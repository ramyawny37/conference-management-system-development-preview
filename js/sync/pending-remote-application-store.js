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
        var record={
          localConferenceId:String(input.localConferenceId),
          remoteConferenceId:String(input.remoteConferenceId),
          conflictId:String(input.conflictId),
          resolutionStrategy:'keep_server',
          resolutionOperationId:String(input.resolutionOperationId),
          resolvedRevision:input.resolvedRevision,
          resolvedSnapshot:snapshot,
          snapshotDigest:hash,
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
        return record?{ok:true,status:record.status,data:copy(record)}:
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
      record.updatedAt=new Date().toISOString();
      return repository(options).putRecord(STORE,record).then(function(){
        return {ok:true,status:status,data:copy(record)};
      }).catch(function(){return {ok:false,status:'storage_failed'};});
    });
  }
  global.PendingRemoteApplicationStore=Object.freeze({
    save:save,get:get,verify:verify,mark:mark,buildDigest:digest
  });
})(window);
