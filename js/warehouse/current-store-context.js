(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{key:function(name){return name;}};
  var KEY_PREFIX='warehouse-current-store:';

  function text(value){return String(value||'').trim();}
  function storage(options){if(options&&options.storage)return options.storage;try{return global.localStorage||null;}catch(error){return null;}}
  function accountId(options){var auth=options&&options.auth||global.SupabaseAuth,identity=auth&&typeof auth.getAccountIdentity==='function'?auth.getAccountIdentity():null,state=auth&&typeof auth.getState==='function'?auth.getState():null;return text(options&&options.userId||identity&&identity.userId||state&&state.user&&state.user.id);}
  function deviceId(options){var service=options&&options.deviceIdentity||global.SupabaseDeviceIdentity,current=service&&typeof service.getCurrent==='function'?service.getCurrent(options):null;return text(options&&options.deviceId||current&&current.id);}
  function scope(options){var user=accountId(options),device=deviceId(options);return user&&device?{userId:user,deviceId:device,key:namespace.key(KEY_PREFIX+user+':'+device)}:null;}
  function activeStore(stores,storeId){return Array.isArray(stores)?stores.find(function(store){return text(store&&store.id)===storeId&&text(store&&store.status)==='active';})||null:null;}
  function read(options){var currentScope=scope(options),target=storage(options);if(!currentScope||!target)return null;try{var value=JSON.parse(target.getItem(currentScope.key)||'null'),storeId=text(value&&value.storeId);return storeId?{storeId:storeId,userId:currentScope.userId,deviceId:currentScope.deviceId}:null;}catch(error){return null;}}
  function clear(options){var currentScope=scope(options),target=storage(options);if(!currentScope)return {ok:false,code:'WAREHOUSE_STORE_CONTEXT_SCOPE_REQUIRED'};if(!target)return {ok:false,code:'WAREHOUSE_STORE_CONTEXT_STORAGE_UNAVAILABLE'};try{target.removeItem(currentScope.key);return {ok:true,store:null};}catch(error){return {ok:false,code:'WAREHOUSE_STORE_CONTEXT_STORAGE_FAILED'};}}
  function set(storeId,stores,options){var currentScope=scope(options),target=storage(options),id=text(storeId),store=activeStore(stores,id);if(!currentScope)return {ok:false,code:'WAREHOUSE_STORE_CONTEXT_SCOPE_REQUIRED'};if(!store)return {ok:false,code:'WAREHOUSE_CURRENT_STORE_INVALID'};if(!target)return {ok:false,code:'WAREHOUSE_STORE_CONTEXT_STORAGE_UNAVAILABLE'};try{target.setItem(currentScope.key,JSON.stringify({storeId:id}));return {ok:true,store:store};}catch(error){return {ok:false,code:'WAREHOUSE_STORE_CONTEXT_STORAGE_FAILED'};}}
  function validate(stores,options){var saved=read(options);if(!saved)return null;var store=activeStore(stores,saved.storeId);if(store)return store;clear(options);return null;}
  function get(options){return read(options);}
  function requireId(options){var saved=read(options);if(saved)return saved.storeId;var error=new Error('يرجى اختيار المخزن الحالي أولًا.');error.code='WAREHOUSE_CURRENT_STORE_REQUIRED';throw error;}

  global.WarehouseCurrentStoreContext=Object.freeze({
    getCurrentWarehouseStore:get,
    getCurrentWarehouseStoreId:requireId,
    setCurrentWarehouseStore:set,
    clearCurrentWarehouseStore:clear,
    validateCurrentWarehouseStore:validate,
    getStorageKey:function(options){var currentScope=scope(options);return currentScope&&currentScope.key||'';}
  });
})(window);
