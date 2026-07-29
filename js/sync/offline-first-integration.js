(function(global){
  'use strict';

  var conferenceContexts=Object.create(null);
  var remoteUpdates=Object.create(null);
  var lockedConferences=Object.create(null);
  var unsyncedConferences=Object.create(null);
  var conflictActualRevisions=Object.create(null);
  var state={
    connectivity:'unknown',
    syncing:false,
    conflict:false,
    lastSyncAt:null,
    lastSyncResult:null,
    lastError:null
  };

  function result(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data===undefined?null:data,
      error:error||null
    };
  }

  function safeError(code,message){
    return {
      code:code||'INTEGRATION_ERROR',
      message:message||'The offline integration operation failed.'
    };
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function cloneValue(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function currentStatus(){
    if(state.syncing)return 'syncing';
    if(state.conflict)return 'conflict';
    if(Object.keys(lockedConferences).length)return 'locked';
    if(state.connectivity==='offline')return 'offline';
    if(state.connectivity==='online')return 'online';
    return 'idle';
  }

  function publicState(){
    return {
      status:currentStatus(),
      connectivity:state.connectivity,
      syncing:state.syncing,
      conflict:state.conflict,
      configuredConferenceCount:Object.keys(conferenceContexts).length,
      pendingRemoteUpdateCount:Object.keys(remoteUpdates).length,
      lockedConferenceCount:Object.keys(lockedConferences).length,
      unsyncedConferenceCount:Object.keys(unsyncedConferences).length,
      lastSyncAt:state.lastSyncAt,
      lastSyncResult:state.lastSyncResult
        ?cloneValue(state.lastSyncResult)
        :null,
      lastError:state.lastError
        ?{code:state.lastError.code,message:state.lastError.message}
        :null
    };
  }

  function configureConferenceSync(localConferenceId,options){
    options=options&&typeof options==='object'?options:{};
    localConferenceId=String(localConferenceId||'');
    var conferenceId=String(options.conferenceId||localConferenceId);
    if(!localConferenceId||!isUuid(conferenceId)){
      return result(false,'error',null,safeError(
        'INVALID_CONFERENCE_CONTEXT',
        'A local conference ID and valid online conferenceId are required.'
      ));
    }
    if(!Number.isInteger(options.baseRevision)||options.baseRevision<0){
      return result(false,'error',null,safeError(
        'INVALID_BASE_REVISION',
        'baseRevision must be a non-negative integer.'
      ));
    }
    var schemaVersion=String(options.schemaVersion||'').trim();
    var appVersion=String(options.appVersion||'').trim();
    if(!schemaVersion||!appVersion){
      return result(false,'error',null,safeError(
        'VERSION_METADATA_REQUIRED',
        'schemaVersion and appVersion are required.'
      ));
    }
    conferenceContexts[localConferenceId]={
      localConferenceId:localConferenceId,
      conferenceId:conferenceId,
      baseRevision:options.baseRevision,
      schemaVersion:schemaVersion,
      appVersion:appVersion
    };
    return result(true,'configured',{
      context:cloneValue(conferenceContexts[localConferenceId])
    },null);
  }

  function removeConferenceSync(localConferenceId){
    localConferenceId=String(localConferenceId||'');
    var existed=Object.prototype.hasOwnProperty.call(
      conferenceContexts,
      localConferenceId
    );
    delete conferenceContexts[localConferenceId];
    return result(true,'removed',{removed:existed},null);
  }

  function findConferenceSnapshot(appSnapshot,localConferenceId){
    if(!appSnapshot||typeof appSnapshot!=='object'||
      !Array.isArray(appSnapshot.conferences)){
      return null;
    }
    var conference=appSnapshot.conferences.find(function(item){
      return item&&String(item.id||'')===localConferenceId;
    });
    return conference?cloneValue(conference):null;
  }

  function resolveDeviceId(options){
    options=options&&typeof options==='object'?options:{};
    try{
      var identity=options.deviceIdentity||
        (global.SupabaseDeviceIdentity&&
        typeof global.SupabaseDeviceIdentity.getOrCreate==='function'
          ?global.SupabaseDeviceIdentity.getOrCreate()
          :null);
      return identity&&isUuid(String(identity.id||''))
        ?String(identity.id)
        :null;
    }catch(error){
      return null;
    }
  }

  function handleLocalSave(appSnapshot,options){
    options=options&&typeof options==='object'?options:{};
    var localConferenceId=String(
      appSnapshot&&appSnapshot.currentConferenceId||''
    );
    var context=conferenceContexts[localConferenceId];
    if(!context){
      if(localConferenceId){
        unsyncedConferences[localConferenceId]={
          reason:'CONFERENCE_NOT_CONFIGURED'
        };
      }
      return Promise.resolve(result(true,'skipped',{
        reason:'CONFERENCE_NOT_CONFIGURED'
      },null));
    }
    var conferenceSnapshot;
    try{
      conferenceSnapshot=findConferenceSnapshot(
        appSnapshot,
        localConferenceId
      );
    }catch(error){
      conferenceSnapshot=null;
    }
    if(!conferenceSnapshot){
      unsyncedConferences[localConferenceId]={
        reason:'CONFERENCE_SNAPSHOT_NOT_FOUND'
      };
      return Promise.resolve(result(true,'skipped',{
        reason:'CONFERENCE_SNAPSHOT_NOT_FOUND'
      },null));
    }
    var deviceId=resolveDeviceId(options);
    if(!deviceId){
      unsyncedConferences[localConferenceId]={
        reason:'DEVICE_ID_UNAVAILABLE'
      };
      return Promise.resolve(result(true,'skipped',{
        reason:'DEVICE_ID_UNAVAILABLE'
      },null));
    }
    var queue=options.queue||global.OfflineSyncQueue||null;
    if(!queue||
      (typeof queue.coalesceSnapshotOperation!=='function'&&
      typeof queue.enqueueSnapshotOperation!=='function')){
      unsyncedConferences[localConferenceId]={
        reason:'SYNC_QUEUE_UNAVAILABLE'
      };
      return Promise.resolve(result(true,'skipped',{
        reason:'SYNC_QUEUE_UNAVAILABLE'
      },null));
    }
    return Promise.resolve().then(function(){
      var enqueue=typeof queue.coalesceSnapshotOperation==='function'
        ?queue.coalesceSnapshotOperation
        :queue.enqueueSnapshotOperation;
      return enqueue.call(queue,{
        conferenceId:context.conferenceId,
        deviceId:deviceId,
        baseRevision:context.baseRevision,
        snapshot:conferenceSnapshot,
        schemaVersion:context.schemaVersion,
        appVersion:context.appVersion
      });
    }).then(function(queueResult){
      if(!queueResult||!queueResult.ok){
        unsyncedConferences[localConferenceId]={
          reason:'QUEUE_ENQUEUE_FAILED'
        };
        return result(true,'skipped',{
          reason:'QUEUE_ENQUEUE_FAILED'
        },null);
      }
      delete unsyncedConferences[localConferenceId];
      return result(true,'queued',{
        operation:queueResult.data&&queueResult.data.operation
          ?queueResult.data.operation
          :queueResult.data,
        queueStatus:queueResult.status
      },null);
    }).catch(function(){
      unsyncedConferences[localConferenceId]={
        reason:'QUEUE_ENQUEUE_FAILED'
      };
      return result(true,'skipped',{
        reason:'QUEUE_ENQUEUE_FAILED'
      },null);
    });
  }

  function hasActiveConflict(link){
    return !!(link&&(
      link.linkStatus==='needs_resolution'||
      link.conflictId||
      link.conflictStatus==='active'||
      link.conflictStatus==='pending'||
      link.conflictStatus==='reviewed'
    ));
  }

  function publishConferenceRevision(input,options){
    options=options&&typeof options==='object'?options:{};
    input=input&&typeof input==='object'?input:{};
    if(!Number.isInteger(input.revision)||input.revision<1){
      return Promise.resolve(result(true,'revision_unavailable',{
        applied:false
      },null));
    }
    var remoteConferenceId=String(input.remoteConferenceId||'');
    var deviceId=String(input.deviceId||'');
    if(!isUuid(remoteConferenceId)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_SUCCESSFUL_SYNC_RESULT',
        'The successful sync result has no valid conference ID.'
      )));
    }
    var revision=input.revision;
    Object.keys(conferenceContexts).forEach(function(localId){
      var context=conferenceContexts[localId];
      if(context.conferenceId===remoteConferenceId){
        context.baseRevision=revision;
      }
    });
    var linkStore=options.linkStore||global.ConferenceLinkStore;
    var link=linkStore&&
      typeof linkStore.findByRemoteId==='function'
      ?linkStore.findByRemoteId(
        remoteConferenceId,
        options.linkOptions
      )
      :null;
    if(link&&(!hasActiveConflict(link)||
      input.allowActiveConflict===true)&&
      typeof linkStore.save==='function'){
      var saved=linkStore.save(Object.assign({},link,{
        knownRevision:revision,
        actualRevision:revision,
        linkStatus:input.linkStatus||link.linkStatus
      }),options.linkOptions);
      if(!saved||!saved.ok){
        return Promise.resolve(result(false,'error',null,safeError(
          'LINK_REVISION_UPDATE_FAILED',
          'The linked conference revision could not be updated.'
        )));
      }
    }
    var queue=options.queue||global.OfflineSyncQueue;
    if(!queue||typeof queue.rebasePendingOperations!=='function'||
      !isUuid(deviceId)){
      return Promise.resolve(result(true,'revision_published',{
        applied:true,
        revision:revision,
        remoteConferenceId:remoteConferenceId,
        rebased:0
      },null));
    }
    return queue.rebasePendingOperations(
      remoteConferenceId,
      deviceId,
      revision,
      options.queueOptions
    ).then(function(rebased){
      if(!rebased||!rebased.ok){
        return result(false,'error',null,safeError(
          'PENDING_REBASE_FAILED',
          'Pending operations could not be rebased.'
        ));
      }
      return result(true,'revision_published',{
        applied:true,
        revision:revision,
        remoteConferenceId:remoteConferenceId,
        rebased:rebased.data&&rebased.data.count||0
      },null);
    }).catch(function(){
      return result(false,'error',null,safeError(
        'PENDING_REBASE_FAILED',
        'Pending operations could not be rebased.'
      ));
    });
  }

  function applySuccessfulSyncRevision(operationResult,options){
    options=options&&typeof options==='object'?options:{};
    if(!operationResult||
      (operationResult.status!=='applied'&&
      operationResult.status!=='duplicate')||
      !operationResult.data){
      return Promise.resolve(result(true,'revision_unavailable',{
        applied:false
      },null));
    }
    var operation=operationResult.data.operation||options.operation;
    return publishConferenceRevision({
      remoteConferenceId:operation&&operation.conferenceId,
      deviceId:operation&&operation.deviceId,
      revision:operationResult.data.revision,
      linkStatus:'linked'
    },options);
  }

  function updateRevisionsFromSync(syncResult,queue,options){
    var results=syncResult&&syncResult.data&&
      Array.isArray(syncResult.data.results)
      ?syncResult.data.results
      :[];
    var sequence=Promise.resolve();
    results.forEach(function(operationResult){
      sequence=sequence.then(function(){
        return applySuccessfulSyncRevision(
          operationResult,
          Object.assign({},options||{},{queue:queue})
        );
      });
    });
    results.forEach(function(operationResult){
      if(!operationResult||operationResult.status!=='conflict'||
        !operationResult.data||!operationResult.data.operation){
        return;
      }
      var conferenceId=operationResult.data.operation.conferenceId;
      conflictActualRevisions[conferenceId]=
        Number.isInteger(operationResult.data.actualRevision)
          ?operationResult.data.actualRevision
          :null;
    });
    return sequence;
  }

  function triggerSync(options){
    options=options&&typeof options==='object'?options:{};
    var processor=options.processor||global.SyncQueueProcessor||null;
    var queue=options.queue||
      (options.processorOptions&&options.processorOptions.queue)||
      global.OfflineSyncQueue||
      null;
    if(!processor||
      typeof processor.processReadyOperations!=='function'){
      return Promise.resolve(result(false,'error',null,safeError(
        'SYNC_PROCESSOR_UNAVAILABLE',
        'The sync processor is unavailable.'
      )));
    }
    if(state.syncing){
      return Promise.resolve(result(true,'busy',{
        state:publicState()
      },null));
    }
    state.syncing=true;
    state.lastError=null;
    return Promise.resolve().then(function(){
      return processor.processReadyOperations(options.processorOptions);
    }).then(function(syncResult){
      state.lastSyncAt=new Date().toISOString();
      state.lastSyncResult=syncResult?{
        ok:syncResult.ok,
        status:syncResult.status,
        data:syncResult.data?cloneValue(syncResult.data):null
      }:null;
      if(syncResult&&syncResult.data&&
        Number(syncResult.data.conflicts||0)>0){
        state.conflict=true;
      }
      if(syncResult&&syncResult.ok){
        return updateRevisionsFromSync(syncResult,queue,options).then(function(){
          state.syncing=false;
          return result(true,'completed',{
            syncResult:cloneValue(syncResult),
            state:publicState()
          },null);
        });
      }
      state.syncing=false;
      state.lastError=safeError(
        'SYNC_PROCESSING_FAILED',
        'The queued sync operation failed.'
      );
      return result(false,'error',null,state.lastError);
    }).catch(function(){
      state.syncing=false;
      state.lastError=safeError(
        'SYNC_PROCESSING_FAILED',
        'The queued sync operation failed.'
      );
      return result(false,'error',null,state.lastError);
    });
  }

  function handleRealtimeEvent(event){
    if(!event||event.type!=='snapshot_changed'||
      !isUuid(String(event.conferenceId||''))){
      return result(false,'error',null,safeError(
        'INVALID_REALTIME_EVENT',
        'A valid snapshot_changed event is required.'
      ));
    }
    remoteUpdates[String(event.conferenceId)]={
      conferenceId:String(event.conferenceId),
      revision:Number.isInteger(event.revision)?event.revision:null,
      updatedAt:event.updatedAt||null,
      deviceId:isUuid(String(event.deviceId||''))
        ?String(event.deviceId)
        :null,
      receivedAt:new Date().toISOString()
    };
    return result(true,'update_marked',{
      update:cloneValue(remoteUpdates[String(event.conferenceId)])
    },null);
  }

  function connectRealtime(conferenceId,options){
    options=options&&typeof options==='object'?options:{};
    var realtime=options.realtime||global.RealtimeSync||null;
    if(!realtime||
      typeof realtime.setEventHandler!=='function'||
      typeof realtime.connect!=='function'){
      return Promise.resolve(result(false,'error',null,safeError(
        'REALTIME_UNAVAILABLE',
        'Realtime notifications are unavailable.'
      )));
    }
    var handlerResult=realtime.setEventHandler(function(event){
      handleRealtimeEvent(event);
      if(typeof options.eventHandler==='function'){
        try{options.eventHandler(cloneValue(event));}catch(error){}
      }
    });
    if(handlerResult&&handlerResult.ok===false){
      return Promise.resolve(result(false,'error',null,safeError(
        'REALTIME_HANDLER_FAILED',
        'The realtime event handler could not be registered.'
      )));
    }
    return realtime.connect(conferenceId,options.realtimeOptions);
  }

  function disconnectRealtime(options){
    options=options&&typeof options==='object'?options:{};
    var realtime=options.realtime||global.RealtimeSync||null;
    if(!realtime||typeof realtime.disconnect!=='function'){
      return Promise.resolve(result(false,'error',null,safeError(
        'REALTIME_UNAVAILABLE',
        'Realtime notifications are unavailable.'
      )));
    }
    return realtime.disconnect(options.realtimeOptions);
  }

  function getRemoteUpdate(conferenceId){
    conferenceId=String(conferenceId||'');
    return remoteUpdates[conferenceId]
      ?cloneValue(remoteUpdates[conferenceId])
      :null;
  }

  function clearRemoteUpdate(conferenceId){
    conferenceId=String(conferenceId||'');
    var existed=Object.prototype.hasOwnProperty.call(
      remoteUpdates,
      conferenceId
    );
    delete remoteUpdates[conferenceId];
    return result(true,'cleared',{cleared:existed},null);
  }

  function refreshLockState(conferenceId,options){
    options=options&&typeof options==='object'?options:{};
    var locks=options.locks||global.ConferenceLocks||null;
    if(!locks||typeof locks.getLockStatus!=='function'){
      return Promise.resolve(result(false,'error',null,safeError(
        'CONFERENCE_LOCKS_UNAVAILABLE',
        'Conference lock status is unavailable.'
      )));
    }
    return Promise.resolve().then(function(){
      return locks.getLockStatus(conferenceId,options.lockOptions);
    }).then(function(lockResult){
      if(!lockResult||!lockResult.ok){
        return result(false,'error',null,safeError(
          'LOCK_STATUS_FAILED',
          'Conference lock status could not be read.'
        ));
      }
      var data=lockResult.data||{};
      if(data.locked&&data.owned===false){
        lockedConferences[String(conferenceId)]={
          conferenceId:String(conferenceId),
          deviceId:data.deviceId||null,
          expiresAt:data.expiresAt||null
        };
      }else{
        delete lockedConferences[String(conferenceId)];
      }
      return result(true,'lock_state_updated',{
        lockResult:cloneValue(lockResult),
        state:publicState()
      },null);
    }).catch(function(){
      return result(false,'error',null,safeError(
        'LOCK_STATUS_FAILED',
        'Conference lock status could not be read.'
      ));
    });
  }

  function applyLockResult(conferenceId,lockResult){
    conferenceId=String(conferenceId||'');
    if(!lockResult||!lockResult.ok){
      return result(false,'error',null,safeError(
        'INVALID_LOCK_RESULT','A valid lock result is required.'
      ));
    }
    var data=lockResult.data||{};
    if(data.locked&&data.owned===false){
      lockedConferences[conferenceId]={
        conferenceId:conferenceId,
        deviceId:data.deviceId||null,
        expiresAt:data.expiresAt||null
      };
    }else{
      delete lockedConferences[conferenceId];
    }
    return result(true,'lock_state_updated',{state:publicState()},null);
  }

  function setConnectivity(connectivity){
    if(connectivity!=='online'&&connectivity!=='offline'&&
      connectivity!=='unknown'){
      return result(false,'error',null,safeError(
        'INVALID_CONNECTIVITY',
        'Connectivity must be online, offline, or unknown.'
      ));
    }
    state.connectivity=connectivity;
    return result(true,'connectivity_updated',{
      state:publicState()
    },null);
  }

  function clearConflictState(){
    state.conflict=false;
    return result(true,'conflict_cleared',{state:publicState()},null);
  }

  function getConferenceSyncState(localConferenceId){
    localConferenceId=String(localConferenceId||'');
    var context=conferenceContexts[localConferenceId]||null;
    var conferenceId=context&&context.conferenceId;
    return {
      context:context?cloneValue(context):null,
      unsynced:unsyncedConferences[localConferenceId]
        ?cloneValue(unsyncedConferences[localConferenceId])
        :null,
      conflictActualRevision:conferenceId&&
        Object.prototype.hasOwnProperty.call(
          conflictActualRevisions,
          conferenceId
        )
        ?conflictActualRevisions[conferenceId]
        :null
    };
  }

  function getState(){
    return publicState();
  }

  function resetForTests(){
    conferenceContexts=Object.create(null);
    remoteUpdates=Object.create(null);
    lockedConferences=Object.create(null);
    unsyncedConferences=Object.create(null);
    conflictActualRevisions=Object.create(null);
    state.connectivity='unknown';
    state.syncing=false;
    state.conflict=false;
    state.lastSyncAt=null;
    state.lastSyncResult=null;
    state.lastError=null;
  }

  global.OfflineFirstIntegration=Object.freeze({
    configureConferenceSync:configureConferenceSync,
    removeConferenceSync:removeConferenceSync,
    handleLocalSave:handleLocalSave,
    publishConferenceRevision:publishConferenceRevision,
    applySuccessfulSyncRevision:applySuccessfulSyncRevision,
    triggerSync:triggerSync,
    connectRealtime:connectRealtime,
    disconnectRealtime:disconnectRealtime,
    handleRealtimeEvent:handleRealtimeEvent,
    getRemoteUpdate:getRemoteUpdate,
    clearRemoteUpdate:clearRemoteUpdate,
    refreshLockState:refreshLockState,
    applyLockResult:applyLockResult,
    setConnectivity:setConnectivity,
    clearConflictState:clearConflictState,
    getConferenceSyncState:getConferenceSyncState,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
