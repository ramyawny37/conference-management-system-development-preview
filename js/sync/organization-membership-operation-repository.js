(function(global){
  'use strict';

  var STORE_NAME='organization_membership_pending_operations';
  var RETENTION_MS=7*24*60*60*1000;
  var FUTURE_TOLERANCE_MS=5*60*1000;
  var ACTIONS=['add_organization_member','remove_organization_member',
    'change_organization_role'];
  var ROLES=['organization_owner','organization_admin','member'];
  var utils=global.OrganizationAdministrationUtils;
  var copy=utils&&utils.copy;
  var isUuid=utils&&utils.isUuid;

  function result(ok,status,data){return {ok:ok,status:status,data:data||null};}
  function date(value){var parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed;}
  function intentKey(input){return [input.authenticatedUserId,input.organizationId,
    input.targetUserId,input.action,input.requestedRole||null];}
  function validRequest(input){
    return input&&isUuid(String(input.authenticatedUserId||''))&&
      isUuid(String(input.organizationId||''))&&isUuid(String(input.targetUserId||''))&&
      ACTIONS.indexOf(input.action)>=0&&
      (input.action==='change_organization_role'
        ?ROLES.indexOf(input.requestedRole)>=0
        :(input.requestedRole==null||input.requestedRole===''));
  }
  function validRecord(record,now){
    var created=date(record&&record.createdAt),attempted=date(record&&record.lastAttemptAt);
    return validRequest(record)&&isUuid(String(record.operationId||''))&&
      ['pending','unknown'].indexOf(record.state)>=0&&
      Number.isInteger(record.attemptCount)&&record.attemptCount>=0&&created&&
      (!record.lastAttemptAt||attempted)&&
      created.getTime()<=now.getTime()+FUTURE_TOLERANCE_MS&&
      now.getTime()-created.getTime()<RETENTION_MS;
  }
  function db(){return global.AppIndexedDB||null;}
  function requestPromise(request){return new Promise(function(resolve,reject){request.onsuccess=function(){resolve(request.result);};request.onerror=function(){reject(request.error);};});}
  function get(authenticatedUserId,operationId){
    var database=db();
    if(!isUuid(String(authenticatedUserId||''))||!isUuid(String(operationId||''))||!database)return Promise.resolve(result(false,'invalid_input'));
    return database.getRecord(STORE_NAME,[authenticatedUserId,operationId]).then(function(record){
      if(!record)return result(false,'not_found');
      if(!validRecord(record,new Date()))return removeCorrupt(record).then(function(){return result(false,'manual_retry_required');});
      return result(true,'found',copy(record));
    }).catch(function(){return result(false,'storage_error');});
  }
  function removeCorrupt(record){
    var database=db();
    if(!database||!record)return Promise.resolve(false);
    return database.deleteRecord(STORE_NAME,[record.authenticatedUserId,record.operationId])
      .then(function(){return true;},function(){return false;});
  }
  function prepare(input,operationId,options){
    options=options||{};var now=date(options.now||new Date());var database=db();
    if(!validRequest(input)||!isUuid(String(operationId||''))||!now||!database)return Promise.resolve(result(false,'invalid_input'));
    return database.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];return requestPromise(store.index('by_user_intent').getAll(intentKey(input))).then(function(records){
        var existing=records[0];
        if(existing&&validRecord(existing,now))return existing;
        if(existing)return requestPromise(store.delete([existing.authenticatedUserId,existing.operationId])).then(function(){return null;});
        return null;
      }).then(function(existing){
        if(existing)return existing;
        var record={authenticatedUserId:input.authenticatedUserId,
          operationId:String(operationId),organizationId:input.organizationId,
          action:input.action,targetUserId:input.targetUserId,
          requestedRole:input.requestedRole||'',state:'pending',
          createdAt:now.toISOString(),lastAttemptAt:null,attemptCount:0};
        return requestPromise(store.put(record)).then(function(){return record;});
      });
    }).then(function(record){
      if(!validRecord(record,now))return result(false,'manual_retry_required');
      return result(true,'prepared',copy(record));
    }).catch(function(){return result(false,'storage_error');});
  }
  function updateState(authenticatedUserId,operationId,state,options){
    options=options||{};var now=date(options.now||new Date());var database=db();
    if(!now||!database)return Promise.resolve(result(false,'invalid_input'));
    return database.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];return requestPromise(store.get([authenticatedUserId,operationId])).then(function(record){
        if(!record)throw new Error('NOT_FOUND');
        if(!validRecord(record,now))return requestPromise(store.delete([authenticatedUserId,operationId])).then(function(){throw new Error('CORRUPT');});
        if(state==='attempt'){record.lastAttemptAt=now.toISOString();record.attemptCount++;}
        else record.state=state;
        return requestPromise(store.put(record)).then(function(){return record;});
      });
    }).then(function(record){return result(true,state==='attempt'?'attempt_recorded':state,copy(record));})
      .catch(function(error){return result(false,error&&error.message==='CORRUPT'?'manual_retry_required':'storage_error');});
  }
  function markAttempt(authenticatedUserId,operationId,options){return updateState(authenticatedUserId,operationId,'attempt',options);}
  function markUnknown(authenticatedUserId,operationId,options){return updateState(authenticatedUserId,operationId,'unknown',options);}
  function remove(authenticatedUserId,operationId){
    var database=db();if(!database)return Promise.resolve(result(false,'unavailable'));
    return database.deleteRecord(STORE_NAME,[authenticatedUserId,operationId])
      .then(function(){return result(true,'removed');},function(){return result(false,'storage_error');});
  }
  function listForReconciliation(authenticatedUserId,options){
    options=options||{};var now=date(options.now||new Date());var database=db();
    if(!isUuid(String(authenticatedUserId||''))||!now||!database)return Promise.resolve(result(false,'invalid_input'));
    return database.runTransaction(STORE_NAME,'readwrite',function(stores){
      var store=stores[STORE_NAME];return requestPromise(store.index('by_authenticated_user').getAll(authenticatedUserId)).then(function(records){
        var valid=[];return Promise.all(records.map(function(record){
          if(validRecord(record,now)){valid.push(record);return null;}
          return requestPromise(store.delete([record.authenticatedUserId,record.operationId]));
        })).then(function(){return valid;});
      });
    }).then(function(records){return result(true,'listed',{operations:copy(records)});})
      .catch(function(){return result(false,'storage_error');});
  }
  global.OrganizationMembershipOperationRepository=Object.freeze({
    storeName:STORE_NAME,retentionMs:RETENTION_MS,futureToleranceMs:FUTURE_TOLERANCE_MS,
    intentKey:intentKey,get:get,prepare:prepare,markAttempt:markAttempt,
    markUnknown:markUnknown,remove:remove,listForReconciliation:listForReconciliation
  });
})(window);
