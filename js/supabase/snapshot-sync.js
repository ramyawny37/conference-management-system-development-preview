(function(global){
  'use strict';

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
      code:code||'SUPABASE_REQUEST_FAILED',
      message:message||'Supabase request failed.'
    };
  }

  function validationError(code,message){
    return result(false,'error',null,safeError(code,message));
  }

  function normalizeRequestError(error){
    var code=error&&typeof error.code==='string'?error.code:'';
    if(code==='PGRST116'){
      return safeError('NOT_FOUND','The requested record was not found.');
    }
    return safeError(
      code==='42501'?'ACCESS_DENIED':'SUPABASE_REQUEST_FAILED',
      code==='42501'?'Access denied.':'Supabase request failed.'
    );
  }

  function normalizeThrownError(error){
    var message=error&&typeof error.message==='string'?error.message:'';
    if(/network|fetch|offline/i.test(message)){
      return safeError('NETWORK_ERROR','Network request failed.');
    }
    return safeError('SUPABASE_REQUEST_FAILED','Supabase request failed.');
  }

  function cloneSnapshot(snapshot){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(snapshot);
    }
    return JSON.parse(JSON.stringify(snapshot));
  }

  function isUuid(value){
    return typeof value==='string'&&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);
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
        return index===4||index===6||index===8||index===10?'-'+text:text;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function getOnlineContext(){
    var client;
    var session;
    try{
      client=global.SupabaseClientLayer&&
        typeof global.SupabaseClientLayer.getClient==='function'
        ?global.SupabaseClientLayer.getClient()
        :null;
      session=global.SupabaseAuth&&
        typeof global.SupabaseAuth.getSession==='function'
        ?global.SupabaseAuth.getSession()
        :null;
    }catch(error){
      return {
        error:safeError('SUPABASE_UNAVAILABLE','Supabase is not available.')
      };
    }
    if(!client){
      return {
        error:safeError('SUPABASE_UNAVAILABLE','Supabase is not configured.')
      };
    }
    if(!session||!session.user||!isUuid(String(session.user.id||''))){
      return {
        error:safeError('AUTH_REQUIRED','An authenticated session is required.')
      };
    }
    return {
      client:client,
      session:session,
      user:session.user
    };
  }

  function getDeviceIdentity(){
    try{
      var identity=global.SupabaseDeviceIdentity&&
        typeof global.SupabaseDeviceIdentity.getOrCreate==='function'
        ?global.SupabaseDeviceIdentity.getOrCreate()
        :null;
      return identity&&isUuid(String(identity.id||''))?identity:null;
    }catch(error){
      return null;
    }
  }

  function registerDevice(client,user,identity){
    return Promise.resolve().then(function(){
      return client
        .from('devices')
        .upsert({
          id:identity.id,
          user_id:user.id,
          device_name:identity.deviceName||null,
          platform:identity.platform||null,
          last_seen_at:new Date().toISOString()
        },{onConflict:'id'});
    })
      .then(function(response){
        if(response.error)throw response.error;
        return identity;
      });
  }

  function createConference(input){
    input=input&&typeof input==='object'?input:{};
    var name=String(input.name||'').trim();
    if(!name){
      return Promise.resolve(validationError(
        'CONFERENCE_NAME_REQUIRED',
        'Conference name is required.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    var conferenceId;
    try{
      conferenceId=input.conferenceId
        ?String(input.conferenceId)
        :createUuid();
    }catch(error){
      return Promise.resolve(validationError(
        'SECURE_UUID_UNAVAILABLE',
        'A secure conference ID could not be created.'
      ));
    }
    if(!isUuid(conferenceId)){
      return Promise.resolve(validationError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      ));
    }

    return Promise.resolve().then(function(){
      return context.client
        .from('conferences')
        .insert({
          id:conferenceId,
          name:name,
          owner_id:context.user.id
        })
        .select('id')
        .single();
    })
      .then(function(response){
        if(response.error){
          return result(false,'error',null,normalizeRequestError(response.error));
        }
        return result(true,'created',{
          conferenceId:response.data&&response.data.id
            ?response.data.id
            :conferenceId
        },null);
      })
      .catch(function(error){
        return result(false,'error',null,normalizeThrownError(error));
      });
  }

  function normalizeSnapshotRpcResult(rpcData,input,operationId){
    var status=rpcData&&typeof rpcData.status==='string'
      ?rpcData.status
      :'unknown';
    var data={
      operationId:operationId,
      conferenceId:input.conferenceId,
      previousRevision:input.baseRevision,
      revision:null,
      expectedRevision:null,
      actualRevision:null,
      conflictId:null
    };
    if(status==='applied'){
      data.revision=Number(rpcData.revision);
      return result(true,'applied',data,null);
    }
    if(status==='conflict'){
      data.expectedRevision=Number(rpcData.expectedRevision);
      data.actualRevision=Number(rpcData.actualRevision);
      data.revision=data.actualRevision;
      data.conflictId=rpcData.conflictId||rpcData.conflict_id||null;
      return result(true,'conflict',data,null);
    }
    if(status==='duplicate'){
      data.revision=rpcData.revision===undefined
        ?null
        :Number(rpcData.revision);
      return result(true,'duplicate',data,null);
    }
    return result(false,'error',data,safeError(
      'UNEXPECTED_RPC_RESULT',
      'The snapshot operation returned an unexpected result.'
    ));
  }

  function uploadSnapshot(input){
    input=input&&typeof input==='object'?input:{};
    var conferenceId=String(input.conferenceId||'');
    if(!isUuid(conferenceId)){
      return Promise.resolve(validationError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      ));
    }
    if(!Number.isInteger(input.baseRevision)||input.baseRevision<0){
      return Promise.resolve(validationError(
        'INVALID_BASE_REVISION',
        'baseRevision must be a non-negative integer.'
      ));
    }
    if(!input.snapshot||typeof input.snapshot!=='object'||
      Array.isArray(input.snapshot)){
      return Promise.resolve(validationError(
        'INVALID_SNAPSHOT',
        'snapshot must be an object.'
      ));
    }
    var schemaVersion=String(input.schemaVersion||'').trim();
    var appVersion=String(input.appVersion||'').trim();
    if(!schemaVersion){
      return Promise.resolve(validationError(
        'SCHEMA_VERSION_REQUIRED',
        'schemaVersion is required.'
      ));
    }
    if(!appVersion){
      return Promise.resolve(validationError(
        'APP_VERSION_REQUIRED',
        'appVersion is required.'
      ));
    }

    var operationId;
    try{
      operationId=input.operationId?String(input.operationId):createUuid();
    }catch(error){
      return Promise.resolve(validationError(
        'SECURE_UUID_UNAVAILABLE',
        'A secure operation ID could not be created.'
      ));
    }
    if(!isUuid(operationId)){
      return Promise.resolve(validationError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      ));
    }

    var snapshotCopy;
    try{
      snapshotCopy=cloneSnapshot(input.snapshot);
    }catch(error){
      return Promise.resolve(validationError(
        'SNAPSHOT_CLONE_FAILED',
        'snapshot could not be cloned safely.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',{
        operationId:operationId
      },context.error));
    }
    var identity=getDeviceIdentity();
    if(!identity){
      return Promise.resolve(result(false,'error',{
        operationId:operationId
      },safeError(
        'DEVICE_ID_UNAVAILABLE',
        'A persistent device ID is required.'
      )));
    }

    return registerDevice(context.client,context.user,identity)
      .then(function(){
        return context.client.rpc('apply_conference_snapshot',{
          p_conference_id:conferenceId,
          p_operation_id:operationId,
          p_device_id:identity.id,
          p_base_revision:input.baseRevision,
          p_snapshot:snapshotCopy,
          p_schema_version:schemaVersion,
          p_app_version:appVersion
        });
      })
      .then(function(response){
        if(response.error){
          return result(false,'error',{
            operationId:operationId
          },normalizeRequestError(response.error));
        }
        return normalizeSnapshotRpcResult(response.data,{
          conferenceId:conferenceId,
          baseRevision:input.baseRevision
        },operationId);
      })
      .catch(function(error){
        return result(false,'error',{
          operationId:operationId
        },normalizeThrownError(error));
      });
  }

  function uploadInitialSnapshot(input){
    input=input&&typeof input==='object'?input:{};
    return uploadSnapshot({
      conferenceId:input.conferenceId,
      baseRevision:0,
      snapshot:input.snapshot,
      schemaVersion:input.schemaVersion,
      appVersion:input.appVersion,
      operationId:input.operationId
    });
  }

  function downloadSnapshot(conferenceId){
    conferenceId=String(conferenceId||'');
    if(!isUuid(conferenceId)){
      return Promise.resolve(validationError(
        'INVALID_CONFERENCE_ID',
        'conferenceId must be a valid UUID.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    return Promise.resolve().then(function(){
      return context.client
        .from('conference_snapshots')
        .select(
          'data,revision,schema_version,app_version,updated_at,'+
          'updated_by_device_id'
        )
        .eq('conference_id',conferenceId)
        .maybeSingle();
    })
      .then(function(response){
        if(response.error){
          return result(false,'error',null,normalizeRequestError(response.error));
        }
        if(!response.data)return result(true,'not_found',null,null);
        return result(true,'downloaded',{
          conferenceId:conferenceId,
          snapshot:cloneSnapshot(response.data.data),
          revision:response.data.revision,
          schemaVersion:response.data.schema_version||null,
          appVersion:response.data.app_version||null,
          updatedAt:response.data.updated_at||null,
          updatedByDeviceId:response.data.updated_by_device_id||null
        },null);
      })
      .catch(function(error){
        return result(false,'error',null,normalizeThrownError(error));
      });
  }

  function listAvailableConferences(){
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    return Promise.resolve().then(function(){
      return context.client
        .from('conference_members')
        .select(
          'role,conference:conferences('+
          'id,name,owner_id,created_at,updated_at,deleted_at)'
        );
    })
      .then(function(response){
        if(response.error){
          return result(false,'error',null,normalizeRequestError(response.error));
        }
        var conferences=(Array.isArray(response.data)?response.data:[])
          .filter(function(item){return item&&item.conference;})
          .map(function(item){
            return {
              id:item.conference.id,
              name:item.conference.name,
              ownerId:item.conference.owner_id,
              role:item.role,
              createdAt:item.conference.created_at,
              updatedAt:item.conference.updated_at,
              deletedAt:item.conference.deleted_at
            };
          });
        return result(true,'listed',{conferences:conferences},null);
      })
      .catch(function(error){
        return result(false,'error',null,normalizeThrownError(error));
      });
  }

  global.SupabaseSnapshotSync=Object.freeze({
    createConference:createConference,
    uploadInitialSnapshot:uploadInitialSnapshot,
    uploadSnapshot:uploadSnapshot,
    downloadSnapshot:downloadSnapshot,
    listAvailableConferences:listAvailableConferences
  });
})(window);
