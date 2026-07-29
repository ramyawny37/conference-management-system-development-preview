'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var remoteId='11111111-1111-4111-8111-111111111111';
var deviceId='22222222-2222-4222-8222-222222222222';
var firstId='33333333-3333-4333-8333-333333333333';
var secondId='44444444-4444-4444-8444-444444444444';

function load(){
  var sandbox={
    window:null,
    Promise:Promise,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Math:Math,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    structuredClone:global.structuredClone
  };
  sandbox.window=sandbox;
  [
    'js/sync/offline-first-integration.js',
    'js/sync/automatic-queue-runner.js'
  ].forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return sandbox;
}

function successful(status,revision,operationId){
  return {
    ok:true,
    status:status,
    data:{
      operationId:operationId,
      revision:revision,
      operation:{
        operationId:operationId,
        conferenceId:remoteId,
        deviceId:deviceId,
        attempts:1
      }
    }
  };
}

async function run(){
  var sandbox=load();
  var integration=sandbox.OfflineFirstIntegration;
  var link={
    localConferenceId:'local-1',
    remoteConferenceId:remoteId,
    knownRevision:1,
    actualRevision:null,
    linkStatus:'linked',
    pendingLocalApplication:false
  };
  var linkStore={
    findByRemoteId:function(){return Object.assign({},link);},
    save:function(input){
      link=Object.assign({},input);
      return {ok:true,status:'saved',data:Object.assign({},link)};
    }
  };
  var rebases=[];
  var queue={
    rebasePendingOperations:function(conferenceId,forDeviceId,revision){
      rebases.push({
        conferenceId:conferenceId,
        deviceId:forDeviceId,
        revision:revision
      });
      return Promise.resolve({ok:true,data:{count:1}});
    }
  };
  integration.configureConferenceSync('local-1',{
    conferenceId:remoteId,
    baseRevision:1,
    schemaVersion:'1',
    appVersion:'test'
  });

  var applied=await integration.applySuccessfulSyncRevision(
    successful('applied',2,firstId),
    {queue:queue,linkStore:linkStore}
  );
  assert.strictEqual(applied.status,'revision_published');
  assert.strictEqual(link.knownRevision,2);
  assert.strictEqual(link.actualRevision,2);
  assert.strictEqual(link.linkStatus,'linked');
  assert.strictEqual(
    integration.getConferenceSyncState('local-1').context.baseRevision,
    2
  );
  assert.strictEqual(rebases[0].revision,2);

  link.knownRevision=1;
  link.actualRevision=null;
  integration.configureConferenceSync('local-1',{
    conferenceId:remoteId,
    baseRevision:1,
    schemaVersion:'1',
    appVersion:'test'
  });
  await integration.applySuccessfulSyncRevision(
    successful('duplicate',2,firstId),
    {queue:queue,linkStore:linkStore}
  );
  assert.strictEqual(link.knownRevision,2);
  assert.strictEqual(
    integration.getConferenceSyncState('local-1').context.baseRevision,
    2
  );

  link.knownRevision=1;
  integration.configureConferenceSync('local-1',{
    conferenceId:remoteId,
    baseRevision:1,
    schemaVersion:'1',
    appVersion:'test'
  });
  var noRevision=await integration.applySuccessfulSyncRevision(
    successful('duplicate',null,firstId),
    {queue:queue,linkStore:linkStore}
  );
  assert.strictEqual(noRevision.status,'revision_unavailable');
  assert.strictEqual(link.knownRevision,1);
  assert.strictEqual(
    integration.getConferenceSyncState('local-1').context.baseRevision,
    1
  );

  var operations=[
    {
      operationId:firstId,
      conferenceId:remoteId,
      deviceId:deviceId,
      baseRevision:1,
      status:'pending',
      attempts:0
    },
    {
      operationId:secondId,
      conferenceId:remoteId,
      deviceId:deviceId,
      baseRevision:1,
      status:'pending',
      attempts:0
    }
  ];
  link.knownRevision=1;
  link.actualRevision=null;
  integration.configureConferenceSync('local-1',{
    conferenceId:remoteId,
    baseRevision:1,
    schemaVersion:'1',
    appVersion:'test'
  });
  var active=0;
  var maxActive=0;
  var processedBases=[];
  var runnerQueue={
    getReadyOperations:function(){
      return Promise.resolve({
        ok:true,
        data:{operations:operations.slice()}
      });
    },
    rebasePendingOperations:function(conferenceId,forDeviceId,revision){
      operations.forEach(function(operation){
        if(operation.conferenceId===conferenceId&&
          operation.deviceId===forDeviceId&&
          operation.status==='pending'&&
          operation.attempts===0){
          operation.baseRevision=revision;
        }
      });
      return Promise.resolve({ok:true,data:{count:1}});
    }
  };
  var processor={
    processOperation:function(operationId){
      var operation=operations.find(function(item){
        return item.operationId===operationId;
      });
      active++;
      maxActive=Math.max(maxActive,active);
      processedBases.push(operation.baseRevision);
      operation.status='processing';
      return Promise.resolve().then(function(){
        active--;
        operation.status='applied';
        return successful(
          'applied',
          operationId===firstId?2:3,
          operationId
        );
      });
    }
  };
  var runner=sandbox.AutomaticQueueRunner;
  var runResult=await runner.run({
    connectivity:'online',
    reasons:['local_save'],
    preferences:{get:function(){
      return {cloudSyncEnabled:true,automaticSyncEnabled:true};
    }},
    clientLayer:{getState:function(){
      return {configured:true,available:true};
    }},
    auth:{getState:function(){return {authenticated:true};}},
    deviceIdentity:{getOrCreate:function(){return {id:deviceId};}},
    queue:runnerQueue,
    processor:processor,
    integration:integration,
    linkStore:linkStore,
    pendingApplicationStore:{get:function(){
      return Promise.resolve({ok:false,status:'not_found'});
    }},
    limit:2
  });
  assert.strictEqual(runResult.status,'completed');
  assert.deepStrictEqual(processedBases,[1,2]);
  assert.strictEqual(maxActive,1);
  assert.strictEqual(link.knownRevision,3);
  assert.strictEqual(
    integration.getConferenceSyncState('local-1').context.baseRevision,
    3
  );

  console.log('successful sync revision tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
