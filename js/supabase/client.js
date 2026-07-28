(function(global){
  'use strict';

  var state = {
    configured: false,
    available: false,
    client: null,
    url: null,
    publishableKey: null,
    lastError: null
  };

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

  function isForbiddenKey(key){
    var value=String(key||'').trim();
    if(!value)return false;
    if(/^sb_secret_/i.test(value))return true;
    var payload=decodeJwtPayload(value);
    return !!(payload&&(payload.role==='service_role'||payload.role==='supabase_admin'));
  }

  function resolveCreateClient(options){
    if(options&&typeof options.createClient==='function')return options.createClient;
    if(global.supabase&&typeof global.supabase.createClient==='function'){
      return global.supabase.createClient;
    }
    return null;
  }

  function configure(options){
    options=options&&typeof options==='object'?options:{};
    var runtimeConfig=global.SUPABASE_RUNTIME_CONFIG&&
      typeof global.SUPABASE_RUNTIME_CONFIG==='object'
      ?global.SUPABASE_RUNTIME_CONFIG
      :{};
    var url=String(options.url||runtimeConfig.url||'').trim();
    var publishableKey=String(
      options.publishableKey||runtimeConfig.publishableKey||''
    ).trim();
    var createClient=resolveCreateClient(options);

    if(!url||!publishableKey){
      return {available:false,reason:'SUPABASE_CONFIG_MISSING'};
    }
    if(!/^https?:\/\//i.test(url)){
      state.lastError=new Error('SUPABASE_URL_INVALID');
      return {available:false,reason:state.lastError.message};
    }
    if(isForbiddenKey(publishableKey)){
      state.lastError=new Error('SUPABASE_SECRET_KEY_REJECTED');
      return {available:false,reason:state.lastError.message};
    }
    if(!createClient){
      return {available:false,reason:'SUPABASE_CLIENT_LIBRARY_UNAVAILABLE'};
    }
    if(state.client&&state.url===url&&state.publishableKey===publishableKey){
      return {available:true,reason:'',reused:true};
    }

    try{
      var previousClient=state.client;
      if(previousClient){
        try{
          if(previousClient.auth&&
            typeof previousClient.auth.stopAutoRefresh==='function'){
            previousClient.auth.stopAutoRefresh();
          }
          if(typeof previousClient.removeAllChannels==='function'){
            previousClient.removeAllChannels();
          }
        }catch(cleanupError){}
      }
      if(global.SupabaseAuth&&
        typeof global.SupabaseAuth.resetForClientChange==='function'){
        global.SupabaseAuth.resetForClientChange();
      }
      state.configured=false;
      state.available=false;
      state.client=null;
      state.url=null;
      state.publishableKey=null;
      state.client=createClient(url,publishableKey,{
        auth:{
          persistSession:true,
          autoRefreshToken:true,
          detectSessionInUrl:true
        }
      });
      state.configured=true;
      state.available=!!state.client;
      state.url=url;
      state.publishableKey=publishableKey;
      state.lastError=null;
      return {
        available:state.available,
        reason:state.available?'':'SUPABASE_CLIENT_CREATION_FAILED'
      };
    }catch(error){
      state.configured=false;
      state.available=false;
      state.client=null;
      state.url=null;
      state.publishableKey=null;
      state.lastError=error;
      return {
        available:false,
        reason:error&&error.message?error.message:'SUPABASE_CLIENT_CREATION_FAILED'
      };
    }
  }

  function getClient(){
    return state.available?state.client:null;
  }

  function getState(){
    return {
      configured:state.configured,
      available:state.available,
      lastError:state.lastError
    };
  }

  function clear(){
    if(state.client){
      try{
        if(state.client.auth&&
          typeof state.client.auth.stopAutoRefresh==='function'){
          state.client.auth.stopAutoRefresh();
        }
        if(typeof state.client.removeAllChannels==='function'){
          state.client.removeAllChannels();
        }
      }catch(error){}
    }
    if(global.SupabaseAuth&&
      typeof global.SupabaseAuth.resetForClientChange==='function'){
      global.SupabaseAuth.resetForClientChange();
    }
    state.configured=false;
    state.available=false;
    state.client=null;
    state.url=null;
    state.publishableKey=null;
    state.lastError=null;
    return {available:false,reason:'SUPABASE_CONFIG_MISSING'};
  }

  global.SupabaseClientLayer=Object.freeze({
    configure:configure,
    getClient:getClient,
    getState:getState,
    clear:clear
  });
})(window);
