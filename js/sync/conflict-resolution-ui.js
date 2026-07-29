(function(global){
  'use strict';
  var busy=false;
  var review=null;
  var plan=null;
  var execution=null;
  var decisions=Object.create(null);
  var message='';
  var pendingRecord=null;
  var pendingTrusted=false;
  var persistentLoadedFor=null;
  var finalizationPending=false;
  var remoteApplicationEnabled=true;
  var persistentStateError=false;

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
      drafts:options.drafts||global.ConflictResolutionDraftStore,
      finalizer:options.finalizer||global.ConflictFinalizationService
    };
  }
  function safe(ok,status,data){
    return {ok:ok,status:status,data:data||null,error:ok?null:{
      code:status,message:'تعذر إكمال العملية بأمان.'
    }};
  }
  function scheduleStateRefresh(options){
    var orchestrator=options&&options.orchestrator||
      global.AutomaticSyncOrchestrator;
    if(orchestrator&&typeof orchestrator.schedule==='function'){
      orchestrator.schedule('conference_changed');
    }
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
    if(!d.finalizer||typeof d.finalizer.finalize!=='function'){
      return Promise.resolve(safe(false,'finalization_unavailable'));
    }
    return d.finalizer.finalize(localConferenceId,options)
      .then(function(result){
        scheduleStateRefresh(options);
        if(result&&result.ok){
          execution=result;
          persistentLoadedFor=null;
          pendingRecord=null;
          pendingTrusted=false;
        }
        return result||safe(false,'finalization_incomplete');
      }).catch(function(){
        return safe(false,'finalization_incomplete');
      });
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
            scheduleStateRefresh(options);
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
    if(!d.adapter||typeof d.adapter.apply!=='function'){
      return Promise.resolve(safe(false,'local_application_unavailable'));
    }
    return d.adapter.apply({localConferenceId:localId},input);
  }
  function restorePersistentState(localConferenceId,options){
    var d=deps(options), link=d.links.get(localConferenceId);
    review=null;
    plan=null;
    execution=null;
    pendingRecord=null;
    pendingTrusted=false;
    finalizationPending=false;
    persistentStateError=false;
    return Promise.all([
      d.pending.get(localConferenceId),
      d.drafts.get(localConferenceId)
    ]).then(function(results){
      if(!results[0]||!results[1]||
        !results[0].ok&&results[0].status!=='not_found'||
        !results[1].ok&&results[1].status!=='not_found'){
        throw new Error('PERSISTENT_STATE_READ_FAILED');
      }
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
      var verification=pendingRecord&&d.pending&&
        typeof d.pending.verify==='function'
        ?d.pending.verify(pendingRecord)
        :Promise.resolve(false);
      return verification.then(function(valid){
        pendingTrusted=!!(valid&&link&&
          pendingRecord.localConferenceId===String(localConferenceId)&&
          pendingRecord.remoteConferenceId===link.remoteConferenceId&&
          pendingRecord.conflictId===link.conflictId&&
          pendingRecord.resolutionOperationId===
            link.resolutionOperationId&&
          pendingRecord.resolvedRevision===link.resolvedRevision&&
          link.linkStatus==='server_selected_pending_local_apply'&&
          link.pendingLocalApplication===true);
        return safe(true,'persistent_state_loaded',{
          pending:pendingRecord?copy(pendingRecord):null,
          draft:draft?copy(draft):null,
          finalizationPending:finalizationPending,
          pendingTrusted:pendingTrusted
        });
      });
    }).catch(function(){
      review=null;
      plan=null;
      execution=null;
      pendingRecord=null;
      pendingTrusted=false;
      finalizationPending=false;
      persistentStateError=true;
      return safe(false,'persistent_state_load_failed');
    });
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
      link.conflictStatus==='active'||link.conflictStatus==='pending'||
      link.conflictStatus==='reviewed'||link.conflictStatus==='changed'||
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
      (persistentStateError?'':'<button class="btn btn-orange btn-sm" onclick="ConflictResolutionUI.reviewCurrent()">مراجعة التعارض</button>');
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
    if(remoteApplicationEnabled&&pendingTrusted&&
      link.linkStatus==='server_selected_pending_local_apply'&&
      link.pendingLocalApplication&&pendingRecord&&
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
    var localConferenceId=current().localConferenceId;
    execute().then(function(result){
      if(current().localConferenceId!==localConferenceId)return;
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
    if(busy)return;
    if(!global.confirm||!global.confirm(
      'سيتم استبدال بيانات المؤتمر المحلية بعد إنشاء نسخة احتياطية. هل تريد المتابعة؟'
    ))return;
    var localConferenceId=current().localConferenceId;
    busy=true;
    applyServerLocally({
      localConferenceId:localConferenceId,
      appData:global.appData,
      applyMemory:function(value){global.appData=value;},
      render:function(){
        if(global.syncCurrentConferenceRefs)global.syncCurrentConferenceRefs();
      }
    }).then(function(result){
      busy=false;
      if(current().localConferenceId!==localConferenceId)return;
      refresh(result.ok?'تم تطبيق نسخة الخادم محليًا بعد إنشاء Backup.':
        'لم يتم تطبيق النسخة المحلية.');
    }).catch(function(){busy=false;});
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
