(function(global){
  'use strict';

  var DEFAULT_TIMEOUT_MS=15000;
  var intentFlights=Object.create(null);
  var targetFlights=Object.create(null);

  function outcome(ok,status,data,error){
    return {
      ok:ok,
      status:status,
      data:data||null,
      error:error||null
    };
  }

  function safeError(code,message){
    return {
      code:String(code||'MEMBERSHIP_RPC_FAILED'),
      message:String(message||'The membership request failed.')
    };
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
        return index===4||index===6||index===8||index===10
          ?'-'+text:text;
      }).join('');
    }
    throw new Error('SECURE_UUID_UNAVAILABLE');
  }

  function dependencies(options){
    options=options||{};
    return {
      clientLayer:options.clientLayer||global.SupabaseClientLayer,
      auth:options.auth||global.SupabaseAuth,
      attempts:options.attempts||global.ConferenceMembershipAttemptStore
    };
  }

  function context(options){
    var d=dependencies(options);
    var client;
    var session;
    try{
      client=d.clientLayer&&
        typeof d.clientLayer.getClient==='function'
        ?d.clientLayer.getClient():null;
      session=d.auth&&typeof d.auth.getSession==='function'
        ?d.auth.getSession():null;
    }catch(error){
      return {error:safeError('SUPABASE_UNAVAILABLE',
        'Membership service is unavailable.')};
    }
    if(!client||typeof client.rpc!=='function'){
      return {error:safeError('SUPABASE_UNAVAILABLE',
        'Membership service is unavailable.')};
    }
    var userId=session&&session.user&&String(session.user.id||'');
    if(!isUuid(userId)){
      return {error:safeError('AUTH_REQUIRED',
        'An authenticated session is required.')};
    }
    return {client:client,userId:userId,attempts:d.attempts};
  }

  function requestError(error){
    var code=String(error&&error.code||'');
    var message=String(error&&error.message||'');
    if(code==='401'||code==='PGRST301'||/jwt|session|auth/i.test(message)){
      return outcome(false,'auth_required',null,
        safeError('AUTH_REQUIRED','Authentication is required.'));
    }
    if(code==='42501'||/owner access|access denied|permission/i.test(message)){
      return outcome(false,'access_denied',null,
        safeError('ACCESS_DENIED','Conference access is not available.'));
    }
    if(/operation id belongs/i.test(message)){
      return outcome(false,'operation_mismatch',null,
        safeError('OPERATION_MISMATCH','The operation could not be replayed.'));
    }
    if(/target user not found/i.test(message)){
      return outcome(false,'target_not_found',null,
        safeError('TARGET_NOT_FOUND','The requested user is not available.'));
    }
    if(/conference not found/i.test(message)){
      return outcome(false,'conference_not_found',null,
        safeError('CONFERENCE_NOT_FOUND','The conference is not available.'));
    }
    if(/network|fetch|offline/i.test(message)){
      return outcome(false,'network_error',null,
        safeError('NETWORK_ERROR','The membership request failed.'));
    }
    return outcome(false,'rpc_error',null,
      safeError('MEMBERSHIP_RPC_FAILED','The membership request failed.'));
  }

  function runRpc(client,name,args,options){
    var request=Promise.resolve().then(function(){
      return client.rpc(name,args);
    });
    request.then(function(){return null;},function(){return null;});
    var timeoutMs=Number.isInteger(options&&options.timeoutMs)
      ?Math.max(1,options.timeoutMs):DEFAULT_TIMEOUT_MS;
    var timer;
    var timeout=new Promise(function(resolve){
      timer=global.setTimeout(function(){
        resolve({timedOut:true});
      },timeoutMs);
    });
    return Promise.race([
      request.then(function(response){
        return {response:response};
      },function(error){
        return {thrown:error};
      }),
      timeout
    ]).then(function(settled){
      global.clearTimeout(timer);
      return settled;
    });
  }

  function malformed(scope){
    return outcome(false,'malformed_response',scope,
      safeError('MALFORMED_RPC_RESPONSE',
        'The membership response was invalid.'));
  }

  function normalizeSimple(response,scope,allowed){
    if(response&&response.error)return requestError(response.error);
    var data=response&&response.data;
    var status=String(data&&data.status||'');
    if(!data||allowed.indexOf(status)<0||
      String(data.conferenceId||'')!==scope.remoteConferenceId){
      return malformed(scope);
    }
    return {status:status,data:data};
  }

  function readOperation(method,input,options){
    input=input||{};
    var remoteConferenceId=String(input.remoteConferenceId||'');
    if(!isUuid(remoteConferenceId)){
      return Promise.resolve(outcome(false,'invalid_input',null,
        safeError('INVALID_CONFERENCE_ID','Conference ID is invalid.')));
    }
    var ctx=context(options);
    if(ctx.error){
      return Promise.resolve(outcome(false,
        ctx.error.code==='AUTH_REQUIRED'?'auth_required':'unavailable',
        {remoteConferenceId:remoteConferenceId},ctx.error));
    }
    var rpcName=method==='access'?'get_my_conference_access':
      method==='list'?'list_conference_members':
      'lookup_conference_user_by_email';
    var args={p_conference_id:remoteConferenceId};
    if(method==='lookup'){
      var email=String(input.email||'').trim();
      if(!email||email.indexOf('@')<=0){
        return Promise.resolve(outcome(false,'invalid_input',null,
          safeError('INVALID_EMAIL','Email is invalid.')));
      }
      args.p_email=email;
    }
    return runRpc(ctx.client,rpcName,args,options).then(function(settled){
      if(settled.timedOut){
        return outcome(false,'unknown_completion_state',{
          remoteConferenceId:remoteConferenceId,
          reason:'timeout'
        },safeError('MEMBERSHIP_COMPLETION_UNKNOWN',
          'The request completion state is unknown.'));
      }
      if(settled.thrown)return requestError(settled.thrown);
      if(method==='list'){
        var response=settled.response;
        if(response&&response.error)return requestError(response.error);
        if(!response||!Array.isArray(response.data))return malformed({
          remoteConferenceId:remoteConferenceId
        });
        var members=[];
        for(var index=0;index<response.data.length;index++){
          var member=response.data[index]||{};
          if(!isUuid(String(member.user_id||''))||
            ['owner','manager','accommodation_viewer',
              'transport_viewer','viewer'].indexOf(member.role)<0){
            return malformed({remoteConferenceId:remoteConferenceId});
          }
          members.push({
            userId:String(member.user_id),
            displayName:member.display_name==null
              ?null:String(member.display_name),
            role:String(member.role),
            createdAt:member.created_at||null,
            isCurrentUser:member.is_current_user===true
          });
        }
        return outcome(true,'listed',{
          remoteConferenceId:remoteConferenceId,
          members:members
        });
      }
      var normalized=normalizeSimple(settled.response,{
        remoteConferenceId:remoteConferenceId
      },method==='access'?['available','access_denied']:
        ['found','not_found']);
      if(normalized.ok===false)return normalized;
      if(method==='access'){
        var access=normalized.data;
        if(normalized.status==='access_denied'){
          return outcome(false,'access_denied',{
            remoteConferenceId:remoteConferenceId
          },safeError('ACCESS_DENIED',
            'Conference access is not available.'));
        }
        if(!isUuid(String(access.userId||''))||
          ['owner','manager','accommodation_viewer',
            'transport_viewer','viewer'].indexOf(access.role)<0||
          ['canManageMembers','canSync','canResolveConflicts',
            'canAcquireLock'].some(function(key){
              return typeof access[key]!=='boolean';
            })){
          return malformed({remoteConferenceId:remoteConferenceId});
        }
        return outcome(true,'available',{
          remoteConferenceId:remoteConferenceId,
          userId:String(access.userId),
          role:String(access.role),
          canManageMembers:access.canManageMembers,
          canSync:access.canSync,
          canResolveConflicts:access.canResolveConflicts,
          canAcquireLock:access.canAcquireLock
        });
      }
      if(normalized.status==='not_found'){
        return outcome(false,'not_found',{
          remoteConferenceId:remoteConferenceId
        },safeError('USER_NOT_FOUND',
          'The requested user is not available.'));
      }
      if(!isUuid(String(normalized.data.targetUserId||''))){
        return malformed({remoteConferenceId:remoteConferenceId});
      }
      return outcome(true,'found',{
        remoteConferenceId:remoteConferenceId,
        targetUserId:String(normalized.data.targetUserId),
        displayName:normalized.data.displayName==null
          ?null:String(normalized.data.displayName)
      });
    });
  }

  function resolveAttempt(ctx,scope,options){
    return ctx.attempts.get(scope,options&&options.attemptOptions)
      .then(function(existing){
        if(existing.ok)return existing;
        if(existing.status!=='not_found'){
          return {ok:false,status:'attempt_storage_failed'};
        }
        var operationId;
        try{operationId=createUuid();}
        catch(error){
          return {ok:false,status:'operation_id_unavailable'};
        }
        return ctx.attempts.save(Object.assign({},scope,{
          version:1,
          operationId:operationId
        }),options&&options.attemptOptions).then(function(saved){
          return saved&&saved.ok
            ?saved
            :{ok:false,status:'attempt_storage_failed'};
        });
      }).catch(function(){
        return {ok:false,status:'attempt_storage_failed'};
      });
  }

  function runMutation(action,input,options){
    var remoteConferenceId=String(input.remoteConferenceId||'');
    var targetUserId=String(input.targetUserId||'');
    if(!isUuid(remoteConferenceId)||!isUuid(targetUserId)){
      return Promise.resolve(outcome(false,'invalid_input',null,
        safeError('INVALID_MEMBERSHIP_INPUT',
          'Membership input is invalid.')));
    }
    var ctx=context(options);
    if(ctx.error){
      return Promise.resolve(outcome(false,
        ctx.error.code==='AUTH_REQUIRED'?'auth_required':'unavailable',{
          remoteConferenceId:remoteConferenceId,
          targetUserId:targetUserId
        },ctx.error));
    }
    var scope={
      actorUserId:ctx.userId,
      remoteConferenceId:remoteConferenceId,
      targetUserId:targetUserId,
      action:action
    };
    return resolveAttempt(ctx,scope,options).then(function(attempt){
      if(!attempt.ok){
        var code=attempt.status==='operation_id_unavailable'
          ?'SECURE_UUID_UNAVAILABLE':'ATTEMPT_STORAGE_FAILED';
        return outcome(false,attempt.status,scope,safeError(code,
          'The membership attempt could not be prepared.'));
      }
      var operationId=attempt.data.operationId;
      var rpcName=action==='add_manager'
        ?'add_conference_manager':'remove_conference_manager';
      return runRpc(ctx.client,rpcName,{
        p_conference_id:remoteConferenceId,
        p_target_user_id:targetUserId,
        p_operation_id:operationId
      },options).then(function(settled){
        var resultScope={
          remoteConferenceId:remoteConferenceId,
          targetUserId:targetUserId,
          operationId:operationId
        };
        if(settled.timedOut){
          resultScope.reason='timeout';
          return outcome(false,'unknown_completion_state',resultScope,
            safeError('MEMBERSHIP_COMPLETION_UNKNOWN',
              'The request completion state is unknown.'));
        }
        if(settled.thrown){
          var thrown=requestError(settled.thrown);
          thrown.data=resultScope;
          return thrown;
        }
        var allowed=action==='add_manager'
          ?['added','already_manager']
          :['removed','already_removed'];
        var normalized=normalizeSimple(
          settled.response,resultScope,allowed
        );
        if(normalized.ok===false){
          if(!normalized.data)normalized.data=resultScope;
          return normalized;
        }
        var data=normalized.data;
        if(String(data.targetUserId||'')!==targetUserId||
          String(data.operationId||'')!==operationId||
          (action==='add_manager'&&data.role!=='manager')||
          (action==='remove_manager'&&data.role!==null)){
          return malformed(resultScope);
        }
        var success=outcome(true,normalized.status,{
          remoteConferenceId:remoteConferenceId,
          targetUserId:targetUserId,
          operationId:operationId,
          role:data.role,
          replayed:data.replayed===true
        });
        return ctx.attempts.remove(
          scope,options&&options.attemptOptions
        ).then(function(removed){
          success.data.attemptCleanupPending=!removed.ok;
          return success;
        }).catch(function(){
          success.data.attemptCleanupPending=true;
          return success;
        });
      });
    });
  }

  function mutation(action,input,options){
    input=input&&typeof input==='object'?input:{};
    var ctx=context(options);
    var actor=ctx.userId||'unauthenticated';
    var remote=String(input.remoteConferenceId||'');
    var target=String(input.targetUserId||'');
    var intentKey=[actor,remote,action,target].join('|');
    var targetKey=[actor,remote,target].join('|');
    if(intentFlights[intentKey])return intentFlights[intentKey];
    var previous=targetFlights[targetKey]||Promise.resolve();
    var flight=previous.catch(function(){return null;}).then(function(){
      return runMutation(action,input,options);
    });
    intentFlights[intentKey]=flight;
    targetFlights[targetKey]=flight;
    flight.finally(function(){
      if(intentFlights[intentKey]===flight){
        delete intentFlights[intentKey];
      }
      if(targetFlights[targetKey]===flight){
        delete targetFlights[targetKey];
      }
    }).catch(function(){return null;});
    return flight;
  }

  function getState(){
    return {
      activeIntentKeys:Object.keys(intentFlights),
      activeTargetKeys:Object.keys(targetFlights)
    };
  }

  function resetForTests(){
    intentFlights=Object.create(null);
    targetFlights=Object.create(null);
    return {ok:true,status:'reset'};
  }

  global.ConferenceMembersService=Object.freeze({
    getCurrentAccess:function(input,options){
      return readOperation('access',input,options);
    },
    listMembers:function(input,options){
      return readOperation('list',input,options);
    },
    lookupUser:function(input,options){
      return readOperation('lookup',input,options);
    },
    addManager:function(input,options){
      return mutation('add_manager',input,options);
    },
    removeManager:function(input,options){
      return mutation('remove_manager',input,options);
    },
    getState:getState,
    resetForTests:resetForTests
  });
})(window);
