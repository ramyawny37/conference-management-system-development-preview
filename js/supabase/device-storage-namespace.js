(function(global){
  'use strict';

  var LEGACY_DATABASE='platform-device-ownership-v1';

  function projectRefFromUrl(value){
    try{
      var host=new URL(String(value||'')).hostname.toLowerCase();
      var match=host.match(/^([a-z0-9]{20})\.supabase\.co$/);
      return match?match[1]:'';
    }catch(error){
      return '';
    }
  }

  function projectRef(){
    var config=global.SUPABASE_RUNTIME_CONFIG||{};
    return projectRefFromUrl(config.url);
  }

  function requireProjectRef(){
    var value=projectRef();
    if(!value)throw new Error('SUPABASE_PROJECT_IDENTITY_REQUIRED');
    return value;
  }

  function databaseName(){
    return LEGACY_DATABASE+':'+requireProjectRef();
  }

  function identityKey(userId){
    return 'device-identity:'+requireProjectRef()+':'+String(userId||'');
  }

  function legacyIdentityKey(){
    var namespace=global.BrowserStorageNamespace||{key:function(name){return name;}};
    return namespace.key('conference_manager_device_identity');
  }

  function canAdoptLegacy(){
    var namespace=global.BrowserStorageNamespace||{};
    var value=projectRef();
    return !!(value&&namespace.environment==='development'&&namespace.projectRef===value);
  }

  global.PlatformDeviceStorageNamespace=Object.freeze({
    projectRefFromUrl:projectRefFromUrl,
    projectRef:projectRef,
    databaseName:databaseName,
    identityKey:identityKey,
    legacyDatabaseName:function(){return LEGACY_DATABASE;},
    legacyIdentityKey:legacyIdentityKey,
    canAdoptLegacy:canAdoptLegacy
  });
})(window);
