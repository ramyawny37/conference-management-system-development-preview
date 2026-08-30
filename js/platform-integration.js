(function(global){
  'use strict';

  var state={initialized:false,managedOrigin:null,context:null,deviceIdentity:null,deviceIdentitySource:'none',authorizationReady:false,adoptedUserId:'',adoptionError:null};
  var initializationFlight=null,adoptionFlight=null,sequence=0;
  var trace={canonicalState:'UNAUTHENTICATED',platformAdoptionStarted:false,platformAdoptionCompleted:false,platformAdoptionSucceeded:false,adoptionDeviceIdPrefix:null,platformContextHydrationAttempted:false,contextDeviceIdPrefix:null,activeIdentitySource:'none',resolverDeviceIdPrefix:null,rpcDeviceIdPrefix:null,platformReadyAtResolution:null,adoptionRequestCount:0,authorizationRefreshCount:0,platformIdentityMismatch:false,eventTrace:[]};

  function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}

  function prefix(deviceId){return isUuid(deviceId)?String(deviceId).slice(0,8):null;}

  function event(name){trace.eventTrace.push({sequence:++sequence,event:String(name||'').replace(/[^A-Z0-9_]/g,'').slice(0,64)});trace.eventTrace=trace.eventTrace.slice(-20);}

  function hydrateDevice(deviceId,source){
    if(!isUuid(deviceId))return null;
    var incoming=String(deviceId),existing=state.deviceIdentity&&state.deviceIdentity.id;
    if(existing&&existing!==incoming){trace.platformIdentityMismatch=true;event('PLATFORM_IDENTITY_MISMATCH');return null;}
    state.deviceIdentity={
      id:incoming,
      deviceName:'Integrated Platform browser',
      platform:String(global.navigator&&global.navigator.platform||''),
      createdAt:''
    };
    state.deviceIdentitySource=source||state.deviceIdentitySource||'none';
    trace.activeIdentitySource=state.deviceIdentitySource;
    event('PLATFORM_IDENTITY_HYDRATED');
    return state.deviceIdentity;
  }

  function request(path,options){
    if(!global.fetch)return Promise.resolve(null);
    return global.fetch(path,Object.assign({
      credentials:'same-origin',
      headers:{'content-type':'application/json'}
    },options||{})).then(function(response){
      return response.json().catch(function(){return null;}).then(function(body){
        if(response.ok)return body;
        var allowedCodes=['PLATFORM_SESSION_INVALID','PLATFORM_DEVICE_REGISTRATION_FAILED','PLATFORM_GATEWAY_FAILURE'],allowedCategories=['authentication','device','unexpected'];
        var error=new Error(body&&allowedCodes.indexOf(body.error)>=0?body.error:'PLATFORM_REQUEST_FAILED');
        error.code=error.message;
        error.status=response.status;
        error.category=body&&allowedCategories.indexOf(body.category)>=0?body.category:'unexpected';
        throw error;
      });
    });
  }

  function applyModules(modules){
    if(!global.document)return;
    (Array.isArray(modules)?modules:[]).forEach(function(module){
      var card=global.document.querySelector(
        '[data-platform-module="'+String(module.id).replace(/[^a-z0-9-]/g,'')+'"]'
      );
      if(!card)return;
      var available=module.available===true;
      card.disabled=!available;
      card.setAttribute('aria-disabled',available?'false':'true');
      card.classList.toggle('platform-module-card-available',available);
      card.classList.toggle('platform-module-card-unavailable',!available);
      card.onclick=available?function(){openModule(module.id);}:null;
    });
  }

  function refreshContext(){
    trace.platformContextHydrationAttempted=true;event('PLATFORM_CONTEXT_START');
    return request('/api/platform/context').then(function(context){
      state.managedOrigin=true;
      state.context=context||null;
      if(context&&context.deviceId){
        trace.contextDeviceIdPrefix=prefix(context.deviceId);
        var hydrated=hydrateDevice(context.deviceId,state.deviceIdentity?'platform_adoption':'platform_context');
        if(!hydrated&&trace.platformIdentityMismatch){var mismatch=new Error('PLATFORM_DEVICE_IDENTITY_MISMATCH');mismatch.code=mismatch.message;mismatch.category='device';throw mismatch;}
      }
      applyModules(context&&context.modules);
      state.initialized=true;
      event('PLATFORM_CONTEXT_COMPLETE');
      return context;
    }).catch(function(error){state.initialized=true;if(state.managedOrigin===null)state.managedOrigin=false;event('PLATFORM_CONTEXT_FAILED');if(error&&error.code==='PLATFORM_DEVICE_IDENTITY_MISMATCH')throw error;return null;});
  }

  function initialize(){
    if(initializationFlight)return initializationFlight;
    initializationFlight=refreshContext().then(function(result){return result;});
    return initializationFlight;
  }

  function sessionUserId(session){return String(session&&session.user&&session.user.id||'');}

  function performAdoption(session,userId){
    trace.platformAdoptionStarted=true;trace.platformAdoptionCompleted=false;trace.platformAdoptionSucceeded=false;trace.adoptionRequestCount++;event('AUTH_SESSION_FOUND');event('PLATFORM_ADOPTION_START');
    if(!session||!session.access_token||!session.refresh_token)
      return Promise.resolve({authenticated:false});
    return request('/api/platform/session/adopt',{
      method:'POST',
      body:JSON.stringify({
        accessToken:session.access_token,
        refreshToken:session.refresh_token
      })
    }).then(function(result){
      trace.adoptionDeviceIdPrefix=prefix(result&&result.deviceId);
      if(!hydrateDevice(result&&result.deviceId,'platform_adoption'))throw Object.assign(new Error('PLATFORM_DEVICE_IDENTITY_INVALID'),{code:'PLATFORM_DEVICE_IDENTITY_INVALID',category:'device'});
      trace.platformAdoptionSucceeded=true;event('PLATFORM_ADOPTION_SUCCESS');
      return refreshContext().then(function(){state.authorizationReady=true;state.adoptedUserId=userId;state.adoptionError=null;trace.platformAdoptionCompleted=true;event('PLATFORM_READY');return result;});
    }).catch(function(error){trace.platformAdoptionCompleted=true;state.authorizationReady=false;state.adoptionError=error;event('PLATFORM_ADOPTION_FAILED');throw error;});
  }

  function adoptSession(session){
    var userId=sessionUserId(session);
    if(state.authorizationReady&&state.deviceIdentity&&state.adoptedUserId===userId)return Promise.resolve({authenticated:true,deviceId:state.deviceIdentity.id});
    if(adoptionFlight)return adoptionFlight;
    if(state.adoptionError&&state.adoptedUserId===userId)return Promise.reject(state.adoptionError);
    state.adoptedUserId=userId;
    adoptionFlight=performAdoption(session,userId).then(function(result){adoptionFlight=null;return result;},function(error){adoptionFlight=null;throw error;});
    return adoptionFlight;
  }

  function awaitAuthorizationReady(){
    return initialize().then(function(){
      if(state.managedOrigin!==true)return {ready:true,platform:false};
      var auth=global.SupabaseAuth,session=auth&&typeof auth.getSession==='function'?auth.getSession():null;
      if(!session)return {ready:false,platform:true,status:'not_authenticated'};
      return adoptSession(session).then(function(){return {ready:state.authorizationReady,platform:true};});
    });
  }

  function synchronizeSession(){
    var auth=global.SupabaseAuth;
    var session=auth&&typeof auth.getSession==='function'?auth.getSession():null;
    if(!session)return Promise.resolve(state.context);
    return adoptSession(session);
  }

  function logout(){
    return request('/api/platform/session/logout',{method:'POST',body:'{}'})
      .catch(function(){return null;}).then(function(result){state.authorizationReady=false;state.adoptedUserId='';state.adoptionError=null;state.deviceIdentity=null;state.deviceIdentitySource='none';adoptionFlight=null;trace.activeIdentitySource='none';return result;});
  }

  function recordResolution(deviceId,source){trace.resolverDeviceIdPrefix=prefix(deviceId);trace.activeIdentitySource=source||'none';trace.platformReadyAtResolution=state.authorizationReady===true;event('DEVICE_RESOLUTION_START');event(source==='platform_adoption'||source==='platform_context'?'DEVICE_SOURCE_PLATFORM':source==='browser_local_fallback'?'DEVICE_SOURCE_BROWSER_LOCAL':'DEVICE_SOURCE_NONE');}
  function recordRpc(deviceId){trace.rpcDeviceIdPrefix=prefix(deviceId);event('DEVICE_ACCESS_RPC');}
  function recordAuthorizationRefresh(){trace.authorizationRefreshCount++;event('AUTHORIZATION_REFRESH');}
  function recordCanonicalState(value){var allowed=['UNAUTHENTICATED','AUTHENTICATING','AUTHENTICATED','PLATFORM_ADOPTING','ACCOUNT_NOT_APPROVED','DEVICE_REGISTERED','DEVICE_PENDING','DEVICE_APPROVED','DEVICE_REVOKED','ERROR'];trace.canonicalState=allowed.indexOf(value)>=0?value:'ERROR';event('STATE_'+trace.canonicalState);}

  function openModule(id){
    if(id==='conference'){
      if(global.location.pathname!=='/conference')global.location.assign('/conference');
      else if(typeof global.openConferenceWorkspace==='function')global.openConferenceWorkspace();
      return true;
    }
    var modules=state.context&&state.context.modules||[];
    var module=modules.find(function(item){return item.id===id&&item.available===true;});
    if(!module)return false;
    global.location.assign(module.routePrefix);
    return true;
  }

  global.PlatformIntegration=Object.freeze({
    initialize:initialize,
    adoptSession:adoptSession,
    synchronizeSession:synchronizeSession,
    awaitAuthorizationReady:awaitAuthorizationReady,
    isManagedOrigin:function(){return state.managedOrigin===true;},
    isAuthorizationReady:function(){return state.authorizationReady===true;},
    getDeviceIdentitySource:function(){return state.deviceIdentitySource;},
    getSafeDiagnostic:function(){return JSON.parse(JSON.stringify(trace));},
    recordDeviceResolution:recordResolution,
    recordDeviceAccessRpc:recordRpc,
    recordAuthorizationRefresh:recordAuthorizationRefresh,
    recordCanonicalState:recordCanonicalState,
    logout:logout,
    openModule:openModule,
    getContext:function(){return state.context;},
    getDeviceIdentity:function(){return state.deviceIdentity;}
  });
})(window);
