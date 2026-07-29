'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var ids={
  conflict:'11111111-1111-4111-8111-111111111111',
  conference:'22222222-2222-4222-8222-222222222222',
  source:'33333333-3333-4333-8333-333333333333',
  resolution:'44444444-4444-4444-8444-444444444444',
  user:'55555555-5555-4555-8555-555555555555',
  device:'66666666-6666-4666-8666-666666666666'
};

function load(responses){
  var calls=[];
  var sandbox={
    window:null,
    Promise:Promise,
    Date:Date,
    JSON:JSON,
    Object:Object,
    Array:Array,
    String:String,
    Number:Number,
    RegExp:RegExp,
    Uint8Array:Uint8Array,
    structuredClone:global.structuredClone,
    SupabaseAuth:{
      getSession:function(){return {user:{id:ids.user}};}
    },
    SupabaseDeviceIdentity:{
      getOrCreate:function(){return {id:ids.device};}
    },
    SupabaseClientLayer:{
      getClient:function(){
        return {
          rpc:function(name,input){
            calls.push({name:name,input:JSON.parse(JSON.stringify(input))});
            var next=responses.shift();
            if(next instanceof Error)return Promise.reject(next);
            return Promise.resolve(next);
          }
        };
      }
    },
    ConferenceLinkStore:new Proxy({},{
      get:function(){throw new Error('LINK_STORE_TOUCHED');}
    }),
    OfflineSyncQueue:new Proxy({},{
      get:function(){throw new Error('QUEUE_TOUCHED');}
    }),
    PendingRemoteApplicationStore:new Proxy({},{
      get:function(){throw new Error('PENDING_STORE_TOUCHED');}
    }),
    appData:new Proxy({},{
      get:function(){throw new Error('APP_DATA_TOUCHED');},
      set:function(){throw new Error('APP_DATA_TOUCHED');}
    })
  };
  sandbox.window=sandbox;
  [
    'js/sync/conflict-resolution.js',
    'js/sync/conflict-executor.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return {window:sandbox,calls:calls};
}

function buildPlan(environment,strategy,overrides){
  var local={id:'local-1',name:'Local'};
  var server={id:'local-1',name:'Server'};
  var input=Object.assign({
    conflictId:ids.conflict,
    conferenceId:ids.conference,
    operationId:ids.source,
    resolutionOperationId:ids.resolution,
    strategy:strategy,
    baseRevision:4,
    actualRevision:5,
    localSnapshot:local,
    serverSnapshot:server,
    schemaVersion:'1',
    appVersion:'4.0.0'
  },overrides||{});
  if(strategy==='manual'){
    input.resolutionMap={'/name':'local'};
  }
  var built=environment.window.ConflictResolution.buildResolutionPlan(
    input,
    {now:'2026-07-29T10:00:00.000Z'}
  );
  assert.strictEqual(built.ok,true);
  return built.data;
}

function rpc(status,resolvedRevision,extra){
  return {error:null,data:Object.assign({
    success:true,
    status:status,
    conflictId:ids.conflict,
    conferenceId:ids.conference,
    strategy:null,
    operationId:ids.resolution,
    previousRevision:5,
    resolvedRevision:resolvedRevision
  },extra||{})};
}

async function execute(strategy,response){
  var environment=load([response]);
  var plan=buildPlan(environment,strategy);
  var result=await environment.window.ConflictExecutor
    .executeResolutionPlan(plan);
  return {environment:environment,plan:plan,result:result};
}

async function run(){
  var local=await execute('keep_local',rpc('resolved',6,{
    strategy:'keep_local'
  }));
  assert.strictEqual(local.result.ok,true);
  assert.strictEqual(local.result.status,'resolved');
  assert.strictEqual(local.result.data.resolvedRevision,6);
  assert.strictEqual(local.environment.calls[0].name,'resolve_sync_conflict');
  assert.strictEqual(
    local.environment.calls[0].input.p_expected_revision,
    5
  );
  assert.deepStrictEqual(
    local.environment.calls[0].input.p_resolved_snapshot,
    {id:'local-1',name:'Local'}
  );

  var remote=await execute('keep_server',rpc('server_selected',5,{
    strategy:'keep_server'
  }));
  assert.strictEqual(remote.result.ok,true);
  assert.strictEqual(remote.result.data.resolvedRevision,5);
  assert.strictEqual(
    remote.environment.calls[0].input.p_resolved_snapshot,
    null
  );

  var manual=await execute('manual',rpc('resolved',6,{
    strategy:'manual'
  }));
  assert.strictEqual(manual.result.ok,true);
  assert.strictEqual(manual.result.data.resolvedRevision,6);
  assert.deepStrictEqual(
    manual.environment.calls[0].input.p_resolved_snapshot,
    {id:'local-1',name:'Local'}
  );

  var duplicate=await execute('keep_local',rpc('duplicate',6,{
    strategy:'keep_local'
  }));
  assert.strictEqual(duplicate.result.ok,true);
  assert.strictEqual(duplicate.result.status,'duplicate');
  assert.strictEqual(duplicate.result.data.resolvedRevision,6);

  var duplicateMissing=await execute(
    'keep_local',
    rpc('duplicate',null,{strategy:'keep_local'})
  );
  assert.strictEqual(duplicateMissing.result.ok,false);
  assert.strictEqual(
    duplicateMissing.result.error.code,
    'INVALID_RESOLUTION_RESPONSE'
  );

  var changed=await execute('keep_local',{
    error:null,
    data:{
      success:false,
      status:'conflict_changed',
      conflictId:ids.conflict,
      conferenceId:ids.conference,
      operationId:ids.resolution,
      expectedRevision:5,
      actualRevision:7
    }
  });
  assert.strictEqual(changed.result.ok,true);
  assert.strictEqual(changed.result.status,'conflict_changed');
  assert.strictEqual(changed.result.data.resolvedRevision,null);

  var malformed=await execute('keep_local',{
    error:null,
    data:{success:true,status:'resolved',resolvedRevision:6}
  });
  assert.strictEqual(malformed.result.ok,false);
  assert.strictEqual(
    malformed.result.error.code,
    'INVALID_RESOLUTION_RESPONSE'
  );

  var badIncrement=await execute('keep_local',rpc('resolved',5,{
    strategy:'keep_local'
  }));
  assert.strictEqual(badIncrement.result.ok,false);
  assert.strictEqual(
    badIncrement.result.error.code,
    'INVALID_RESOLUTION_RESPONSE'
  );

  var badRemoteIncrement=await execute(
    'keep_server',
    rpc('server_selected',6,{strategy:'keep_server'})
  );
  assert.strictEqual(badRemoteIncrement.result.ok,false);
  assert.strictEqual(
    badRemoteIncrement.result.error.code,
    'INVALID_RESOLUTION_RESPONSE'
  );

  var retryEnvironment=load([
    new Error('network offline'),
    rpc('resolved',6,{strategy:'keep_local'})
  ]);
  var persistedPlan=buildPlan(retryEnvironment,'keep_local');
  var persistedCopy=JSON.parse(JSON.stringify(persistedPlan));
  var failed=await retryEnvironment.window.ConflictExecutor
    .executeResolutionPlan(persistedPlan);
  assert.strictEqual(failed.ok,false);
  assert.strictEqual(failed.error.code,'NETWORK_ERROR');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(persistedPlan)),
    persistedCopy
  );
  var retried=await retryEnvironment.window.ConflictExecutor
    .executeResolutionPlan(persistedPlan);
  assert.strictEqual(retried.ok,true);
  assert.strictEqual(retryEnvironment.calls.length,2);
  assert.strictEqual(
    retryEnvironment.calls[0].input.p_resolution_operation_id,
    ids.resolution
  );
  assert.strictEqual(
    retryEnvironment.calls[1].input.p_resolution_operation_id,
    ids.resolution
  );

  var reusedEnvironment=load([]);
  var reused=JSON.parse(JSON.stringify(
    buildPlan(reusedEnvironment,'keep_local')
  ));
  reused.resolutionOperationId=ids.source;
  assert.strictEqual(
    (await reusedEnvironment.window.ConflictExecutor
      .executeResolutionPlan(reused)).error.code,
    'INVALID_RESOLUTION_PLAN'
  );
  assert.strictEqual(reusedEnvironment.calls.length,0);

  console.log('conflict executor phase 2 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
