'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var records={};

function copy(value){
  return JSON.parse(JSON.stringify(value));
}

var indexedDb={
  getRecord:function(store,key){
    return Promise.resolve(records[store+'::'+key]||null);
  },
  putRecord:function(store,record){
    var key=record.backupId||record.localConferenceId;
    records[store+'::'+key]=copy(record);
    return Promise.resolve(record);
  },
  getAllRecords:function(store){
    return Promise.resolve(Object.keys(records).filter(function(key){
      return key.indexOf(store+'::')===0;
    }).map(function(key){return copy(records[key]);}));
  },
  deleteRecord:function(store,key){
    delete records[store+'::'+key];
    return Promise.resolve(true);
  }
};

var sandbox={
  window:null,
  Promise:Promise,
  JSON:JSON,
  Object:Object,
  String:String,
  Array:Array,
  Date:Date,
  Uint8Array:Uint8Array,
  TextEncoder:TextEncoder,
  crypto:require('crypto').webcrypto,
  structuredClone:global.structuredClone,
  AppIndexedDB:indexedDb
};
sandbox.window=sandbox;
[
  'js/sync/pending-remote-application-store.js',
  'js/sync/conflict-backup-store.js'
].forEach(function(file){
  vm.runInNewContext(
    fs.readFileSync(path.join(root,file),'utf8'),
    sandbox,
    {filename:file}
  );
});

async function run(){
  var input={
    localConferenceId:'local-1',
    remoteConferenceId:'remote-1',
    conflictId:'conflict-1',
    resolutionStrategy:'keep_server',
    resolutionOperationId:'operation-1',
    resolvedRevision:5,
    resolvedSnapshot:{id:'local-1',name:'Remote'}
  };
  var saved=await sandbox.PendingRemoteApplicationStore.save(input);
  assert.strictEqual(saved.ok,true);
  assert.deepStrictEqual(copy(saved.data.applicationState),{
    validationCompleted:false,
    backupStored:false,
    localSnapshotSaved:false,
    linkFinalized:false,
    pendingCompleted:false
  });
  var updated=await sandbox.PendingRemoteApplicationStore
    .updateApplicationState('local-1',{
      resolutionOperationId:'operation-1',
      patch:{validationCompleted:true}
    });
  assert.strictEqual(updated.data.applicationState.validationCompleted,true);
  assert.strictEqual(
    (await sandbox.PendingRemoteApplicationStore
      .updateApplicationState('local-1',{
        resolutionOperationId:'other',
        patch:{backupStored:true}
      })).status,
    'operation_mismatch'
  );
  var marked=await sandbox.PendingRemoteApplicationStore.mark(
    'local-1','applied'
  );
  assert.strictEqual(marked.data.applicationState.pendingCompleted,true);

  var backupInput={
    localConferenceId:'local-1',
    snapshot:{id:'local-1',name:'Local'},
    conflictId:'conflict-1',
    resolutionOperationId:'operation-1',
    resolvedRevision:5
  };
  var first=await sandbox.ConflictBackupStore.create(backupInput);
  var second=await sandbox.ConflictBackupStore.create(backupInput);
  assert.strictEqual(first.status,'created');
  assert.strictEqual(second.status,'duplicate');
  assert.strictEqual(first.data.backupId,second.data.backupId);
  assert.strictEqual(
    (await sandbox.ConflictBackupStore.list('local-1')).length,
    1
  );

  console.log('remote application stores phase 4 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
