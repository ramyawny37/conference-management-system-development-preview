(function(global){
  'use strict';
  var STORE='pending_remote_applications';
  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function canonical(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    return '{'+Object.keys(value).sort().map(function(key){
      return JSON.stringify(key)+':'+canonical(value[key]);
    }).join(',')+'}';
  }
  function digest(snapshot){
    if(!global.crypto||!global.crypto.subtle||
      typeof global.TextEncoder!=='function'){
      return Promise.reject(new Error('DIGEST_UNAVAILABLE'));
    }
    var bytes=new global.TextEncoder().encode(canonical(snapshot));
    return global.crypto.subtle.digest('SHA-256',bytes).then(function(buffer){
      return Array.prototype.map.call(new Uint8Array(buffer),function(byte){
        return byte.toString(16).padStart(2,'0');
      }).join('');
    });
  }
  function repository(options){
    return options&&options.indexedDb||global.AppIndexedDB;
  }
  function normalizeApplicationState(record){
    record.applicationState=record.applicationState&&
      typeof record.applicationState==='object'
      ?record.applicationState
      :{};
    [
      'validationCompleted',
      'backupStored',
      'localSnapshotSaved',
      'linkFinalized',
      'pendingCompleted'
    ].forEach(function(flag){
      if(record.applicationState[flag]!==true){
        record.applicationState[flag]=false;
      }
    });
    if(record.status==='applied'){
      record.applicationState.pendingCompleted=true;
    }
    return record;
  }
  function save(input,options){
    input=input||{};
    if(!input.localConferenceId||!input.remoteConferenceId||
      !input.conflictId||input.resolutionStrategy!=='keep_server'||
      !input.resolutionOperationId||!Number.isInteger(input.resolvedRevision)||
      !input.resolvedSnapshot){
      return Promise.resolve({ok:false,status:'invalid'});
    }
    var snapshot=copy(input.resolvedSnapshot);
    return digest(snapshot).then(function(hash){
      var previousPromise=repository(options).getRecord(
        STORE,input.localConferenceId
      );
      return previousPromise.catch(function(){return null;}).then(function(previous){
        var now=new Date().toISOString();
        if(previous&&previous.status==='pending'){
          if(previous.resolutionOperationId!==
            String(input.resolutionOperationId)||
            previous.conflictId!==String(input.conflictId)||
            previous.remoteConferenceId!==String(input.remoteConferenceId)||
            previous.resolvedRevision!==input.resolvedRevision||
            previous.snapshotDigest!==hash){
            return {ok:false,status:'pending_mismatch'};
          }
          return {ok:true,status:'duplicate',data:copy(previous)};
        }
        var record={
          localConferenceId:String(input.localConferenceId),
          remoteConferenceId:String(input.remoteConferenceId),
          conflictId:String(input.conflictId),
          resolutionStrategy:'keep_server',
          resolutionOperationId:String(input.resolutionOperationId),
          resolvedRevision:input.resolvedRevision,
          resolvedSnapshot:snapshot,
          snapshotDigest:hash,
          applicationState:{
            validationCompleted:false,
            backupStored:false,
            localSnapshotSaved:false,
            linkFinalized:false,
            pendingCompleted:false
          },
          createdAt:previous&&previous.createdAt||now,
          updatedAt:now,
          status:'pending'
        };
        return repository(options).putRecord(STORE,record).then(function(){
          return {ok:true,status:'pending',data:copy(record)};
        });
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  function get(localConferenceId,options){
    return repository(options).getRecord(STORE,String(localConferenceId||''))
      .then(function(record){
        return record?{ok:true,status:record.status,
          data:copy(normalizeApplicationState(record))}:
          {ok:false,status:'not_found',data:null};
      }).catch(function(){return {ok:false,status:'read_failed',data:null};});
  }
  function verify(record){
    if(!record||record.status!=='pending'||!record.resolvedSnapshot||
      !record.snapshotDigest)return Promise.resolve(false);
    return digest(record.resolvedSnapshot).then(function(hash){
      return hash===record.snapshotDigest;
    }).catch(function(){return false;});
  }
  function mark(localConferenceId,status,options){
    if(['applied','failed','cancelled'].indexOf(status)<0){
      return Promise.resolve({ok:false,status:'invalid'});
    }
    return get(localConferenceId,options).then(function(result){
      if(!result.ok)return result;
      var record=result.data;
      record.status=status;
      if(status==='applied'){
        record.applicationState.pendingCompleted=true;
      }
      record.updatedAt=new Date().toISOString();
      return repository(options).putRecord(STORE,record).then(function(){
        return {ok:true,status:status,data:copy(record)};
      }).catch(function(){return {ok:false,status:'storage_failed'};});
    });
  }
  function updateApplicationState(localConferenceId,input,options){
    input=input||{};
    var operationId=String(input.resolutionOperationId||'');
    var patch=input.patch&&typeof input.patch==='object'
      ?input.patch
      :{};
    return get(localConferenceId,options).then(function(result){
      if(!result.ok)return result;
      var record=result.data;
      if(record.resolutionOperationId!==operationId){
        return {ok:false,status:'operation_mismatch'};
      }
      Object.keys(patch).forEach(function(flag){
        if(Object.prototype.hasOwnProperty.call(
          record.applicationState,flag
        )){
          record.applicationState[flag]=patch[flag]===true;
        }
      });
      record.updatedAt=new Date().toISOString();
      return repository(options).putRecord(STORE,record).then(function(){
        return {ok:true,status:record.status,data:copy(record)};
      });
    }).catch(function(){return {ok:false,status:'storage_failed'};});
  }
  global.PendingRemoteApplicationStore=Object.freeze({
    save:save,get:get,verify:verify,mark:mark,
    updateApplicationState:updateApplicationState,
    buildDigest:digest
  });
})(window);
