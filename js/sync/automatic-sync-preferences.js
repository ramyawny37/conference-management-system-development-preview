(function(global){
  'use strict';

  var namespace=global.BrowserStorageNamespace||{
    key:function(name){return name;}
  };
  var STORAGE_KEY=namespace.key(
    'conference_manager_automatic_sync_preferences'
  );
  var DEFAULTS=Object.freeze({
    cloudSyncEnabled:false,
    automaticLinkingEnabled:true,
    automaticSyncEnabled:true
  });

  function storage(options){
    if(options&&options.storage)return options.storage;
    try{return global.localStorage||null;}catch(error){return null;}
  }

  function normalize(input){
    input=input&&typeof input==='object'?input:{};
    return {
      cloudSyncEnabled:input.cloudSyncEnabled===true,
      automaticLinkingEnabled:input.automaticLinkingEnabled!==false,
      automaticSyncEnabled:input.automaticSyncEnabled!==false
    };
  }

  function get(options){
    var target=storage(options);
    if(!target)return normalize(DEFAULTS);
    try{
      return normalize(JSON.parse(target.getItem(STORAGE_KEY)||'null'));
    }catch(error){
      return normalize(DEFAULTS);
    }
  }

  function set(input,options){
    var previous=get(options);
    var value=normalize(input);
    var target=storage(options);
    if(!target)return {ok:false,status:'storage_unavailable'};
    try{
      target.setItem(STORAGE_KEY,JSON.stringify(value));
      var persisted=normalize(JSON.parse(
        target.getItem(STORAGE_KEY)||'null'
      ));
      if(persisted.cloudSyncEnabled!==value.cloudSyncEnabled||
        persisted.automaticLinkingEnabled!==value.automaticLinkingEnabled||
        persisted.automaticSyncEnabled!==value.automaticSyncEnabled){
        return {ok:false,status:'storage_failed',data:persisted};
      }
      var orchestrator=global.AutomaticSyncOrchestrator;
      if(orchestrator){
        if(previous.cloudSyncEnabled&&!value.cloudSyncEnabled&&
          typeof orchestrator.stop==='function'){
          orchestrator.stop();
        }else if(value.cloudSyncEnabled){
          if(typeof orchestrator.start==='function'){
            orchestrator.start();
          }
          if(typeof orchestrator.schedule==='function'){
            orchestrator.schedule('preferences_changed');
          }
        }
      }
      return {ok:true,status:'saved',data:persisted};
    }catch(error){
      return {ok:false,status:'storage_failed'};
    }
  }

  function reset(options){
    var target=storage(options);
    if(target){
      try{target.removeItem(STORAGE_KEY);}catch(error){}
    }
    if(global.AutomaticSyncOrchestrator&&
      typeof global.AutomaticSyncOrchestrator.stop==='function'){
      global.AutomaticSyncOrchestrator.stop();
    }
    return {ok:true,status:'reset',data:normalize(DEFAULTS)};
  }

  global.AutomaticSyncPreferences=Object.freeze({
    defaults:DEFAULTS,
    get:get,
    set:set,
    reset:reset
  });
})(window);
