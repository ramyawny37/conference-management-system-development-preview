(function(global){
  'use strict';
  function invoke(operation,args){var entry=global.WarehouseDeviceOperationContract.get(operation);if(!entry||!entry.dispatchable)return Promise.reject({code:'WAREHOUSE_OPERATION_NOT_DISPATCHABLE'});args=Object.assign({},args||{});if(Object.prototype.hasOwnProperty.call(args,'p_device_id')||Object.prototype.hasOwnProperty.call(args,'p_actor_device_id'))return Promise.reject({code:'ACTOR_DEVICE_OVERRIDE_DENIED'});return global.PlatformDeviceSession.invokeModuleProtected('warehouse',operation,args);}
  global.WarehouseTransport=Object.freeze({invoke:invoke});
})(window);
