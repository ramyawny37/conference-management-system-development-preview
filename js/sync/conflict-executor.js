(function(global){
  'use strict';

  var state={
    executing:false,
    lastOperationId:null,
    lastStatus:null,
    lastError:null
  };

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
      code:code||'CONFLICT_EXECUTION_ERROR',
      message:message||'The conflict resolution could not be executed.'
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
      return safeError('NETWORK_ERROR','The resolution request failed.');
    }
    return safeError(
      'CONFLICT_EXECUTION_FAILED',
      'The resolution request failed.'
    );
  }

  function resolveDependencies(options){
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
        'EXECUTION_DEPENDENCY_UNAVAILABLE',
        'Conflict execution dependencies are unavailable.'
      )};
    }
    var planner=options.conflictResolution||global.ConflictResolution||null;
    if(!planner||typeof planner.validateResolutionPlan!=='function'){
      return {error:safeError(
        'CONFLICT_RESOLUTION_UNAVAILABLE',
        'Conflict resolution validation is unavailable.'
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
      planner:planner,
      deviceId:String(identity.id)
    };
  }

  function validateExecutionInput(plan,options,planner){
    var validation=planner.validateResolutionPlan(plan);
    if(!validation||!validation.ok){
      return safeError(
        'INVALID_RESOLUTION_PLAN',
        'The resolution plan is invalid.'
      );
    }
    if(!isUuid(String(plan.conferenceId||''))){
      return safeError(
        'INVALID_CONFERENCE_ID',
        'The plan requires a valid conferenceId.'
      );
    }
    if(!Number.isInteger(plan.actualRevision)||
      plan.actualRevision<0||
      plan.baseRevision!==plan.actualRevision){
      return safeError(
        'PLAN_REVISION_MISMATCH',
        'The plan baseRevision must match actualRevision.'
      );
    }
    if(!Number.isInteger(plan.baseRevision)||plan.baseRevision<0){
      return safeError(
        'INVALID_BASE_REVISION',
        'The plan requires a valid baseRevision.'
      );
    }
    var schemaVersion=String(
      options.schemaVersion||plan.schemaVersion||''
    ).trim();
    var appVersion=String(
      options.appVersion||plan.appVersion||''
    ).trim();
    if(!schemaVersion||!appVersion){
      return safeError(
        'VERSION_METADATA_REQUIRED',
        'schemaVersion and appVersion are required.'
      );
    }
    return null;
  }

  function prepareExecutionPlan(plan,options){
    var prepared=cloneValue(plan);
    var legacyUpgraded=false;
    if(!prepared.resolutionOperationId){
      prepared.resolutionOperationId=createUuid();
      legacyUpgraded=true;
    }
    if(!isUuid(String(prepared.resolutionOperationId||''))){
      throw new Error('INVALID_OPERATION_ID');
    }
    if(options.operationId&&
      String(options.operationId)!==String(prepared.resolutionOperationId)){
      throw new Error('OPERATION_ID_MISMATCH');
    }
    return {
      plan:prepared,
      legacyUpgraded:legacyUpgraded
    };
  }

  function addLegacyPlanData(data,plan,legacyUpgraded){
    if(!legacyUpgraded)return data;
    data.updatedPlan=cloneValue(plan);
    data.legacyPlanUpgraded=true;
    return data;
  }

  function legacyPlanData(plan,legacyUpgraded){
    if(!legacyUpgraded)return null;
    return addLegacyPlanData({
      operationId:plan.resolutionOperationId
    },plan,true);
  }

  function normalizeRpcResult(
    rpcData,
    plan,
    operationId,
    legacyUpgraded
  ){
    var status=rpcData&&typeof rpcData.status==='string'
      ?rpcData.status
      :'';
    var data={
      conflictId:plan.conflictId,
      conferenceId:plan.conferenceId,
      strategy:plan.strategy,
      operationId:operationId,
      previousRevision:rpcData&&
        Number.isInteger(rpcData.previousRevision)
        ?rpcData.previousRevision
        :plan.baseRevision,
      resolvedRevision:rpcData&&
        Number.isInteger(rpcData.resolvedRevision)
        ?rpcData.resolvedRevision
        :null,
      resolvedSnapshot:cloneValue(plan.resolvedSnapshot)
    };
    addLegacyPlanData(data,plan,legacyUpgraded);
    if(status==='resolved'||status==='server_selected'||
      status==='duplicate'){
      return result(true,status,data,null);
    }
    if(status==='conflict_changed'){
      data.expectedRevision=rpcData.expectedRevision;
      data.actualRevision=rpcData.actualRevision;
      data.resolvedSnapshot=null;
      return result(true,'conflict_changed',data,null);
    }
    var unexpectedData={operationId:operationId};
    addLegacyPlanData(unexpectedData,plan,legacyUpgraded);
    return result(false,'error',unexpectedData,safeError(
      'UNEXPECTED_RESOLUTION_RESULT',
      'The resolution request returned an unexpected result.'
    ));
  }

  function executeResolutionPlan(plan,options){
    options=options&&typeof options==='object'?options:{};
    var planCopy;
    var legacyUpgraded=false;
    try{
      var preparedPlan=prepareExecutionPlan(plan,options);
      planCopy=preparedPlan.plan;
      legacyUpgraded=preparedPlan.legacyUpgraded;
    }catch(error){
      var preparationCode=error&&error.message;
      return Promise.resolve(result(false,'error',null,safeError(
        preparationCode==='OPERATION_ID_MISMATCH'
          ?'OPERATION_ID_MISMATCH'
          :preparationCode==='INVALID_OPERATION_ID'
            ?'INVALID_RESOLUTION_OPERATION_ID'
            :'INVALID_RESOLUTION_PLAN',
        preparationCode==='OPERATION_ID_MISMATCH'
          ?'options.operationId must match the resolution plan.'
          :'The resolution plan could not be prepared.'
      )));
    }
    var planner=options.conflictResolution||
      global.ConflictResolution||
      null;
    if(!planner||typeof planner.validateResolutionPlan!=='function'){
      var plannerError=safeError(
        'CONFLICT_RESOLUTION_UNAVAILABLE',
        'Conflict resolution validation is unavailable.'
      );
      state.lastError=plannerError;
      return Promise.resolve(result(
        false,
        'error',
        legacyPlanData(planCopy,legacyUpgraded),
        plannerError
      ));
    }
    var inputError=validateExecutionInput(planCopy,options,planner);
    if(inputError){
      state.lastError=inputError;
      return Promise.resolve(result(
        false,
        'error',
        legacyPlanData(planCopy,legacyUpgraded),
        inputError
      ));
    }
    var dependencies=resolveDependencies(options);
    if(dependencies.error){
      state.lastError=dependencies.error;
      return Promise.resolve(result(
        false,
        'error',
        legacyPlanData(planCopy,legacyUpgraded),
        dependencies.error
      ));
    }
    var operationId=String(planCopy.resolutionOperationId);
    if((planCopy.sourceOperationId&&
      String(planCopy.sourceOperationId)===operationId)||
      (planCopy.operationId&&
      String(planCopy.operationId)===operationId)){
      var reusedError=safeError(
        'SOURCE_OPERATION_ID_REUSED',
        'The original conflicting operationId cannot resolve the conflict.'
      );
      return Promise.resolve(result(false,'error',{
        operationId:operationId
      },reusedError));
    }

    state.executing=true;
    state.lastOperationId=operationId;
    state.lastError=null;
    var schemaVersion=String(
      options.schemaVersion||planCopy.schemaVersion
    ).trim();
    var appVersion=String(
      options.appVersion||planCopy.appVersion
    ).trim();
    return Promise.resolve().then(function(){
      return dependencies.client.rpc('resolve_sync_conflict',{
        p_conflict_id:planCopy.conflictId,
        p_conference_id:planCopy.conferenceId,
        p_resolution_operation_id:operationId,
        p_device_id:dependencies.deviceId,
        p_expected_revision:planCopy.baseRevision,
        p_strategy:planCopy.strategy,
        p_resolved_snapshot:planCopy.strategy==='keep_server'
          ?null
          :cloneValue(planCopy.resolvedSnapshot),
        p_schema_version:schemaVersion,
        p_app_version:appVersion
      });
    }).then(function(response){
      if(response.error)throw response.error;
      var executionResult=normalizeRpcResult(
        response.data,
        planCopy,
        operationId,
        legacyUpgraded
      );
      state.lastStatus=executionResult.status;
      state.lastError=executionResult.error;
      return executionResult;
    }).catch(function(error){
      state.lastError=normalizeThrownError(error);
      state.lastStatus='error';
      var errorData={
        operationId:operationId
      };
      addLegacyPlanData(errorData,planCopy,legacyUpgraded);
      return result(false,'error',errorData,state.lastError);
    }).then(function(executionResult){
      state.executing=false;
      return executionResult;
    },function(){
      state.executing=false;
      state.lastError=safeError(
        'CONFLICT_EXECUTION_FAILED',
        'The resolution request failed.'
      );
      var errorData={
        operationId:operationId
      };
      addLegacyPlanData(errorData,planCopy,legacyUpgraded);
      return result(false,'error',errorData,state.lastError);
    });
  }

  function applyServerResolutionLocally(plan,options){
    options=options&&typeof options==='object'?options:{};
    var planner=options.conflictResolution||
      global.ConflictResolution||
      null;
    if(!planner||typeof planner.validateResolutionPlan!=='function'){
      return Promise.resolve(result(false,'error',null,safeError(
        'CONFLICT_RESOLUTION_UNAVAILABLE',
        'Conflict resolution validation is unavailable.'
      )));
    }
    var validation=planner.validateResolutionPlan(plan);
    if(!validation||!validation.ok){
      return Promise.resolve(result(false,'error',null,safeError(
        'INVALID_RESOLUTION_PLAN',
        'The resolution plan is invalid.'
      )));
    }
    var snapshot;
    try{
      snapshot=cloneValue(plan.resolvedSnapshot);
    }catch(error){
      return Promise.resolve(result(false,'error',null,safeError(
        'SNAPSHOT_CLONE_FAILED',
        'The resolved snapshot could not be cloned.'
      )));
    }
    if(typeof options.adapter!=='function'){
      return Promise.resolve(result(true,'ready_local',{
        conflictId:plan.conflictId,
        strategy:plan.strategy,
        resolvedSnapshot:snapshot
      },null));
    }
    return Promise.resolve().then(function(){
      return options.adapter(cloneValue(snapshot),cloneValue(plan));
    }).then(function(adapterResult){
      return result(true,'applied_local',{
        conflictId:plan.conflictId,
        strategy:plan.strategy,
        resolvedSnapshot:snapshot,
        adapterResult:adapterResult===undefined?null:adapterResult
      },null);
    }).catch(function(){
      return result(false,'error',null,safeError(
        'LOCAL_ADAPTER_FAILED',
        'The explicit local adapter failed.'
      ));
    });
  }

  function getExecutionState(){
    return {
      executing:state.executing,
      lastOperationId:state.lastOperationId,
      lastStatus:state.lastStatus,
      lastError:state.lastError
        ?{code:state.lastError.code,message:state.lastError.message}
        :null
    };
  }

  function resetForTests(){
    state.executing=false;
    state.lastOperationId=null;
    state.lastStatus=null;
    state.lastError=null;
  }

  global.ConflictExecutor=Object.freeze({
    executeResolutionPlan:executeResolutionPlan,
    applyServerResolutionLocally:applyServerResolutionLocally,
    getExecutionState:getExecutionState,
    resetForTests:resetForTests
  });
})(window);
