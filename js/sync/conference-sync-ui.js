(function(global){
  'use strict';
  var busy=false;
  var available=[];
  var listLoaded=false;
  var preview=null;
  var notice='';
  var currentQueueCounts={pending:0,failed:0,conflict:0};

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function outcome(ok,status,data){
    return {ok:ok,status:status,data:data||null,error:ok?null:{
      code:status,message:'تعذر إكمال العملية بأمان.'
    }};
  }
  function uuid(value){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value||''));
  }
  function createUuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes=new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6]=(bytes[6]&15)|64;
      bytes[8]=(bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var text=byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10?'-'+text:text;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }
  function deps(options){
    options=options||{};
    return {
      links:options.links||global.ConferenceLinkStore,
      remote:options.remote||global.SupabaseSnapshotSync,
      integration:options.integration||global.OfflineFirstIntegration,
      queue:options.queue||global.OfflineSyncQueue,
      comparer:options.comparer||global.ConflictResolution,
      config:options.config||global.SupabaseRuntimeConfig,
      auth:options.auth||global.SupabaseAuth,
      device:options.device||global.SupabaseDeviceIdentity
    };
  }
  function version(options){
    return {
      schemaVersion:String(options&&options.schemaVersion||'1'),
      appVersion:String(options&&options.appVersion||
        global.APP_RELEASE&&global.APP_RELEASE.version||'unknown')
    };
  }
  function readiness(options){
    var d=deps(options);
    var configured=d.config&&d.config.getPublicState&&
      d.config.getPublicState().configured;
    var signedIn=d.auth&&d.auth.getState&&d.auth.getState().authenticated;
    var device=null;
    try{device=d.device&&d.device.getOrCreate&&d.device.getOrCreate();}
    catch(error){}
    var reasons=[];
    if(!configured)reasons.push('إعداد Supabase غير موجود.');
    if(!signedIn)reasons.push('يجب تسجيل الدخول.');
    if(!device||!uuid(device.id))reasons.push('هوية الجهاز غير متاحة.');
    return {ready:!reasons.length,reasons:reasons,device:device};
  }
  function restoreContext(localId,options){
    var d=deps(options);
    var link=d.links.get(localId);
    if(!link)return outcome(false,'link_not_found');
    var v=version(options);
    var result=d.integration.configureConferenceSync(localId,{
      conferenceId:link.remoteConferenceId,
      baseRevision:link.knownRevision,
      schemaVersion:v.schemaVersion,
      appVersion:v.appVersion
    });
    return result&&result.ok
      ?outcome(true,'context_restored',{link:link})
      :outcome(false,'context_failed');
  }
  function saveLink(d,input,diagnosticWriter){
    return d.links.save(input,diagnosticWriter?{
      diagnosticWriter:diagnosticWriter
    }:undefined);
  }

  function createOnlineConference(input,options){
    input=input||{};
    var service=options&&options.linkingService||
      global.ConferenceLinkingService;
    if(!service||typeof service.ensureConferenceLinked!=='function'){
      return Promise.resolve(outcome(false,'linking_service_unavailable'));
    }
    return service.ensureConferenceLinked({
      localConferenceId:input.localConferenceId,
      name:input.name,
      snapshot:input.snapshot,
      mode:'manual',
      reason:'manual_button'
    },options&&options.linkingOptions||options);
  }
  function listAvailable(options){
    var ready=readiness(options), d=deps(options);
    if(!ready.ready)return Promise.resolve(outcome(false,'prerequisites_missing'));
    return d.remote.listAvailableConferences().then(function(result){
      if(!result||!result.ok)return outcome(false,'list_failed');
      available=copy(result.data.conferences||[]).filter(function(item){
        return item&&uuid(item.id);
      });
      listLoaded=true;
      return outcome(true,'listed',{conferences:copy(available)});
    }).catch(function(){return outcome(false,'network_error');});
  }
  function allowed(remoteId){
    return available.some(function(item){return item.id===remoteId;});
  }
  function previewRemote(input,options){
    input=input||{};
    var d=deps(options);
    if(!listLoaded||!allowed(input.remoteConferenceId)){
      return Promise.resolve(outcome(false,'remote_not_available'));
    }
    var local=copy(input.localSnapshot);
    return d.remote.downloadSnapshot(input.remoteConferenceId).then(function(result){
      if(!result||!result.ok)return outcome(false,'download_failed');
      if(result.status==='not_found'){
        preview={
          localConferenceId:input.localConferenceId,
          remoteConferenceId:input.remoteConferenceId,
          remoteEmpty:true,revision:0
        };
        return outcome(true,'remote_empty',copy(preview));
      }
      var compared=d.comparer.compareSnapshots(
        local,copy(result.data.snapshot)
      );
      if(!compared||!compared.ok)return outcome(false,'compare_failed');
      var summary=compared.data.summary||{};
      var differs=Number(summary.added||0)+Number(summary.removed||0)+
        Number(summary.changed||0)>0;
      preview={
        localConferenceId:input.localConferenceId,
        remoteConferenceId:input.remoteConferenceId,
        remoteEmpty:false,
        revision:result.data.revision,
        comparison:copy(summary),
        differs:differs
      };
      if(differs)saveLink(d,{
        localConferenceId:input.localConferenceId,
        remoteConferenceId:input.remoteConferenceId,
        remoteName:input.remoteName,
        knownRevision:result.data.revision,
        actualRevision:result.data.revision,
        linkStatus:'needs_resolution'
      },{
        writerName:'ConferenceSyncUI.previewRemote',
        incomingRevision:Number.isInteger(result.data.revision)
          ?result.data.revision:null,
        reason:'remote_preview_differs',
        trigger:'previewRemote'
      });
      if(!differs){
        saveLink(d,{
          localConferenceId:input.localConferenceId,
          remoteConferenceId:input.remoteConferenceId,
          remoteName:input.remoteName,
          knownRevision:result.data.revision,
          linkStatus:'linked'
        });
        restoreContext(input.localConferenceId,options);
      }
      return outcome(true,differs?'needs_resolution':'matching',copy(preview));
    }).catch(function(){return outcome(false,'network_error');});
  }
  function linkEmptyRemote(input,options){
    input=input||{};
    if(!readiness(options).ready){
      return Promise.resolve(outcome(false,'prerequisites_missing'));
    }
    if(!preview||!preview.remoteEmpty||
      preview.localConferenceId!==input.localConferenceId||
      preview.remoteConferenceId!==input.remoteConferenceId){
      return Promise.resolve(outcome(false,'preview_required'));
    }
    var d=deps(options), v=version(options), snapshot=copy(input.localSnapshot);
    return d.remote.uploadInitialSnapshot({
      conferenceId:input.remoteConferenceId,
      snapshot:snapshot,
      schemaVersion:v.schemaVersion,
      appVersion:v.appVersion
    }).then(function(result){
      if(!result||!result.ok||
        ['applied','duplicate'].indexOf(result.status)<0){
        return outcome(false,'upload_failed');
      }
      saveLink(d,{
        localConferenceId:input.localConferenceId,
        remoteConferenceId:input.remoteConferenceId,
        remoteName:input.remoteName,
        knownRevision:result.data.revision,
        linkStatus:'linked',
        initialOperationId:result.data.operationId
      });
      restoreContext(input.localConferenceId,options);
      return outcome(true,'linked',{revision:result.data.revision});
    }).catch(function(){return outcome(false,'network_error');});
  }
  function queueStatus(localId,options){
    var d=deps(options), link=d.links.get(localId);
    if(!link)return Promise.resolve({
      pending:0,failed:0,conflict:0,readError:false
    });
    return d.queue.getOperationsByConference(link.remoteConferenceId)
      .then(function(result){
        var counts={pending:0,failed:0,conflict:0,readError:false};
        (result.data&&result.data.operations||[]).forEach(function(operation){
          if(counts[operation.status]!==undefined)counts[operation.status]++;
        });
        return counts;
      }).catch(function(){
        return {pending:0,failed:0,conflict:0,readError:true};
      });
  }
  function syncNow(input,options){
    input=input||{};
    if(busy)return Promise.resolve(outcome(false,'busy'));
    var d=deps(options), link=d.links.get(input.localConferenceId);
    if(!readiness(options).ready||!link||link.linkStatus!=='linked'){
      return Promise.resolve(outcome(false,'sync_unavailable'));
    }
    busy=true;
    restoreContext(input.localConferenceId,options);
    var state=d.integration.getConferenceSyncState(input.localConferenceId);
    var queued=state.unsynced&&input.appSnapshot
      ?d.integration.handleLocalSave(copy(input.appSnapshot))
      :Promise.resolve(null);
    return queued.then(function(){return d.integration.triggerSync();})
      .then(function(result){
        var current=d.integration.getConferenceSyncState(input.localConferenceId);
        var revision=current.context&&current.context.baseRevision;
        var batch=result&&result.data&&result.data.syncResult&&
          result.data.syncResult.data;
        var conflictResult=batch&&Array.isArray(batch.results)
          ?batch.results.find(function(item){return item&&item.status==='conflict';})
          :null;
        var conflictId=conflictResult&&conflictResult.data&&
          conflictResult.data.conflictId||null;
        if(Number.isInteger(revision))saveLink(d,{
          localConferenceId:link.localConferenceId,
          remoteConferenceId:link.remoteConferenceId,
          remoteName:link.remoteName,
          knownRevision:revision,
          actualRevision:current.conflictActualRevision,
          linkStatus:current.conflictActualRevision===null?'linked':'needs_resolution',
          initialOperationId:link.initialOperationId,
          conflictId:conflictId,
          conflictStatus:conflictId?'pending':null,
          lastConflictAt:conflictId?new Date().toISOString():null
        },current.conflictActualRevision===null?null:{
          writerName:'ConferenceSyncUI.syncNow',
          incomingRevision:Number.isInteger(current.conflictActualRevision)
            ?current.conflictActualRevision:null,
          reason:'manual_sync_conflict',
          trigger:'syncNow'
        });
        return result&&result.ok?outcome(true,'completed',result.data):
          outcome(false,'sync_failed');
      }).catch(function(){return outcome(false,'sync_failed');})
      .then(function(result){busy=false;return result;});
  }
  function unlink(localId,options){
    var d=deps(options);
    return queueStatus(localId,options).then(function(counts){
      if(counts.readError)return outcome(false,'queue_read_failed');
      if(counts.pending||counts.conflict){
        return outcome(false,'confirmation_required',{counts:counts});
      }
      var result=d.links.remove(localId);
      if(result.ok)d.integration.removeConferenceSync(localId);
      return result.ok?outcome(true,'disconnected'):outcome(false,'unlink_failed');
    });
  }
  function forceUnlink(localId,options){
    var d=deps(options), result=d.links.remove(localId);
    if(result.ok)d.integration.removeConferenceSync(localId);
    return result.ok?outcome(true,'disconnected'):outcome(false,'unlink_failed');
  }
  function esc(value){
    return String(value==null?'':value).replace(/&/g,'&amp;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function renderSection(input){
    input=input||{};
    var local=input.localConference;
    var link=local&&global.ConferenceLinkStore.get(local.id);
    var ready=readiness();
    var integrationState=local&&global.OfflineFirstIntegration&&
      global.OfflineFirstIntegration.getConferenceSyncState
      ?global.OfflineFirstIntegration.getConferenceSyncState(local.id)
      :null;
    var globalSyncState=global.OfflineFirstIntegration&&
      global.OfflineFirstIntegration.getState
      ?global.OfflineFirstIntegration.getState()
      :null;
    var html='<section class="settings-section sync-settings-section">'+
      '<div class="settings-section-title">ربط المؤتمر والمزامنة اليدوية</div>';
    if(!local)return html+'<div class="settings-empty-state">اختر مؤتمرًا محليًا أولًا.</div></section>';
    html+='<div class="sync-link-summary"><strong>'+esc(local.name)+'</strong>'+
      '<span>Local ID: '+esc(String(local.id).slice(0,8))+'…</span>'+
      '<span>الحالة: '+esc(link?link.linkStatus:'غير مرتبط')+'</span>'+
      '<span>Revision: '+esc(link?link.knownRevision:'—')+'</span>'+
      '<span>Pending: '+currentQueueCounts.pending+'</span>'+
      '<span>Failed: '+currentQueueCounts.failed+'</span>'+
      '<span>Conflict: '+currentQueueCounts.conflict+'</span>'+
      '<span>Unsynced: '+esc(integrationState&&integrationState.unsynced
        ?integrationState.unsynced.reason:'لا')+'</span></div>';
    if(!ready.ready)html+='<div class="sync-settings-message sync-settings-error">'+
      esc(ready.reasons.join(' '))+'</div>';
    html+='<div class="sync-settings-actions">'+
      '<button class="btn btn-blue btn-sm" '+(!ready.ready?'disabled':'')+
      ' onclick="ConferenceSyncUI.createCurrentOnline()">إنشاء نسخة أونلاين لهذا المؤتمر</button>'+
      '<button class="btn btn-gray btn-sm" '+(!ready.ready?'disabled':'')+
      ' onclick="ConferenceSyncUI.loadAvailableForCurrent()">عرض المؤتمرات المتاحة</button>'+
      '<button class="btn btn-green btn-sm" '+(!link||link.linkStatus!=='linked'?'disabled':'')+
      ' onclick="ConferenceSyncUI.syncCurrentNow()">مزامنة الآن</button>'+
      '<button class="btn btn-gray btn-sm" '+(!link?'disabled':'')+
      ' onclick="ConferenceSyncUI.restoreCurrentContext()">تهيئة الربط</button>'+
      '<button class="btn btn-gray btn-sm" '+(!link?'disabled':'')+
      ' onclick="ConferenceSyncUI.refreshCurrentQueueStatus()">تحديث حالة العمليات</button>'+
      '<button class="btn btn-red btn-sm" '+(!link?'disabled':'')+
      ' onclick="ConferenceSyncUI.unlinkCurrent()">فك الربط المحلي</button></div>'+
      '<div class="sync-settings-message">'+esc(notice)+'</div>';
    if(preview&&preview.remoteEmpty&&preview.localConferenceId===local.id){
      html+='<button class="btn btn-orange btn-sm" '+
        'onclick="ConferenceSyncUI.linkCurrentEmptyRemote()">استخدام المحلي كبداية</button>';
    }
    if(preview&&preview.comparison&&preview.localConferenceId===local.id){
      html+='<div class="sync-link-summary"><span>Added: '+
        Number(preview.comparison.added||0)+'</span><span>Removed: '+
        Number(preview.comparison.removed||0)+'</span><span>Changed: '+
        Number(preview.comparison.changed||0)+'</span></div>';
    }
    if(globalSyncState&&globalSyncState.lastSyncAt){
      html+='<div class="sync-settings-message">آخر محاولة مزامنة: '+
        esc(globalSyncState.lastSyncAt)+'</div>';
    }
    if(listLoaded){
      html+='<div class="settings-list">';
      available.forEach(function(remote){
        html+='<div class="settings-list-item"><div><strong>'+esc(remote.name)+
          '</strong><div>'+esc(String(remote.id).slice(0,8))+'… · '+
          esc(remote.role||'')+'</div></div><button class="btn btn-blue btn-sm" '+
          "onclick=\"ConferenceSyncUI.previewCurrentRemote('"+esc(remote.id)+
          "')\">معاينة الربط</button></div>";
      });
      html+='</div>';
    }
    return html+'</section>';
  }
  function current(){
    var conference=global.getCurrentConference&&global.getCurrentConference();
    return {
      localConferenceId:conference&&conference.id,
      name:conference&&conference.name,
      snapshot:conference?copy(conference):null,
      appSnapshot:global.appData?copy(global.appData):null
    };
  }
  function refresh(text){
    notice=text;
    if(global.renderSettings)global.renderSettings();
  }
  function createCurrentOnline(){
    createOnlineConference(current()).then(function(result){
      refresh(result.status==='linked'?'تم إنشاء الربط بنجاح.':
        result.status==='upload_pending'
          ?'تم إنشاء المؤتمر الأونلاين والرفع ما زال معلقًا.':'تعذر إنشاء الربط.');
    });
  }
  function loadAvailableForCurrent(){
    listAvailable().then(function(result){
      refresh(result.ok?'تم تحميل المؤتمرات المتاحة.':'تعذر تحميل القائمة.');
    });
  }
  function previewCurrentRemote(remoteId){
    var input=current();
    var remote=available.find(function(item){return item.id===remoteId;});
    previewRemote({
      localConferenceId:input.localConferenceId,
      localSnapshot:input.snapshot,
      remoteConferenceId:remoteId,
      remoteName:remote&&remote.name
    }).then(function(result){
      refresh(result.status==='remote_empty'?'المؤتمر الأونلاين فارغ.':
        result.status==='needs_resolution'
          ?'البيانات مختلفة وتحتاج إلى حل تعارض.':'تمت المعاينة دون تطبيق البيانات.');
    });
  }
  function syncCurrentNow(){
    syncNow(current()).then(function(result){
      var summary=result.data&&result.data.syncResult&&
        result.data.syncResult.data||{};
      var duplicateCount=(summary.results||[]).filter(function(item){
        return item&&item.status==='duplicate';
      }).length;
      refresh(result.ok
        ?'اكتملت المزامنة: applied '+Number(summary.applied||0)+
          '، duplicate '+duplicateCount+
          '، failed '+Number(summary.failed||0)+
          '، conflict '+Number(summary.conflicts||0)+'.'
        :'تعذرت المزامنة اليدوية.');
    });
  }
  function restoreCurrentContext(){
    var input=current();
    var result=restoreContext(input.localConferenceId);
    refresh(result.ok?'تمت تهيئة الربط محليًا دون مزامنة.':'تعذر تهيئة الربط.');
  }
  function refreshCurrentQueueStatus(){
    var input=current();
    queueStatus(input.localConferenceId).then(function(counts){
      currentQueueCounts=counts;
      refresh('تم تحديث حالة العمليات المحلية.');
    });
  }
  function linkCurrentEmptyRemote(){
    var input=current();
    var remote=available.find(function(item){
      return preview&&item.id===preview.remoteConferenceId;
    });
    linkEmptyRemote({
      localConferenceId:input.localConferenceId,
      localSnapshot:input.snapshot,
      remoteConferenceId:preview&&preview.remoteConferenceId,
      remoteName:remote&&remote.name
    }).then(function(result){
      refresh(result.ok?'تم ربط المؤتمر باستخدام البيانات المحلية.':
        'تعذر إكمال الربط.');
    });
  }
  function unlinkCurrent(){
    var input=current();
    unlink(input.localConferenceId).then(function(result){
      if(result.status==='confirmation_required'&&global.confirm&&global.confirm(
        'توجد عمليات معلقة أو متعارضة. هل تريد فك الربط دون حذفها؟'
      )){
        forceUnlink(input.localConferenceId).then(function(){
          refresh('تم فك الربط المحلي فقط.');
        });
      }else if(result.status!=='confirmation_required'){
        refresh(result.ok?'تم فك الربط المحلي فقط.':'تعذر فك الربط.');
      }
    });
  }
  global.ConferenceSyncUI=Object.freeze({
    readiness:readiness,restoreContext:restoreContext,
    createOnlineConference:createOnlineConference,listAvailable:listAvailable,
    previewRemote:previewRemote,linkEmptyRemote:linkEmptyRemote,
    queueStatus:queueStatus,syncNow:syncNow,unlink:unlink,
    forceUnlink:forceUnlink,renderSection:renderSection,
    createCurrentOnline:createCurrentOnline,
    loadAvailableForCurrent:loadAvailableForCurrent,
    previewCurrentRemote:previewCurrentRemote,
    syncCurrentNow:syncCurrentNow,unlinkCurrent:unlinkCurrent,
    restoreCurrentContext:restoreCurrentContext,
    refreshCurrentQueueStatus:refreshCurrentQueueStatus,
    linkCurrentEmptyRemote:linkCurrentEmptyRemote
  });
})(window);
