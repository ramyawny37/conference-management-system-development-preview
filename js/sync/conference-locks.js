(function(global){
  'use strict';

  var DEFAULT_TTL_SECONDS=120;
  var MIN_TTL_SECONDS=30;
  var MAX_TTL_SECONDS=300;
  var ownedLocks=Object.create(null);
  var pendingTokens=Object.create(null);
  var state={
    lastStatus:null,
    lastError:null,
    lastConferenceId:null,
    lastSection:null
  };

  function normalizeSection(options){
    var section=String(options&&options.section||'conference').trim().toLowerCase();
    return /^[a-z][a-z0-9_]{0,31}$/.test(section)?section:null;
  }

  function lockKey(conferenceId,section){return conferenceId+'::'+section;}

  function result(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data===undefined?null:data,
      error:error||null
    };
  }

  function safeError(code,message){
    return {
      code:code||'CONFERENCE_LOCK_ERROR',
      message:message||'The conference lock operation failed.'
    };
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
  }

  function cloneValue(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function createUuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function'){
      return global.crypto.randomUUID();
    }
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){
      var bytes=new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      bytes[6]=(bytes[6]&15)|64;
      bytes[8]=(bytes[8]&63)|128;
      return Array.prototype.map.call(bytes,function(byte,index){
        var text=byte.toString(16).padStart(2,'0');
        return index===4||index===6||index===8||index===10
          ?'-'+text
          :text;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function normalizeThrownError(error){
    var message=error&&typeof error.message==='string'?error.message:'';
    if(/network|fetch|offline/i.test(message)){
      return safeError('NETWORK_ERROR','The lock request failed.');
    }
    return safeError('LOCK_REQUEST_FAILED','The lock request failed.');
  }

  function normalizeTtl(options){
    var ttl=options&&options.ttlSeconds!==undefined
      ?options.ttlSeconds
      :DEFAULT_TTL_SECONDS;
    if(!Number.isInteger(ttl)||
      ttl<MIN_TTL_SECONDS||
      ttl>MAX_TTL_SECONDS){
      return null;
    }
    return ttl;
  }

  function resolveContext(options){
    options=options&&typeof options==='object'?options:{};
    var client;
    var session;
    var identity;
    try{
      client=options.client||
        (global.SupabaseClientLayer&&
        typeof global.SupabaseClientLayer.getClient==='function'
          ?global.SupabaseClientLayer.getClient()
          :null);
      session=options.session||
        (global.SupabaseAuth&&
        typeof global.SupabaseAuth.getSession==='function'
          ?global.SupabaseAuth.getSession()
          :null);
      identity=options.deviceIdentity||
        (global.SupabaseDeviceIdentity&&
        typeof global.SupabaseDeviceIdentity.getOrCreate==='function'
          ?global.SupabaseDeviceIdentity.getOrCreate()
          :null);
    }catch(error){
      return {error:safeError(
        'LOCK_DEPENDENCY_UNAVAILABLE',
        'Conference lock dependencies are unavailable.'
      )};
    }
    if(!client||typeof client.rpc!=='function'){
      return {error:safeError(
        'SUPABASE_UNAVAILABLE',
        'Supabase is not configured.'
      )};
    }
    if(!session||!session.user||!isUuid(String(session.user.id||''))){
      return {error:safeError(
        'AUTH_REQUIRED',
        'An authenticated session is required.'
      )};
    }
    if(!identity||!isUuid(String(identity.id||''))){
      return {error:safeError(
        'DEVICE_ID_UNAVAILABLE',
        'A valid device ID is required.'
      )};
    }
    return {
      client:client,
      userId:String(session.user.id),
      deviceId:String(identity.id)
    };
  }

  function normalizeLockData(rpcData,conferenceId,section){
    rpcData=rpcData&&typeof rpcData==='object'?rpcData:{};
    return {
      conferenceId:conferenceId,
      section:String(rpcData.section||section||'conference'),
      lockToken:isUuid(String(rpcData.lockToken||''))
        ?String(rpcData.lockToken)
        :null,
      locked:rpcData.locked===true,
      owned:rpcData.owned===true,
      userId:isUuid(String(rpcData.userId||''))
        ?String(rpcData.userId)
        :null,
      deviceId:isUuid(String(rpcData.deviceId||''))
        ?String(rpcData.deviceId)
        :null,
      acquiredAt:rpcData.acquiredAt||null,
      expiresAt:rpcData.expiresAt||null,
      lastRenewedAt:rpcData.lastRenewedAt||null,
      serverNow:rpcData.serverNow||null,
      isExpired:rpcData.isExpired===true
    };
  }

  function rememberOwnedLock(status,data){
    if((status==='acquired'||status==='already_owned'||
      status==='renewed'||status==='locked')&&
      data.owned&&data.lockToken){
      ownedLocks[lockKey(data.conferenceId,data.section)]=cloneValue(data);
    }
    if(status==='released'||status==='not_found'||
      status==='expired'){
      delete ownedLocks[lockKey(data.conferenceId,data.section)];
    }
  }

  function normalizeRpcResult(response,conferenceId,section,allowedStatuses){
    if(response.error)throw response.error;
    var rpcData=response.data&&typeof response.data==='object'
      ?response.data
      :{};
    var status=String(rpcData.status||'');
    if(allowedStatuses.indexOf(status)===-1){
      return result(false,'error',null,safeError(
        'UNEXPECTED_LOCK_RESULT',
        'The lock request returned an unexpected result.'
      ));
    }
    var data=normalizeLockData(rpcData,conferenceId,section);
    data.locked=[
      'acquired',
      'already_owned',
      'locked',
      'renewed',
      'not_owner'
    ].indexOf(status)!==-1;
    rememberOwnedLock(status,data);
    state.lastStatus=status;
    state.lastError=null;
    state.lastConferenceId=conferenceId;
    state.lastSection=section;
    return result(true,status,data,null);
  }

  function runRpc(
    name,
    args,
    conferenceId,
    section,
    allowedStatuses,
    context,
    failureData
  ){
    return Promise.resolve().then(function(){
      return context.client.rpc(name,args);
    }).then(function(response){
      return normalizeRpcResult(
        response,
        conferenceId,
        section,allowedStatuses
      );
    }).catch(function(error){
      state.lastError=normalizeThrownError(error);
      state.lastStatus='error';
      state.lastConferenceId=conferenceId;
      return result(
        false,
        'error',
        failureData?cloneValue(failureData):null,
        state.lastError
      );
    });
  }

  function validateConferenceId(conferenceId){
    conferenceId=String(conferenceId||'');
    return isUuid(conferenceId)?conferenceId:null;
  }

  function acquireLock(conferenceId,options){
    options=options&&typeof options==='object'?options:{};
    conferenceId=validateConferenceId(conferenceId);
    if(!conferenceId){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    var ttl=normalizeTtl(options);
    var section=normalizeSection(options);
    if(ttl===null||!section){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_LOCK_TTL',
        'ttlSeconds must be an integer between 30 and 300.'
      )));
    }
    var context=resolveContext(options);
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    var key=lockKey(conferenceId,section);
    var lockToken=options.lockToken||pendingTokens[key]||
      (ownedLocks[key]&&ownedLocks[key].lockToken);
    try{
      lockToken=lockToken?String(lockToken):createUuid();
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'SECURE_UUID_UNAVAILABLE',
        'A secure lock token could not be created.'
      )));
    }
    if(!isUuid(lockToken)){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_LOCK_TOKEN',
        'lockToken must be a valid UUID.'
      )));
    }
    pendingTokens[key]=lockToken;
    var acquireArgs={
      p_conference_id:conferenceId,
      p_section:section,
      p_device_id:context.deviceId,
      p_lock_token:lockToken,
      p_ttl_seconds:ttl
    };
    if(section==='conference')delete acquireArgs.p_section;
    return runRpc(section==='conference'?'acquire_conference_lock':'acquire_conference_section_lock',acquireArgs,conferenceId,section,[
      'acquired',
      'already_owned',
      'locked'
    ],context,{
      conferenceId:conferenceId,
      lockToken:lockToken
    }).then(function(acquireResult){
      if(acquireResult.status==='acquired'||
        acquireResult.status==='already_owned'||
        acquireResult.status==='locked'){
        delete pendingTokens[key];
      }
      return acquireResult;
    });
  }

  function resolveOwnedToken(conferenceId,section,options){
    var token=options.lockToken||
      (ownedLocks[lockKey(conferenceId,section)]&&ownedLocks[lockKey(conferenceId,section)].lockToken);
    token=token?String(token):'';
    return isUuid(token)?token:null;
  }

  function renewLock(conferenceId,options){
    options=options&&typeof options==='object'?options:{};
    conferenceId=validateConferenceId(conferenceId);
    if(!conferenceId){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    var ttl=normalizeTtl(options);
    var section=normalizeSection(options);
    if(ttl===null||!section){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_LOCK_TTL',
        'ttlSeconds must be an integer between 30 and 300.'
      )));
    }
    var token=resolveOwnedToken(conferenceId,section,options);
    if(!token){
      return Promise.resolve(result(false,'error',null,safeError(
        'LOCK_TOKEN_REQUIRED',
        'A valid lockToken is required.'
      )));
    }
    var context=resolveContext(options);
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    var renewArgs={
      p_conference_id:conferenceId,
      p_section:section,
      p_device_id:context.deviceId,
      p_lock_token:token,
      p_ttl_seconds:ttl
    };
    if(section==='conference')delete renewArgs.p_section;
    return runRpc(section==='conference'?'renew_conference_lock':'renew_conference_section_lock',renewArgs,conferenceId,section,[
      'renewed',
      'expired',
      'not_owner',
      'not_found'
    ],context);
  }

  function releaseLock(conferenceId,options){
    options=options&&typeof options==='object'?options:{};
    conferenceId=validateConferenceId(conferenceId);
    if(!conferenceId){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    var section=normalizeSection(options);
    var token=section&&resolveOwnedToken(conferenceId,section,options);
    if(!token){
      return Promise.resolve(result(false,'error',null,safeError(
        'LOCK_TOKEN_REQUIRED',
        'A valid lockToken is required.'
      )));
    }
    var context=resolveContext(options);
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    var releaseArgs={
      p_conference_id:conferenceId,
      p_section:section,
      p_device_id:context.deviceId,
      p_lock_token:token
    };
    if(section==='conference')delete releaseArgs.p_section;
    return runRpc(section==='conference'?'release_conference_lock':'release_conference_section_lock',releaseArgs,conferenceId,section,[
      'released',
      'not_owner',
      'not_found'
    ],context);
  }

  function getLockStatus(conferenceId,options){
    options=options&&typeof options==='object'?options:{};
    conferenceId=validateConferenceId(conferenceId);
    if(!conferenceId){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      )));
    }
    var section=normalizeSection(options);
    if(!section)return Promise.resolve(result(false,'error',null,safeError('INVALID_LOCK_SECTION','A valid lock section is required.')));
    var context=resolveContext(options);
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    var statusArgs={
      p_conference_id:conferenceId,
      p_section:section,
      p_device_id:context.deviceId
    };
    if(section==='conference')delete statusArgs.p_section;
    return runRpc(section==='conference'?'get_conference_lock':'get_conference_section_lock',statusArgs,conferenceId,section,[
      'locked',
      'not_found'
    ],context);
  }

  function getOwnedLock(conferenceId,section){
    if(conferenceId!==undefined&&conferenceId!==null){
      conferenceId=validateConferenceId(conferenceId);
      section=String(section||'conference');
      return conferenceId&&ownedLocks[lockKey(conferenceId,section)]
        ?cloneValue(ownedLocks[lockKey(conferenceId,section)])
        :null;
    }
    return Object.keys(ownedLocks).sort().map(function(key){
      return cloneValue(ownedLocks[key]);
    });
  }

  function getState(){
    return {
      ownedLockCount:Object.keys(ownedLocks).length,
      pendingAcquireCount:Object.keys(pendingTokens).length,
      lastStatus:state.lastStatus,
      lastConferenceId:state.lastConferenceId,
      lastSection:state.lastSection,
      lastError:state.lastError
        ?{code:state.lastError.code,message:state.lastError.message}
        :null
    };
  }

  function resetForTests(){
    ownedLocks=Object.create(null);
    pendingTokens=Object.create(null);
    state.lastStatus=null;
    state.lastError=null;
    state.lastConferenceId=null;
    state.lastSection=null;
  }

  global.ConferenceLocks=Object.freeze({
    defaultTtlSeconds:DEFAULT_TTL_SECONDS,
    minTtlSeconds:MIN_TTL_SECONDS,
    maxTtlSeconds:MAX_TTL_SECONDS,
    acquireLock:acquireLock,
    renewLock:renewLock,
    releaseLock:releaseLock,
    getLockStatus:getLockStatus,
    getOwnedLock:getOwnedLock,
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
