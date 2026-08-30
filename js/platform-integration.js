(function(global){
  'use strict';

  var state={initialized:false,context:null,deviceIdentity:null};

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

  function initialize(){
    return request('/api/platform/context').then(function(context){
      state.context=context||null;
      if(context&&context.deviceId){
        state.deviceIdentity={
          id:String(context.deviceId),
          deviceName:'Integrated Platform browser',
          platform:String(global.navigator&&global.navigator.platform||''),
          createdAt:''
        };
      }
      applyModules(context&&context.modules);
      state.initialized=true;
      return context;
    }).catch(function(){state.initialized=true;return null;});
  }

  function adoptSession(session){
    if(!session||!session.access_token||!session.refresh_token)
      return Promise.resolve({authenticated:false});
    return request('/api/platform/session/adopt',{
      method:'POST',
      body:JSON.stringify({
        accessToken:session.access_token,
        refreshToken:session.refresh_token
      })
    }).then(function(result){return initialize().then(function(){return result;});});
  }

  function synchronizeSession(){
    var auth=global.SupabaseAuth;
    var session=auth&&typeof auth.getSession==='function'?auth.getSession():null;
    if(!session)return Promise.resolve(state.context);
    return adoptSession(session);
  }

  function logout(){
    return request('/api/platform/session/logout',{method:'POST',body:'{}'})
      .catch(function(){return null;});
  }

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
    logout:logout,
    openModule:openModule,
    getContext:function(){return state.context;},
    getDeviceIdentity:function(){return state.deviceIdentity;}
  });
})(window);
