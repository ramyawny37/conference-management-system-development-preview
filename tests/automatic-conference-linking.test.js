'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var sources=[
  'js/sync/conference-link-store.js',
  'js/sync/conference-linking-attempt-store.js',
  'js/sync/conference-linking-service.js',
  'js/sync/automatic-conference-linking.js'
].map(function(file){
  return {
    file:file,
    source:fs.readFileSync(path.resolve(__dirname,'..',file),'utf8')
  };
});

var UUIDS=[
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666'
];

function memoryStorage(){
  var values={};
  return {
    getItem:function(key){
      return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;
    },
    setItem:function(key,value){values[key]=String(value);},
    removeItem:function(key){delete values[key];}
  };
}

function environment(overrides){
  overrides=overrides||{};
  var conference=overrides.conference===undefined
    ?{id:'local-1',name:'Conference 1',people:[]}
    :overrides.conference;
  var uuidIndex=0;
  var calls={create:[],upload:[],configure:[],schedule:[]};
  var remote=overrides.remote||{
    createConferenceIdempotent:function(input){
      calls.create.push(input);
      return Promise.resolve({
        ok:true,status:'created',
        data:{conferenceId:input.requestedConferenceId,
          operationId:input.operationId}
      });
    },
    uploadInitialSnapshot:function(input){
      calls.upload.push(input);
      return Promise.resolve({
        ok:true,status:'applied',
        data:{revision:1,operationId:input.operationId}
      });
    }
  };
  var preferences=Object.assign({
    cloudSyncEnabled:true,
    automaticLinkingEnabled:true,
    automaticSyncEnabled:true
  },overrides.preferences||{});
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
    localStorage:memoryStorage(),
    navigator:{onLine:overrides.online!==false},
    crypto:{randomUUID:function(){
      return UUIDS[uuidIndex++%UUIDS.length];
    }},
    APP_RELEASE:{version:'test'},
    AutomaticSyncPreferences:{get:function(){return preferences;}},
    SupabaseRuntimeConfig:{getPublicState:function(){
      return {configured:overrides.configured!==false};
    }},
    SupabaseAuth:{
      initialize:function(){return Promise.resolve({authenticated:true});},
      getState:function(){
        return {authenticated:overrides.authenticated!==false};
      }
    },
    SupabaseDeviceIdentity:{getOrCreate:function(){
      return {id:UUIDS[5]};
    }},
    SupabaseSnapshotSync:remote,
    OfflineFirstIntegration:{configureConferenceSync:function(localId,input){
      calls.configure.push({localId:localId,input:input});
      return {ok:true};
    }},
    AutomaticSyncOrchestrator:{schedule:function(reason){
      calls.schedule.push(reason);
      return {ok:true};
    }},
    getCurrentConference:function(){return conference;}
  };
  sandbox.window=sandbox;
  sources.forEach(function(item){
    vm.runInNewContext(item.source,sandbox,{filename:item.file});
  });
  sandbox.AutomaticConferenceLinking.initialize();
  return {
    window:sandbox,
    calls:calls,
    setConference:function(value){conference=value;}
  };
}

async function evaluate(env){
  return env.window.AutomaticConferenceLinking.evaluate({
    connectivity:'online',
    reason:'test'
  });
}

async function run(){
  var offline=environment({online:false});
  assert.strictEqual((await evaluate(offline)).status,'offline');
  assert.strictEqual(offline.calls.create.length,0);

  var noSession=environment({authenticated:false});
  assert.strictEqual((await evaluate(noSession)).status,'auth_required');
  assert.strictEqual(noSession.calls.create.length,0);

  var cloudDisabled=environment({
    preferences:{cloudSyncEnabled:false}
  });
  assert.strictEqual(
    (await evaluate(cloudDisabled)).status,'cloud_sync_disabled'
  );
  assert.strictEqual(cloudDisabled.calls.create.length,0);

  var automaticDisabled=environment({
    preferences:{automaticSyncEnabled:false}
  });
  assert.strictEqual(
    (await evaluate(automaticDisabled)).status,'automatic_sync_disabled'
  );
  assert.strictEqual(automaticDisabled.calls.create.length,0);

  var noConference=environment({conference:null});
  assert.strictEqual(
    (await evaluate(noConference)).status,'conference_unavailable'
  );
  assert.strictEqual(noConference.calls.create.length,0);

  var linked=environment();
  linked.window.ConferenceLinkStore.save({
    localConferenceId:'local-1',
    remoteConferenceId:UUIDS[1],
    knownRevision:3,
    linkStatus:'linked'
  });
  var linkedResult=await evaluate(linked);
  assert.strictEqual(linkedResult.status,'already_linked');
  assert.strictEqual(linkedResult.data.linked,true);
  assert.strictEqual(linked.calls.create.length,0);

  var created=environment();
  var createdResult=await evaluate(created);
  assert.strictEqual(createdResult.status,'linked');
  assert.strictEqual(createdResult.data.revision,1);
  assert.strictEqual(created.calls.create.length,1);
  assert.strictEqual(created.calls.upload.length,1);
  assert.strictEqual(
    created.window.ConferenceLinkStore.get('local-1').linkStatus,'linked'
  );

  var resolveCreate;
  var concurrentCalls=0;
  var concurrent=environment({remote:{
    createConferenceIdempotent:function(input){
      concurrentCalls++;
      return new Promise(function(resolve){
        resolveCreate=function(){
          resolve({ok:true,status:'created',data:{
            conferenceId:input.requestedConferenceId,
            operationId:input.operationId
          }});
        };
      });
    },
    uploadInitialSnapshot:function(input){
      return Promise.resolve({ok:true,status:'applied',data:{
        revision:1,operationId:input.operationId
      }});
    }
  }});
  var first=evaluate(concurrent);
  var second=evaluate(concurrent);
  await Promise.resolve();
  resolveCreate();
  await Promise.all([first,second]);
  assert.strictEqual(concurrentCalls,1);

  var duplicate=environment({remote:{
    createConferenceIdempotent:function(input){
      duplicate.calls.create.push(input);
      return Promise.resolve({ok:true,status:'duplicate',data:{
        conferenceId:input.requestedConferenceId,
        operationId:input.operationId
      }});
    },
    uploadInitialSnapshot:function(input){
      duplicate.calls.upload.push(input);
      return Promise.resolve({ok:true,status:'duplicate',data:{
        revision:4,operationId:input.operationId
      }});
    }
  }});
  var duplicateResult=await evaluate(duplicate);
  assert.strictEqual(duplicateResult.status,'linked');
  assert.strictEqual(duplicateResult.data.creationStatus,'duplicate');
  assert.strictEqual(duplicateResult.data.uploadStatus,'duplicate');
  assert.strictEqual(duplicateResult.data.revision,4);

  var failedRpc=environment({remote:{
    createConferenceIdempotent:function(input){
      failedRpc.calls.create.push(input);
      return Promise.resolve({
        ok:false,status:'error',error:{code:'NETWORK_ERROR'}
      });
    },
    uploadInitialSnapshot:function(){
      throw new Error('upload must not run');
    }
  }});
  var rpcFailure=await evaluate(failedRpc);
  assert.strictEqual(rpcFailure.status,'create_failed');
  assert.strictEqual(
    failedRpc.window.ConferenceLinkStore.get('local-1'),null
  );
  var retained=failedRpc.window.ConferenceLinkingAttemptStore.get('local-1');
  assert.deepStrictEqual(Object.keys(retained).sort(),[
    'createdAt','localConferenceId','operationId',
    'requestedConferenceId','updatedAt'
  ]);
  assert.strictEqual(retained.operationId,
    failedRpc.calls.create[0].operationId);
  assert.strictEqual(retained.requestedConferenceId,
    failedRpc.calls.create[0].requestedConferenceId);

  var uploadAttempts=0;
  var uploadFailed=environment({remote:{
    createConferenceIdempotent:function(input){
      uploadFailed.calls.create.push(input);
      return Promise.resolve({ok:true,status:uploadAttempts?'duplicate':'created',
        data:{conferenceId:input.requestedConferenceId,
          operationId:input.operationId}});
    },
    uploadInitialSnapshot:function(input){
      uploadFailed.calls.upload.push(input);
      uploadAttempts++;
      return Promise.resolve(uploadAttempts===1
        ?{ok:false,status:'error',error:{code:'NETWORK_ERROR'}}
        :{ok:true,status:'applied',data:{
          revision:2,operationId:input.operationId
        }});
    }
  }});
  var pending=await evaluate(uploadFailed);
  assert.strictEqual(pending.status,'upload_pending');
  var pendingLink=uploadFailed.window.ConferenceLinkStore.get('local-1');
  assert.strictEqual(pendingLink.linkStatus,'upload_pending');
  var retried=await evaluate(uploadFailed);
  assert.strictEqual(retried.status,'linked');
  assert.strictEqual(
    uploadFailed.calls.create[1].operationId,
    uploadFailed.calls.create[0].operationId
  );
  assert.strictEqual(
    uploadFailed.calls.create[1].requestedConferenceId,
    uploadFailed.calls.create[0].requestedConferenceId
  );

  var mismatch=environment({remote:{
    createConferenceIdempotent:function(){
      return Promise.resolve({
        ok:false,status:'operation_mismatch',
        error:{code:'OPERATION_RESULT_MISMATCH'}
      });
    },
    uploadInitialSnapshot:function(){
      throw new Error('upload must not run');
    }
  }});
  assert.strictEqual((await evaluate(mismatch)).status,'conflict');
  assert.strictEqual(mismatch.window.ConferenceLinkStore.get('local-1'),null);

  var changedCalls=[];
  var changed=environment({remote:{
    createConferenceIdempotent:function(input){
      changedCalls.push(input);
      return Promise.resolve({ok:true,status:'created',data:{
        conferenceId:input.requestedConferenceId,
        operationId:input.operationId
      }});
    },
    uploadInitialSnapshot:function(input){
      return Promise.resolve({ok:true,status:'applied',data:{
        revision:1,operationId:input.operationId
      }});
    }
  }});
  await evaluate(changed);
  changed.setConference({id:'local-2',name:'Conference 2'});
  await evaluate(changed);
  assert.strictEqual(changedCalls.length,2);
  assert.strictEqual(
    changed.window.ConferenceLinkStore.get('local-2').linkStatus,'linked'
  );

  assert.strictEqual(
    created.window.ConferenceLinkingAttemptStore.storageKey,
    'conference_manager_linking_attempts_v1'
  );
  assert.strictEqual(
    created.window.AutomaticConferenceLinking.initialize().status,
    'already_initialized'
  );
  console.log('automatic conference linking tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
