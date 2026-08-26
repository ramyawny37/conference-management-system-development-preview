'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var diagnosticsSource=fs.readFileSync(path.join(
  root,'js/storage/snapshot-payload-diagnostics.js'),'utf8');
var repositorySource=fs.readFileSync(path.join(
  root,'js/storage/storage-repository.js'),'utf8');
var queueSource=fs.readFileSync(path.join(
  root,'js/sync/sync-queue.js'),'utf8');

var OPERATION_ID='11111111-1111-4111-8111-111111111111';
var CONFERENCE_ID='22222222-2222-4222-8222-222222222222';
var DEVICE_ID='33333333-3333-4333-8333-333333333333';

function clone(value){return JSON.parse(JSON.stringify(value));}
function load(source,sandbox,name){
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:name});
}
function request(result,error){
  var target={result:result,error:error||null};
  setImmediate(function(){
    if(error&&target.onerror)target.onerror();
    if(!error&&target.onsuccess)target.onsuccess();
  });
  return target;
}

function baseSandbox(){
  var sandbox={Promise:Promise,JSON:JSON,Object:Object,Array:Array,
    String:String,Number:Number,Date:Date,Error:Error,
    TextEncoder:TextEncoder,structuredClone:global.structuredClone,
    setImmediate:setImmediate};
  load(diagnosticsSource,sandbox,'snapshot-payload-diagnostics.js');
  return sandbox;
}

async function verifyRepositoryRecovery(){
  var sandbox=baseSandbox();
  var previous={conferenceId:'**app_snapshot**',data:{version:'old'},
    sizeBytes:17};
  var current=clone(previous);
  var remoteStarts=0;
  sandbox.AppIndexedDB={
    stores:{conferences:'conferences'},
    getAppSnapshot:function(){return Promise.resolve(clone(current));},
    saveAppSnapshot:function(snapshot){
      current={conferenceId:'**app_snapshot**',data:clone(snapshot)};
      return Promise.resolve({ok:true,status:'saved'});
    },
    putRecord:function(store,value){current=clone(value);return Promise.resolve();},
    deleteAppSnapshot:function(){current=null;return Promise.resolve();}
  };
  sandbox.OfflineFirstIntegration={handleLocalSave:function(){
    return Promise.resolve({ok:true,status:'skipped',
      data:{reason:'QUEUE_ENQUEUE_FAILED'}});
  }};
  sandbox.AutomaticSyncOrchestrator={wakeForLocalSave:function(){
    remoteStarts++;return {ok:true};
  }};
  load(repositorySource,sandbox,'storage-repository.js');
  var failure=null;
  try{
    await sandbox.StorageRepository.saveAppSnapshot({version:'new',
      conferences:[{id:'local',name:'not logged'}]});
  }catch(error){failure=error;}
  assert.strictEqual(failure.code,'SYNC_QUEUE_ENQUEUE_FAILED');
  assert.deepStrictEqual(current,previous);
  assert.strictEqual(remoteStarts,0);

  sandbox.AppIndexedDB.saveAppSnapshot=function(){
    var error=new Error('safe');
    error.code='LOCAL_STORAGE_QUOTA_EXCEEDED';
    return Promise.reject(error);
  };
  failure=null;
  try{await sandbox.StorageRepository.saveAppSnapshot({version:'quota'});}
  catch(error){failure=error;}
  assert.strictEqual(failure.code,'LOCAL_STORAGE_QUOTA_EXCEEDED');
  assert.deepStrictEqual(current,previous);
  assert.strictEqual(remoteStarts,0);

  var cyclic={conferences:[]};cyclic.self=cyclic;
  failure=null;
  try{await sandbox.StorageRepository.saveAppSnapshot(cyclic);}
  catch(error){failure=error;}
  assert.strictEqual(failure.code,'SNAPSHOT_SERIALIZATION_FAILED');
  assert.deepStrictEqual(current,previous);
  assert.strictEqual(remoteStarts,0);
}

async function verifyQueueAtomicFailure(){
  var sandbox=baseSandbox();
  var oldOperation={operationId:OPERATION_ID,conferenceId:CONFERENCE_ID,
    cloudConferenceId:CONFERENCE_ID,deviceId:DEVICE_ID,status:'pending',
    attempts:0,createdAt:'2026-08-26T10:00:00.000Z',baseRevision:4,
    snapshot:{version:'old'},schemaVersion:'1',appVersion:'test'};
  var rows=[clone(oldOperation)];
  var quota={name:'QuotaExceededError'};
  sandbox.crypto={randomUUID:function(){throw new Error('MUST_PRESERVE_ID');}};
  sandbox.AppIndexedDB={runTransaction:function(name,mode,callback){
    var before=clone(rows);
    var store={
      getAll:function(){return request(clone(rows));},
      put:function(){return request(null,quota);},
      add:function(){return request(null,quota);},
      delete:function(){throw new Error('DELETE_MUST_NOT_RUN');}
    };
    return Promise.resolve(callback((function(){var result={};
      result[name]=store;return result;})())).catch(function(error){
        rows=before;throw error;
      });
  }};
  load(queueSource,sandbox,'sync-queue.js');
  var nextSnapshot={version:'new',unicode:'أهلاً'};
  var result=await sandbox.OfflineSyncQueue.coalesceSnapshotOperation({
    operationId:OPERATION_ID,conferenceId:CONFERENCE_ID,
    deviceId:DEVICE_ID,baseRevision:4,snapshot:nextSnapshot,
    schemaVersion:'1',appVersion:'test'
  },{now:'2026-08-26T11:00:00.000Z'});
  assert.strictEqual(result.ok,false);
  assert.strictEqual(result.error.code,'SYNC_QUEUE_QUOTA_EXCEEDED');
  assert.deepStrictEqual(rows,[oldOperation]);
  assert.strictEqual(rows[0].operationId,OPERATION_ID);

  var inspected=sandbox.SnapshotPayloadDiagnostics.inspect(nextSnapshot);
  assert.strictEqual(inspected.ok,true);
  assert.strictEqual(inspected.sizeBytes,
    Buffer.byteLength(JSON.stringify(nextSnapshot),'utf8'));
  assert.deepStrictEqual(nextSnapshot,{version:'new',unicode:'أهلاً'});
}

async function verifyPostRestoreIsolation(){
  var sandbox=baseSandbox();
  var rows=[{operationId:OPERATION_ID,conferenceId:CONFERENCE_ID,
    deviceId:DEVICE_ID,status:'pending',attempts:0,
    snapshot:{version:'old',rooms:[{id:'room-1'}]}}];
  sandbox.AppIndexedDB={runTransaction:function(name,mode,callback){
    var before=clone(rows);
    var store={
      getAll:function(){return request(clone(rows));},
      put:function(value){
        rows[rows.findIndex(function(item){
          return item.operationId===value.operationId;
        })]=clone(value);
        return request(value);
      }
    };
    return Promise.resolve(callback((function(){var result={};
      result[name]=store;return result;})())).catch(function(error){
        rows=before;throw error;
      });
  }};
  load(queueSource,sandbox,'sync-queue.js');
  var isolated=await sandbox.OfflineSyncQueue.isolatePostRestoreOperations({
    operationIds:[OPERATION_ID]
  },{now:'2026-08-26T12:00:00.000Z'});
  assert.strictEqual(isolated.ok,true);
  assert.strictEqual(rows[0].status,'discarded');
  assert.strictEqual(rows[0].operationId,OPERATION_ID);
  assert.deepStrictEqual(rows[0].snapshot,
    {version:'old',rooms:[{id:'room-1'}]});
  assert.strictEqual(rows[0].postRestoreIsolation.proof,'never_attempted');

  rows[0].status='processing';rows[0].attempts=1;
  delete rows[0].postRestoreIsolation;
  var before=clone(rows);
  var rejected=await sandbox.OfflineSyncQueue.isolatePostRestoreOperations({
    operationIds:[OPERATION_ID]
  },{now:'2026-08-26T12:01:00.000Z'});
  assert.strictEqual(rejected.ok,false);
  assert.strictEqual(rejected.error.code,'OPERATION_NOT_PROVEN_UNEXECUTED');
  assert.deepStrictEqual(rows,before);

  rows[0].status='pending';rows[0].attempts=2;
  var verified=await sandbox.OfflineSyncQueue.isolatePostRestoreOperations({
    operationIds:[OPERATION_ID],verifiedMissingOperationIds:[OPERATION_ID]
  },{now:'2026-08-26T12:02:00.000Z'});
  assert.strictEqual(verified.ok,false);
  assert.strictEqual(verified.error.code,'OPERATION_NOT_PROVEN_UNEXECUTED');
  assert.strictEqual(rows[0].postRestoreIsolation,undefined);
  assert.strictEqual(rows[0].operationId,OPERATION_ID);
}

async function run(){
  await verifyRepositoryRecovery();
  await verifyQueueAtomicFailure();
  await verifyPostRestoreIsolation();
  console.log('snapshot payload and local quota diagnostics tests: passed');
}

run().catch(function(error){console.error(error);process.exitCode=1;});
