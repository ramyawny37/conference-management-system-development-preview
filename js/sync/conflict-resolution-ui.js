(function(global){
  'use strict';
  var busy=false;
  var review=null;
  var plan=null;
  var execution=null;
  var decisions=Object.create(null);
  var message='';
  var pendingRecord=null;
  var persistentLoadedFor=null;
  var finalizationPending=false;

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function deps(options){
    options=options||{};
    return {
      planner:options.planner||global.ConflictResolution,
      executor:options.executor||global.ConflictExecutor,
      remote:options.remote||global.SupabaseSnapshotSync,
      links:options.links||global.ConferenceLinkStore,
      queue:options.queue||global.OfflineSyncQueue,
      adapter:options.adapter||global.LocalSnapshotApplication,
      pending:options.pending||global.PendingRemoteApplicationStore,
      drafts:options.drafts||global.ConflictResolutionDraftStore
    };
  }
  function safe(ok,status,data){
    return {ok:ok,status:status,data:data||null,error:ok?null:{
      code:status,message:'تعذر إكمال العملية بأمان.'
    }};
  }
  function loadConflict(input,options){
    input=input||{};
    var d=deps(options), link=d.links.get(input.localConferenceId);
    if(!link)return Promise.resolve(safe(false,'link_not_found'));
    var fetch=link.conflictId
      ?d.planner.getConflict(link.conflictId)
      :d.planner.listConferenceConflicts(link.remoteConferenceId,{status:'pending'})
        .then(function(result){
          var items=result&&result.data&&result.data.conflicts||[];
          return items.length
            ?{ok:true,status:'loaded',data:items[0]}
            :safe(false,'conflict_not_found');
        });
    return fetch.then(function(result){
      if(!result||!result.ok||!result.data)return safe(false,'conflict_not_found');
      var conflict=copy(result.data);
      var server=conflict.serverSnapshot
        ?Promise.resolve({ok:true,status:'downloaded',data:{
          snapshot:conflict.serverSnapshot,revision:conflict.actualRevision
        }})
        :d.remote.downloadSnapshot(link.remoteConferenceId);
      return server.then(function(download){
        if(!download||!download.ok||!download.data)return safe(false,'download_failed');
        var local=copy(input.localSnapshot);
        var remoteSnapshot=copy(download.data.snapshot);
        var compared=d.planner.compareSnapshots(local,remoteSnapshot);
        if(!compared.ok)return safe(false,'compare_failed');
        var classified=d.planner.classifyConflict(compared.data);
        if(!classified.ok)return safe(false,'classify_failed');
        review={
          localConferenceId:input.localConferenceId,
          remoteConferenceId:link.remoteConferenceId,
          remoteName:link.remoteName,
          conflict:conflict,
          localSnapshot:local,
          serverSnapshot:remoteSnapshot,
          comparison:copy(compared.data),
          classification:copy(classified.data)
        };
        plan=null;execution=null;decisions=Object.create(null);
        d.links.save(Object.assign({},link,{
          conflictId:conflict.conflictId,
          conflictStatus:'reviewed',
          actualRevision:conflict.actualRevision,
          linkStatus:'needs_resolution',
          lastConflictAt:conflict.createdAt||new Date().toISOString()
        }));
        return safe(true,'reviewed',copy({
          comparison:review.comparison,
          classification:review.classification,
          conflict:review.conflict
        }));
      });
    }).catch(function(){return safe(false,'load_failed');});
  }
  function setDecision(index,source){
    if(!review||!Number.isInteger(index)||index<0||
      index>=review.comparison.changes.length||
      (source!=='local'&&source!=='server'))return false;
    var change=review.comparison.changes[index];
    if(change.type==='unchanged')return false;
    decisions[change.path]=source;
    return true;
  }
  function buildPlan(strategy,options){
    if(!review)return safe(false,'review_required');
    var d=deps(options), conflict=review.conflict;
    var v={
      schemaVersion:String(options&&options.schemaVersion||'1'),
      appVersion:String(options&&options.appVersion||
        global.APP_RELEASE&&global.APP_RELEASE.version||'unknown')
    };
    var input={
      conflictId:conflict.conflictId,
      conferenceId:review.remoteConferenceId,
      operationId:conflict.operationId,
      strategy:strategy,
      baseRevision:conflict.expectedRevision,
      actualRevision:conflict.actualRevision,
      localSnapshot:copy(review.localSnapshot),
      serverSnapshot:copy(review.serverSnapshot),
      schemaVersion:v.schemaVersion,
      appVersion:v.appVersion
    };
    if(strategy==='manual')input.resolutionMap=copy(decisions);
    var result=d.planner.buildResolutionPlan(input);
    if(!result.ok)return safe(false,'plan_invalid');
    var validation=d.planner.validateResolutionPlan(result.data);
    if(!validation.ok)return safe(false,'plan_invalid');
    plan=copy(result.data);
    execution=null;
    return safe(true,'planned',{plan:copy(plan)});
  }
  function finalizeResolution(localConferenceId,options){
    var d=deps(options);
    return d.drafts.get(localConferenceId).then(function(draftResult){
      if(!draftResult.ok)return safe(false,'draft_not_found');
      var draft=draftResult.data;
      if(['executed','finalizing'].indexOf(draft.executionStatus)<0){
        return safe(false,draft.executionStatus==='stale'
          ?'stale_resolution':'finalization_not_ready');
      }
      var result=draft.executionResult;
      var storedPlan=draft.plan;
      var revision=draft.resolvedRevision;
      var keepServer=storedPlan.strategy==='keep_server';
      var flags=draft.finalization;
      var sequence=Promise.resolve();
      if(!flags.pendingApplicationStored){
        sequence=sequence.then(function(){
          if(!keepServer)return {ok:true,data:null};
          return d.pending.save({
            localConferenceId:localConferenceId,
            remoteConferenceId:storedPlan.conferenceId,
            conflictId:storedPlan.conflictId,
            resolutionStrategy:'keep_server',
            resolutionOperationId:storedPlan.resolutionOperationId,
            resolvedRevision:revision,
            resolvedSnapshot:copy(storedPlan.resolvedSnapshot)
          });
        }).then(function(pendingResult){
          if(!pendingResult.ok)throw new Error('PENDING_APPLICATION_STORE_FAILED');
          pendingRecord=pendingResult.data||pendingRecord;
          return d.drafts.updateFinalization(localConferenceId,{
            pendingApplicationStored:true
          });
        }).then(function(updated){flags=updated.data.finalization;});
      }
      sequence=sequence.then(function(){
        if(flags.linkMetadataUpdated)return null;
        var link=d.links.get(localConferenceId);
        if(!link)throw new Error('LINK_METADATA_MISSING');
        var metadata=d.links.save(Object.assign({},link,{
          knownRevision:revision,
          resolvedRevision:revision,
          conflictStatus:'resolved',
          resolutionStrategy:storedPlan.strategy,
          resolutionOperationId:storedPlan.resolutionOperationId,
          pendingLocalApplication:keepServer,
          linkStatus:keepServer
            ?'server_selected_pending_local_apply':'linked',
          lastResolvedAt:new Date().toISOString()
        }));
        if(!metadata.ok)throw new Error('LINK_METADATA_UPDATE_FAILED');
        return d.drafts.updateFinalization(localConferenceId,{
          linkMetadataUpdated:true
        }).then(function(updated){flags=updated.data.finalization;});
      }).then(function(){
        if(flags.queueUpdated)return null;
        if(!storedPlan.sourceOperationId){
          return d.drafts.updateFinalization(localConferenceId,{
            queueUpdated:true
          }).then(function(updated){flags=updated.data.finalization;});
        }
        if(!d.queue||!d.queue.markConflictResolved){
          throw new Error('QUEUE_UPDATE_UNAVAILABLE');
        }
        return d.queue.markConflictResolved(storedPlan.sourceOperationId,{
          conflictId:storedPlan.conflictId,
          resolutionOperationId:storedPlan.resolutionOperationId,
          strategy:storedPlan.strategy,
          revision:revision
        }).then(function(queueResult){
          if(!queueResult.ok)throw new Error('QUEUE_UPDATE_FAILED');
          return d.drafts.updateFinalization(localConferenceId,{
            queueUpdated:true
          });
        }).then(function(updated){flags=updated.data.finalization;});
      }).then(function(){
        return d.drafts.markCompleted(localConferenceId);
      }).then(function(completed){
        if(!completed.ok)throw new Error('DRAFT_COMPLETION_FAILED');
        execution=result;
        return safe(true,'finalization_completed',{
          executionResult:copy(result)
        });
      }).catch(function(error){
        return safe(false,'finalization_incomplete',{
          reason:error&&error.message
        });
      });
      return sequence;
    }).catch(function(){return safe(false,'finalization_incomplete');});
  }
  function execute(options){
    if(busy)return Promise.resolve(safe(false,'busy'));
    if(!plan||!review)return Promise.resolve(safe(false,'plan_required'));
    if(plan.conferenceId!==review.remoteConferenceId||
      plan.conflictId!==review.conflict.conflictId){
      return Promise.resolve(safe(false,'plan_scope_mismatch'));
    }
    busy=true;
    var d=deps(options), planCopy=copy(plan);
    return d.drafts.save(review.localConferenceId,planCopy)
      .then(function(draftResult){
        if(!draftResult.ok)return safe(false,'draft_storage_failed');
        if(['executed','finalizing'].indexOf(
          draftResult.data.executionStatus
        )>=0){
          return finalizeResolution(review.localConferenceId,options);
        }
        if(draftResult.data.executionStatus==='completed'){
          return safe(false,'resolution_already_completed');
        }
        if(draftResult.data.executionStatus==='stale'){
          return safe(false,'stale_resolution');
        }
        return d.executor.executeResolutionPlan(planCopy).then(function(result){
          execution=result;
          if(result&&result.status==='conflict_changed'){
            plan=null;
            message='تغير التعارض؛ أعد تحميله قبل إنشاء خطة جديدة.';
            var changedLink=d.links.get(review.localConferenceId);
            if(changedLink){
              d.links.save(Object.assign({},changedLink,{
                linkStatus:'needs_resolution',
                conflictStatus:'changed',
                actualRevision:result.data&&result.data.actualRevision
              }));
            }
            return d.drafts.markStale(
              review.localConferenceId,result
            ).then(function(){return result;});
          }
          if(!result||!result.ok)return result||safe(false,'execution_failed');
          var revision=result.data&&result.data.resolvedRevision;
          if(!Number.isInteger(revision)){
            return safe(false,result.status==='duplicate'
              ?'duplicate_revision_missing':'resolved_revision_missing');
          }
          return d.drafts.saveExecutionResult(
            review.localConferenceId,result
          ).then(function(saved){
            if(!saved.ok)return safe(false,'execution_result_storage_failed');
            return finalizeResolution(review.localConferenceId,options);
          });
        });
      }).catch(function(){return safe(false,'execution_failed');})
      .then(function(result){
        finalizationPending=result&&result.status==='finalization_incomplete';
        if(result&&result.status==='finalization_completed'){
          finalizationPending=false;
        }
        busy=false;
        return result;
      });
  }
  function applyServerLocally(input,options){
    input=input||{};
    var d=deps(options);
    var localId=input.localConferenceId||
      review&&review.localConferenceId||
      pendingRecord&&pendingRecord.localConferenceId;
    var link=d.links.get(localId);
    if(!link||!pendingRecord||pendingRecord.status!=='pending'||
      !link.pendingLocalApplication){
      return Promise.resolve(safe(false,'server_apply_mismatch'));
    }
    return d.adapter.apply({
      record:copy(pendingRecord),
      link:copy(link)
    },input).then(function(result){
      if(!result.ok)return result;
      var metadata=d.links.save(Object.assign({},link,{
        linkStatus:'linked',
        pendingLocalApplication:false
      }));
      if(!metadata.ok)return safe(false,'metadata_update_failed');
      return d.pending.mark(localId,'applied').then(function(marked){
        if(!marked.ok){
          d.links.save(Object.assign({},link,{
            linkStatus:'server_selected_pending_local_apply',
            pendingLocalApplication:true
          }));
          return safe(false,'pending_status_update_failed');
        }
        pendingRecord=marked.data;
        return safe(true,'applied_local',result.data);
      });
    });
  }
  function restorePersistentState(localConferenceId,options){
    var d=deps(options), link=d.links.get(localConferenceId);
    return Promise.all([
      d.pending.get(localConferenceId),
      d.drafts.get(localConferenceId)
    ]).then(function(results){
      pendingRecord=results[0].ok&&results[0].data.status==='pending'
        ?results[0].data:null;
      var draft=results[1].ok?results[1].data:null;
      finalizationPending=!!(draft&&
        ['executed','finalizing'].indexOf(draft.executionStatus)>=0);
      if(draft){
        var validation=d.planner.validateResolutionPlan(draft.plan);
        if(validation&&validation.ok&&link&&
          draft.plan.conferenceId===link.remoteConferenceId&&
          link.conflictStatus!=='changed'&&
          draft.executionStatus!=='stale'&&
          draft.executionStatus!=='completed'){
          plan=copy(draft.plan);
          review={
            localConferenceId:String(localConferenceId),
            remoteConferenceId:link.remoteConferenceId,
            remoteName:link.remoteName,
            conflict:{
              conflictId:plan.conflictId,
              operationId:plan.sourceOperationId||null,
              expectedRevision:plan.sourceRevision,
              actualRevision:plan.actualRevision
            },
            localSnapshot:null,
            serverSnapshot:copy(plan.resolvedSnapshot),
            comparison:{summary:{added:0,removed:0,changed:0},changes:[]},
            classification:{level:'unknown'}
          };
        }
      }
      return safe(true,'persistent_state_loaded',{
        pending:pendingRecord?copy(pendingRecord):null,
        draft:draft?copy(draft):null,
        finalizationPending:finalizationPending
      });
    }).catch(function(){return safe(false,'persistent_state_load_failed');});
  }
  function esc(value){
    return String(value==null?'':value).replace(/&/g,'&amp;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  function displayValue(value){
    var text;
    try{text=typeof value==='string'?value:JSON.stringify(value);}
    catch(error){text='[قيمة غير قابلة للعرض]';}
    if(/(access.?token|refresh.?token|service.?role|anon.?key)/i.test(text)){
      return '[بيانات حساسة مخفية]';
    }
    return text.length>140?text.slice(0,140)+'…':text;
  }
  function pathLabel(path){
    return String(path||'/').split('/').filter(Boolean).map(function(part){
      if(part.indexOf('@id=')===0)return 'العنصر '+part.slice(4,12)+'…';
      return part;
    }).join(' ← ')||'الجذر';
  }
  function renderSection(input){
    input=input||{};
    var link=input.localConference&&global.ConferenceLinkStore.get(
      input.localConference.id
    );
    var hasConflict=link&&(link.linkStatus==='needs_resolution'||
      link.conflictStatus==='pending'||link.conflictStatus==='reviewed'||
      link.pendingLocalApplication);
    if(!hasConflict)return '';
    if(persistentLoadedFor!==input.localConference.id){
      persistentLoadedFor=input.localConference.id;
      restorePersistentState(input.localConference.id).then(function(){
        if(global.renderSettings)global.renderSettings();
      });
    }
    var html='<section class="settings-section conflict-ui-section">'+
      '<div class="settings-section-title">مراجعة تعارض المزامنة</div>'+
      '<div class="sync-settings-message sync-settings-error">'+
      'توقفت المزامنة بسبب تعارض ولم تُعدّل البيانات المحلية.</div>'+
      '<button class="btn btn-orange btn-sm" onclick="ConflictResolutionUI.reviewCurrent()">مراجعة التعارض</button>';
    if(review&&review.localConferenceId===input.localConference.id){
      var summary=review.comparison.summary;
      html+='<div class="sync-link-summary"><span>المحلي: '+
        esc(input.localConference.name)+'</span><span>الخادم: '+
        esc(review.remoteName||'—')+'</span><span>المصدر: '+
        (review.conflict.operationId?'Queue sync conflict':'Initial linking conflict')+
        '</span><span>وقت الاكتشاف: '+esc(review.conflict.createdAt||'—')+
        '</span><span>الخطورة: '+
        esc(review.classification.level)+'</span><span>Added: '+
        summary.added+'</span><span>Removed: '+summary.removed+
        '</span><span>Changed: '+summary.changed+'</span><span>Expected: '+
        review.conflict.expectedRevision+'</span><span>Actual: '+
        review.conflict.actualRevision+'</span></div><div class="conflict-change-list">';
      review.comparison.changes.forEach(function(change,index){
        if(change.type==='unchanged')return;
        var sensitive=/(people|person|guest|child|guardian|room|house|capacity|assignment)/i
          .test(change.path);
        var forbidden=/(token|password|session|supabase|anon.?key|service.?role)/i
          .test(change.path);
        html+='<div class="conflict-change-item"><strong>'+
          (sensitive?'⚠️ ':'')+esc(pathLabel(change.path))+'</strong>'+
          '<span>'+esc(change.type)+'</span><small>محلي: '+
          esc(forbidden?'[بيانات حساسة مخفية]':displayValue(change.localValue))+
          '</small><small>الخادم: '+
          esc(forbidden?'[بيانات حساسة مخفية]':displayValue(change.serverValue))+
          '</small>'+
          "<div><button class=\"btn btn-gray btn-sm\" onclick=\"ConflictResolutionUI.choose("+
          index+",'local')\">المحلي</button> <button class=\"btn btn-gray btn-sm\" onclick=\"ConflictResolutionUI.choose("+
          index+",'server')\">الخادم</button></div></div>";
      });
      html+='</div><div class="sync-settings-actions">'+
        "<button class=\"btn btn-blue btn-sm\" onclick=\"ConflictResolutionUI.prepare('keep_local')\">الاحتفاظ بالمحلي</button>"+
        "<button class=\"btn btn-purple btn-sm\" onclick=\"ConflictResolutionUI.prepare('keep_server')\">الاحتفاظ بالخادم</button>"+
        "<button class=\"btn btn-orange btn-sm\" onclick=\"ConflictResolutionUI.prepare('manual')\">اختيار يدوي</button></div>";
    }
    if(plan&&!finalizationPending){
      html+='<div class="conflict-plan-preview">الاستراتيجية: '+esc(plan.strategy)+
        ' · القرارات: '+Number(plan.selectedPaths&&plan.selectedPaths.length||0)+
        ' · Revision: '+plan.baseRevision+' · Operation: '+
        esc(plan.resolutionOperationId.slice(0,8))+
        '…<br>إذا تغيرت Revision أثناء المراجعة يجب تحميل التعارض من جديد.</div>'+
        '<button class="btn btn-red btn-sm" onclick="ConflictResolutionUI.executeCurrent()">تنفيذ حل التعارض</button>';
    }
    if(finalizationPending){
      html+='<div class="sync-settings-message sync-settings-error">'+
        'تم تنفيذ الحل، ويحتاج استكمال تسجيل الحالة محليًا.</div>'+
        '<button class="btn btn-orange btn-sm" '+
        'onclick="ConflictResolutionUI.finalizeCurrent()">استكمال إنهاء حل التعارض</button>';
    }
    if(link.pendingLocalApplication&&pendingRecord&&
      pendingRecord.status==='pending'){
      html+='<button class="btn btn-red btn-sm" onclick="ConflictResolutionUI.applyCurrentServer()">تطبيق نسخة الخادم على هذا الجهاز</button>';
    }
    return html+'<div class="sync-settings-message">'+esc(message)+'</div></section>';
  }
  function current(){
    var conference=global.getCurrentConference&&global.getCurrentConference();
    return {localConferenceId:conference&&conference.id,
      localSnapshot:conference?copy(conference):null};
  }
  function refresh(text){message=text||'';if(global.renderSettings)global.renderSettings();}
  function reviewCurrent(){
    loadConflict(current()).then(function(result){
      refresh(result.ok?'تم تحميل تفاصيل التعارض للمعاينة.':'تعذر تحميل التعارض.');
    });
  }
  function choose(index,source){
    setDecision(index,source);refresh('تم تسجيل الاختيار محليًا.');
  }
  function prepare(strategy){
    var result=buildPlan(strategy);
    refresh(result.ok?'تم إعداد Preview للخطة.':'الخطة غير مكتملة أو غير صالحة.');
  }
  function executeCurrent(){
    execute().then(function(result){
      refresh(result&&result.ok?'تم تنفيذ قرار التعارض على الخادم.':
        'تعذر تنفيذ الخطة، ويمكن إعادة المحاولة بنفس الخطة.');
    });
  }
  function finalizeCurrent(){
    var input=current();
    finalizeResolution(input.localConferenceId).then(function(result){
      finalizationPending=!result.ok;
      refresh(result.ok?'اكتمل تسجيل نتيجة حل التعارض.':
        'لم يكتمل التسجيل المحلي ويمكن إعادة المحاولة.');
    });
  }
  function applyCurrentServer(){
    if(!global.confirm||!global.confirm(
      'سيتم استبدال بيانات المؤتمر المحلية بعد إنشاء نسخة احتياطية. هل تريد المتابعة؟'
    ))return;
    applyServerLocally({
      localConferenceId:current().localConferenceId,
      appData:global.appData,
      applyMemory:function(value){global.appData=value;},
      render:function(){
        if(global.syncCurrentConferenceRefs)global.syncCurrentConferenceRefs();
      }
    }).then(function(result){
      refresh(result.ok?'تم تطبيق نسخة الخادم محليًا بعد إنشاء Backup.':
        'لم يتم تطبيق النسخة المحلية.');
    });
  }
  global.ConflictResolutionUI=Object.freeze({
    loadConflict:loadConflict,setDecision:setDecision,buildPlan:buildPlan,
    execute:execute,finalizeResolution:finalizeResolution,
    applyServerLocally:applyServerLocally,
    restorePersistentState:restorePersistentState,
    renderSection:renderSection,reviewCurrent:reviewCurrent,choose:choose,
    prepare:prepare,executeCurrent:executeCurrent,
    applyCurrentServer:applyCurrentServer,
    finalizeCurrent:finalizeCurrent
  });
})(window);
