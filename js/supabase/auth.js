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
  var lastSignUpDiagnostic = null;

  function safeDiagnosticCode(value){
    var code=String(value||'').trim();
    if(!code)return null;
    return /^[A-Za-z0-9_.-]{1,80}$/.test(code)?code:'AUTH_ERROR';
  }

  function safeDiagnosticStatus(value){
    if(value===null||value===undefined||value==='')return null;
    var status=String(value).trim();
    return /^[A-Za-z0-9_.-]{1,40}$/.test(status)?status:null;
  }

  function sanitizeErrorMessage(value){
    var message=String(value||'').slice(0,500);
    if(!message)return '';
    message=message
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[REDACTED_EMAIL]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        '[REDACTED_TOKEN]')
      .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/gi,
        '[REDACTED_KEY]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED_TOKEN]')
      .replace(/\b(password|access_token|refresh_token|anon_key|apikey|token)\b\s*[:=]\s*[^\s,;]+/gi,
        '$1=[REDACTED]');
    return message.slice(0,240);
  }

  function copySignUpDiagnostic(value){
    if(!value)return null;
    return {
      stage:value.stage,
      authStage:value.authStage,
      success:value.success,
      errorCode:value.errorCode,
      httpStatus:value.httpStatus,
      sanitizedMessage:value.sanitizedMessage,
      userPresent:value.userPresent,
      sessionPresent:value.sessionPresent,
      timestamp:value.timestamp
    };
  }

  function captureSignUpDiagnostic(result){
    var data=result&&result.data||null;
    var error=result&&result.error||null;
    var success=!!(result&&result.success);
    lastSignUpDiagnostic={
      stage:'AUTH_SIGNUP',
      authStage:success?'AUTH_SIGNUP_SUCCEEDED':'AUTH_SIGNUP_FAILED',
      success:success,
      errorCode:safeDiagnosticCode(error&&error.code)||
        (!success&&result&&result.failureKind==='exception'
          ?'AUTH_SIGNUP_EXCEPTION':null),
      httpStatus:safeDiagnosticStatus(error&&(
        error.status===undefined?error.statusCode:error.status
      )),
      sanitizedMessage:sanitizeErrorMessage(error&&error.message),
      userPresent:!!(data&&data.user),
      sessionPresent:!!(data&&data.session),
      timestamp:new Date().toISOString()
    };
    var safe=copySignUpDiagnostic(lastSignUpDiagnostic);
    return Object.assign({},result||{success:false},{diagnostics:safe});
  }

  function markSignUpStartupAccessFailed(error){
    if(!lastSignUpDiagnostic||
      lastSignUpDiagnostic.authStage!=='AUTH_SIGNUP_SUCCEEDED'||
      !lastSignUpDiagnostic.sessionPresent)return null;
    lastSignUpDiagnostic.authStage=
      'AUTH_SIGNUP_SUCCEEDED_BUT_STARTUP_ACCESS_FAILED';
    lastSignUpDiagnostic.success=false;
    lastSignUpDiagnostic.errorCode=safeDiagnosticCode(error&&error.code)||
      'STARTUP_ACCESS_FAILED';
    lastSignUpDiagnostic.httpStatus=safeDiagnosticStatus(error&&error.status);
    lastSignUpDiagnostic.sanitizedMessage=sanitizeErrorMessage(
      error&&error.message
    );
    lastSignUpDiagnostic.timestamp=new Date().toISOString();
    return copySignUpDiagnostic(lastSignUpDiagnostic);
  }

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
    if(typeof global.updateLogoText==='function')global.updateLogoText();
    if(global.SyncSettingsUI&&
      typeof global.SyncSettingsUI.refreshAccountIdentity==='function'){
      global.SyncSettingsUI.refreshAccountIdentity();
    }
  }

  function getAccountIdentity(){
    var user=state.session&&state.session.user?state.session.user:null;
    if(!user)return {
      authenticated:false,userId:'',displayName:'',email:'',label:''
    };
    var displayName=user.user_metadata&&user.user_metadata.display_name
      ?String(user.user_metadata.display_name).trim():'';
    var email=user.email?String(user.email).trim():'';
    return {
      authenticated:true,
      userId:String(user.id||''),
      displayName:displayName,
      email:email,
      label:displayName||email||'صاحب الحساب'
    };
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
          return {success:false,error:result.error,failureKind:'response'};
        }
        var session=result.data&&result.data.session;
        if(session)updateSession(session);
        state.lastError=null;
        return {success:true,data:result.data||null};
      })
      .catch(function(error){
        state.lastError=error;
        return {success:false,error:error,failureKind:'exception'};
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
    }).then(captureSignUpDiagnostic);
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
      lastError:state.lastError,
      signUpDiagnostic:copySignUpDiagnostic(lastSignUpDiagnostic)
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
    lastSignUpDiagnostic=null;
    initializationPromise=null;
  }

  global.SupabaseAuth=Object.freeze({
    initialize:initialize,
    signInWithPassword:signInWithPassword,
    signUp:signUp,
    signOut:signOut,
    getSession:getSession,
    getUser:getUser,
    getAccountIdentity:getAccountIdentity,
    getState:getState,
    getSignUpDiagnostic:function(){
      return copySignUpDiagnostic(lastSignUpDiagnostic);
    },
    markSignUpStartupAccessFailed:markSignUpStartupAccessFailed,
    resetForClientChange:resetForClientChange
  });
})(window);
