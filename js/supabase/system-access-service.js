(function(global){
  'use strict';

  var CACHE_PREFIX='conference_system_access_v1:';
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
      canCreateConferences:false,
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

  function cacheKey(userId){
    return CACHE_PREFIX+userId;
  }

  function readCache(storage,userId){
    if(!storage||typeof storage.getItem!=='function')return null;
    try{
      var parsed=JSON.parse(storage.getItem(cacheKey(userId))||'null');
      if(!parsed||parsed.userId!==userId||
        ['pending','approved','blocked'].indexOf(parsed.accountStatus)<0||
        typeof parsed.canCreateConferences!=='boolean'||
        !Array.isArray(parsed.roles)||!parsed.checkedAt){
        return null;
      }
      return parsed;
    }catch(error){
      return null;
    }
  }

  function writeCache(storage,value){
    if(!storage||typeof storage.setItem!=='function')return false;
    try{
      storage.setItem(cacheKey(value.userId),JSON.stringify(value));
      return true;
    }catch(error){
      return false;
    }
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
      canCreateConferences:
        access.account_status==='approved'&&
        (access.can_create_conferences===true||
          normalizedRoles.indexOf('system_owner')>=0),
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

  function setFailure(status,userId,error,cached){
    if(cached){
      setFromRecord(userId,{
        account_status:cached.accountStatus,
        can_create_conferences:cached.canCreateConferences
      },cached.roles,'cache',cached.checkedAt,false);
      state.status=status;
      state.error=error||null;
      applyUi();
      return getState();
    }
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
    var restricted=state.authenticated&&
      (!state.profileLoaded||!state.fresh||
       state.accountStatus==='pending'||state.accountStatus==='blocked'||
        state.accountStatus==='approved'&&
          !state.canCreateConferences&&!state.isSystemOwner);
    var controls=document.querySelectorAll(
      '[data-system-conference-create]'
    );
    Array.prototype.forEach.call(controls,function(control){
      control.style.display='';
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
      typeof row.can_create_conferences==='boolean';
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

    var cached=readCache(d.storage,userId);
    if(d.navigator&&d.navigator.onLine===false){
      return Promise.resolve(setFailure('offline',userId,{
        code:'OFFLINE',
        message:'System access could not be refreshed while offline.'
      },cached));
    }
    var client=d.clientLayer&&
      typeof d.clientLayer.getClient==='function'
      ?d.clientLayer.getClient():null;
    if(!client||typeof client.from!=='function'){
      return Promise.resolve(setFailure('configuration_error',userId,{
        code:'SUPABASE_UNAVAILABLE',
        message:'System access service is not configured.'
      },cached));
    }

    state=createState('loading');
    state.authenticated=true;
    state.userId=userId;
    applyUi();
    var accessRequest=client.from('system_user_access')
      .select('user_id,account_status,can_create_conferences,updated_at')
      .eq('user_id',userId)
      .maybeSingle();
    var rolesRequest=client.from('system_user_roles')
      .select('user_id,role,granted_at')
      .eq('user_id',userId);

    var flight=Promise.all([accessRequest,rolesRequest])
      .then(function(results){
        if(generation!==loadGeneration||
          String(sessionUser(d.auth)&&sessionUser(d.auth).id||'')!==userId){
          return getState();
        }
        var accessResponse=results[0]||{};
        var rolesResponse=results[1]||{};
        if(accessResponse.error||rolesResponse.error){
          throw accessResponse.error||rolesResponse.error;
        }
        if(!validAccess(accessResponse.data,userId)||
          !validRoles(rolesResponse.data,userId)){
          return setFailure('access_missing',userId,{
            code:'SYSTEM_ACCESS_MISSING',
            message:'The account has no valid System Access record.'
          },cached);
        }
        var checkedAt=new Date().toISOString();
        var roles=rolesResponse.data;
        writeCache(d.storage,{
          userId:userId,
          accountStatus:accessResponse.data.account_status,
          canCreateConferences:
            accessResponse.data.can_create_conferences===true,
          roles:roles.map(function(row){return {role:row.role};}),
          checkedAt:checkedAt,
          source:'server'
        });
        return setFromRecord(
          userId,accessResponse.data,roles,'server',checkedAt,true
        );
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
            if(!session||!session.user){
              setUnauthenticated();
              return;
            }
            load(Object.assign({},options,{force:true}));
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

  function canCreateConference(){
    return state.authenticated&&state.profileLoaded&&state.fresh&&
      state.accountStatus==='approved'&&
      (state.canCreateConferences||state.isSystemOwner);
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
    canCreateConference:canCreateConference,
    applyUi:applyUi,
    resetForTests:resetForTests
  });
})(window);
