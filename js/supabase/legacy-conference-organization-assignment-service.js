(function(global){
  'use strict';

  var flights=Object.create(null),TIMEOUT_MS=15000;
  function uuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
  function output(ok,status,data,error){return {ok:ok,status:status,data:data||null,error:error||null};}
  function safeError(code,message){return {code:String(code||'ASSIGNMENT_FAILED'),message:String(message||'تعذر ربط المؤتمر بالمؤسسة.')};}
  function deps(options){options=options||{};return {
    clientLayer:options.clientLayer||global.SupabaseClientLayer,
    auth:options.auth||global.SupabaseAuth,
    identity:options.identity||global.SupabaseDeviceIdentity,
    snapshots:options.snapshots||global.SupabaseSnapshotSync,
    attempts:options.attempts||global.LegacyConferenceOrganizationAssignmentAttemptStore,
    crypto:options.crypto||global.crypto
  };}
  function context(options){
    var d=deps(options),client,session,identity;
    try{client=d.clientLayer&&d.clientLayer.getClient&&d.clientLayer.getClient();session=d.auth&&d.auth.getSession&&d.auth.getSession();identity=d.identity&&d.identity.getOrCreate&&d.identity.getOrCreate();}catch(error){}
    if(!client||typeof client.rpc!=='function'||!session||!session.user||
      !uuid(session.user.id)||!identity||!uuid(identity.id))return {error:'unavailable'};
    return {d:d,client:client,userId:String(session.user.id),deviceId:String(identity.id)};
  }
  function preflight(input,options){
    input=input||{};var conferenceId=String(input.conferenceId||''),ctx=context(options);
    if(!uuid(conferenceId))return Promise.resolve(output(false,'invalid_input'));
    if(ctx.error)return Promise.resolve(output(false,'unavailable'));
    return ctx.client.rpc('device_guarded_list_eligible_legacy_conference_organizations',{
      p_actor_device_id:ctx.deviceId,p_conference_id:conferenceId
    }).then(function(response){
      if(response.error)return output(false,'preflight_unavailable',null,mapRpcError(response.error));
      var value=response.data||{},rows=Array.isArray(value.organizations)?value.organizations:[];
      if(value.status!=='eligible_organizations')return output(false,'preflight_malformed');
      var eligible=rows.filter(function(item){return item&&uuid(item.organizationId)&&item.eligibility===true&&item.organizationStatus==='active'&&typeof item.displayName==='string';}).map(function(item){
        return {organizationId:String(item.organizationId),displayName:String(item.displayName),status:'active'};
      });
      if(eligible.length!==rows.length)return output(false,'preflight_malformed');
      return output(true,'legacy',{conferenceId:conferenceId,organizationId:null,eligibleOrganizations:eligible});
    }).catch(function(){return output(false,'preflight_read_failed');});
  }
  function readBackUnknown(ctx,conferenceId,organizationId){
    if(!ctx.d.snapshots||typeof ctx.d.snapshots.listAvailableConferences!=='function')return Promise.resolve(false);
    return ctx.d.snapshots.listAvailableConferences().then(function(result){
      var rows=result&&result.ok&&result.data&&result.data.conferences||[];
      return rows.some(function(item){return item.id===conferenceId&&item.organizationId===organizationId;});
    }).catch(function(){return false;});
  }
  function operationUuid(ctx){
    try{return ctx.d.crypto&&ctx.d.crypto.randomUUID&&ctx.d.crypto.randomUUID();}
    catch(error){return null;}
  }
  function rpcWithTimeout(ctx,args,options){
    var request=Promise.resolve().then(function(){return ctx.client.rpc('device_guarded_assign_legacy_conference_organization',args);});
    var timeoutMs=Number(options&&options.timeoutMs||TIMEOUT_MS),timer;
    var timeout=new Promise(function(resolve){timer=global.setTimeout(function(){resolve({timeout:true});},timeoutMs);});
    return Promise.race([request.then(function(response){return {response:response};},function(error){return {error:error};}),timeout]).then(function(result){global.clearTimeout(timer);return result;});
  }
  function mapRpcError(error){
    var raw=String(error&&error.message||''),code=String(error&&error.code||'ASSIGNMENT_FAILED');
    var known=['LEGACY_CONFERENCE_PREFLIGHT_UNAVAILABLE','INVALID_PREFLIGHT_REQUEST','CONFERENCE_ALREADY_ASSIGNED','ASSIGNMENT_OWNER_REQUIRED','CONFERENCE_OWNER_ORGANIZATION_MEMBERSHIP_REQUIRED','CONFERENCE_MEMBERS_ORGANIZATION_MEMBERSHIP_REQUIRED','ASSIGNMENT_OPERATION_MISMATCH','INVALID_ASSIGNMENT_REQUEST'];
    var found=known.find(function(item){return raw.indexOf(item)>=0;});
    return safeError(found||(/^[A-Z0-9_]{1,80}$/.test(code)?code:'ASSIGNMENT_FAILED'),'تعذر ربط المؤتمر بالمؤسسة.');
  }
  function execute(input,options){
    var conferenceId=String(input&&input.conferenceId||''),organizationId=String(input&&input.organizationId||''),ctx=context(options);
    if(!uuid(conferenceId)||!uuid(organizationId))return Promise.resolve(output(false,'invalid_input'));
    if(ctx.error)return Promise.resolve(output(false,'unavailable'));
    var scope={actorUserId:ctx.userId,conferenceId:conferenceId,organizationId:organizationId},stored=ctx.d.attempts.get(scope,options&&options.storeOptions);
    return (stored.ok&&stored.data.state==='unknown'?readBackUnknown(ctx,conferenceId,organizationId):Promise.resolve(false)).then(function(applied){
      if(applied){ctx.d.attempts.remove(scope,options&&options.storeOptions);return output(true,'assigned_after_readback',{conferenceId:conferenceId,organizationId:organizationId});}
      return preflight({conferenceId:conferenceId},options);
    }).then(function(check){
      if(check.ok&&check.status==='assigned_after_readback')return check;
      if(!check.ok||check.status!=='legacy')return output(false,check.status,check.data,check.error);
      var eligible=check.data.eligibleOrganizations.find(function(item){return item.organizationId===organizationId;});
      if(!eligible)return output(false,'organization_not_eligible',check.data,safeError('ORGANIZATION_NOT_ELIGIBLE','المؤسسة المختارة غير مؤهلة.'));
      var existing=ctx.d.attempts.get(scope,options&&options.storeOptions),attempt;
      if(existing.ok)attempt=existing;
      else{
        var id=operationUuid(ctx);if(!uuid(id))return output(false,'operation_id_unavailable');
        attempt=ctx.d.attempts.prepare(scope,id,options&&options.storeOptions);
      }
      if(!attempt.ok)return output(false,'attempt_storage_failed',null,safeError('ATTEMPT_STORAGE_FAILED','تعذر تجهيز العملية بأمان.'));
      return rpcWithTimeout(ctx,{p_actor_device_id:ctx.deviceId,p_operation_id:attempt.data.operationId,p_conference_id:conferenceId,p_organization_id:organizationId},options).then(function(settled){
        if(settled.timeout||settled.error||(settled.response&&settled.response.error)){
          ctx.d.attempts.markUnknown(scope,options&&options.storeOptions);
          var error=settled.response&&settled.response.error||settled.error;
          return output(false,settled.timeout?'unknown_completion_state':'rpc_error',{operationId:attempt.data.operationId},settled.timeout?safeError('UNKNOWN_COMPLETION_STATE','تعذر تأكيد نتيجة العملية.'):mapRpcError(error));
        }
        var data=settled.response&&settled.response.data||{};
        if(data.status!=='assigned'||String(data.conferenceId||'')!==conferenceId||String(data.organizationId||'')!==organizationId||String(data.operationId||'')!==attempt.data.operationId){
          ctx.d.attempts.markUnknown(scope,options&&options.storeOptions);return output(false,'malformed_response',null,safeError('MALFORMED_RPC_RESPONSE','تعذر تأكيد نتيجة العملية.'));
        }
        ctx.d.attempts.remove(scope,options&&options.storeOptions);
        return output(true,'assigned',{conferenceId:conferenceId,organizationId:organizationId,operationId:attempt.data.operationId,organizationName:eligible.displayName});
      });
    });
  }
  function assign(input,options){
    var key=String(input&&input.conferenceId||'')+'|'+String(input&&input.organizationId||'');
    if(flights[key])return flights[key];
    var flight=execute(input,options);flights[key]=flight;
    flight.finally(function(){if(flights[key]===flight)delete flights[key];}).catch(function(){return null;});
    return flight;
  }
  global.LegacyConferenceOrganizationAssignmentService=Object.freeze({preflight:preflight,assign:assign});
})(window);
