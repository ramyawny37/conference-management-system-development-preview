(function(global){
  'use strict';
  var conference=global.ConferenceDeviceOperationContract.EDGE_ONLY_PROTECTED.map(function(entry){return Object.freeze({module:'conference',operation:entry.operation,signature:entry.signature,dispatchable:true});});
  var warehouse=global.WarehouseDeviceOperationContract.DISPATCHABLE;
  global.PlatformDeviceOperationContract=Object.freeze({CONFERENCE:Object.freeze(conference),WAREHOUSE:warehouse,DISPATCHABLE:Object.freeze(conference.concat(warehouse)),isAllowed:function(module,operation){return module==='conference'?global.ConferenceDeviceOperationContract.isProtectedOperation(operation):module==='warehouse'&&!!(global.WarehouseDeviceOperationContract.get(operation)||{}).dispatchable;}});
})(window);
