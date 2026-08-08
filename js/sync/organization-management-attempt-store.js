(function(global){
  'use strict';
  var namespace=global.BrowserStorageNamespace||{key:function(v){return v;}},KEY=namespace.key('organization_management_attempts_v1');
  function storage(){try{return global.localStorage||null;}catch(error){return null;}}
  function read(){var target=storage();if(!target)return [];try{var value=JSON.parse(target.getItem(KEY)||'[]');return Array.isArray(value)?value:[];}catch(error){return [];}}
  function write(rows){var target=storage();if(!target)return false;try{target.setItem(KEY,JSON.stringify(rows));return true;}catch(error){return false;}}
  function prepare(intent,operationId){var rows=read(),key=intent.intentKey,found=rows.find(function(row){return row.intentKey===key;});if(found)return Promise.resolve({ok:true,status:'preserved',data:found});var row=Object.assign({},intent,{operationId:operationId,state:'prepared',createdAt:new Date().toISOString()});rows.push(row);return Promise.resolve(write(rows)?{ok:true,status:'saved',data:row}:{ok:false,status:'storage_failed'});}
  function markUnknown(operationId){var rows=read(),found=rows.find(function(row){return row.operationId===operationId;});if(found)found.state='unknown';return Promise.resolve(write(rows)?{ok:true}:{ok:false});}
  function remove(operationId){return Promise.resolve(write(read().filter(function(row){return row.operationId!==operationId;}))?{ok:true}:{ok:false});}
  global.OrganizationManagementAttemptStore=Object.freeze({prepare:prepare,markUnknown:markUnknown,remove:remove,list:function(){return read().slice();}});
})(window);
