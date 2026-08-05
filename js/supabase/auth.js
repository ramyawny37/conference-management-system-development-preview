(function(global){
  'use strict';

  var state = {
    initialized: false,
    session: null,
    user: null,
    subscription: null,
    lastError: null
  };
  var initializationPromise = null;
  var clientGeneration = 0;

  function getClient(){
    return global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.getClient==='function'
      ?global.SupabaseClientLayer.getClient()
      :null;
  }

  function updateSession(session){
    var previousUserId=String(state.user&&state.user.id||'');
    state.session=session||null;
    state.user=session&&session.user?session.user:null;
    var nextUserId=String(state.user&&state.user.id||'');
    var orchestrator=global.AutomaticSyncOrchestrator;
    var orchestratorState=orchestrator&&
      typeof orchestrator.getState==='function'
      ?orchestrator.getState():null;
    if(previousUserId!==nextUserId&&orchestratorState&&
      orchestratorState.started&&typeof orchestrator.schedule==='function'){
      orchestrator.schedule('auth_changed');
    }
  }

  function initialize(options){
    if(initializationPromise)return initializationPromise;
    if(options&&global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.configure==='function'){
      global.SupabaseClientLayer.configure(options);
    }
    var client=getClient();
    if(!client&&global.SupabaseRuntimeConfig&&
      typeof global.SupabaseRuntimeConfig.configureClient==='function'){
      global.SupabaseRuntimeConfig.configureClient();
      client=getClient();
    }
    if(!client||!client.auth){
      state.initialized=true;
      initializationPromise=Promise.resolve({
        available:false,
        authenticated:false,
        reason:'SUPABASE_AUTH_UNAVAILABLE'
      });
      return initializationPromise;
    }
    var generation=clientGeneration;

    initializationPromise=client.auth.getSession()
      .then(function(result){
        if(generation!==clientGeneration){
          return {
            available:false,
            authenticated:false,
            reason:'SUPABASE_CLIENT_CHANGED'
          };
        }
        if(result.error)throw result.error;
        updateSession(result.data&&result.data.session);
        var listener=client.auth.onAuthStateChange(function(event,session){
          if(generation!==clientGeneration)return;
          updateSession(session);
        });
        state.subscription=listener&&listener.data
          ?listener.data.subscription
          :null;
        state.initialized=true;
        state.lastError=null;
        return {
          available:true,
          authenticated:!!state.user,
          user:state.user
        };
      })
      .catch(function(error){
        if(generation!==clientGeneration){
          return {
            available:false,
            authenticated:false,
            reason:'SUPABASE_CLIENT_CHANGED'
          };
        }
        state.initialized=true;
        state.lastError=error;
        return {
          available:true,
          authenticated:false,
          error:error
        };
      });
    return initializationPromise;
  }

  function runAuthAction(action){
    var client=getClient();
    if(!client||!client.auth){
      return Promise.resolve({
        success:false,
        error:{code:'SUPABASE_AUTH_UNAVAILABLE'}
      });
    }
    return action(client.auth)
      .then(function(result){
        if(result.error){
          state.lastError=result.error;
          return {success:false,error:result.error};
        }
        var session=result.data&&result.data.session;
        if(session)updateSession(session);
        state.lastError=null;
        return {success:true,data:result.data||null};
      })
      .catch(function(error){
        state.lastError=error;
        return {success:false,error:error};
      });
  }

  function signInWithPassword(email,password){
    return runAuthAction(function(auth){
      return auth.signInWithPassword({email:email,password:password});
    });
  }

  function signUp(email,password,metadata){
    var redirectUrl='';
    try{
      var runtimeConfig=global.SupabaseRuntimeConfig&&
        typeof global.SupabaseRuntimeConfig.load==='function'
        ?global.SupabaseRuntimeConfig.load()
        :null;
      redirectUrl=String(
        runtimeConfig&&runtimeConfig.emailRedirectTo||
        global.SUPABASE_AUTH_REDIRECT_URL||
        global.location&&global.location.origin||
        ''
      ).trim();
    }catch(error){
      redirectUrl='';
    }
    return runAuthAction(function(auth){
      var signUpOptions={
        data:metadata&&typeof metadata==='object'?metadata:{}
      };
      if(redirectUrl)signUpOptions.emailRedirectTo=redirectUrl;
      return auth.signUp({
        email:email,
        password:password,
        options:signUpOptions
      });
    });
  }

  function signOut(){
    return runAuthAction(function(auth){
      return auth.signOut();
    }).then(function(result){
      if(result.success)updateSession(null);
      return result;
    });
  }

  function getSession(){
    return state.session;
  }

  function getUser(){
    return state.user;
  }

  function getState(){
    return {
      initialized:state.initialized,
      authenticated:!!state.user,
      user:state.user,
      lastError:state.lastError
    };
  }

  function resetForClientChange(){
    clientGeneration++;
    if(state.subscription&&
      typeof state.subscription.unsubscribe==='function'){
      try{state.subscription.unsubscribe();}catch(error){}
    }
    state.initialized=false;
    state.session=null;
    state.user=null;
    state.subscription=null;
    state.lastError=null;
    initializationPromise=null;
  }

  global.SupabaseAuth=Object.freeze({
    initialize:initialize,
    signInWithPassword:signInWithPassword,
    signUp:signUp,
    signOut:signOut,
    getSession:getSession,
    getUser:getUser,
    getState:getState,
    resetForClientChange:resetForClientChange
  });
})(window);
