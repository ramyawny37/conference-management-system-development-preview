(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{key:function(value){return value;}};
  var PREFIX='legacy-conference-organization-assignment:';

  function uuid(value){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value||''));
  }
  function copy(value){return value?JSON.parse(JSON.stringify(value)):null;}
  function key(input){
    return namespace.key(PREFIX+[
      String(input&&input.actorUserId||''),
      String(input&&input.conferenceId||''),
      String(input&&input.organizationId||'')
    ].join(':'));
  }
  function valid(input){
    return !!(input&&uuid(input.actorUserId)&&uuid(input.conferenceId)&&
      uuid(input.organizationId)&&uuid(input.operationId)&&
      ['prepared','unknown'].indexOf(input.state)>=0);
  }
  function get(input,options){
    var storage=options&&options.storage||global.localStorage;
    if(!storage)return {ok:false,status:'storage_unavailable'};
    try{
      var raw=storage.getItem(key(input));
      if(!raw)return {ok:false,status:'not_found'};
      var row=JSON.parse(raw);
      if(!valid(row)||row.actorUserId!==input.actorUserId||
        row.conferenceId!==input.conferenceId||
        row.organizationId!==input.organizationId){
        return {ok:false,status:'corrupt_record'};
      }
      return {ok:true,status:'found',data:copy(row)};
    }catch(error){return {ok:false,status:'storage_error'};}
  }
  function prepare(input,operationId,options){
    var existing=get(input,options);
    if(existing.ok)return existing;
    if(existing.status!=='not_found')return existing;
    var storage=options&&options.storage||global.localStorage;
    var now=new Date().toISOString();
    var row={actorUserId:String(input.actorUserId),
      conferenceId:String(input.conferenceId),
      organizationId:String(input.organizationId),operationId:String(operationId),
      state:'prepared',createdAt:now,updatedAt:now};
    if(!storage||!valid(row))return {ok:false,status:'invalid'};
    try{storage.setItem(key(row),JSON.stringify(row));
      return {ok:true,status:'prepared',data:copy(row)};
    }catch(error){return {ok:false,status:'storage_error'};}
  }
  function markUnknown(input,options){
    var found=get(input,options),storage=options&&options.storage||global.localStorage;
    if(!found.ok)return found;
    found.data.state='unknown';found.data.updatedAt=new Date().toISOString();
    try{storage.setItem(key(found.data),JSON.stringify(found.data));
      return {ok:true,status:'unknown',data:copy(found.data)};
    }catch(error){return {ok:false,status:'storage_error'};}
  }
  function remove(input,options){
    var storage=options&&options.storage||global.localStorage;
    if(!storage)return {ok:false,status:'storage_unavailable'};
    try{storage.removeItem(key(input));return {ok:true,status:'removed'};}
    catch(error){return {ok:false,status:'storage_error'};}
  }

  global.LegacyConferenceOrganizationAssignmentAttemptStore=Object.freeze({
    prefix:PREFIX,key:key,get:get,prepare:prepare,
    markUnknown:markUnknown,remove:remove
  });
})(window);
