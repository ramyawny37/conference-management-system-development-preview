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

  function getClient(){
    return global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.getClient==='function'
      ?global.SupabaseClientLayer.getClient()
      :null;
  }

  function updateSession(session){
    state.session=session||null;
    state.user=session&&session.user?session.user:null;
  }

  function initialize(options){
    if(initializationPromise)return initializationPromise;
    if(options&&global.SupabaseClientLayer&&
      typeof global.SupabaseClientLayer.configure==='function'){
      global.SupabaseClientLayer.configure(options);
    }
    var client=getClient();
    if(!client||!client.auth){
      state.initialized=true;
      initializationPromise=Promise.resolve({
        available:false,
        authenticated:false,
        reason:'SUPABASE_AUTH_UNAVAILABLE'
      });
      return initializationPromise;
    }

    initializationPromise=client.auth.getSession()
      .then(function(result){
        if(result.error)throw result.error;
        updateSession(result.data&&result.data.session);
        var listener=client.auth.onAuthStateChange(function(event,session){
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
    return runAuthAction(function(auth){
      return auth.signUp({
        email:email,
        password:password,
        options:{data:metadata&&typeof metadata==='object'?metadata:{}}
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

  global.SupabaseAuth=Object.freeze({
    initialize:initialize,
    signInWithPassword:signInWithPassword,
    signUp:signUp,
    signOut:signOut,
    getSession:getSession,
    getUser:getUser,
    getState:getState
  });
})(window);
