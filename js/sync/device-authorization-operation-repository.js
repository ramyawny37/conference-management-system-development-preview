(function(global){
  'use strict';
  var KEY='conference_manager_device_authorization_operations';
  function storage(options){try{return options&&options.storage||global.localStorage||null;}catch(error){return null;}}
  function read(options){var target=storage(options);if(!target)return [];try{var value=JSON.parse(target.getItem(KEY)||'[]');return Array.isArray(value)?value:[];}catch(error){return [];}}
  function write(records,options){var target=storage(options);if(!target)return false;try{target.setItem(KEY,JSON.stringify(records));return true;}catch(error){return false;}}
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function prepare(input,operationId,options){
    var records=read(options),existing=records.filter(function(row){return row.actorUserId===input.actorUserId&&row.intentKey===input.intentKey;})[0];
    if(existing)return Promise.resolve({ok:true,status:'existing',data:copy(existing)});
    var record=Object.assign({},input,{operationId:operationId,state:'pending',createdAt:new Date().toISOString()});
    records.push(record);return Promise.resolve(write(records,options)?{ok:true,status:'prepared',data:copy(record)}:{ok:false,status:'storage_failed'});
  }
  function update(actorUserId,operationId,state,options){var records=read(options),found=false;records.forEach(function(row){if(row.actorUserId===actorUserId&&row.operationId===operationId){row.state=state;found=true;}});return Promise.resolve(found&&write(records,options)?{ok:true,status:state}:{ok:false,status:'not_found'});}
  function get(actorUserId,operationId,options){var row=read(options).filter(function(item){return item.actorUserId===actorUserId&&item.operationId===operationId;})[0];return Promise.resolve(row?{ok:true,status:'found',data:copy(row)}:{ok:false,status:'not_found'});}
  function remove(actorUserId,operationId,options){var records=read(options),next=records.filter(function(row){return !(row.actorUserId===actorUserId&&row.operationId===operationId);});return Promise.resolve(next.length!==records.length&&write(next,options)?{ok:true,status:'removed'}:{ok:false,status:'not_found'});}
  function list(actorUserId,options){return Promise.resolve({ok:true,status:'listed',data:{operations:read(options).filter(function(row){return row.actorUserId===actorUserId;}).map(copy)}});}
  global.DeviceAuthorizationOperationRepository=Object.freeze({prepare:prepare,markUnknown:function(user,id,options){return update(user,id,'unknown',options);},get:get,remove:remove,list:list});
})(window);
