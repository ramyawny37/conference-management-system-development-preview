'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var source=fs.readFileSync(path.join(root,'js/sync/targeted-stuck-operation-recovery.js'),'utf8');
var LOCAL='e711a3ba-fea3-416a-ba1d-7caf4c3e931e';
var REMOTE='78b1b30a-6ef9-4f8c-89e7-fb71d4b6b9aa';
var OP='d41902b7-f8ae-402d-9423-854df9e40d23';
var DEVICE='71f9f2db-aeff-4e72-b692-a0f926916c62';
function clone(v){return JSON.parse(JSON.stringify(v));}
function roomSnapshot(){return {id:LOCAL,houses:[{floors:[{rooms:[{id:'room-105',number:'105',guests:[{id:'p1'}]}]}]}]};}
function environment(settings){
  settings=settings||{};
  var writes=[],calls={markApplied:0,upload:0,download:0,retry:0,enqueue:0,schedule:0,configure:0};
  var conference=roomSnapshot();
  var appData={currentConferenceId:LOCAL,conferences:[conference]};
  var operation={operationId:OP,localConferenceId:LOCAL,conferenceId:REMOTE,
    cloudConferenceId:REMOTE,deviceId:DEVICE,status:settings.status||'processing',
    baseRevision:settings.baseRevision===undefined?17:settings.baseRevision,
    attempts:1,snapshot:roomSnapshot(),result:null,lastError:null};
  var operations=[operation].concat(settings.otherActive?[{operationId:'other',
    conferenceId:REMOTE,status:'pending'}]:[]);
  var link={localConferenceId:LOCAL,remoteConferenceId:REMOTE,
    knownRevision:settings.knownRevision===undefined?17:settings.knownRevision,
    actualRevision:settings.actualRevision===undefined?17:settings.actualRevision,
    linkStatus:'linked',pendingLocalApplication:false,syncState:{pendingLocalChanges:false}};
  var backups=[];
  var queue={
    getOperation:function(){return Promise.resolve({ok:true,status:'found',data:clone(operation)});},
    getOperationsByConference:function(){return Promise.resolve({ok:true,status:'listed',data:{operations:clone(operations)}});},
    getConferenceReadiness:function(){var active=operations.filter(function(x){return ['pending','processing','failed','server_applied','requires_reconciliation','conflict'].includes(x.status);});return Promise.resolve(active.length?{ok:false,status:'not_stable',data:{blockingOperations:clone(active)}}:{ok:true,status:'stable',data:{blockingOperations:[]}});},
    markApplied:function(id,input){calls.markApplied++;writes.push('markApplied');if(settings.markFails)return Promise.resolve({ok:false,status:'error'});operation.status='applied';operation.result={revision:input.revision,previousRevision:input.previousRevision,conferenceId:input.conferenceId,operationId:id,recoveryReason:input.recoveryReason};return Promise.resolve({ok:true,status:'applied',data:clone(operation)});},
    enqueueSnapshotOperation:function(){calls.enqueue++;},coalesceSnapshotOperation:function(){calls.enqueue++;}
  };
  var links={get:function(){return clone(link);},save:function(value){writes.push(value.knownRevision===18?'link18':'linkRollback');if(settings.linkFails&&value.knownRevision===18)return {ok:false,status:'storage_error'};link=clone(value);return {ok:true,status:'saved',data:clone(link)};}};
  var db={getRecord:function(store){if(store==='pending_remote_applications')return Promise.resolve(settings.pending?{status:'pending'}:null);if(store==='conflict_resolution_drafts')return Promise.resolve(settings.draft?{status:'active'}:null);return Promise.resolve(null);},getAllRecords:function(){return Promise.resolve(settings.conflict?[{conferenceId:REMOTE,status:'open'}]:[]);},putRecord:function(store,value){writes.push('backup');backups.push(clone(value));return Promise.resolve(value);}};
  var integration={getConferenceSyncState:function(){return {context:{conferenceId:REMOTE,baseRevision:17}};},configureConferenceSync:function(id,input){calls.configure++;assert.strictEqual(id,LOCAL);assert.strictEqual(input.baseRevision,18);},handleLocalSave:function(){throw new Error('must not save');},upload:function(){calls.upload++;},download:function(){calls.download++;},retry:function(){calls.retry++;}};
  var orchestrator={schedule:function(){calls.schedule++;return true;},getRealtimeState:function(){return {status:'waiting_for_prerequisites'};}};
  var crypto={randomUUID:function(){return '11111111-1111-4111-8111-111111111111';}};
  var sandbox={window:null,structuredClone:clone,TextEncoder:TextEncoder,crypto:crypto,Promise:Promise,JSON:JSON,Date:Date};sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'targeted-stuck-operation-recovery.js'});
  return {api:sandbox.TargetedStuckOperationRecovery,options:{queue:queue,links:links,db:db,integration:integration,orchestrator:orchestrator,appData:appData},operation:function(){return clone(operation);},link:function(){return clone(link);},writes:writes,calls:calls,backups:backups,operations:operations,conference:conference};
}
async function run(){
  var queueSource=fs.readFileSync(path.join(root,'js/sync/sync-queue.js'),'utf8');
  var uiSource=fs.readFileSync(path.join(root,'js/sync/sync-settings-ui.js'),'utf8');
  var indexSource=fs.readFileSync(path.join(root,'index.html'),'utf8');
  var workerSource=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  assert.match(queueSource,/operation\.result\.recoveryReason=applyResult\.recoveryReason\.trim\(\)/);
  assert.ok(!uiSource.includes('TargetedStuckOperationRecovery'));
  assert.ok(!uiSource.includes('recoverTargetedStuckOperation:recoverTargetedStuckOperation'));
  assert.ok(!indexSource.includes('js/sync/targeted-stuck-operation-recovery.js'));
  assert.ok(!workerSource.includes("'./js/sync/targeted-stuck-operation-recovery.js'"));
  assert.match(workerSource,
    /const CACHE_REVISION = IS_DEVELOPMENT\s*\? 'development-3-4-0-warehouse-rtl-sidebar-position-v1'\s*:\s*'production-integrated-3-3-0-main-6d0c1e1-develop-80653ca-v1';/);
  var ok=environment();var recovered=await ok.api.recover(ok.options);
  assert.strictEqual(recovered.ok,true);assert.strictEqual(recovered.status,'recovered');
  assert.strictEqual(ok.operation().status,'applied');assert.strictEqual(ok.operation().result.revision,18);
  assert.strictEqual(ok.operation().result.recoveryReason,'server_applied_same_operation');
  assert.deepStrictEqual(ok.writes.slice(0,3),['backup','link18','markApplied']);
  assert.strictEqual(ok.link().knownRevision,18);assert.strictEqual(ok.link().actualRevision,18);
  assert.strictEqual(recovered.data.readiness.status,'stable');assert.strictEqual(recovered.data.room105Present,true);
  assert.strictEqual(recovered.data.snapshotUnchanged,true);assert.strictEqual(ok.calls.enqueue,0);
  assert.strictEqual(ok.calls.upload+ok.calls.download+ok.calls.retry,0);
  assert.strictEqual(ok.calls.configure,1);
  assert.strictEqual(ok.backups.length,1);assert.strictEqual(ok.backups[0].queueRecord.operationId,OP);
  assert.strictEqual(ok.calls.schedule,1);
  var again=await ok.api.recover(ok.options);assert.strictEqual(again.status,'already_recovered');
  assert.deepStrictEqual(ok.writes.slice(3),[]);assert.strictEqual(ok.calls.markApplied,1);

  for(const item of [
    [{status:'pending'},'queue_operation','status_changed'],
    [{baseRevision:16},'queue_operation','base_revision_changed'],
    [{knownRevision:16},'conference_link','link_revision_changed'],
    [{otherActive:true},'queue_read','other_active_operation'],
    [{pending:true},'pending_remote_application','pending_remote_application_exists'],
    [{conflict:true},'conflicts','active_conflict_exists']
  ]){
    var blocked=environment(item[0]);var outcome=await blocked.api.recover(blocked.options);
    assert.strictEqual(outcome.ok,false);assert.strictEqual(outcome.failedStage,item[1]);
    assert.strictEqual(outcome.reason,item[2]);assert.deepStrictEqual(blocked.writes,[]);
  }
  var linkFailure=environment({linkFails:true});var linkResult=await linkFailure.api.recover(linkFailure.options);
  assert.strictEqual(linkResult.failedStage,'link_update');assert.strictEqual(linkFailure.calls.markApplied,0);
  assert.deepStrictEqual(linkFailure.writes,['backup','link18']);
  var markFailure=environment({markFails:true});var markResult=await markFailure.api.recover(markFailure.options);
  assert.strictEqual(markResult.failedStage,'mark_applied');assert.strictEqual(markResult.ok,false);
  assert.deepStrictEqual(markFailure.writes,['backup','link18','markApplied','linkRollback']);
  assert.strictEqual(markFailure.link().knownRevision,17);
  console.log('targeted stuck operation recovery tests: passed');
}
run().catch(function(error){console.error(error);process.exitCode=1;});
