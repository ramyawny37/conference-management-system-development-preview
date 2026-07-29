'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/conference-members-service.js'
),'utf8');
var ids={
  actor:'11111111-1111-4111-8111-111111111111',
  conference:'22222222-2222-4222-8222-222222222222',
  target:'33333333-3333-4333-8333-333333333333',
  operation:'44444444-4444-4444-8444-444444444444',
  secondTarget:'55555555-5555-4555-8555-555555555555'
};

function delay(milliseconds){
  return new Promise(function(resolve){setTimeout(resolve,milliseconds);});
}

function load(settings){
  settings=settings||{};
  var records={};
  var rpcCalls=[];
  var removals=0;
  var operationId=settings.operationId||ids.operation;
  var operationIds=(settings.operationIds||[]).slice();
  var attempts={
    get:function(scope){
      var key=[scope.actorUserId,scope.remoteConferenceId,
        scope.action,scope.targetUserId].join('|');
      return Promise.resolve(records[key]
        ?{ok:true,status:'found',data:records[key]}
        :{ok:false,status:'not_found'});
    },
    save:function(input){
      var key=[input.actorUserId,input.remoteConferenceId,
        input.action,input.targetUserId].join('|');
      records[key]=Object.assign({},input);
      return Promise.resolve(settings.attemptSaveFails
        ?{ok:false,status:'storage_error'}
        :{ok:true,status:'saved',data:records[key]});
    },
    remove:function(scope){
      removals++;
      var key=[scope.actorUserId,scope.remoteConferenceId,
        scope.action,scope.targetUserId].join('|');
      if(!settings.cleanupFails)delete records[key];
      return Promise.resolve(settings.cleanupFails
        ?{ok:false,status:'storage_error'}
        :{ok:true,status:'removed'});
    }
  };
  var client={
    rpc:function(name,args){
      rpcCalls.push({name:name,args:args});
      return settings.rpc
        ?settings.rpc(name,args,rpcCalls.length)
        :Promise.resolve({data:null,error:null});
    }
  };
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Math:Math,
    Array:Array,
    Uint8Array:Uint8Array,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    structuredClone:global.structuredClone,
    crypto:{
      randomUUID:function(){
        return operationIds.length?operationIds.shift():operationId;
      }
    },
    SupabaseClientLayer:{
      getClient:function(){return settings.noClient?null:client;}
    },
    SupabaseAuth:{
      getSession:function(){
        return settings.noSession?null:{user:{id:ids.actor}};
      }
    },
    ConferenceMembershipAttemptStore:attempts
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{
    filename:'conference-members-service.js'
  });
  return {
    service:sandbox.ConferenceMembersService,
    attempts:attempts,
    records:records,
    rpcCalls:rpcCalls,
    removals:function(){return removals;},
    options:{
      attempts:attempts,
      clientLayer:sandbox.SupabaseClientLayer,
      auth:sandbox.SupabaseAuth
    }
  };
}

function mutationInput(target){
  return {
    remoteConferenceId:ids.conference,
    targetUserId:target||ids.target
  };
}

async function run(){
  var access=load({rpc:function(name){
    assert.strictEqual(name,'get_my_conference_access');
    return Promise.resolve({data:{
      success:true,status:'available',
      conferenceId:ids.conference,
      userId:ids.actor,
      role:'owner',
      canManageMembers:true,
      canSync:true,
      canResolveConflicts:true,
      canAcquireLock:true
    },error:null});
  }});
  assert.strictEqual((await access.service.getCurrentAccess({
    remoteConferenceId:ids.conference
  },access.options)).status,'available');

  var accessUserMismatch=load({rpc:function(){
    return Promise.resolve({data:{
      success:true,status:'available',
      conferenceId:ids.conference,
      userId:ids.target,
      role:'owner',
      canManageMembers:true,
      canSync:true,
      canResolveConflicts:true,
      canAcquireLock:true
    },error:null});
  }});
  assert.strictEqual((await accessUserMismatch.service.getCurrentAccess({
    remoteConferenceId:ids.conference
  },accessUserMismatch.options)).status,'malformed_response');

  var malformedAccess=load({rpc:function(){
    return Promise.resolve({data:{
      success:true,status:'available',
      conferenceId:ids.conference,
      userId:ids.actor,
      role:'owner',
      canManageMembers:'yes',
      canSync:true,
      canResolveConflicts:true,
      canAcquireLock:true
    },error:null});
  }});
  assert.strictEqual((await malformedAccess.service.getCurrentAccess({
    remoteConferenceId:ids.conference
  },malformedAccess.options)).status,'malformed_response');

  var listed=load({rpc:function(name){
    assert.strictEqual(name,'list_conference_members');
    return Promise.resolve({data:[{
      user_id:ids.actor,
      display_name:'Owner',
      role:'owner',
      created_at:'2026-07-29T00:00:00.000Z',
      is_current_user:true,
      email:'must-not-pass'
    }],error:null});
  }});
  var listResult=await listed.service.listMembers({
    remoteConferenceId:ids.conference
  },listed.options);
  assert.strictEqual(listResult.status,'listed');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      listResult.data.members[0],'email'
    ),
    false
  );

  var lookup=load({rpc:function(name,args){
    assert.strictEqual(name,'lookup_conference_user_by_email');
    assert.strictEqual(args.p_email,'manager@example.test');
    return Promise.resolve({data:{
      success:true,status:'found',
      conferenceId:ids.conference,
      targetUserId:ids.target,
      displayName:'Manager'
    },error:null});
  }});
  assert.strictEqual((await lookup.service.lookupUser({
    remoteConferenceId:ids.conference,
    email:'manager@example.test'
  },lookup.options)).status,'found');

  var added=load({rpc:function(name,args){
    assert.strictEqual(name,'add_conference_manager');
    return Promise.resolve({data:{
      success:true,status:'added',
      conferenceId:ids.conference,
      targetUserId:ids.target,
      operationId:args.p_operation_id,
      role:'manager'
    },error:null});
  }});
  var addResult=await added.service.addManager(
    mutationInput(),added.options
  );
  assert.strictEqual(addResult.status,'added');
  assert.strictEqual(addResult.data.operationId,ids.operation);
  assert.strictEqual(added.removals(),1);

  var removed=load({rpc:function(name,args){
    assert.strictEqual(name,'remove_conference_manager');
    return Promise.resolve({data:{
      success:true,status:'removed',
      conferenceId:ids.conference,
      targetUserId:ids.target,
      operationId:args.p_operation_id,
      role:null
    },error:null});
  }});
  assert.strictEqual((await removed.service.removeManager(
    mutationInput(),removed.options
  )).status,'removed');

  var networkAttempts=0;
  var retry=load({rpc:function(name,args){
    networkAttempts++;
    if(networkAttempts===1){
      return Promise.reject(new Error('network failed'));
    }
    return Promise.resolve({data:{
      success:true,status:'added',
      conferenceId:ids.conference,
      targetUserId:ids.target,
      operationId:args.p_operation_id,
      role:'manager',
      replayed:true
    },error:null});
  }});
  var firstRetry=await retry.service.addManager(
    mutationInput(),retry.options
  );
  assert.strictEqual(firstRetry.status,'network_error');
  assert.strictEqual(Object.keys(retry.records).length,1);
  var secondRetry=await retry.service.addManager(
    mutationInput(),retry.options
  );
  assert.strictEqual(secondRetry.status,'added');
  assert.strictEqual(secondRetry.data.replayed,true);
  assert.strictEqual(
    retry.rpcCalls[0].args.p_operation_id,
    retry.rpcCalls[1].args.p_operation_id
  );

  var timeout=load({rpc:function(){
    return new Promise(function(){});
  }});
  var timeoutResult=await timeout.service.removeManager(
    mutationInput(),
    Object.assign({},timeout.options,{timeoutMs:5})
  );
  assert.strictEqual(
    timeoutResult.status,
    'unknown_completion_state'
  );
  assert.strictEqual(Object.keys(timeout.records).length,1);
  assert.strictEqual(timeout.rpcCalls.length,1);

  var releaseRpc;
  var doubleClick=load({rpc:function(name,args){
    return new Promise(function(resolve){
      releaseRpc=function(){
        resolve({data:{
          success:true,status:'already_manager',
          conferenceId:ids.conference,
          targetUserId:ids.target,
          operationId:args.p_operation_id,
          role:'manager'
        },error:null});
      };
    });
  }});
  var clickOne=doubleClick.service.addManager(
    mutationInput(),doubleClick.options
  );
  var clickTwo=doubleClick.service.addManager(
    mutationInput(),doubleClick.options
  );
  assert.strictEqual(clickOne,clickTwo);
  await delay(0);
  assert.strictEqual(doubleClick.rpcCalls.length,1);
  releaseRpc();
  await clickOne;
  assert.deepStrictEqual(
    Array.from(doubleClick.service.getState().activeIntentKeys),
    []
  );

  var malformed=load({rpc:function(){
    return Promise.resolve({data:{
      success:true,status:'duplicate',
      conferenceId:ids.conference,
      targetUserId:ids.target,
      operationId:ids.operation,
      role:'manager'
    },error:null});
  }});
  assert.strictEqual((await malformed.service.addManager(
    mutationInput(),malformed.options
  )).status,'malformed_response');
  assert.strictEqual(Object.keys(malformed.records).length,1);

  var mismatched=load({rpc:function(name,args){
    return Promise.resolve({data:{
      success:true,status:'added',
      conferenceId:ids.conference,
      targetUserId:ids.secondTarget,
      operationId:args.p_operation_id,
      role:'manager'
    },error:null});
  }});
  assert.strictEqual((await mismatched.service.addManager(
    mutationInput(),mismatched.options
  )).status,'malformed_response');
  assert.strictEqual(Object.keys(mismatched.records).length,1);

  var expired=load({rpc:function(){
    return Promise.resolve({data:null,error:{
      code:'PGRST301',message:'JWT expired'
    }});
  }});
  assert.strictEqual((await expired.service.addManager(
    mutationInput(),expired.options
  )).status,'auth_required');
  assert.strictEqual(Object.keys(expired.records).length,1);

  var cleanup=load({
    cleanupFails:true,
    rpc:function(name,args){
      return Promise.resolve({data:{
        success:true,status:'already_manager',
        conferenceId:ids.conference,
        targetUserId:ids.target,
        operationId:args.p_operation_id,
        role:'manager'
      },error:null});
    }
  });
  var cleanupResult=await cleanup.service.addManager(
    mutationInput(),cleanup.options
  );
  assert.strictEqual(cleanupResult.ok,true);
  assert.strictEqual(cleanupResult.data.attemptCleanupPending,true);

  var releaseFirst;
  var serial=load({
    operationIds:[ids.operation,ids.secondTarget],
    rpc:function(name,args){
      if(name==='add_conference_manager'){
        return new Promise(function(resolve){
          releaseFirst=function(){
            resolve({data:{
              success:true,status:'added',
              conferenceId:ids.conference,
              targetUserId:ids.target,
              operationId:args.p_operation_id,
              role:'manager'
            },error:null});
          };
        });
      }
      return Promise.resolve({data:{
        success:true,status:'removed',
        conferenceId:ids.conference,
        targetUserId:ids.target,
        operationId:args.p_operation_id,
        role:null
      },error:null});
    }
  });
  var serialAdd=serial.service.addManager(
    mutationInput(),serial.options
  );
  var serialRemove=serial.service.removeManager(
    mutationInput(),serial.options
  );
  await delay(0);
  assert.strictEqual(serial.rpcCalls.length,1);
  releaseFirst();
  await serialAdd;
  assert.strictEqual((await serialRemove).status,'removed');
  assert.strictEqual(serial.rpcCalls.length,2);

  var auth=load({noSession:true});
  assert.strictEqual((await auth.service.addManager(
    mutationInput(),auth.options
  )).status,'auth_required');
  assert.strictEqual(auth.rpcCalls.length,0);

  var storageFailure=load({attemptSaveFails:true});
  assert.strictEqual((await storageFailure.service.addManager(
    mutationInput(),storageFailure.options
  )).status,'attempt_storage_failed');
  assert.strictEqual(storageFailure.rpcCalls.length,0);

  var corruptAttempts=load();
  corruptAttempts.attempts.get=function(){
    return Promise.resolve({
      ok:false,status:'corrupt_record',data:null
    });
  };
  assert.strictEqual((await corruptAttempts.service.addManager(
    mutationInput(),corruptAttempts.options
  )).status,'attempt_corrupt');
  assert.strictEqual(corruptAttempts.rpcCalls.length,0);

  var sessionReads=0;
  var sessionChange=load({cleanupFails:true,rpc:function(name,args){
    assert.strictEqual(name,'add_conference_manager');
    return Promise.resolve({data:{
      success:true,status:'added',
      conferenceId:ids.conference,
      targetUserId:ids.target,
      operationId:args.p_operation_id,
      role:'manager'
    },error:null});
  }});
  sessionChange.options.auth={
    getSession:function(){
      sessionReads++;
      return {
        user:{
          id:sessionReads===1?ids.actor:ids.secondTarget
        }
      };
    }
  };
  assert.strictEqual((await sessionChange.service.addManager(
    mutationInput(),sessionChange.options
  )).status,'added');
  assert.strictEqual(sessionReads,1);
  assert.strictEqual(
    Object.keys(sessionChange.records)[0].split('|')[0],
    ids.actor
  );

  var sourceText=source;
  [
    'ConferenceLinkStore',
    'OfflineSyncQueue',
    'SupabaseSnapshotSync',
    'ConflictExecutor',
    'AutomaticSyncOrchestrator',
    'StorageRepository',
    'appData',
    'renderSettings',
    'document.'
  ].forEach(function(forbidden){
    assert.strictEqual(sourceText.indexOf(forbidden),-1);
  });
  assert.ok(/\.finally\(function\(\)/.test(sourceText));

  console.log('conference members service tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
