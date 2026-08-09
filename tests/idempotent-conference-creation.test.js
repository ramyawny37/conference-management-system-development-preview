'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/supabase/snapshot-sync.js'
),'utf8');
var operationId='11111111-1111-4111-8111-111111111111';
var conferenceId='22222222-2222-4222-8222-222222222222';
var userId='33333333-3333-4333-8333-333333333333';
var deviceId='44444444-4444-4444-8444-444444444444';
var organizationId='55555555-5555-4555-8555-555555555555';

function load(handler,authenticated){
  var calls=[];
  var client={
    rpc:function(name,input){
      calls.push({name:name,input:input});
      return handler(name,input);
    }
  };
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Date:Date,
    Uint8Array:Uint8Array,
    structuredClone:global.structuredClone,
    SupabaseClientLayer:{getClient:function(){return client;}},
    SupabaseAuth:{getSession:function(){
      return authenticated===false?null:{user:{id:userId}};
    }},
    SupabaseDeviceIdentity:{getOrCreate:function(){return {id:deviceId};}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'snapshot-sync.js'});
  return {api:sandbox.SupabaseSnapshotSync,calls:calls};
}

function request(overrides){
  return Object.assign({
    operationId:operationId,
    requestedConferenceId:conferenceId,
    name:'Conference',
    organizationId:organizationId,
    metadata:{source:'automatic-link'}
  },overrides||{});
}

async function run(){
  var networkCalls=0;
  var unloaded=load(function(){
    networkCalls++;
    return Promise.resolve({data:null,error:null});
  });
  assert.strictEqual(networkCalls,0);
  assert.strictEqual(typeof unloaded.api.createConference,'function');
  assert.strictEqual(
    typeof unloaded.api.verifyOwnerMembership,'function'
  );
  assert.strictEqual(typeof unloaded.api.uploadInitialSnapshot,'function');
  assert.strictEqual(typeof unloaded.api.uploadSnapshot,'function');
  assert.strictEqual(typeof unloaded.api.downloadSnapshot,'function');
  assert.strictEqual(typeof unloaded.api.listAvailableConferences,'function');

  var created=load(function(name,input){
    return Promise.resolve({data:{
      status:'created',
      operationId:input.p_operation_id,
      conferenceId:input.p_requested_conference_id,
      created:true
    },error:null});
  });
  var createdResult=await created.api.createConferenceIdempotent(request());
  assert.strictEqual(createdResult.ok,true);
  assert.strictEqual(createdResult.status,'created');
  assert.strictEqual(createdResult.data.conferenceId,conferenceId);
  assert.strictEqual(created.calls[0].name,'device_guarded_create_organization_conference_idempotent');
  assert.strictEqual(created.calls[0].input.p_actor_device_id,deviceId);
  assert.strictEqual(created.calls[0].input.p_organization_id,organizationId);

  var duplicate=load(function(name,input){
    return Promise.resolve({data:{
      status:'duplicate',
      operationId:input.p_operation_id,
      conferenceId:input.p_requested_conference_id,
      created:false
    },error:null});
  });
  assert.strictEqual(
    (await duplicate.api.createConferenceIdempotent(request())).status,
    'duplicate'
  );

  var incomplete=load(function(){
    return Promise.resolve({data:{status:'created'},error:null});
  });
  assert.strictEqual(
    (await incomplete.api.createConferenceIdempotent(request())).error.code,
    'INVALID_CREATION_RESPONSE'
  );

  var wrongOperation=load(function(){
    return Promise.resolve({data:{
      status:'duplicate',
      operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      conferenceId:conferenceId
    },error:null});
  });
  assert.strictEqual(
    (await wrongOperation.api.createConferenceIdempotent(request())).error.code,
    'OPERATION_RESULT_MISMATCH'
  );

  var wrongConference=load(function(){
    return Promise.resolve({data:{
      status:'created',
      operationId:operationId,
      conferenceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    },error:null});
  });
  assert.strictEqual(
    (await wrongConference.api.createConferenceIdempotent(request())).error.code,
    'CONFERENCE_RESULT_MISMATCH'
  );

  var noAuth=load(function(){
    throw new Error('RPC must not run');
  },false);
  assert.strictEqual(
    (await noAuth.api.createConferenceIdempotent(request())).error.code,
    'AUTH_REQUIRED'
  );
  assert.strictEqual(noAuth.calls.length,0);

  var accessDenied=load(function(){
    return Promise.resolve({data:null,error:{code:'42501'}});
  });
  assert.strictEqual(
    (await accessDenied.api.createConferenceIdempotent(request())).error.code,
    'ACCESS_DENIED'
  );

  var rpcAccessDenied=load(function(name,input){
    return Promise.resolve({data:{
      status:'access_denied',
      errorCode:'ACCOUNT_PENDING',
      operationId:input.p_operation_id
    },error:null});
  });
  var rpcDeniedResult=await rpcAccessDenied.api
    .createConferenceIdempotent(request());
  assert.strictEqual(rpcDeniedResult.ok,false);
  assert.strictEqual(rpcDeniedResult.status,'access_denied');
  assert.strictEqual(rpcDeniedResult.error.code,'ACCOUNT_PENDING');

  var network=load(function(){
    return Promise.reject(new Error('network unavailable'));
  });
  assert.strictEqual(
    (await network.api.createConferenceIdempotent(request())).error.code,
    'NETWORK_ERROR'
  );

  var capturedMetadata;
  var stable=load(function(name,input){
    capturedMetadata=input.p_initial_metadata;
    return Promise.resolve({data:{
      status:'created',
      operationId:operationId,
      conferenceId:conferenceId
    },error:null});
  });
  var metadata={nested:{value:1}};
  var stablePromise=stable.api.createConferenceIdempotent(
    request({metadata:metadata})
  );
  metadata.nested.value=2;
  await stablePromise;
  assert.strictEqual(capturedMetadata.nested.value,1);

  var invalid=load(function(){
    throw new Error('RPC must not run');
  });
  assert.strictEqual(
    (await invalid.api.createConferenceIdempotent(
      request({operationId:'invalid'})
    )).error.code,
    'INVALID_OPERATION_ID'
  );
  assert.strictEqual(invalid.calls.length,0);

  console.log('idempotent conference creation tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
