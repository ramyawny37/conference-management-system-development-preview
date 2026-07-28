(function(global){
  'use strict';

  var STORAGE_KEY='conference_manager_supabase_runtime_config';
  var memoryConfig=null;

  function decodeJwtPayload(token){
    try{
      var parts=String(token||'').split('.');
      if(parts.length!==3)return null;
      var encoded=parts[1].replace(/-/g,'+').replace(/_/g,'/');
      while(encoded.length%4)encoded+='=';
      return JSON.parse(global.atob(encoded));
    }catch(error){
      return null;
    }
  }

  function isServiceRoleKey(key){
    var value=String(key||'').trim();
    if(/^sb_secret_/i.test(value))return true;
    var payload=decodeJwtPayload(value);
    return !!(payload&&(
      payload.role==='service_role'||
      payload.role==='supabase_admin'
    ));
  }

  function validate(input){
    input=input&&typeof input==='object'?input:{};
    var url=String(input.url||'').trim();
    var publishableKey=String(
      input.publishableKey||input.anonKey||''
    ).trim();
    var emailRedirectTo=String(input.emailRedirectTo||'').trim();
    var errors=[];
    try{
      var parsed=new URL(url);
      if(parsed.protocol!=='https:'||
        !/\.supabase\.co$/i.test(parsed.hostname)){
        errors.push('SUPABASE_URL_INVALID');
      }
    }catch(error){
      errors.push('SUPABASE_URL_INVALID');
    }
    if(!publishableKey)errors.push('SUPABASE_KEY_REQUIRED');
    if(isServiceRoleKey(publishableKey)){
      errors.push('SUPABASE_SERVICE_ROLE_KEY_REJECTED');
    }
    if(emailRedirectTo){
      try{
        var redirectUrl=new URL(emailRedirectTo);
        if(redirectUrl.protocol!=='https:'&&
          redirectUrl.protocol!=='http:'){
          errors.push('SUPABASE_REDIRECT_URL_INVALID');
        }
      }catch(error){
        errors.push('SUPABASE_REDIRECT_URL_INVALID');
      }
    }
    return {
      valid:errors.length===0,
      errors:errors,
      value:errors.length?null:{
        url:url,
        publishableKey:publishableKey,
        emailRedirectTo:emailRedirectTo
      }
    };
  }

  function getStorage(options){
    if(options&&options.storage)return options.storage;
    try{
      return global.localStorage||null;
    }catch(error){
      return null;
    }
  }

  function load(options){
    if(memoryConfig)return {
      url:memoryConfig.url,
      publishableKey:memoryConfig.publishableKey,
      emailRedirectTo:memoryConfig.emailRedirectTo||''
    };
    var storage=getStorage(options);
    if(!storage)return null;
    try{
      var parsed=JSON.parse(storage.getItem(STORAGE_KEY)||'null');
      var checked=validate(parsed);
      if(checked.valid){
        memoryConfig=checked.value;
        return {
          url:memoryConfig.url,
          publishableKey:memoryConfig.publishableKey,
          emailRedirectTo:memoryConfig.emailRedirectTo||''
        };
      }
    }catch(error){}
    return null;
  }

  function save(input,options){
    var checked=validate(input);
    if(!checked.valid){
      return {ok:false,status:'invalid',errors:checked.errors};
    }
    var storage=getStorage(options);
    if(!storage){
      return {ok:false,status:'storage_unavailable',errors:[
        'RUNTIME_CONFIG_STORAGE_UNAVAILABLE'
      ]};
    }
    try{
      storage.setItem(STORAGE_KEY,JSON.stringify(checked.value));
      memoryConfig=checked.value;
      return {ok:true,status:'configured',errors:[]};
    }catch(error){
      return {ok:false,status:'storage_error',errors:[
        'RUNTIME_CONFIG_STORAGE_FAILED'
      ]};
    }
  }

  function clear(options){
    memoryConfig=null;
    var storage=getStorage(options);
    if(storage){
      try{storage.removeItem(STORAGE_KEY);}catch(error){}
    }
    if(global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.clear==='function'){
      global.SupabaseClientLayer.clear();
    }else if(global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.configure==='function'){
      global.SupabaseClientLayer.configure({url:'',publishableKey:''});
    }
    return {ok:true,status:'not_configured'};
  }

  function configureClient(options){
    var config=load(options);
    if(!config)return {
      available:false,
      reason:'SUPABASE_CONFIG_MISSING'
    };
    if(!global.SupabaseClientLayer||
      typeof global.SupabaseClientLayer.configure!=='function'){
      return {
        available:false,
        reason:'SUPABASE_CLIENT_LAYER_UNAVAILABLE'
      };
    }
    return global.SupabaseClientLayer.configure(config);
  }

  function maskKey(key){
    var value=String(key||'');
    if(!value)return '';
    if(value.length<12)return '••••••••';
    return value.slice(0,6)+'••••••••'+value.slice(-4);
  }

  function getPublicState(options){
    var config=load(options);
    return {
      configured:!!config,
      url:config?config.url:'',
      emailRedirectTo:config?config.emailRedirectTo:'',
      maskedKey:config?maskKey(config.publishableKey):''
    };
  }

  global.SupabaseRuntimeConfig=Object.freeze({
    validate:validate,
    load:load,
    save:save,
    clear:clear,
    configureClient:configureClient,
    getPublicState:getPublicState
  });
})(window);
