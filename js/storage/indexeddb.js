(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{
    databaseName:function(name){return name;}
  };
  var DATABASE_NAME = namespace.databaseName(
    'conference_manager_v3'
  );
  var DATABASE_VERSION = 6;
  var STORE_NAMES = Object.freeze({
    conferences: 'conferences',
    rooms: 'rooms',
    pendingOperations: 'pending_operations',
    syncMetadata: 'sync_metadata',
    conflicts: 'conflicts',
    deviceSettings: 'device_settings',
    localBackups: 'local_backups',
    syncOperationsQueue: 'sync_operations_queue',
    pendingRemoteApplications: 'pending_remote_applications',
    conflictResolutionDrafts: 'conflict_resolution_drafts',
    conflictResolutionBackups: 'conflict_resolution_backups',
    organizationMembershipPendingOperations:
      'organization_membership_pending_operations',
    organizationTemplateOperations:
      'organization_template_operations',
    libraryTemplateContentOperations:
      'library_template_content_operations',
    organizationTemplateAccessOperations:
      'organization_template_access_operations'
  });
  var database = null;
  var openingPromise = null;

  function requestToPromise(request){
    return new Promise(function(resolve,reject){
      request.onsuccess = function(){ resolve(request.result); };
      request.onerror = function(){ reject(request.error); };
    });
  }

  function ensureIndex(store,indexName,keyPath,options){
    if(!store.indexNames.contains(indexName)){
      store.createIndex(indexName,keyPath,options||{});
    }
  }

  function ensureStore(db,upgradeTransaction,name,options,indexes){
    var store = db.objectStoreNames.contains(name)
      ? upgradeTransaction.objectStore(name)
      : db.createObjectStore(name,options);
    (indexes||[]).forEach(function(index){
      ensureIndex(store,index.name,index.keyPath,index.options);
    });
  }

  function upgradeDatabase(db,upgradeTransaction){
    ensureStore(db,upgradeTransaction,STORE_NAMES.conferences,{keyPath:'conferenceId'},[
      {name:'status',keyPath:'status'},
      {name:'syncStatus',keyPath:'syncStatus'}
    ]);
    ensureStore(db,upgradeTransaction,STORE_NAMES.rooms,{keyPath:['conferenceId','roomId']},[
      {name:'conferenceId',keyPath:'conferenceId'},
      {name:'conferenceHouse',keyPath:['conferenceId','houseId']},
      {name:'conferenceFloor',keyPath:['conferenceId','floorId']},
      {name:'conferenceSyncStatus',keyPath:['conferenceId','syncStatus']}
    ]);
    ensureStore(db,upgradeTransaction,STORE_NAMES.pendingOperations,{keyPath:'operationId'},[
      {name:'conferenceStatus',keyPath:['conferenceId','status']},
      {name:'createdAt',keyPath:'createdAt'}
    ]);
    ensureStore(db,upgradeTransaction,STORE_NAMES.syncMetadata,{keyPath:'conferenceId'});
    ensureStore(db,upgradeTransaction,STORE_NAMES.conflicts,{keyPath:'conflictId'},[
      {name:'conferenceStatus',keyPath:['conferenceId','resolutionStatus']},
      {name:'operationId',keyPath:'operationId'}
    ]);
    ensureStore(db,upgradeTransaction,STORE_NAMES.deviceSettings,{keyPath:'key'});
    ensureStore(db,upgradeTransaction,STORE_NAMES.localBackups,{keyPath:'backupId'},[
      {name:'conferenceId',keyPath:'conferenceId'},
      {name:'conferenceCreatedAt',keyPath:['conferenceId','createdAt']}
    ]);
    ensureStore(
      db,
      upgradeTransaction,
      STORE_NAMES.syncOperationsQueue,
      {keyPath:'operationId'},
      [
        {name:'status',keyPath:'status'},
        {name:'conferenceId',keyPath:'conferenceId'},
        {name:'createdAt',keyPath:'createdAt'},
        {name:'nextAttemptAt',keyPath:'nextAttemptAt'}
      ]
    );
    ensureStore(db,upgradeTransaction,STORE_NAMES.pendingRemoteApplications,
      {keyPath:'localConferenceId'},[
        {name:'status',keyPath:'status'},
        {name:'remoteConferenceId',keyPath:'remoteConferenceId'}
      ]);
    ensureStore(db,upgradeTransaction,STORE_NAMES.conflictResolutionDrafts,
      {keyPath:'localConferenceId'},[
        {name:'status',keyPath:'status'},
        {name:'conflictId',keyPath:'conflictId'}
      ]);
    ensureStore(db,upgradeTransaction,STORE_NAMES.conflictResolutionBackups,
      {keyPath:'backupId'},[
        {name:'localConferenceId',keyPath:'localConferenceId'},
        {name:'conferenceCreatedAt',keyPath:['localConferenceId','createdAt']}
      ]);
    ensureStore(db,upgradeTransaction,
      STORE_NAMES.organizationMembershipPendingOperations,
      {keyPath:['authenticatedUserId','operationId']},[
        {name:'by_authenticated_user',keyPath:'authenticatedUserId'},
        {name:'by_user_intent',keyPath:[
          'authenticatedUserId','organizationId','targetUserId','action',
          'requestedRole'
        ]},
        {name:'by_user_created_at',keyPath:[
          'authenticatedUserId','createdAt'
        ]},
        {name:'by_created_at',keyPath:'createdAt'}
      ]);
    ensureStore(db,upgradeTransaction,
      STORE_NAMES.organizationTemplateOperations,
      {keyPath:'operationId'},[
        {name:'by_organization_status',keyPath:['organizationId','status']},
        {name:'by_template',keyPath:[
          'organizationId','templateType','templateId'
        ]},
        {name:'by_created_at',keyPath:'createdAt'}
      ]);
    ensureStore(db,upgradeTransaction,
      STORE_NAMES.libraryTemplateContentOperations,
      {keyPath:'operationId'},[
        {name:'by_status',keyPath:'status'},
        {name:'by_template',keyPath:['templateType','templateId']},
        {name:'by_created_at',keyPath:'createdAt'}
      ]);
    ensureStore(db,upgradeTransaction,
      STORE_NAMES.organizationTemplateAccessOperations,
      {keyPath:'operationId'},[
        {name:'by_status',keyPath:'status'},
        {name:'by_organization_template',keyPath:[
          'organizationId','templateType','templateId'
        ]},
        {name:'by_created_at',keyPath:'createdAt'}
      ]);
  }

  function openDatabase(){
    if(database)return Promise.resolve(database);
    if(openingPromise)return openingPromise;
    if(!global.indexedDB)return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));

    openingPromise = new Promise(function(resolve,reject){
      var request = global.indexedDB.open(DATABASE_NAME,DATABASE_VERSION);
      request.onupgradeneeded = function(event){
        upgradeDatabase(event.target.result,event.target.transaction);
      };
      request.onsuccess = function(){
        database = request.result;
        database.onversionchange = function(){ closeDatabase(); };
        openingPromise = null;
        resolve(database);
      };
      request.onerror = function(){
        openingPromise = null;
        reject(request.error);
      };
      request.onblocked = function(){
        openingPromise = null;
        reject(new Error('INDEXEDDB_OPEN_BLOCKED'));
      };
    });
    return openingPromise;
  }

  function closeDatabase(){
    if(database)database.close();
    database = null;
    openingPromise = null;
  }

  function runTransaction(storeNames,mode,executor){
    var names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return openDatabase().then(function(db){
      return new Promise(function(resolve,reject){
        var transaction;
        try{
          transaction = db.transaction(names,mode||'readonly');
        }catch(error){
          reject(error);
          return;
        }
        var stores = {};
        names.forEach(function(name){ stores[name] = transaction.objectStore(name); });
        var result;
        try{
          result = executor(stores,transaction);
        }catch(error){
          try{ transaction.abort(); }catch(abortError){}
          reject(error);
          return;
        }
        transaction.oncomplete = function(){ resolve(result); };
        transaction.onerror = function(){ reject(transaction.error); };
        transaction.onabort = function(){ reject(transaction.error||new Error('INDEXEDDB_TRANSACTION_ABORTED')); };
      });
    });
  }

  function getRecord(storeName,key){
    return openDatabase().then(function(db){
      return requestToPromise(db.transaction(storeName,'readonly').objectStore(storeName).get(key));
    });
  }

  function getAllRecords(storeName){
    return openDatabase().then(function(db){
      return requestToPromise(db.transaction(storeName,'readonly').objectStore(storeName).getAll());
    });
  }

  function putRecord(storeName,value){
    return runTransaction(storeName,'readwrite',function(stores){
      return requestToPromise(stores[storeName].put(value));
    });
  }

  function deleteRecord(storeName,key){
    return runTransaction(storeName,'readwrite',function(stores){
      return requestToPromise(stores[storeName].delete(key));
    });
  }

  function clearStore(storeName){
    return runTransaction(storeName,'readwrite',function(stores){
      return requestToPromise(stores[storeName].clear());
    });
  }

  function saveAppSnapshot(appData){
    var diagnostics=global.SnapshotPayloadDiagnostics;
    var inspected;
    if(diagnostics&&typeof diagnostics.inspect==='function'){
      inspected=diagnostics.inspect(appData);
    }else{
      try{
        var serialized=JSON.stringify(appData);
        if(typeof serialized!=='string')throw new Error('NOT_SERIALIZABLE');
        inspected={ok:true,snapshot:JSON.parse(serialized),sizeBytes:null};
      }catch(error){
        inspected={ok:false};
      }
    }
    if(!inspected.ok){
      var serializationError=new Error(
        'The snapshot payload could not be serialized.'
      );
      serializationError.code='SNAPSHOT_SERIALIZATION_FAILED';
      return Promise.reject(serializationError);
    }
    return putRecord(STORE_NAMES.conferences,{
      conferenceId: '**app_snapshot**',
      data: inspected.snapshot,
      schemaVersion: inspected.snapshot&&inspected.snapshot.version
        ?inspected.snapshot.version:'',
      appVersion: global.APP_RELEASE&&global.APP_RELEASE.version?global.APP_RELEASE.version:'',
      savedAt: new Date().toISOString(),
      source: 'dual-write',
      sizeBytes: inspected.sizeBytes
    }).catch(function(error){
      if(diagnostics&&diagnostics.isQuotaExceededError(error)){
        var quotaError=new Error(
          'Local storage quota prevented saving the snapshot.'
        );
        quotaError.code='LOCAL_STORAGE_QUOTA_EXCEEDED';
        quotaError.sizeBytes=inspected.sizeBytes;
        throw quotaError;
      }
      throw error;
    });
  }

  function validateAppSnapshot(snapshot){
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Object.keys(snapshot).length){
      return {valid:false,reason:'SNAPSHOT_EMPTY'};
    }
    if(!snapshot.data||typeof snapshot.data!=='object'||Array.isArray(snapshot.data)||!Object.keys(snapshot.data).length){
      return {valid:false,reason:'SNAPSHOT_DATA_MISSING'};
    }
    if(!Object.prototype.hasOwnProperty.call(snapshot.data,'conferences')){
      return {valid:false,reason:'SNAPSHOT_CONFERENCES_MISSING'};
    }
    if(!Array.isArray(snapshot.data.conferences)){
      return {valid:false,reason:'SNAPSHOT_CONFERENCES_INVALID'};
    }
    if(!Object.prototype.hasOwnProperty.call(snapshot.data,'currentConferenceId')){
      return {valid:false,reason:'SNAPSHOT_CURRENT_CONFERENCE_ID_MISSING'};
    }
    return {valid:true,reason:''};
  }

  function getAppSnapshot(){
    return getRecord(STORE_NAMES.conferences,'**app_snapshot**');
  }

  function hasAppSnapshot(){
    return getAppSnapshot().then(function(snapshot){
      return validateAppSnapshot(snapshot).valid;
    });
  }

  function deleteAppSnapshot(){
    return deleteRecord(STORE_NAMES.conferences,'**app_snapshot**');
  }

  function createBackupId(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes = new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6]&15)|64;
      bytes[8] = (bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var value = byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10?'-'+value:value;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function calculateUtf8Size(json){
    if(typeof global.TextEncoder==='function'){
      return new global.TextEncoder().encode(json).byteLength;
    }
    return unescape(encodeURIComponent(json)).length;
  }

  function getLocalBackups(conferenceId){
    return openDatabase().then(function(db){
      var store = db.transaction(STORE_NAMES.localBackups,'readonly').objectStore(STORE_NAMES.localBackups);
      return requestToPromise(store.index('conferenceId').getAll(conferenceId||'**all**'));
    }).then(function(backups){
      return backups.sort(function(first,second){
        return second.createdAt.localeCompare(first.createdAt);
      });
    }).catch(function(error){
      console.warn('تعذر قراءة النسخ الاحتياطية المحلية من IndexedDB.',error);
      return [];
    });
  }

  function getLocalBackup(backupId){
    return getRecord(STORE_NAMES.localBackups,backupId).catch(function(error){
      console.warn('تعذر قراءة النسخة الاحتياطية المحلية من IndexedDB.',error);
      return null;
    });
  }

  function deleteLocalBackup(backupId){
    return deleteRecord(STORE_NAMES.localBackups,backupId).then(function(){
      return true;
    }).catch(function(error){
      console.warn('تعذر حذف النسخة الاحتياطية المحلية من IndexedDB.',error);
      return false;
    });
  }

  function pruneLocalBackups(conferenceId,maxBackups){
    var limit = Number.isInteger(maxBackups)&&maxBackups>=0?maxBackups:10;
    return getLocalBackups(conferenceId).then(function(backups){
      var obsoleteBackups = backups.slice(limit);
      return Promise.all(obsoleteBackups.map(function(backup){
        return deleteLocalBackup(backup.backupId);
      })).then(function(results){
        return results.every(function(result){ return result; });
      });
    }).catch(function(error){
      console.warn('تعذر تقليم النسخ الاحتياطية المحلية في IndexedDB.',error);
      return false;
    });
  }

  function createLocalBackup(appData,reason){
    try{
      var snapshotJson = JSON.stringify(appData);
      var snapshot = JSON.parse(snapshotJson);
      var conferenceId = snapshot.currentConferenceId||'**all**';
      var backup = {
        backupId: createBackupId(),
        conferenceId: conferenceId,
        createdAt: new Date().toISOString(),
        reason: typeof reason==='string'?reason:'',
        schemaVersion: snapshot.version||'',
        appVersion: global.APP_RELEASE&&global.APP_RELEASE.version?global.APP_RELEASE.version:'',
        snapshot: snapshot,
        sizeBytes: calculateUtf8Size(snapshotJson)
      };
      return putRecord(STORE_NAMES.localBackups,backup).then(function(){
        return pruneLocalBackups(conferenceId,10);
      }).then(function(pruned){
        return pruned?backup:false;
      }).catch(function(error){
        console.warn('تعذر إنشاء النسخة الاحتياطية المحلية في IndexedDB.',error);
        return false;
      });
    }catch(error){
      console.warn('تعذر تجهيز النسخة الاحتياطية المحلية.',error);
      return Promise.resolve(false);
    }
  }

  global.AppIndexedDB = Object.freeze({
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    stores: STORE_NAMES,
    openDatabase: openDatabase,
    closeDatabase: closeDatabase,
    runTransaction: runTransaction,
    getRecord: getRecord,
    getAllRecords: getAllRecords,
    putRecord: putRecord,
    deleteRecord: deleteRecord,
    clearStore: clearStore,
    saveAppSnapshot: saveAppSnapshot,
    getAppSnapshot: getAppSnapshot,
    hasAppSnapshot: hasAppSnapshot,
    deleteAppSnapshot: deleteAppSnapshot,
    validateAppSnapshot: validateAppSnapshot,
    createLocalBackup: createLocalBackup,
    getLocalBackups: getLocalBackups,
    getLocalBackup: getLocalBackup,
    deleteLocalBackup: deleteLocalBackup,
    pruneLocalBackups: pruneLocalBackups
  });
})(window);
