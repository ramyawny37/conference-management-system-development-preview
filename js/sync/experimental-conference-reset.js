(function(global){
  'use strict';
  function reset(localId,options){
    options=options||{};localId=String(localId||'');var stage='validation';
    var link=global.ConferenceLinkStore&&global.ConferenceLinkStore.get(localId);
    if(!link||!link.remoteConferenceId)return Promise.resolve({ok:false,status:'linked_conference_required'});
    if(options.confirmed!==true)return Promise.resolve({ok:false,status:'confirmation_required'});
    stage='stop_runtime';
    var stopped=global.AutomaticSyncOrchestrator&&global.AutomaticSyncOrchestrator.stop();
    var wait=stopped&&stopped.promise||Promise.resolve();
    return Promise.resolve(wait).then(function(){
      stage='release_lock';
      return global.ConferenceEditLockManager?global.ConferenceEditLockManager.release():null;
    }).then(function(){
      stage='discard_queue';
      return global.OfflineSyncQueue.discardConferenceOperations(link.remoteConferenceId);
    }).then(function(discarded){
      if(!discarded||!discarded.ok)throw new Error('QUEUE_DISCARD_FAILED');
      stage='soft_delete_cloud';
      var client=global.SupabaseClientLayer&&global.SupabaseClientLayer.getClient();
      if(!client||typeof client.from!=='function')throw new Error('SUPABASE_UNAVAILABLE');
      return client.from('conferences').update({deleted_at:new Date().toISOString()}).eq('id',link.remoteConferenceId).then(function(response){
        if(response&&response.error)throw response.error;return discarded;
      });
    }).then(function(discarded){
      stage='remove_sync_context';
      var contextRemoved=global.OfflineFirstIntegration&&
        global.OfflineFirstIntegration.removeConferenceSync(localId);
      if(contextRemoved&&contextRemoved.ok===false)throw new Error('SYNC_CONTEXT_REMOVE_FAILED');
      if(global.OfflineFirstIntegration&&
        typeof global.OfflineFirstIntegration.getConferenceSyncState==='function'&&
        global.OfflineFirstIntegration.getConferenceSyncState(localId).context){
        throw new Error('SYNC_CONTEXT_STILL_ACTIVE');
      }
      stage='remove_link';
      var removed=global.ConferenceLinkStore.remove(localId);
      if(!removed||!removed.ok)throw new Error('LINK_REMOVE_FAILED');
      if(global.ConferenceLinkStore.get(localId))throw new Error('LINK_STILL_ACTIVE');
      stage='verify_queue';
      return global.OfflineSyncQueue.getOperationsByConference(link.remoteConferenceId).then(function(read){
        if(!read||!read.ok)throw new Error('QUEUE_VERIFY_FAILED');
        var active=(read.data&&read.data.operations||[]).filter(function(operation){return ['pending','processing','failed','conflict'].indexOf(operation.status)>=0;});
        if(active.length)throw new Error('QUEUE_STILL_ACTIVE');
        return discarded;
      });
    }).then(function(discarded){
      stage='remove_local_snapshot';
      var authorization=global.ConferenceEditLockManager&&
        global.ConferenceEditLockManager.authorizeReset(localId);
      var data=global.appData;
      data.conferences=(data.conferences||[]).filter(function(c){return String(c&&c.id)!==localId;});
      if(data.conferenceLifecycle&&data.conferenceLifecycle.records)delete data.conferenceLifecycle.records[localId];
      if(String(data.currentConferenceId||'')===localId)data.currentConferenceId=null;
      if(!global.save({skipCurrentConferenceUpdate:true,skipConferenceTracking:true,skipSyncQueue:true,lockAuthorization:authorization}))throw new Error('LOCAL_SAVE_FAILED');
      if(global.AutomaticSyncOrchestrator&&
        typeof global.AutomaticSyncOrchestrator.start==='function'){
        global.AutomaticSyncOrchestrator.start();
      }
      return {ok:true,status:'reset_complete',data:{discardedOperations:discarded.data&&discarded.data.count||0,oldLocalConferenceId:localId,oldRemoteConferenceId:link.remoteConferenceId}};
    }).catch(function(error){return {ok:false,status:'reset_failed',data:{failedStage:stage},error:{code:String(error&&error.message||'RESET_FAILED')}};});
  }
  function resetCurrent(){
    var current=global.getCurrentConference&&global.getCurrentConference();
    if(!current)return Promise.resolve({ok:false,status:'conference_required'});
    var warning='سيتم عزل المؤتمر التجريبي سحابيًا وإنهاء عملياته المحلية وإزالة نسخته من هذا الجهاز. لا يمكن التراجع. هل تريد المتابعة؟';
    if(!global.confirm||!global.confirm(warning))return Promise.resolve({ok:false,status:'cancelled'});
    return reset(current.id,{confirmed:true}).then(function(result){
      if(global.showToast)global.showToast(result.ok?'تم تنظيف المؤتمر التجريبي. أنشئ مؤتمرًا جديدًا الآن.':'تعذر إكمال التنظيف بأمان.',result.ok?'#27AE60':'#E74C3C');
      if(result.ok&&global.showSelectConferenceModal)global.showSelectConferenceModal();
      return result;
    });
  }
  global.ExperimentalConferenceReset=Object.freeze({reset:reset,resetCurrent:resetCurrent});
})(window);
