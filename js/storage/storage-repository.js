(function(global){
  'use strict';

  var snapshotWriteQueue = Promise.resolve();
  var namespace=global.BrowserStorageNamespace||{key:function(name){return name;}};
  var APP_DATA_KEY=namespace.key('conf_v5');
  var PERSISTENCE_METADATA_KEY=namespace.key(
    'conference_manager_local_persistence_v1'
  );
  var PERSISTENCE_VERSION=1;
  var currentGeneration=0;

  function validAppData(value){
    return !!(value&&typeof value==='object'&&!Array.isArray(value)&&
      Array.isArray(value.conferences));
  }

  function serialize(value){
    return JSON.stringify(value);
  }

  function fingerprintJson(json){
    var first=2166136261;
    var second=2246822519;
    for(var index=0;index<json.length;index++){
      var code=json.charCodeAt(index);
      first^=code;
      first=Math.imul(first,16777619);
      second^=code+(index&255);
      second=Math.imul(second,3266489917);
    }
    return 'v1:'+json.length+':'+(first>>>0).toString(16)+
      ':'+(second>>>0).toString(16);
  }

  function metadata(generation,fingerprint){
    return {
      version:PERSISTENCE_VERSION,
      generation:generation,
      fingerprint:fingerprint
    };
  }

  function validMetadata(value,fingerprint){
    return !!(value&&value.version===PERSISTENCE_VERSION&&
      Number.isInteger(value.generation)&&value.generation>0&&
      typeof value.fingerprint==='string'&&
      value.fingerprint===fingerprint);
  }

  function candidate(source,data,storedMetadata,rawPresent){
    if(!validAppData(data)){
      return {
        source:source,status:rawPresent?'corrupt':'missing',valid:false,
        data:null,json:null,fingerprint:null,generation:null,trusted:false
      };
    }
    var json=serialize(data);
    var contentFingerprint=fingerprintJson(json);
    var trusted=validMetadata(storedMetadata,contentFingerprint);
    return {
      source:source,status:trusted?'valid':'legacy',valid:true,
      data:cloneSnapshotData(data),json:json,fingerprint:contentFingerprint,
      generation:trusted?storedMetadata.generation:null,trusted:trusted
    };
  }

  function inspectLocalStorage(options){
    options=options&&typeof options==='object'?options:{};
    var storage=options.localStorage||global.localStorage;
    var raw=null;
    var rawMetadata=null;
    try{
      raw=storage&&storage.getItem(APP_DATA_KEY);
      rawMetadata=storage&&storage.getItem(PERSISTENCE_METADATA_KEY);
    }catch(error){
      return {source:'localStorage',status:'unreadable',valid:false,
        data:null,json:null,fingerprint:null,generation:null,trusted:false};
    }
    if(raw===null||raw==='')return candidate('localStorage',null,null,false);
    try{
      var parsed=JSON.parse(raw);
      var data=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&
        parsed.appData?parsed.appData:parsed;
      var parsedMetadata=null;
      try{parsedMetadata=rawMetadata?JSON.parse(rawMetadata):null;}
      catch(metadataError){parsedMetadata=null;}
      return candidate('localStorage',data,parsedMetadata,true);
    }catch(error){
      return candidate('localStorage',null,null,raw!==null&&raw!=='');
    }
  }

  function inspectIndexedDbSnapshot(snapshot){
    var rawPresent=!!snapshot;
    var storedMetadata=snapshot?{
      version:snapshot.persistenceVersion,
      generation:snapshot.persistenceGeneration,
      fingerprint:snapshot.persistenceFingerprint
    }:null;
    return candidate(
      'indexeddb',snapshot&&snapshot.data,storedMetadata,rawPresent
    );
  }

  function arbitrateCandidates(indexedCandidate,localCandidate){
    var indexed=indexedCandidate;
    var local=localCandidate;
    if([indexed,local].some(function(item){
      return item&&item.status==='unreadable';
    })){
      return {status:'unreadable',selected:null,candidates:[indexed,local]};
    }
    var valid=[indexed,local].filter(function(item){return item&&item.valid;});
    if(!valid.length){
      var corrupt=[indexed,local].some(function(item){
        return item&&item.status==='corrupt';
      });
      return {status:corrupt?'corrupt':'empty',selected:null,
        candidates:[indexed,local]};
    }
    if(valid.length===1){
      return {status:'single_valid',selected:valid[0],
        candidates:[indexed,local]};
    }
    if(indexed.json===local.json){
      var selected=indexed.trusted&&!local.trusted?indexed:
        local.trusted&&!indexed.trusted?local:indexed;
      return {status:'equal',selected:selected,candidates:[indexed,local],
        generation:Math.max(indexed.generation||0,local.generation||0)};
    }
    if(indexed.trusted&&local.trusted&&
      indexed.generation!==local.generation){
      return {status:'newer',selected:indexed.generation>local.generation
        ?indexed:local,candidates:[indexed,local]};
    }
    return {status:'ambiguous',selected:null,candidates:[indexed,local]};
  }

  function synchronizeGeneration(resolution){
    var candidates=resolution&&resolution.candidates||[];
    candidates.forEach(function(item){
      if(item&&item.trusted&&item.generation>currentGeneration){
        currentGeneration=item.generation;
      }
    });
  }

  function resolveAppSnapshot(options){
    options=options&&typeof options==='object'?options:{};
    var local=inspectLocalStorage(options);
    return global.AppIndexedDB.getAppSnapshot().catch(function(error){
      var unreadableError=new Error('LOCAL_PERSISTENCE_UNREADABLE');
      unreadableError.code='LOCAL_PERSISTENCE_UNREADABLE';
      unreadableError.cause=error;
      throw unreadableError;
    }).then(function(snapshot){
      var resolution=arbitrateCandidates(
        inspectIndexedDbSnapshot(snapshot),local
      );
      synchronizeGeneration(resolution);
      if(resolution.status==='ambiguous'){
        var ambiguousError=new Error('LOCAL_PERSISTENCE_AMBIGUOUS');
        ambiguousError.code='LOCAL_PERSISTENCE_AMBIGUOUS';
        ambiguousError.resolution=resolution;
        throw ambiguousError;
      }
      if(resolution.status==='corrupt'){
        var corruptError=new Error('LOCAL_PERSISTENCE_CORRUPT');
        corruptError.code='LOCAL_PERSISTENCE_CORRUPT';
        corruptError.resolution=resolution;
        throw corruptError;
      }
      if(resolution.status==='unreadable'){
        var unreadableCandidateError=new Error('LOCAL_PERSISTENCE_UNREADABLE');
        unreadableCandidateError.code='LOCAL_PERSISTENCE_UNREADABLE';
        unreadableCandidateError.resolution=resolution;
        throw unreadableCandidateError;
      }
      if(!resolution.selected){
        return {source:'defaults',status:'empty',data:cloneSnapshotData(
          options.defaults
        ),generation:currentGeneration,candidates:resolution.candidates};
      }
      return {
        source:resolution.selected.source,status:resolution.status,
        data:cloneSnapshotData(resolution.selected.data),
        generation:resolution.selected.generation||currentGeneration,
        candidates:resolution.candidates
      };
    });
  }

  function cloneSnapshotData(appData){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(appData);
    }
    return JSON.parse(JSON.stringify(appData));
  }

  function saveAppSnapshot(appData,options){
    options=options&&typeof options==='object'?options:{};
    var queuedSnapshot;
    var json;
    var nextGeneration;
    var contentFingerprint;
    try{
      queuedSnapshot = cloneSnapshotData(appData);
      if(!validAppData(queuedSnapshot))throw new Error('INVALID_APP_SNAPSHOT');
      json=serialize(queuedSnapshot);
      contentFingerprint=fingerprintJson(json);
      nextGeneration=currentGeneration+1;
      currentGeneration=nextGeneration;
    }catch(error){
      return Promise.reject(error);
    }
    try{
      var storage=options.localStorage||global.localStorage;
      if(storage&&typeof storage.setItem==='function'){
        storage.setItem(APP_DATA_KEY,json);
        storage.setItem(PERSISTENCE_METADATA_KEY,JSON.stringify(
          metadata(nextGeneration,contentFingerprint)
        ));
      }
    }catch(localStorageError){}
    var localSaveResult=null;
    var writeOperation = snapshotWriteQueue
      .catch(function(){})
      .then(function(){
        return global.AppIndexedDB.saveAppSnapshot(queuedSnapshot,{
          persistenceVersion:PERSISTENCE_VERSION,
          persistenceGeneration:nextGeneration,
          persistenceFingerprint:contentFingerprint
        });
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
          .then(function(result){
            localSaveResult=result;
            return saveResult;
          });
      })
      .then(function(saveResult){
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
            return saveResult;
          }
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
    appDataKey:APP_DATA_KEY,
    persistenceMetadataKey:PERSISTENCE_METADATA_KEY,
    persistenceVersion:PERSISTENCE_VERSION,
    fingerprintJson:fingerprintJson,
    inspectLocalStorage:inspectLocalStorage,
    inspectIndexedDbSnapshot:inspectIndexedDbSnapshot,
    arbitrateCandidates:arbitrateCandidates,
    resolveAppSnapshot:resolveAppSnapshot,
    saveAppSnapshot: saveAppSnapshot,
    getAppSnapshot: getAppSnapshot,
    hasAppSnapshot: hasAppSnapshot,
    createLocalBackup: createLocalBackup,
    getLocalBackups: getLocalBackups,
    getLocalBackup: getLocalBackup,
    deleteLocalBackup: deleteLocalBackup
  });
})(window);
