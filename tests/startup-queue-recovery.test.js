'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/startup-queue-recovery.js'),'utf8');
var indexSource=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
var workerSource=fs.readFileSync(path.resolve(
  __dirname,'../service-worker.js'),'utf8');
var scriptSource=fs.readFileSync(path.resolve(__dirname,'../script.js'),'utf8');
var queueSource=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/sync-queue.js'),'utf8');
var OP='11111111-1111-4111-8111-111111111111';
var REMOTE='22222222-2222-4222-8222-222222222222';
var DEVICE='33333333-3333-4333-8333-333333333333';

function clone(value){return JSON.parse(JSON.stringify(value));}
function environment(settings){
  settings=settings||{};
  var snapshot={rooms:[{number:105,name:'unchanged'}]};
  var initialSnapshot=JSON.stringify(snapshot);
  var operation={
    operationId:OP,localConferenceId:'local-1',conferenceId:REMOTE,
    deviceId:DEVICE,status:settings.localStatus||'processing',attempts:1,
    baseRevision:17,schemaVersion:'1',appVersion:'test',snapshot:snapshot,
    result:settings.checkpoint?{
      operationId:OP,conferenceId:REMOTE,revision:18,previousRevision:17,
      serverAppliedAt:'2026-08-06T10:00:00.000Z'
    }:null
  };
  var links={knownRevision:17,actualRevision:17,localConferenceId:'local-1',
    remoteConferenceId:REMOTE,linkStatus:'cloud_linked'};
  var calls={inspect:0,upload:0,checkpoint:0,link:0,applied:0,
    pending:0,conflict:0,failed:0,reconcile:0,schedule:0,configure:0,
    timers:[],cleared:[]};
  function transition(status,update){
    operation.status=status;
    if(update)update(operation);
    return Promise.resolve({ok:true,status:status,data:clone(operation)});
  }
  var queue={
    getAllOperations:function(){return Promise.resolve({ok:true,data:{
      operations:[clone(operation)]}});},
    beginServerVerification:function(){return transition('verifying_server');},
    resumeServerVerification:function(){return transition('verifying_server');},
    checkpointServerApplied:function(id,input){calls.checkpoint++;
      return transition('server_applied',function(item){item.result={
        operationId:id,conferenceId:REMOTE,revision:input.revision,
        previousRevision:input.previousRevision,
        serverAppliedAt:input.serverAppliedAt
      };});},
    requireReconciliation:function(id,error){calls.reconcile++;
      return transition('requires_reconciliation',function(item){
        item.lastError=error;
        item.recovery={nextVerificationAt:new Date(
          Date.now()+[15000,60000,300000][Math.min(calls.reconcile-1,2)]
        ).toISOString()};
      });},
    restoreVerifiedMissingToPending:function(){calls.pending++;
      return transition('pending');},
    markApplied:function(){calls.applied++;
      if(settings.markAppliedFails&&calls.applied===1){
        return Promise.resolve({ok:false,status:'error'});
      }
      return transition('applied');},
    markConflict:function(){calls.conflict++;return transition('conflict');},
    markFailed:function(){calls.failed++;return transition('failed');}
  };
  var inspection=settings.inspection||{ok:true,status:'applied',data:{
    operationId:OP,conferenceId:REMOTE,deviceId:DEVICE,status:'applied',
    baseRevision:17,resultingRevision:18,
    processedAt:'2026-08-06T10:00:00.000Z'
  }};
  var sandbox={window:null,Promise:Promise,Date:Date,JSON:JSON,Object:Object,
    String:String,Number:Number,Array:Array,structuredClone:global.structuredClone,
    setTimeout:function(callback,delay){var handle={callback:callback,delay:delay};
      calls.timers.push(handle);return handle;},
    clearTimeout:function(handle){calls.cleared.push(handle);}};
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'startup-queue-recovery.js'});
  var options={
    queue:queue,
    snapshotSync:{
      inspectSnapshotOperation:function(){calls.inspect++;
        if(settings.deferredInspection)return settings.deferredInspection;
        return Promise.resolve(clone(inspection));},
      uploadSnapshot:function(){calls.upload++;}
    },
    linkStore:{findByRemoteId:function(){return clone(links);},
      save:function(input){calls.link++;if(settings.linkFails)return {ok:false};
        links=clone(input);return {ok:true,data:links};}},
    processor:{getProcessorState:function(){return {
      activeOperationIds:settings.live?[OP]:[]};}},
    integration:{configureConferenceSync:function(){calls.configure++;}},
    orchestrator:{schedule:function(){calls.schedule++;}}
  };
  return {recovery:sandbox.StartupQueueRecovery,options:options,calls:calls,
    operation:function(){return clone(operation);},links:function(){return clone(links);},
    snapshotUnchanged:function(){return JSON.stringify(snapshot)===initialSnapshot;}};
}

async function run(){
  assert.ok(indexSource.indexOf('sync-queue.js')<
    indexSource.indexOf('startup-queue-recovery.js'));
  assert.ok(indexSource.indexOf('startup-queue-recovery.js')<
    indexSource.indexOf('automatic-queue-runner.js'));
  assert.ok(workerSource.includes('./js/sync/startup-queue-recovery.js'));
  assert.ok(queueSource.includes('var delays=[15000,60000,300000]'));
  assert.ok(scriptSource.indexOf('StartupQueueRecovery.run()')<
    scriptSource.indexOf('AutomaticSyncOrchestrator.start()'));
  var applied=environment();
  var recovered=await applied.recovery.run(applied.options);
  assert.strictEqual(recovered.data.outcomes[0].status,'recovered');
  assert.strictEqual(applied.operation().status,'applied');
  assert.strictEqual(applied.links().knownRevision,18);
  assert.strictEqual(applied.calls.inspect,1);
  assert.strictEqual(applied.calls.upload,0);
  assert.strictEqual(applied.calls.checkpoint,1);
  assert.strictEqual(applied.calls.link,1);
  assert.strictEqual(applied.calls.applied,1);
  assert.strictEqual(applied.calls.schedule,1);
  assert.strictEqual(applied.snapshotUnchanged(),true);

  var missing=environment({inspection:{ok:true,status:'not_found',data:{}}});
  await missing.recovery.run(missing.options);
  assert.strictEqual(missing.operation().status,'pending');
  assert.strictEqual(missing.calls.pending,1);
  assert.strictEqual(missing.calls.upload,0);

  for(var status of ['pending','processing']){
    var waiting=environment({inspection:{ok:true,status:status,data:{}}});
    await waiting.recovery.run(waiting.options);
    assert.strictEqual(waiting.operation().status,'requires_reconciliation');
    assert.strictEqual(waiting.calls.upload,0);
  }

  var conflict=environment({inspection:{ok:true,status:'conflict',data:{
    conflictId:null,expectedRevision:17,actualRevision:18}}});
  await conflict.recovery.run(conflict.options);
  assert.strictEqual(conflict.operation().status,'conflict');

  var failed=environment({inspection:{ok:true,status:'failed',data:{}}});
  await failed.recovery.run(failed.options);
  assert.strictEqual(failed.operation().status,'failed');

  for(var code of ['NETWORK_ERROR','AUTH_REQUIRED','ACCESS_DENIED']){
    var unavailable=environment({inspection:{ok:false,status:'error',
      error:{code:code}}});
    await unavailable.recovery.run(unavailable.options);
    assert.strictEqual(unavailable.operation().status,'requires_reconciliation');
    assert.strictEqual(unavailable.calls.upload,0);
  }

  var checkpoint=environment({localStatus:'server_applied',checkpoint:true});
  await checkpoint.recovery.run(checkpoint.options);
  assert.strictEqual(checkpoint.calls.inspect,0);
  assert.strictEqual(checkpoint.calls.checkpoint,0);
  assert.strictEqual(checkpoint.operation().status,'applied');
  assert.strictEqual(checkpoint.links().knownRevision,18);

  var linkFailure=environment({localStatus:'server_applied',checkpoint:true,
    linkFails:true});
  var linkFailureResult=await linkFailure.recovery.run(linkFailure.options);
  assert.strictEqual(linkFailureResult.data.outcomes[0].status,'server_applied');
  assert.strictEqual(linkFailure.operation().status,'server_applied');
  assert.strictEqual(linkFailure.calls.applied,0);

  var markFailure=environment({localStatus:'server_applied',checkpoint:true,
    markAppliedFails:true});
  await markFailure.recovery.run(markFailure.options);
  assert.strictEqual(markFailure.operation().status,'server_applied');
  await markFailure.recovery.run(markFailure.options);
  assert.strictEqual(markFailure.operation().status,'applied');
  assert.strictEqual(markFailure.calls.upload,0);

  var linkAlreadyUpdated=environment({localStatus:'server_applied',checkpoint:true});
  linkAlreadyUpdated.options.linkStore.findByRemoteId=function(){return {
    knownRevision:18,actualRevision:18,localConferenceId:'local-1',
    remoteConferenceId:REMOTE,linkStatus:'cloud_linked'};};
  await linkAlreadyUpdated.recovery.run(linkAlreadyUpdated.options);
  assert.strictEqual(linkAlreadyUpdated.operation().status,'applied');
  assert.strictEqual(linkAlreadyUpdated.calls.upload,0);

  var live=environment({live:true});
  var liveResult=await live.recovery.run(live.options);
  assert.strictEqual(liveResult.data.candidateCount,0);
  assert.strictEqual(live.operation().status,'processing');

  var otherDevice=environment({inspection:{ok:true,status:'applied',data:{
    deviceId:'44444444-4444-4444-8444-444444444444',baseRevision:17,
    resultingRevision:18}}});
  await otherDevice.recovery.run(otherDevice.options);
  assert.strictEqual(otherDevice.operation().status,'requires_reconciliation');
  assert.strictEqual(otherDevice.calls.upload,0);

  var repeated=await applied.recovery.run(applied.options);
  assert.strictEqual(repeated.data.candidateCount,0);
  assert.strictEqual(applied.calls.upload,0);
  assert.strictEqual(applied.calls.applied,1);
  assert.strictEqual(applied.snapshotUnchanged(),true);

  var resolveInspection;
  var concurrent=environment({deferredInspection:new Promise(function(resolve){
    resolveInspection=resolve;
  })});
  var firstRun=concurrent.recovery.run(concurrent.options);
  var secondRun=concurrent.recovery.run(concurrent.options);
  assert.strictEqual(firstRun,secondRun);
  resolveInspection({ok:true,status:'applied',data:{operationId:OP,
    conferenceId:REMOTE,deviceId:DEVICE,status:'applied',baseRevision:17,
    resultingRevision:18}});
  await firstRun;
  assert.strictEqual(concurrent.calls.inspect,1);

  var retry=environment({inspection:{ok:false,status:'error',
    error:{code:'NETWORK_ERROR'}}});
  await retry.recovery.run(retry.options);
  assert.strictEqual(retry.calls.timers.length,1);
  await retry.recovery.run(retry.options);
  assert.strictEqual(retry.calls.timers.length,1,
    'only one verification timer may exist per operation');
  retry.recovery.stop();
  assert.strictEqual(retry.calls.cleared.length,1);

  var review=environment();
  var reviewed=await review.recovery.reviewOperations([
    review.operation()
  ],review.options);
  assert.strictEqual(reviewed.ok,true);
  assert.strictEqual(reviewed.data.outcomes[0].status,'recovered');
  assert.strictEqual(review.operation().operationId,OP);
  assert.strictEqual(review.operation().status,'applied');
  assert.strictEqual(review.calls.inspect,1);
  assert.strictEqual(review.calls.upload,0);
  assert.strictEqual(review.calls.schedule,0,
    'post-restore review must not wake remote orchestration');
  var unavailableReview=environment({inspection:{ok:false,status:'error',
    error:{code:'NETWORK_ERROR'}}});
  var unavailableResult=await unavailableReview.recovery.reviewOperations([
    unavailableReview.operation()
  ],unavailableReview.options);
  assert.strictEqual(unavailableResult.data.outcomes[0].status,
    'requires_reconciliation');
  assert.strictEqual(unavailableReview.calls.timers.length,0,
    'post-restore review must remain paused without retry timers');
  assert.strictEqual(unavailableReview.calls.upload,0);
  assert.strictEqual(unavailableReview.calls.schedule,0);
  console.log('startup queue recovery tests passed');
}

run().catch(function(error){console.error(error);process.exitCode=1;});
