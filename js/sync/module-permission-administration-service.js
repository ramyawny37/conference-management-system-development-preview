(function(global){
  'use strict';
  var MODULE='warehouse';
  function outcome(ok,status,data,error){return {ok:ok,status:status,data:data||null,error:error||null};}
  function text(value){return value==null?null:String(value);}
  function uuid(value){value=String(value||'');return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;}
  function operationId(){return global.crypto&&typeof global.crypto.randomUUID==='function'?global.crypto.randomUUID():null;}
  function errorCode(error){var value=String(error&&error.code||error&&error.message||'MODULE_PERMISSION_ADMINISTRATION_FAILED');return /^[A-Z][A-Z0-9_]{0,95}$/.test(value)?value:'MODULE_PERMISSION_ADMINISTRATION_FAILED';}
  function invoke(operation,args){
    if(!global.PlatformDeviceSession||typeof global.PlatformDeviceSession.invokeProtected!=='function')return Promise.reject({code:'DEVICE_SESSION_UNAVAILABLE'});
    if(Object.prototype.hasOwnProperty.call(args||{},'p_actor_device_id')||Object.prototype.hasOwnProperty.call(args||{},'p_device_id'))return Promise.reject({code:'ACTOR_DEVICE_OVERRIDE_DENIED'});
    return global.PlatformDeviceSession.invokeProtected(operation,args||{});
  }
  function warehouse(operation,args){
    if(!global.WarehouseTransport||typeof global.WarehouseTransport.invoke!=='function')return Promise.reject({code:'WAREHOUSE_TRANSPORT_UNAVAILABLE'});
    return global.WarehouseTransport.invoke(operation,args||{});
  }
  function run(call,normalize,status){return Promise.resolve().then(call).then(function(value){var data=normalize(value);return data==null?outcome(false,'malformed_response'):outcome(true,status,data);}).catch(function(error){return outcome(false,'denied',null,{code:errorCode(error)});});}
  function candidate(row){var id=uuid(row&&row.userId);if(!id)return null;return {userId:id,displayName:text(row.displayName),email:String(row.email||''),accountStatus:String(row.accountStatus||'')};}
  function catalogItem(row){if(!row||!row.permissionKey||String(row.permissionKey).indexOf('module.')===0)return null;return {permissionKey:String(row.permissionKey),displayName:String(row.displayName||row.permissionKey),description:String(row.description||''),allowedScopeMode:String(row.allowedScopeMode||'module'),allowedResourceType:text(row.allowedResourceType),sensitiveMutation:row.sensitiveMutation===true,catalogVersion:Number(row.catalogVersion||0)};}
  function grant(row){var id=uuid(row&&row.grantId);if(!id)return null;return {grantId:id,permissionKey:String(row.permissionKey||''),resourceType:text(row.resourceType),resourceId:text(row.resourceId),grantedAt:text(row.grantedAt),revokedAt:text(row.revokedAt),active:row.revokedAt==null};}
  function store(row){var id=uuid(row&&row.storeId);if(!id)return null;return {storeId:id,code:String(row.code||''),name:String(row.name||''),status:String(row.status||'')};}
  function array(value,mapper){if(!Array.isArray(value))return null;var mapped=value.map(mapper);return mapped.some(function(item){return !item;})?null:mapped;}
  function probeAvailability(){return run(function(){return invoke('get_user_management_actor_capabilities',{});},function(value){if(!value||value.status!=='success'||typeof value.canManageAccount!=='boolean')return {ownerConfirmed:false};return {ownerConfirmed:value.canManageAccount===true};},'confirmed').then(function(capability){return listCatalog().then(function(response){if(!response.ok)return response;return outcome(true,'available',{moduleKey:MODULE,catalog:response.data.catalog,ownerConfirmed:capability.ok&&capability.data.ownerConfirmed===true,canManageModuleManagers:capability.ok&&capability.data.ownerConfirmed===true});});});}
  function searchCandidates(query){return run(function(){return invoke('search_module_permission_candidates',{p_module_key:MODULE,p_query:String(query||'').slice(0,160),p_limit:50});},function(value){var rows=array(value,candidate);return rows&&{candidates:rows};},'listed');}
  function listCatalog(){return run(function(){return invoke('list_module_permission_catalog_for_administration',{p_module_key:MODULE});},function(value){var rows=array(value,catalogItem);return rows&&{catalog:rows};},'listed');}
  function listGrants(targetUserId){var target=uuid(targetUserId);if(!target)return Promise.resolve(outcome(false,'invalid_input'));return run(function(){return invoke('list_module_permission_grants',{p_module_key:MODULE,p_target_user_id:target});},function(value){if(!value||value.status!=='success'||uuid(value.targetUserId)!==target)return null;var rows=array(value.grants,grant);return rows&&{targetUserId:target,grants:rows};},'listed');}
  function listStores(){return run(function(){return warehouse('list_permission_administration_stores',{p_include_inactive:false});},function(value){var rows=array(value,store);return rows&&{stores:rows};},'listed');}
  function foundationMutation(input){return mutate(input,true);}
  function catalogMutation(input){return mutate(input,false);}
  function mutate(input,foundation){
    input=input||{};var target=uuid(input.targetUserId),grantId=input.action==='revoke'?uuid(input.grantId):null,id=operationId();
    if(!target||!id||['grant','revoke'].indexOf(input.action)<0||foundation&&['module.access','module.manage'].indexOf(input.permissionKey)<0||!foundation&&String(input.permissionKey||'').indexOf('warehouse.')!==0||input.action==='revoke'&&!grantId)return Promise.resolve(outcome(false,'invalid_input'));
    var args={p_operation_id:id,p_action:foundation&&input.action==='grant'?'create':input.action,p_target_user_id:target,p_module_key:MODULE,p_permission_key:String(input.permissionKey),p_grant_id:grantId,p_revocation_reason:input.action==='revoke'?String(input.revocationReason||'إلغاء الصلاحية من شاشة إدارة صلاحيات الموديولات').slice(0,300):null};
    if(!foundation){args.p_resource_type=input.resourceType==null?null:String(input.resourceType);args.p_resource_id=input.resourceId==null?null:String(input.resourceId);}
    return run(function(){return invoke(foundation?'manage_foundation_module_grant':'manage_catalog_module_grant',args);},function(value){return value&&value.grantId?{result:value}:null;},'applied');
  }
  global.ModulePermissionAdministrationService=Object.freeze({MODULE_KEY:MODULE,probeAvailability:probeAvailability,searchCandidates:searchCandidates,listCatalog:listCatalog,listGrants:listGrants,listStores:listStores,foundationMutation:foundationMutation,catalogMutation:catalogMutation});
})(window);
