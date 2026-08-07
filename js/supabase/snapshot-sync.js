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
    var status=Number(error&&error.status);
    if(code==='PGRST116'){
      return safeError('NOT_FOUND','The requested record was not found.');
    }
    return safeError(
      /jwt.*expired|token.*expired/i.test(code)?'TOKEN_EXPIRED':
        code==='42501'||status===401||status===403
          ?'ACCESS_DENIED':'SUPABASE_REQUEST_FAILED',
      code==='42501'||status===401||status===403
        ?'Access denied.':'Supabase request failed.'
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
    if(Number.isFinite(Number(session.expires_at))&&
      Number(session.expires_at)*1000<=Date.now()){
      return {
        error:safeError('TOKEN_EXPIRED','The authenticated session has expired.')
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

  function normalizeConferenceCreationResult(rpcData,input){
    var row=Array.isArray(rpcData)?rpcData[0]:rpcData;
    if(!row||typeof row!=='object'){
      return result(false,'error',null,safeError(
        'INVALID_CREATION_RESPONSE',
        'The conference creation response was incomplete.'
      ));
    }
    var status=String(row.status||'');
    var operationId=String(row.operationId||row.operation_id||'');
    var conferenceId=String(row.conferenceId||row.conference_id||'');
    if(status==='invalid_request'){
      if(operationId&&operationId!==input.operationId){
        return result(false,'error',null,safeError(
          'OPERATION_RESULT_MISMATCH',
          'The conference creation operation did not match the request.'
        ));
      }
      var errorCode=String(row.errorCode||row.error_code||'CREATION_FAILED');
      return result(false,'error',{
        operationId:operationId||input.operationId
      },safeError(errorCode,'The conference could not be created.'));
    }
    if(status==='access_denied'){
      if(operationId&&operationId!==input.operationId){
        return result(false,'error',null,safeError(
          'OPERATION_RESULT_MISMATCH',
          'The conference creation operation did not match the request.'
        ));
      }
      return result(false,'access_denied',{
        operationId:operationId||input.operationId
      },safeError(
        String(row.errorCode||row.error_code||'ACCESS_DENIED'),
        'Conference creation is not authorized.'
      ));
    }
    if(!operationId){
      return result(false,'error',null,safeError(
        'INVALID_CREATION_RESPONSE',
        'The conference creation response was incomplete.'
      ));
    }
    if(operationId!==input.operationId){
      return result(false,'error',null,safeError(
        'OPERATION_RESULT_MISMATCH',
        'The conference creation operation did not match the request.'
      ));
    }
    if(status==='operation_mismatch'){
      return result(false,'operation_mismatch',{
        operationId:operationId,
        conferenceId:isUuid(conferenceId)?conferenceId:null
      },safeError(
        'OPERATION_RESULT_MISMATCH',
        'The conference creation operation is already bound.'
      ));
    }
    if(status!=='created'&&status!=='duplicate'){
      return result(false,'error',null,safeError(
        'INVALID_CREATION_RESPONSE',
        'The conference creation response was not recognized.'
      ));
    }
    if(!isUuid(conferenceId)||conferenceId!==input.requestedConferenceId){
      return result(false,'error',null,safeError(
        'CONFERENCE_RESULT_MISMATCH',
        'The created conference did not match the request.'
      ));
    }
    return result(true,status,{
      operationId:operationId,
      conferenceId:conferenceId,
      created:status==='created'&&row.created!==false
    },null);
  }

  function createConferenceIdempotent(input){
    input=input&&typeof input==='object'?input:{};
    var operationId=String(input.operationId||'');
    var requestedConferenceId=String(input.requestedConferenceId||'');
    var name=String(input.name||'').trim();
    if(!isUuid(operationId)){
      return Promise.resolve(validationError(
        'INVALID_OPERATION_ID',
        'operationId must be a valid UUID.'
      ));
    }
    if(!isUuid(requestedConferenceId)){
      return Promise.resolve(validationError(
        'INVALID_CONFERENCE_ID',
        'requestedConferenceId must be a valid UUID.'
      ));
    }
    if(!name){
      return Promise.resolve(validationError(
        'CONFERENCE_NAME_REQUIRED',
        'Conference name is required.'
      ));
    }
    var metadata=input.metadata===undefined?{}:input.metadata;
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)){
      return Promise.resolve(validationError(
        'INVALID_METADATA',
        'metadata must be an object.'
      ));
    }
    var metadataCopy;
    try{
      metadataCopy=cloneSnapshot(metadata);
    }catch(error){
      return Promise.resolve(validationError(
        'METADATA_CLONE_FAILED',
        'metadata could not be cloned safely.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',{
        operationId:operationId
      },context.error));
    }
    return Promise.resolve().then(function(){
      return context.client.rpc('create_conference_idempotent',{
        p_operation_id:operationId,
        p_requested_conference_id:requestedConferenceId,
        p_name:name,
        p_initial_metadata:metadataCopy
      });
    }).then(function(response){
      if(response.error){
        return result(false,'error',{
          operationId:operationId
        },normalizeRequestError(response.error));
      }
      return normalizeConferenceCreationResult(response.data,{
        operationId:operationId,
        requestedConferenceId:requestedConferenceId
      });
    }).catch(function(error){
      return result(false,'error',{
        operationId:operationId
      },normalizeThrownError(error));
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

  function inspectSnapshotOperation(input){
    input=input&&typeof input==='object'?input:{};
    var operationId=String(input.operationId||'');
    var conferenceId=String(input.conferenceId||'');
    var deviceId=String(input.deviceId||'');
    var baseRevision=input.baseRevision;
    if(!isUuid(operationId)||!isUuid(conferenceId)||!isUuid(deviceId)||
      !Number.isInteger(baseRevision)||baseRevision<0){
      return Promise.resolve(validationError(
        'INVALID_OPERATION_INSPECTION',
        'Valid operation and conference IDs are required.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',{
        operationId:operationId,conferenceId:conferenceId
      },context.error));
    }
    return Promise.resolve().then(function(){
      return context.client.from('sync_operations')
        .select('operation_id,conference_id,user_id,device_id,status,base_revision,resulting_revision,processed_at')
        .eq('operation_id',operationId)
        .maybeSingle();
    }).then(function(response){
      if(response.error){
        return result(false,'error',null,normalizeRequestError(response.error));
      }
      if(!response.data){
        return result(true,'not_found',{
          operationId:operationId,conferenceId:conferenceId
        },null);
      }
      var row=response.data;
      if(String(row.operation_id||'')!==operationId||
        String(row.conference_id||'')!==conferenceId||
        String(row.user_id||'')!==String(context.user.id)||
        String(row.device_id||'')!==deviceId||
        Number(row.base_revision)!==baseRevision){
        return result(false,'integrity_conflict',null,safeError(
          'OPERATION_RESULT_MISMATCH',
          'The server operation did not match the local operation.'
        ));
      }
      var inspected={
        operationId:operationId,
        conferenceId:conferenceId,
        userId:row.user_id||null,
        deviceId:row.device_id||null,
        status:String(row.status||'unknown'),
        baseRevision:Number.isInteger(Number(row.base_revision))
          ?Number(row.base_revision):null,
        resultingRevision:row.resulting_revision===null||
          row.resulting_revision===undefined
          ?null:Number(row.resulting_revision),
        processedAt:row.processed_at||null
      };
      var knownStatuses=['pending','processing','applied','failed',
        'rejected','conflict'];
      if(knownStatuses.indexOf(inspected.status)<0||
        !Number.isInteger(inspected.baseRevision)||
        inspected.baseRevision<0||
        inspected.status==='applied'&&(
          !Number.isInteger(inspected.resultingRevision)||
          inspected.resultingRevision<=inspected.baseRevision)){
        return result(false,'integrity_conflict',null,safeError(
          'INVALID_OPERATION_RESULT',
          'The server operation result was incomplete or invalid.'
        ));
      }
      if(inspected.status!=='conflict'){
        return result(true,inspected.status,inspected,null);
      }
      return context.client.from('sync_conflicts')
        .select('id,expected_revision,actual_revision,status')
        .eq('operation_id',operationId)
        .maybeSingle().then(function(conflictResponse){
          if(conflictResponse.error){
            return result(false,'error',null,
              normalizeRequestError(conflictResponse.error));
          }
          var conflict=conflictResponse.data||{};
          inspected.conflictId=conflict.id||null;
          inspected.expectedRevision=Number(conflict.expected_revision);
          inspected.actualRevision=Number(conflict.actual_revision);
          inspected.conflictStatus=conflict.status||null;
          if(!conflict.id||!Number.isInteger(inspected.expectedRevision)||
            inspected.expectedRevision<0||
            !Number.isInteger(inspected.actualRevision)||
            inspected.actualRevision<0){
            return result(false,'integrity_conflict',null,safeError(
              'INVALID_CONFLICT_RESULT',
              'The server conflict result was incomplete or invalid.'
            ));
          }
          return result(true,'conflict',inspected,null);
        });
    }).catch(function(error){
      return result(false,'error',null,normalizeThrownError(error));
    });
  }

  function verifyOwnerMembership(input){
    input=input&&typeof input==='object'?input:{};
    var conferenceId=String(input.conferenceId||'');
    var requestedUserId=String(input.userId||'');
    if(!isUuid(conferenceId)||!isUuid(requestedUserId)){
      return Promise.resolve(validationError(
        'INVALID_MEMBERSHIP_REQUEST',
        'A valid conference and user are required.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    if(String(context.user.id)!==requestedUserId){
      return Promise.resolve(validationError(
        'MEMBERSHIP_USER_MISMATCH',
        'The membership user did not match the authenticated user.'
      ));
    }
    return Promise.resolve().then(function(){
      return context.client.from('conference_members')
        .select('conference_id,user_id,role')
        .eq('conference_id',conferenceId)
        .eq('user_id',requestedUserId)
        .maybeSingle();
    }).then(function(response){
      if(response.error){
        return result(false,'error',null,
          normalizeRequestError(response.error));
      }
      var row=response.data;
      if(!row||row.conference_id!==conferenceId||
        row.user_id!==requestedUserId||row.role!=='owner'){
        return result(false,'owner_not_verified',null,safeError(
          'OWNER_MEMBERSHIP_NOT_VERIFIED',
          'Owner membership could not be verified.'
        ));
      }
      return result(true,'owner_verified',{
        conferenceId:conferenceId,
        userId:requestedUserId,
        role:'owner'
      },null);
    }).catch(function(error){
      return result(false,'error',null,normalizeThrownError(error));
    });
  }

  function inspectConferenceCreationOperation(input){
    input=input&&typeof input==='object'?input:{};
    var operationId=String(input.operationId||'');
    var requestedConferenceId=String(input.requestedConferenceId||'');
    var requestedUserId=String(input.userId||'');
    if(!isUuid(operationId)||!isUuid(requestedConferenceId)||
      !isUuid(requestedUserId)){
      return Promise.resolve(validationError(
        'INVALID_CREATION_INSPECTION',
        'Valid operation, conference, and user IDs are required.'
      ));
    }
    var context=getOnlineContext();
    if(context.error){
      return Promise.resolve(result(false,'error',null,context.error));
    }
    if(String(context.user.id)!==requestedUserId){
      return Promise.resolve(validationError(
        'CREATION_INSPECTION_USER_MISMATCH',
        'The operation owner did not match the authenticated user.'
      ));
    }
    return Promise.resolve().then(function(){
      return context.client.from('conference_creation_operations')
        .select('user_id,operation_id,conference_id,created_at,updated_at')
        .eq('user_id',requestedUserId)
        .eq('operation_id',operationId)
        .maybeSingle();
    }).then(function(response){
      if(response.error){
        return result(false,'error',null,
          normalizeRequestError(response.error));
      }
      if(!response.data){
        return result(true,'not_found',{
          operationId:operationId,
          requestedConferenceId:requestedConferenceId
        },null);
      }
      var row=response.data;
      if(String(row.user_id||'')!==requestedUserId||
        String(row.operation_id||'')!==operationId){
        return result(false,'integrity_conflict',null,safeError(
          'CREATION_OPERATION_MISMATCH',
          'The creation operation did not match the request.'
        ));
      }
      var cloudConferenceId=String(row.conference_id||'');
      if(!isUuid(cloudConferenceId)||
        cloudConferenceId!==requestedConferenceId){
        return result(false,'integrity_conflict',{
          operationId:operationId,
          cloudConferenceId:isUuid(cloudConferenceId)
            ?cloudConferenceId:null
        },safeError(
          'CONFERENCE_ID_MISMATCH',
          'The cloud conference did not match the requested ID.'
        ));
      }
      return result(true,'created',{
        userId:requestedUserId,
        operationId:operationId,
        conferenceId:cloudConferenceId,
        createdAt:row.created_at||null,
        updatedAt:row.updated_at||null
      },null);
    }).catch(function(error){
      return result(false,'error',null,normalizeThrownError(error));
    });
  }

  function inspectInitialSnapshot(conferenceId){
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
      return context.client.from('conference_snapshots')
        .select('conference_id,revision,schema_version,app_version,updated_at')
        .eq('conference_id',conferenceId)
        .maybeSingle();
    }).then(function(response){
      if(response.error){
        return result(false,'error',null,
          normalizeRequestError(response.error));
      }
      if(!response.data){
        return result(true,'not_found',{
          conferenceId:conferenceId
        },null);
      }
      var row=response.data;
      var revision=Number(row.revision);
      if(String(row.conference_id||'')!==conferenceId||
        !Number.isInteger(revision)||revision<1){
        return result(false,'invalid_snapshot',null,safeError(
          'SNAPSHOT_INSPECTION_INVALID',
          'The initial snapshot state was invalid.'
        ));
      }
      return result(true,'found',{
        conferenceId:conferenceId,
        revision:revision,
        schemaVersion:row.schema_version||null,
        appVersion:row.app_version||null,
        updatedAt:row.updated_at||null
      },null);
    }).catch(function(error){
      return result(false,'error',null,normalizeThrownError(error));
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
          'id,name,owner_id,organization_id,created_at,updated_at,deleted_at)'
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
              organizationId:item.conference.organization_id||null,
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
    createConferenceIdempotent:createConferenceIdempotent,
    verifyOwnerMembership:verifyOwnerMembership,
    inspectConferenceCreationOperation:
      inspectConferenceCreationOperation,
    inspectInitialSnapshot:inspectInitialSnapshot,
    uploadInitialSnapshot:uploadInitialSnapshot,
    uploadSnapshot:uploadSnapshot,
    inspectSnapshotOperation:inspectSnapshotOperation,
    downloadSnapshot:downloadSnapshot,
    listAvailableConferences:listAvailableConferences
  });
})(window);
