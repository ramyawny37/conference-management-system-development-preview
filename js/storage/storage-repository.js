(function(global){
  'use strict';

  var snapshotWriteQueue = Promise.resolve();

  function cloneSnapshotData(appData){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(appData);
    }
    return JSON.parse(JSON.stringify(appData));
  }

  function inspectSnapshot(appData){
    var diagnostics=global.SnapshotPayloadDiagnostics;
    if(diagnostics&&typeof diagnostics.inspect==='function'){
      return diagnostics.inspect(appData);
    }
    try{
      var serialized=JSON.stringify(appData);
      if(typeof serialized!=='string')throw new Error('NOT_SERIALIZABLE');
      return {ok:true,snapshot:JSON.parse(serialized),sizeBytes:null};
    }catch(error){
      return {ok:false,error:{code:'SNAPSHOT_SERIALIZATION_FAILED'}};
    }
  }

  function saveAppSnapshot(appData,options){
    options=options&&typeof options==='object'?options:{};
    var activation=global.ConferenceActivationAuthorization;
    var persistenceInput=activation&&
      typeof activation.preparePersistedAppData==='function'
      ?activation.preparePersistedAppData(appData):appData;
    var inspected=inspectSnapshot(persistenceInput);
    if(!inspected.ok){
      var serializationError=new Error(
        'The snapshot payload could not be serialized.'
      );
      serializationError.code='SNAPSHOT_SERIALIZATION_FAILED';
      return Promise.reject(serializationError);
    }
    var queuedSnapshot=cloneSnapshotData(inspected.snapshot);
    var localSaveResult=null;
    var previousSnapshotRecord=null;
    var persistenceMetadata=null;
    var arbitration=global.LocalPersistenceArbitration;
    function restorePreviousSnapshot(){
      if(previousSnapshotRecord){
        return global.AppIndexedDB.putRecord(
          global.AppIndexedDB.stores.conferences,
          previousSnapshotRecord
        );
      }
      if(typeof global.AppIndexedDB.deleteAppSnapshot==='function'){
        return global.AppIndexedDB.deleteAppSnapshot();
      }
      return Promise.resolve();
    }
    var writeOperation = snapshotWriteQueue
      .catch(function(){})
      .then(function(){
        if(typeof global.AppIndexedDB.getAppSnapshot!=='function')return null;
        return global.AppIndexedDB.getAppSnapshot();
      })
      .then(function(previous){
        previousSnapshotRecord=previous||null;
        if(!arbitration||typeof arbitration.inspect!=='function'){
          throw Object.assign(new Error('Persistence arbitration is unavailable.'),
            {code:'LOCAL_PERSISTENCE_ARBITRATION_UNAVAILABLE'});
        }
        return arbitration.inspect({indexedDB:global.AppIndexedDB,
          localStorage:global.localStorage,storageKey:global.SK});
      })
      .then(function(current){
        if(!current.ok){
          var persistenceError=new Error(
            'Local persistence requires recovery before it can be updated.'
          );
          persistenceError.code=current.code||
            'LOCAL_PERSISTENCE_RECOVERY_REQUIRED';
          persistenceError.persistenceResult=current;
          throw persistenceError;
        }
        var generations=(current.candidates||[]).map(function(candidate){
          return candidate.metadata&&candidate.metadata.generation||0;
        });
        var nextGeneration=Math.max.apply(Math,[0].concat(generations))+1;
        return arbitration.createMetadata(queuedSnapshot,nextGeneration);
      })
      .then(function(metadata){
        persistenceMetadata=metadata;
        return global.AppIndexedDB.saveAppSnapshot(queuedSnapshot,metadata);
      })
      .then(function(saveResult){
        var integration=options.skipSyncQueue
          ?null
          :global.OfflineFirstIntegration;
        if(!integration||
          typeof integration.handleLocalSave!=='function'){
          return saveResult;
        }
        return Promise.resolve()
          .then(function(){
            return integration.handleLocalSave(queuedSnapshot);
          })
          .catch(function(error){
            return {ok:false,status:'error',error:{
              code:error&&error.code||'SYNC_QUEUE_ENQUEUE_FAILED',
              message:'The local sync operation could not be queued.'
            }};
          })
          .then(function(result){
            localSaveResult=result;
            return saveResult;
          });
      })
      .then(function(saveResult){
        if(localSaveResult&&(
          localSaveResult.ok===false||
          localSaveResult.data&&
          localSaveResult.data.reason==='QUEUE_ENQUEUE_FAILED'
        )){
          return Promise.resolve(restorePreviousSnapshot()).then(function(){
            var queueError=new Error(
              'The local sync operation could not be queued.'
            );
            queueError.code=localSaveResult.error&&localSaveResult.error.code||
              'SYNC_QUEUE_ENQUEUE_FAILED';
            queueError.sizeBytes=inspected.sizeBytes;
            throw queueError;
          });
        }
        var templateSync=options.skipTemplateSync
          ?null:global.OrganizationTemplateSync;
        if(templateSync&&typeof templateSync.captureLocalSave==='function'){
          Promise.resolve(templateSync.captureLocalSave(queuedSnapshot))
            .catch(function(){return null;});
        }
        var queued=localSaveResult&&localSaveResult.ok===true&&
          localSaveResult.status==='queued'&&
          localSaveResult.data&&
          ['enqueued','coalesced'].indexOf(
            localSaveResult.data.queueStatus
          )>=0;
        var orchestrator=global.AutomaticSyncOrchestrator;
        if(queued&&orchestrator){
          var wakeResult=typeof orchestrator.wakeForLocalSave==='function'
            ?orchestrator.wakeForLocalSave(options.orchestratorOptions)
            :typeof orchestrator.schedule==='function'
              ?orchestrator.schedule('local_save',options.orchestratorOptions)
              :null;
          if(!wakeResult||wakeResult.ok===false){
            // Snapshot durability is already established. Mirror persistence
            // must still run even when the optional wake request is declined.
          }
        }
        var mirrorStatus={ok:true,status:'persisted',indexedDB:saveResult,
          persistenceMetadata:persistenceMetadata,mirror:{ok:true}};
        try{
          global.localStorage.setItem(global.SK,JSON.stringify(queuedSnapshot));
          global.localStorage.setItem(
            arbitration.metadataKey(global.SK),JSON.stringify(persistenceMetadata)
          );
        }catch(error){
          mirrorStatus.status='persisted_mirror_degraded';
          mirrorStatus.mirror={ok:false,error:error,
            code:global.SnapshotPayloadDiagnostics&&
              global.SnapshotPayloadDiagnostics.isQuotaExceededError(error)
              ?'LOCAL_STORAGE_QUOTA_EXCEEDED':'LOCAL_STORAGE_MIRROR_FAILED',
            sizeBytes:inspected.sizeBytes};
        }
        return mirrorStatus;
      });
    snapshotWriteQueue = writeOperation;
    return writeOperation;
  }

  function getAppSnapshot(){
    return global.AppIndexedDB.getAppSnapshot();
  }

  function hasAppSnapshot(){
    return global.AppIndexedDB.hasAppSnapshot();
  }

  function createLocalBackup(appData,reason){
    return global.AppIndexedDB.createLocalBackup(appData,reason);
  }

  function getLocalBackups(conferenceId){
    return global.AppIndexedDB.getLocalBackups(conferenceId);
  }

  function getLocalBackup(backupId){
    return global.AppIndexedDB.getLocalBackup(backupId);
  }

  function deleteLocalBackup(backupId){
    return global.AppIndexedDB.deleteLocalBackup(backupId);
  }

  global.StorageRepository = Object.freeze({
    saveAppSnapshot: saveAppSnapshot,
    getAppSnapshot: getAppSnapshot,
    hasAppSnapshot: hasAppSnapshot,
    createLocalBackup: createLocalBackup,
    getLocalBackups: getLocalBackups,
    getLocalBackup: getLocalBackup,
    deleteLocalBackup: deleteLocalBackup
  });
})(window);
