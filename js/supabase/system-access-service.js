(function(global){
  'use strict';

  var state=createState('idle');
  var loadPromise=null;
  var initializationPromise=null;
  var authSubscription=null;
  var loadGeneration=0;

  function createState(status){
    return {
      status:status,
      authenticated:false,
      profileLoaded:false,
      accountStatus:null,
      isSystemOwner:false,
      isSystemAdmin:false,
      userId:null,
      checkedAt:null,
      source:null,
      fresh:false,
      error:null
    };
  }

  function copy(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function uuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function dependencies(options){
    options=options||{};
    return {
      auth:options.auth||global.SupabaseAuth,
      clientLayer:options.clientLayer||global.SupabaseClientLayer,
      storage:options.storage||global.localStorage,
      navigator:options.navigator||global.navigator
    };
  }

  function sessionUser(auth){
    var authState=auth&&typeof auth.getState==='function'
      ?auth.getState():null;
    var session=auth&&typeof auth.getSession==='function'
      ?auth.getSession():null;
    return authState&&authState.user||
      session&&session.user||null;
  }

  function setUnauthenticated(){
    loadGeneration++;
    state=createState('not_authenticated');
    applyUi();
    return getState();
  }

  function setFromRecord(userId,access,roles,source,checkedAt,fresh){
    var normalizedRoles=roles.map(function(item){return String(item.role);});
    state={
      status:access.account_status,
      authenticated:true,
      profileLoaded:true,
      accountStatus:access.account_status,
      isSystemOwner:normalizedRoles.indexOf('system_owner')>=0,
      isSystemAdmin:normalizedRoles.indexOf('system_admin')>=0,
      userId:userId,
      checkedAt:checkedAt,
      source:source,
      fresh:fresh===true,
      error:null
    };
    applyUi();
    return getState();
  }

  function setFailure(status,userId,error){
    // Never promote cached account status or roles into runtime authority.
    state=createState(status);
    state.authenticated=true;
    state.userId=userId;
    state.error=error||null;
    applyUi();
    return getState();
  }

  function applyUi(){
    var document=global.document;
    if(!document||typeof document.querySelectorAll!=='function')return;
    var restricted=!state.authenticated||
      (!state.profileLoaded||!state.fresh||
       state.accountStatus==='pending'||state.accountStatus==='blocked'||
        state.accountStatus==='approved'&&
        state.accountStatus!=='approved');
    var controls=document.querySelectorAll(
      '[data-system-conference-create]'
    );
    Array.prototype.forEach.call(controls,function(control){
      control.style.display='';
      control.disabled=restricted;
      control.setAttribute('aria-disabled',restricted?'true':'false');
      if(restricted){
        control.setAttribute(
          'title','هذا الحساب غير مخول بإنشاء مؤتمرات جديدة.'
        );
      }else{
        control.removeAttribute('title');
      }
    });
    var notice=document.getElementById('systemAccessStartupNotice');
    var actions=document.querySelector('.startup-actions');
    if(!restricted){
      if(notice&&notice.parentNode)notice.parentNode.removeChild(notice);
      return;
    }
    if(!notice&&actions&&typeof document.createElement==='function'){
      notice=document.createElement('div');
      notice.id='systemAccessStartupNotice';
      notice.className='settings-empty-state';
      if(actions.parentNode){
        actions.parentNode.insertBefore(notice,actions);
      }
    }
    if(notice){
      notice.textContent=state.accountStatus==='pending'
        ?'الحساب ينتظر الاعتماد.'
        :state.accountStatus==='blocked'
          ?'الحساب موقوف.'
          :state.profileLoaded&&state.fresh
            ?'هذا الحساب غير مخول بإنشاء مؤتمرات جديدة.'
            :'تعذر التحقق حديثًا من صلاحية إنشاء المؤتمرات.';
    }
  }

  function validAccess(row,userId){
    return row&&String(row.user_id||'')===userId&&
      ['pending','approved','blocked'].indexOf(row.account_status)>=0&&
      true;
  }

  function validRoles(rows,userId){
    if(!Array.isArray(rows))return false;
    return rows.every(function(row){
      return row&&String(row.user_id||'')===userId&&
        ['system_owner','system_admin'].indexOf(row.role)>=0;
    });
  }

  function load(options){
    options=options||{};
    if(loadPromise&&!options.force)return loadPromise;
    var d=dependencies(options);
    var user=sessionUser(d.auth);
    var userId=user&&String(user.id||'');
    if(!uuid(userId))return Promise.resolve(setUnauthenticated());
    var generation=++loadGeneration;

    if(d.navigator&&d.navigator.onLine===false){
      return Promise.resolve(setFailure('offline',userId,{
        code:'OFFLINE',
        message:'System access could not be refreshed while offline.'
      }));
    }
    var client=d.clientLayer&&
      typeof d.clientLayer.getClient==='function'
      ?d.clientLayer.getClient():null;
    if(!client||typeof client.rpc!=='function'){
      return Promise.resolve(setFailure('configuration_error',userId,{
        code:'SUPABASE_UNAVAILABLE',
        message:'System access service is not configured.'
      }));
    }

    state=createState('loading');
    state.authenticated=true;
    state.userId=userId;
    applyUi();
    var flight=client.rpc('get_my_platform_system_access').then(function(response){
        if(generation!==loadGeneration||
          String(sessionUser(d.auth)&&sessionUser(d.auth).id||'')!==userId){
          return getState();
        }
        response=response||{};
        if(response.error)throw response.error;
        var data=response.data||{};
        var access={user_id:String(data.userId||''),account_status:String(data.accountStatus||'')};
        var roles=Array.isArray(data.systemRoles)?data.systemRoles.map(function(role){return {user_id:userId,role:String(role)};}):[];
        if(!validAccess(access,userId)||!validRoles(roles,userId)){
          return setFailure('access_missing',userId,{code:'SYSTEM_ACCESS_MISSING',message:'The account has no valid Platform access record.'},cached);
        }
        var checkedAt=new Date().toISOString();
        return setFromRecord(userId,access,roles,'server',checkedAt,true);
      })
      .catch(function(error){
        if(generation!==loadGeneration)return getState();
        var offline=d.navigator&&d.navigator.onLine===false||
          /network|fetch|offline/i.test(String(error&&error.message||''));
        return setFailure(offline?'offline':'load_error',userId,{
          code:offline?'OFFLINE':'SYSTEM_ACCESS_LOAD_FAILED',
          message:'System access could not be loaded.'
        },cached);
      })
      .finally(function(){
        if(loadPromise===flight)loadPromise=null;
      });
    loadPromise=flight;
    return flight;
  }

  function initialize(options){
    options=options||{};
    if(initializationPromise)return initializationPromise;
    var d=dependencies(options);
    var authReady=d.auth&&typeof d.auth.initialize==='function'
      ?d.auth.initialize():Promise.resolve();
    initializationPromise=Promise.resolve(authReady)
      .catch(function(){return null;})
      .then(function(){
        var client=d.clientLayer&&
          typeof d.clientLayer.getClient==='function'
          ?d.clientLayer.getClient():null;
        if(!authSubscription&&client&&client.auth&&
          typeof client.auth.onAuthStateChange==='function'){
          var listener=client.auth.onAuthStateChange(function(event,session){
            if(global.StartupConferenceDiscovery&&
              typeof global.StartupConferenceDiscovery.clear==='function'){
              global.StartupConferenceDiscovery.clear();
            }
            if(global.DiscoveredConferenceOpenService&&
              typeof global.DiscoveredConferenceOpenService.invalidate==='function'){
              global.DiscoveredConferenceOpenService.invalidate();
            }
            if(!session||!session.user){
              setUnauthenticated();
              return;
            }
            load(Object.assign({},options,{force:true})).then(function(){
              if(global.StartupConferenceDiscovery&&
                typeof global.StartupConferenceDiscovery.refresh==='function'){
                global.StartupConferenceDiscovery.refresh();
              }
            });
          });
          authSubscription=listener&&listener.data
            ?listener.data.subscription:null;
        }
        return load(Object.assign({},options,{force:true}));
      });
    return initializationPromise;
  }

  function getState(){
    return copy(state);
  }

  function resetForTests(){
    if(authSubscription&&typeof authSubscription.unsubscribe==='function'){
      authSubscription.unsubscribe();
    }
    state=createState('idle');
    loadPromise=null;
    initializationPromise=null;
    authSubscription=null;
    loadGeneration++;
    return getState();
  }

  global.SystemAccessService=Object.freeze({
    initialize:initialize,
    load:load,
    refresh:function(options){
      options=Object.assign({},options||{},{force:true});
      return load(options);
    },
    getState:getState,
    applyUi:applyUi,
    resetForTests:resetForTests
  });
})(window);
