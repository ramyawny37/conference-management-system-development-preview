(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{
    databaseName:function(name){return name;}
  };
  var DATABASE_NAME=namespace.databaseName(
    'conference_manager_membership_attempts'
  );
  var DATABASE_VERSION=1;
  var STORE_NAME='membership_attempts_v1';
  var openingPromise=null;
  var database=null;

  function copy(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function buildAttemptKey(input){
    input=input||{};
    return [
      String(input.actorUserId||''),
      String(input.remoteConferenceId||''),
      String(input.action||''),
      String(input.targetUserId||'')
    ].join('|');
  }

  function valid(input){
    return !!(input&&input.version===1&&
      isUuid(String(input.actorUserId||''))&&
      isUuid(String(input.remoteConferenceId||''))&&
      isUuid(String(input.targetUserId||''))&&
      isUuid(String(input.operationId||''))&&
      ['add_manager','remove_manager'].indexOf(input.action)>=0);
  }

  function validScope(input){
    return !!(input&&
      isUuid(String(input.actorUserId||''))&&
      isUuid(String(input.remoteConferenceId||''))&&
      isUuid(String(input.targetUserId||''))&&
      ['add_manager','remove_manager'].indexOf(input.action)>=0);
  }

  function validTimestamp(value){
    return typeof value==='string'&&value.length>0&&
      !Number.isNaN(Date.parse(value));
  }

  function validStoredRecord(record,key,input){
    if(!valid(record)||
      record.attemptKey!==key||
      buildAttemptKey(record)!==key||
      !validTimestamp(record.createdAt)||
      !validTimestamp(record.updatedAt)){
      return false;
    }
    if(typeof input==='string')return true;
    return record.actorUserId===String(input.actorUserId||'')&&
      record.remoteConferenceId===
        String(input.remoteConferenceId||'')&&
      record.targetUserId===String(input.targetUserId||'')&&
      record.action===String(input.action||'');
  }

  function requestPromise(request){
    return new Promise(function(resolve,reject){
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error);};
    });
  }

  function open(options){
    options=options||{};
    if(options.repository)return Promise.resolve(null);
    if(database)return Promise.resolve(database);
    if(openingPromise)return openingPromise;
    var factory=options.indexedDB||global.indexedDB;
    if(!factory||typeof factory.open!=='function'){
      return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));
    }
    openingPromise=new Promise(function(resolve,reject){
      var request=factory.open(DATABASE_NAME,DATABASE_VERSION);
      request.onupgradeneeded=function(event){
        var db=event.target.result;
        if(!db.objectStoreNames.contains(STORE_NAME)){
          db.createObjectStore(STORE_NAME,{keyPath:'attemptKey'});
        }
      };
      request.onsuccess=function(){
        database=request.result;
        database.onversionchange=function(){
          database.close();
          database=null;
          openingPromise=null;
        };
        openingPromise=null;
        resolve(database);
      };
      request.onerror=function(){
        openingPromise=null;
        reject(request.error);
      };
      request.onblocked=function(){
        openingPromise=null;
        reject(new Error('INDEXEDDB_OPEN_BLOCKED'));
      };
    });
    return openingPromise;
  }

  function repositoryCall(method,key,value,options){
    options=options||{};
    if(options.repository&&
      typeof options.repository[method]==='function'){
      return Promise.resolve(options.repository[method](key,value));
    }
    return open(options).then(function(db){
      var mode=method==='get'?'readonly':'readwrite';
      var store=db.transaction(STORE_NAME,mode).objectStore(STORE_NAME);
      if(method==='get')return requestPromise(store.get(key));
      if(method==='put')return requestPromise(store.put(value));
      return requestPromise(store.delete(key));
    });
  }

  function get(input,options){
    var key=typeof input==='string'?input:buildAttemptKey(input);
    if((typeof input!=='string'&&!validScope(input))||
      !key||key.split('|').some(function(part){return !part;})){
      return Promise.resolve({ok:false,status:'invalid',data:null});
    }
    return repositoryCall('get',key,null,options).then(function(record){
      if(!record)return {ok:false,status:'not_found',data:null};
      if(!validStoredRecord(record,key,input)){
        return {ok:false,status:'corrupt_record',data:null};
      }
      return {ok:true,status:'found',data:copy(record)};
    }).catch(function(){
      return {ok:false,status:'read_failed',data:null};
    });
  }

  function save(input,options){
    input=input&&typeof input==='object'?input:{};
    var candidate=Object.assign({},input,{
      version:1,
      actorUserId:String(input.actorUserId||''),
      remoteConferenceId:String(input.remoteConferenceId||''),
      targetUserId:String(input.targetUserId||''),
      operationId:String(input.operationId||''),
      action:String(input.action||'')
    });
    candidate.attemptKey=buildAttemptKey(candidate);
    if(!valid(candidate)){
      return Promise.resolve({ok:false,status:'invalid',data:null});
    }
    return get(candidate,options).then(function(existing){
      if(existing.ok){
        if(existing.data.operationId!==candidate.operationId){
          return {ok:false,status:'operation_mismatch',data:existing.data};
        }
        return {ok:true,status:'preserved',data:existing.data};
      }
      if(existing.status==='corrupt_record')return existing;
      if(existing.status!=='not_found'){
        return {ok:false,status:'storage_error',data:null};
      }
      var now=new Date().toISOString();
      var record={
        version:1,
        attemptKey:candidate.attemptKey,
        actorUserId:candidate.actorUserId,
        remoteConferenceId:candidate.remoteConferenceId,
        targetUserId:candidate.targetUserId,
        action:candidate.action,
        operationId:candidate.operationId,
        createdAt:String(input.createdAt||now),
        updatedAt:now
      };
      return repositoryCall(
        'put',record.attemptKey,record,options
      ).then(function(){
        return {ok:true,status:'saved',data:copy(record)};
      });
    }).catch(function(){
      return {ok:false,status:'storage_error',data:null};
    });
  }

  function remove(input,options){
    var key=typeof input==='string'?input:buildAttemptKey(input);
    if(!key||key.split('|').some(function(part){return !part;})){
      return Promise.resolve({ok:false,status:'invalid'});
    }
    return repositoryCall('delete',key,null,options).then(function(){
      return {ok:true,status:'removed'};
    }).catch(function(){
      return {ok:false,status:'storage_error'};
    });
  }

  function close(){
    if(database)database.close();
    database=null;
    openingPromise=null;
  }

  global.ConferenceMembershipAttemptStore=Object.freeze({
    databaseName:DATABASE_NAME,
    databaseVersion:DATABASE_VERSION,
    storeName:STORE_NAME,
    buildAttemptKey:buildAttemptKey,
    get:get,
    save:save,
    remove:remove,
    close:close
  });
})(window);
