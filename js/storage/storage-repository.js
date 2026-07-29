(function(global){
  'use strict';

  var snapshotWriteQueue = Promise.resolve();

  function cloneSnapshotData(appData){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(appData);
    }
    return JSON.parse(JSON.stringify(appData));
  }

  function saveAppSnapshot(appData,options){
    options=options&&typeof options==='object'?options:{};
    var queuedSnapshot;
    try{
      queuedSnapshot = cloneSnapshotData(appData);
    }catch(error){
      return Promise.reject(error);
    }
    var writeOperation = snapshotWriteQueue
      .catch(function(){})
      .then(function(){
        return global.AppIndexedDB.saveAppSnapshot(queuedSnapshot);
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
          .catch(function(){ return null; })
          .then(function(){ return saveResult; });
      })
      .then(function(saveResult){
        if(!options.skipSyncQueue&&global.AutomaticSyncOrchestrator&&
          typeof global.AutomaticSyncOrchestrator.schedule==='function'){
          global.AutomaticSyncOrchestrator.schedule('local_save');
        }
        return saveResult;
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
