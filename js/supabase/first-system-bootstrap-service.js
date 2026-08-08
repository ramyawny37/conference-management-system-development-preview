(function(global){
  'use strict';
  function client(){return global.SupabaseClientLayer&&global.SupabaseClientLayer.getClient?global.SupabaseClientLayer.getClient():null;}
  function rpc(name,args){var value=client();if(!value||typeof value.rpc!=='function')return Promise.resolve({ok:false,status:'unavailable'});return value.rpc(name,args||{}).then(function(result){if(result.error)return {ok:false,status:'failed',error:result.error};return {ok:true,status:result.data&&result.data.status||'unknown',data:result.data||{}};}).catch(function(error){return {ok:false,status:'unknown',error:error};});}
  function getStatus(){return rpc('get_first_system_bootstrap_status');}
  function complete(input){input=input||{};var identity=global.SupabaseDeviceIdentity&&global.SupabaseDeviceIdentity.getOrCreate?global.SupabaseDeviceIdentity.getOrCreate():null,operationId=input.operationId||(global.crypto&&global.crypto.randomUUID?global.crypto.randomUUID():null);return rpc('complete_first_system_bootstrap',{p_setup_token:String(input.setupToken||''),p_organization_name:String(input.organizationName||''),p_organization_description:String(input.organizationDescription||''),p_device_id:identity&&identity.id||null,p_device_name:identity&&identity.deviceName||'',p_device_platform:identity&&identity.platform||'',p_operation_id:operationId});}
  global.FirstSystemBootstrapService=Object.freeze({getStatus:getStatus,complete:complete});
})(window);
