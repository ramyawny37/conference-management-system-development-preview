(function(global){
  'use strict';

  var ROLES=['organization_owner','organization_admin','member'];
  var ACTIONS=['add_organization_member','remove_organization_member','change_organization_role'];
  // Mutation requests become locally unknown after 15 seconds. The server may
  // still complete them, so reconciliation always reuses the stored operationId.
  var DEFAULT_MUTATION_TIMEOUT_MS=15000;
  var flights=Object.create(null);
  var lastDiagnostic=null;
  var utils=global.OrganizationAdministrationUtils;
  var isUuid=utils&&utils.isUuid;

  function outcome(ok,status,data,error){return {ok:ok,status:status,data:data||null,error:error||null};}
  function safeError(code,message){return {code:code,message:message};}
  function createUuid(){
    if(global.crypto&&typeof global.crypto.randomUUID==='function')return global.crypto.randomUUID();
    if(global.crypto&&typeof global.crypto.getRandomValues==='function'){var b=new Uint8Array(16);global.crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return Array.prototype.map.call(b,function(v,i){var s=v.toString(16).padStart(2,'0');return i===4||i===6||i===8||i===10?'-'+s:s;}).join('');}
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }
  function dependencies(options){
    options=options||{};return {clientLayer:options.clientLayer||global.SupabaseClientLayer,
      auth:options.auth||global.SupabaseAuth,
      identity:options.identity||global.SupabaseDeviceIdentity,
      repository:options.repository||global.OrganizationMembershipOperationRepository};
  }
  function context(options){
    var d=dependencies(options),client=d.clientLayer&&d.clientLayer.getClient&&d.clientLayer.getClient();
    var session=d.auth&&d.auth.getSession&&d.auth.getSession();var authenticatedUserId=session&&session.user&&String(session.user.id||'');
    if(!client||typeof client.rpc!=='function')return {error:safeError('SUPABASE_UNAVAILABLE','Organization administration is unavailable.')};
    if(!isUuid(authenticatedUserId))return {error:safeError('AUTH_REQUIRED','An authenticated session is required.')};
    var identity=options&&options.deviceGuarded&&d.identity&&d.identity.getOrCreate&&d.identity.getOrCreate();
    if(options&&options.deviceGuarded&&(!identity||!isUuid(String(identity.id||''))))return {error:safeError('DEVICE_REQUIRED','An approved device is required.')};
    return {client:client,authenticatedUserId:authenticatedUserId,repository:d.repository,
      deviceGuarded:options&&options.deviceGuarded===true,
      actorDeviceId:identity&&String(identity.id||'')};
  }
  function rpcError(raw){
    var code=String(raw&&raw.code||''),message=String(raw&&raw.message||'');
    if(code==='401'||code==='PGRST301'||/auth|jwt|session/i.test(message))return safeError('AUTH_REQUIRED','Authentication is required.');
    if(code==='42501'||/authorization|permission|role required/i.test(message))return safeError('ACCESS_DENIED','Organization access is not available.');
    if(/network|fetch|offline|timeout/i.test(message))return safeError('AMBIGUOUS_RESULT','The operation result is unknown.');
    return {code:code||'ORGANIZATION_RPC_FAILED',sqlstate:code||null,
      message:'The organization request failed.'};
  }
  function diagnostic(stage,rpc,ctx,input,error){var device=global.CurrentDeviceAuthorizationService&&global.CurrentDeviceAuthorizationService.getState?global.CurrentDeviceAuthorizationService.getState():{};lastDiagnostic={stage:String(stage),rpc:String(rpc||''),errorCode:String(error&&error.code||''),sqlstate:error&&error.sqlstate||null,sanitizedMessage:String(error&&error.message||''),actorDevicePresent:!!(ctx&&ctx.actorDeviceId),actorDeviceApproved:device.currentDeviceAccessStatus==='approved',targetAccountApproved:input&&input.targetAccountApproved===true,organizationIdPresent:!!(input&&input.organizationId),timestamp:new Date().toISOString()};}
  function guardedRpc(ctx,name,args){if(!ctx.deviceGuarded)return {name:name,args:args};var guarded={list_my_organizations:'device_guarded_list_my_organizations',get_my_organization_access:'device_guarded_get_my_organization_access',list_organization_members:'device_guarded_list_organization_members',lookup_organization_candidate_by_email:'device_guarded_lookup_organization_candidate_by_email',add_organization_member:'device_guarded_add_organization_member',remove_organization_member:'device_guarded_remove_organization_member',change_organization_role:'device_guarded_change_organization_role'};return {name:guarded[name]||name,args:Object.assign({p_actor_device_id:ctx.actorDeviceId},args)};}
  function invoke(ctx,name,args){var request=guardedRpc(ctx,name,args);return Promise.resolve().then(function(){return ctx.client.rpc(request.name,request.args);}).then(function(response){
    if(response&&response.error)return outcome(false,'rpc_error',null,rpcError(response.error));
    return outcome(true,'received',response&&response.data);
  }).catch(function(error){return outcome(false,'rpc_error',null,rpcError(error));});}
  function invokeMutation(ctx,name,args,options){
    var timeoutMs=Number.isInteger(options&&options.mutationTimeoutMs)
      ?Math.max(1,options.mutationTimeoutMs):DEFAULT_MUTATION_TIMEOUT_MS;
    return new Promise(function(resolve){
      var settled=false;
      var timer=global.setTimeout(function(){
        settle(outcome(false,'timeout',null,
          safeError('AMBIGUOUS_RESULT','The operation result is unknown.')));
      },timeoutMs);
      function settle(value){
        if(settled)return;
        settled=true;
        global.clearTimeout(timer);
        resolve(value);
      }
      var request=guardedRpc(ctx,name,args);
      Promise.resolve().then(function(){return ctx.client.rpc(request.name,request.args);})
        .then(function(response){
          if(response&&response.error){
            settle(outcome(false,'rpc_error',null,rpcError(response.error)));
            return;
          }
          settle(outcome(true,'received',response&&response.data));
        },function(error){
          settle(outcome(false,'rpc_error',null,rpcError(error)));
        });
    });
  }
  function requireOrganization(input){var id=String(input&&input.organizationId||'');return isUuid(id)?id:null;}
  function candidateUnavailable(organizationId){
    return outcome(false,'candidate_unavailable',{
      organizationId:organizationId||null,targetUserId:null,displayName:null,
      membershipStatus:'not_member'
    });
  }
  function listMyOrganizations(options){
    var ctx=context(options);
    if(ctx.error)return Promise.resolve(outcome(false,'unavailable',null,ctx.error));
    return invoke(ctx,'list_my_organizations',{}).then(function(response){
      if(!response.ok||!Array.isArray(response.data))return outcome(false,'unavailable');
      var organizations=[];
      for(var index=0;index<response.data.length;index++){
        var row=response.data[index]||{};
        if(!isUuid(String(row.id||''))||!String(row.display_name||'').trim()){
          return outcome(false,'unavailable');
        }
        organizations.push({organizationId:String(row.id),displayName:String(row.display_name),
          organizationKey:String(row.organization_key||''),isDefault:row.is_default===true});
      }
      return outcome(true,'listed',{organizations:organizations});
    });
  }
  function getCurrentAccess(input,options){
    var organizationId=requireOrganization(input),ctx=context(options);
    if(!organizationId)return Promise.resolve(outcome(false,'invalid_input',null,safeError('INVALID_ORGANIZATION_ID','Organization ID is invalid.')));
    if(ctx.error)return Promise.resolve(outcome(false,ctx.error.code==='AUTH_REQUIRED'?'auth_required':'unavailable',null,ctx.error));
    return invoke(ctx,'get_my_organization_access',{p_organization_id:organizationId}).then(function(response){
      var data=response.data||{};if(!response.ok)return response;
      if(String(data.organization_id||'')!==organizationId||
        (data.current_user_role!==null&&ROLES.indexOf(data.current_user_role)<0)||
        ['can_manage_members','can_manage_admins','can_manage_owners'].some(function(k){return typeof data[k]!=='boolean';}))return outcome(false,'malformed_response',null,safeError('MALFORMED_RPC_RESPONSE','The access response was invalid.'));
      if(!data.current_user_role)return outcome(false,'access_denied',{organizationId:organizationId},safeError('ACCESS_DENIED','Organization access is not available.'));
      return outcome(true,'available',{organizationId:organizationId,role:data.current_user_role,
        canManageMembers:data.can_manage_members,canManageAdmins:data.can_manage_admins,
        canManageOwners:data.can_manage_owners});
    });
  }
  function listMembers(input,options){
    var organizationId=requireOrganization(input),ctx=context(options);
    if(!organizationId)return Promise.resolve(outcome(false,'invalid_input'));
    if(ctx.error)return Promise.resolve(outcome(false,'unavailable',null,ctx.error));
    return invoke(ctx,'list_organization_members',{p_organization_id:organizationId}).then(function(response){
      if(!response.ok)return response;if(!Array.isArray(response.data))return outcome(false,'malformed_response',null,safeError('MALFORMED_RPC_RESPONSE','The member list was invalid.'));
      var members=[];for(var i=0;i<response.data.length;i++){var row=response.data[i]||{};if(!isUuid(String(row.user_id||''))||ROLES.indexOf(row.role)<0||typeof row.is_current_user!=='boolean')return outcome(false,'malformed_response',null,safeError('MALFORMED_RPC_RESPONSE','The member list was invalid.'));members.push({userId:String(row.user_id),displayName:row.display_name==null?null:String(row.display_name),role:row.role,createdAt:row.created_at||null,isCurrentUser:row.is_current_user});}
      return outcome(true,'listed',{organizationId:organizationId,members:members});
    });
  }
  function lookupCandidate(input,options){
    var organizationId=requireOrganization(input),email=String(input&&input.email||'').trim(),ctx=context(options);
    if(!organizationId||!email||email.indexOf('@')<=0){
      return Promise.resolve(candidateUnavailable(organizationId));
    }
    if(ctx.error)return Promise.resolve(candidateUnavailable(organizationId));
    return invoke(ctx,'lookup_organization_candidate_by_email',{p_organization_id:organizationId,p_email:email}).then(function(response){
      var data=response.data||{};
      if(!response.ok)return candidateUnavailable(organizationId);
      if(String(data.organization_id||'')!==organizationId||['member','not_member'].indexOf(data.membership_status)<0)return candidateUnavailable(organizationId);
      if(data.status!=='candidate'||!isUuid(String(data.target_user_id||'')))return candidateUnavailable(organizationId);
      return outcome(true,'candidate',{organizationId:organizationId,targetUserId:String(data.target_user_id),displayName:data.display_name==null?null:String(data.display_name),membershipStatus:data.membership_status});
    });
  }
  function refresh(input,options){return getCurrentAccess(input,options).then(function(access){
    if(!access.ok)return access;if(!access.data.canManageMembers)return outcome(true,'refreshed',{access:access.data,members:[]});
    return listMembers(input,options).then(function(members){return members.ok?outcome(true,'refreshed',{access:access.data,members:members.data.members}):members;});
  });}
  function validateOperation(input,ctx){
    var organizationId=requireOrganization(input),targetUserId=String(input&&input.targetUserId||''),action=String(input&&input.action||''),requestedRole=input&&input.requestedRole==null?null:String(input&&input.requestedRole||'');
    if(!organizationId||!isUuid(targetUserId)||ACTIONS.indexOf(action)<0||
      (action==='change_organization_role'&&ROLES.indexOf(requestedRole)<0)||
      (action!=='change_organization_role'&&requestedRole!==null))return null;
    return {authenticatedUserId:ctx.authenticatedUserId,organizationId:organizationId,
      targetUserId:targetUserId,action:action,requestedRole:requestedRole};
  }
  function executeRecord(ctx,record,options){
    var rpcName=record.action==='add_organization_member'?'add_organization_member':record.action==='remove_organization_member'?'remove_organization_member':'change_organization_role';
    var args={p_organization_id:record.organizationId,p_target_user_id:record.targetUserId,p_operation_id:record.operationId};if(record.action==='change_organization_role')args.p_target_role=record.requestedRole;
    return ctx.repository.markAttempt(record.authenticatedUserId,record.operationId,options&&options.repositoryOptions).then(function(attempt){
      if(!attempt.ok)return outcome(false,attempt.status,null,safeError('MANUAL_RETRY_REQUIRED','The pending operation is invalid.'));
      return invokeMutation(ctx,rpcName,args,options);
    }).then(function(response){
      if(!response.ok)return ctx.repository.markUnknown(record.authenticatedUserId,record.operationId,options&&options.repositoryOptions).then(function(){return outcome(false,'unknown',{operation:record},safeError('AMBIGUOUS_RESULT','The operation requires reconciliation.'));});
      var status=String(response.data&&response.data.status||'');
      if(['applied','unchanged','denied','invalid_request','operation_mismatch'].indexOf(status)<0)return ctx.repository.markUnknown(record.authenticatedUserId,record.operationId,options&&options.repositoryOptions).then(function(){return outcome(false,'unknown',{operation:record});});
      return refresh({organizationId:record.organizationId},options).then(function(refreshed){
        if(!refreshed.ok)return outcome(false,'terminal_refresh_failed',{operation:record,terminalStatus:status});
        return ctx.repository.remove(record.authenticatedUserId,record.operationId).then(function(){
          return outcome(status==='applied'||status==='unchanged',status,{operation:record,refresh:refreshed.data,
            newIntentRequired:status==='operation_mismatch'});
        });
      });
    });
  }
  function mutate(input,options){
    var ctx=context(options);if(ctx.error){diagnostic('CONTEXT','device_guarded_add_organization_member',ctx,input,ctx.error);return Promise.resolve(outcome(false,'unavailable',null,ctx.error));}
    var request=validateOperation(input,ctx);if(!request)return Promise.resolve(outcome(false,'invalid_input'));
    if(!ctx.repository||typeof ctx.repository.prepare!=='function')return Promise.resolve(outcome(false,'unavailable'));
    var flightKey=[request.authenticatedUserId,request.organizationId,request.targetUserId,request.action,request.requestedRole||''].join('|');if(flights[flightKey])return flights[flightKey];
    var flight=ctx.repository.prepare(request,createUuid(),options&&options.repositoryOptions).then(function(prepared){
      if(!prepared.ok){var error=safeError('OPERATION_STORAGE_'+String(prepared.status||'FAILED').toUpperCase(),'The membership operation could not be prepared.');diagnostic('LOCAL_OPERATION_PREPARE','device_guarded_add_organization_member',ctx,input,error);return outcome(false,prepared.status,null,error);}
      return executeRecord(ctx,prepared.data,options).then(function(response){diagnostic(response.ok?'COMPLETED':'RPC_OR_REFRESH','device_guarded_add_organization_member',ctx,input,response.error);return response;});
    }).finally(function(){delete flights[flightKey];});flights[flightKey]=flight;return flight;
  }
  function listPendingOperations(options){
    var ctx=context(options);if(ctx.error)return Promise.resolve(outcome(false,'unavailable',null,ctx.error));
    if(!ctx.repository||typeof ctx.repository.listForReconciliation!=='function')return Promise.resolve(outcome(false,'unavailable'));
    return ctx.repository.listForReconciliation(ctx.authenticatedUserId,options&&options.repositoryOptions).then(function(list){
      return list.ok?outcome(true,'listed',{operations:list.data.operations}):list;
    });
  }
  function getStoredOperation(ctx,operationId,options){
    if(!isUuid(String(operationId||''))||!ctx.repository||typeof ctx.repository.get!=='function')return Promise.resolve(outcome(false,'invalid_input'));
    return ctx.repository.get(ctx.authenticatedUserId,String(operationId),options&&options.repositoryOptions).then(function(found){
      return found.ok?outcome(true,'found',{operation:found.data}):found;
    });
  }
  function retryUnknownOperation(operationId,options){
    var ctx=context(options);if(ctx.error)return Promise.resolve(outcome(false,'unavailable',null,ctx.error));
    return getStoredOperation(ctx,operationId,options).then(function(found){
      if(!found.ok)return found;
      if(found.data.operation.state!=='unknown')return outcome(false,'not_unknown',{operation:found.data.operation});
      return executeRecord(ctx,found.data.operation,options);
    });
  }
  function abandonUnknownOperation(operationId,options){
    var ctx=context(options);if(ctx.error)return Promise.resolve(outcome(false,'unavailable',null,ctx.error));
    if(!ctx.repository||typeof ctx.repository.removeUnknown!=='function')return Promise.resolve(outcome(false,'unavailable'));
    return getStoredOperation(ctx,operationId,options).then(function(found){
      if(!found.ok)return found;var record=found.data.operation;
      if(record.state!=='unknown')return outcome(false,'not_unknown',{operation:record});
      return refresh({organizationId:record.organizationId},options).then(function(refreshed){
        if(!refreshed.ok)return outcome(false,'refresh_failed',{operation:record});
        return ctx.repository.removeUnknown(ctx.authenticatedUserId,record.operationId,options&&options.repositoryOptions).then(function(removed){
          return removed.ok?outcome(true,'tracking_stopped',{operation:record,refresh:refreshed.data}):removed;
        });
      });
    });
  }
  global.OrganizationAdministrationService=Object.freeze({listMyOrganizations:listMyOrganizations,getCurrentAccess:getCurrentAccess,
    listMembers:listMembers,lookupCandidate:lookupCandidate,refresh:refresh,
    addMember:function(input,options){return mutate(Object.assign({},input,{action:'add_organization_member',requestedRole:null}),options);},
    removeMember:function(input,options){return mutate(Object.assign({},input,{action:'remove_organization_member',requestedRole:null}),options);},
    changeRole:function(input,options){return mutate(Object.assign({},input,{action:'change_organization_role'}),options);},
    listPendingOperations:listPendingOperations,retryUnknownOperation:retryUnknownOperation,
    abandonUnknownOperation:abandonUnknownOperation,getLastDiagnostic:function(){return lastDiagnostic&&JSON.parse(JSON.stringify(lastDiagnostic));}});
})(window);
