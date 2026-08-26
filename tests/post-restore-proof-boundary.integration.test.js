'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var REMOTE='11111111-1111-4111-8111-111111111111';
var DEVICE='22222222-2222-4222-8222-222222222222';
var OP_ONE='33333333-3333-4333-8333-333333333333';
var OP_TWO='44444444-4444-4444-8444-444444444444';
var MARKER='conference_manager_full_restore_pending_cloud_review';
var LINKS='conference_manager_sync_links';
var ATTEMPTS='conference_manager_linking_attempts_v1';

function clone(value){return JSON.parse(JSON.stringify(value));}
function request(result,error){
  var target={result:result,error:error||null};
  setImmediate(function(){
    if(error&&target.onerror)target.onerror();
    if(!error&&target.onsuccess)target.onsuccess();
  });
  return target;
}
function operation(id,status,attempts){
  return {operationId:id,queueSchemaVersion:1,localConferenceId:'restored-1',
    conferenceId:REMOTE,cloudConferenceId:REMOTE,deviceId:DEVICE,
    operationType:'snapshot',baseRevision:1,snapshot:{id:'restored-1',
      rooms:[{id:'room-1',name:'unchanged'}]},schemaVersion:'2',
    appVersion:'3.1.1',status:status,attempts:attempts,
    createdAt:'2026-08-26T10:00:00.000Z',
    updatedAt:'2026-08-26T10:00:00.000Z',nextAttemptAt:null,
    lastError:null,result:status==='server_applied'?{revision:2,
      previousRevision:1,conferenceId:REMOTE,operationId:id}:null};
}
function memoryStorage(values){
  values=Object.assign({},values);
  return {getItem:function(key){return Object.prototype.hasOwnProperty.call(
    values,key)?values[key]:null;},setItem:function(key,value){values[key]=value;},
    removeItem:function(key){delete values[key];},value:function(key){return values[key];}};
}
function environment(initialOperations,inspectionById){
  var rows=clone(initialOperations);
  var calls={inspect:0,upload:0,download:0,retry:0,schedule:0,start:0};
  var repository={stores:{syncOperationsQueue:'sync_operations_queue'},
    runTransaction:function(name,mode,callback){
      var before=clone(rows);
      var store={getAll:function(){return request(clone(rows));},
        get:function(id){return request(clone(rows.find(function(item){
          return item.operationId===id;
        })||null));},put:function(value){
          var index=rows.findIndex(function(item){
            return item.operationId===value.operationId;
          });
          if(index<0)rows.push(clone(value));else rows[index]=clone(value);
          return request(value);
        }};
      var stores={};stores[name]=store;
      return Promise.resolve(callback(stores)).catch(function(error){
        rows=before;throw error;
      });
    },getAllRecords:function(name){return Promise.resolve(name===
      'sync_operations_queue'?clone(rows):[]);},
    getRecord:function(name,id){
      return Promise.resolve(name==='sync_operations_queue'
        ?clone(rows.find(function(item){return item.operationId===id;})||null)
        :null);
    }};
  var store=memoryStorage({
    [MARKER]:JSON.stringify({version:1,
      createdAt:'2026-08-26T11:00:00.000Z',
      restoredConferenceIds:['restored-1'],sourceBackupCreatedAt:null,
      safetyBackupId:'safety-1'}),
    [LINKS]:JSON.stringify({'restored-1':{localConferenceId:'restored-1',
      remoteConferenceId:REMOTE,linkStatus:'linked',knownRevision:1}}),
    [ATTEMPTS]:'{}'
  });
  var link={localConferenceId:'restored-1',remoteConferenceId:REMOTE,
    linkStatus:'linked',knownRevision:1,actualRevision:1};
  var sandbox={window:null,Promise:Promise,JSON:JSON,Object:Object,Array:Array,
    String:String,Number:Number,Date:Date,Error:Error,setImmediate:setImmediate,
    setTimeout:function(){throw new Error('RETRY_TIMER_FORBIDDEN');},
    clearTimeout:function(){},structuredClone:clone,AppIndexedDB:repository,
    localStorage:store,BrowserStorageNamespace:{key:function(value){return value;}},
    SupabaseSnapshotSync:{inspectSnapshotOperation:function(input){
      calls.inspect++;
      var value=inspectionById[input.operationId];
      return Promise.resolve(typeof value==='function'?value(input):clone(value));
    },uploadSnapshot:function(){calls.upload++;},
    downloadSnapshot:function(){calls.download++;}},
    ConferenceLinkStore:{findByRemoteId:function(){return clone(link);},
      save:function(value){link=clone(value);return {ok:true,data:clone(link)};}},
    SyncQueueProcessor:{getProcessorState:function(){return {activeOperationIds:[]};}},
    OfflineFirstIntegration:{removeConferenceSync:function(){return {ok:true};},
      clearRemoteUpdate:function(){return {ok:true};},
      configureConferenceSync:function(){}},
    AutomaticSyncOrchestrator:{schedule:function(){calls.schedule++;},
      stop:function(){return {ok:true};},start:function(){calls.start++;return {ok:true};}},
    AutomaticConferenceLinking:{initialize:function(){return {ok:true};}},
    PendingRemoteApplicationStore:{get:function(){return Promise.resolve({
      ok:false,status:'not_found'});}},SupabaseAuth:{getSession:function(){return null;}},
    SupabaseDeviceIdentity:{getOrCreate:function(){return null;}}};
  sandbox.window=sandbox;
  ['js/sync/sync-queue.js','js/sync/startup-queue-recovery.js',
    'js/storage/full-backup.js'].forEach(function(file){
    vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox,
      {filename:file});
  });
  return {sandbox:sandbox,rows:function(){return clone(rows);},calls:calls,
    store:store,options:{currentAppData:{version:'2',
      currentConferenceId:'restored-1',conferences:[{id:'restored-1'}]},
      storage:store,queue:sandbox.OfflineSyncQueue,
      recovery:sandbox.StartupQueueRecovery,repository:repository,
      indexedDb:repository,snapshotSync:sandbox.SupabaseSnapshotSync,
      linkStore:sandbox.ConferenceLinkStore,
      processor:sandbox.SyncQueueProcessor,
      pendingRemoteApplications:sandbox.PendingRemoteApplicationStore,
      integration:sandbox.OfflineFirstIntegration,
      autoLinking:sandbox.AutomaticConferenceLinking,
      orchestrator:sandbox.AutomaticSyncOrchestrator}};
}

async function run(){
  var forged=environment([operation(OP_ONE,'pending',2)],{});
  var before=forged.rows();
  var forgedResult=await forged.sandbox.OfflineSyncQueue
    .isolatePostRestoreOperations({operationIds:[OP_ONE],
      verifiedMissingOperationIds:[OP_ONE]});
  assert.strictEqual(forgedResult.ok,false);
  assert.strictEqual(forgedResult.error.code,'OPERATION_NOT_PROVEN_UNEXECUTED');
  assert.deepStrictEqual(forged.rows(),before);

  var injected=environment([operation(OP_ONE,'processing',2)],{});
  var injectedReview=await injected.sandbox.StartupQueueRecovery
    .reviewOperations([injected.rows()[0]],{
      queue:injected.sandbox.OfflineSyncQueue,
      snapshotSync:{inspectSnapshotOperation:function(){return Promise.resolve({
        ok:true,status:'not_found',data:{}});}},
      repository:injected.options.repository,
      _isolateVerifiedMissing:true
    });
  assert.strictEqual(injectedReview.data.outcomes[0].status,'pending');
  assert.strictEqual(injected.rows()[0].status,'pending');
  assert.strictEqual(injected.rows()[0].postRestoreIsolation,undefined);

  var verified=environment([operation(OP_ONE,'processing',2)],{
    [OP_ONE]:{ok:true,status:'not_found',data:{}}
  });
  var snapshotBefore=JSON.stringify(verified.rows()[0].snapshot);
  var completed=await verified.sandbox.FullBackupService
    .completePostRestoreCloudReview(verified.options);
  assert.strictEqual(completed.success,true,JSON.stringify({completed:completed,
    rows:verified.rows(),calls:verified.calls,links:verified.store.value(LINKS),
    marker:verified.store.value(MARKER)}));
  assert.strictEqual(verified.rows()[0].status,'discarded');
  assert.strictEqual(verified.rows()[0].operationId,OP_ONE);
  assert.strictEqual(JSON.stringify(verified.rows()[0].snapshot),snapshotBefore);
  assert.strictEqual(verified.rows()[0].postRestoreIsolation.proof,
    'server_not_found');
  assert.strictEqual(verified.calls.inspect,1);
  assert.strictEqual(verified.calls.upload+verified.calls.download+
    verified.calls.retry+verified.calls.schedule,0);

  var bound=environment([
    operation(OP_ONE,'processing',2),operation(OP_TWO,'processing',2)
  ],{
    [OP_ONE]:{ok:true,status:'not_found',data:{}},
    [OP_TWO]:{ok:false,status:'error',error:{code:'NETWORK_ERROR'}}
  });
  var blocked=await bound.sandbox.FullBackupService
    .completePostRestoreCloudReview(bound.options);
  assert.strictEqual(blocked.success,false);
  assert.strictEqual(blocked.errorCode,'FULL_RESTORE_QUEUE_REVIEW_REQUIRED');
  assert.strictEqual(bound.rows()[0].status,'discarded');
  assert.strictEqual(bound.rows()[0].postRestoreIsolation.operationId,OP_ONE);
  assert.strictEqual(bound.rows()[1].operationId,OP_TWO);
  assert.strictEqual(bound.rows()[1].status,'requires_reconciliation');
  assert.strictEqual(bound.rows()[1].postRestoreIsolation,undefined);
  assert.strictEqual(bound.calls.start,0);
  assert.ok(bound.store.value(MARKER));

  var staleOperation=operation(OP_ONE,'pending',2);
  staleOperation.postRestoreIsolation={operationId:OP_TWO,
    proof:'server_not_found',isolatedAt:'2026-08-25T00:00:00.000Z'};
  var stale=environment([staleOperation],{});
  var staleResult=await stale.sandbox.OfflineSyncQueue
    .isolatePostRestoreOperations({operationIds:[OP_ONE]});
  assert.strictEqual(staleResult.ok,false);

  var local=environment([operation(OP_ONE,'pending',0)],{});
  var localResult=await local.sandbox.OfflineSyncQueue
    .isolatePostRestoreOperations({operationIds:[OP_ONE]});
  assert.strictEqual(localResult.ok,true);
  assert.strictEqual(local.rows()[0].postRestoreIsolation.proof,
    'never_attempted');

  console.log('post-restore proof boundary integration tests: passed');
}

run().catch(function(error){console.error(error);process.exitCode=1;});
