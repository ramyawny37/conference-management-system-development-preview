'use strict';

var assert=require('assert');
var crypto=require('crypto');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/device-rescue-export.js'
),'utf8');

function clone(value){return JSON.parse(JSON.stringify(value));}

function environment(options){
  options=options||{};
  var localId='local-conference-a';
  var remoteId='22222222-2222-4222-8222-222222222222';
  var conflictId='33333333-3333-4333-8333-333333333333';
  var writes=0;
  var conference={
    id:localId,name:'Conference',peopleDb:{people:[{id:'p1'}]},
    transports:[{id:'transport-iphone'}],houses:[]
  };
  var records={
    sync_operations_queue:[{
      operationId:'operation-a',conferenceId:remoteId,status:'conflict',
      snapshot:{transports:[{id:'transport-iphone'}]}
    }],
    conflicts:[{conflictId:conflictId,conferenceId:remoteId,
      localSnapshot:{peopleDb:{people:[{id:'p1'}]}},serverSnapshot:{houses:[]}}],
    conflict_resolution_drafts:[{localConferenceId:localId,
      conflictId:conflictId,plan:{resolvedSnapshot:{houses:[]}}}],
    pending_remote_applications:[{localConferenceId:localId,
      resolvedSnapshot:{transports:[{id:'server-transport'}]}}],
    pending_operations:[{operationId:'legacy-a',conferenceId:localId,
      snapshot:{legacy:true}}],
    conflict_resolution_backups:[{backupId:'backup-a',localConferenceId:localId,
      snapshot:{peopleDb:{people:[{id:'p0'}]}}}],
    sync_metadata:[{conferenceId:remoteId,baseRevision:8}]
  };
  var before=clone(records);
  var repository={
    getAllRecords:function(store){
      if(options.failedStore===store)return Promise.reject(new Error('blocked store'));
      return Promise.resolve(clone(records[store]||[]));
    },
    getRecord:function(store,key){
      assert.strictEqual(store,'conferences');
      assert.strictEqual(key,'**app_snapshot**');
      return Promise.resolve({data:{conferences:[clone(conference)]},
        snapshot:{stored:true}});
    },
    putRecord:function(){writes++;return Promise.resolve();},
    deleteRecord:function(){writes++;return Promise.resolve();},
    clearStore:function(){writes++;return Promise.resolve();},
    runTransaction:function(store,mode){
      if(mode!=='readonly')writes++;
      return Promise.resolve();
    }
  };
  var sandbox={
    window:null,JSON:JSON,Object:Object,String:String,Array:Array,
    Promise:Promise,Date:Date,Uint8Array:Uint8Array,TextEncoder:TextEncoder,
    structuredClone:clone,
    crypto:{subtle:{digest:function(algorithm,bytes){
      assert.strictEqual(algorithm,'SHA-256');
      var digest=crypto.createHash('sha256').update(Buffer.from(bytes)).digest();
      return Promise.resolve(digest.buffer.slice(
        digest.byteOffset,digest.byteOffset+digest.byteLength
      ));
    }}},
    navigator:{platform:'iPhone',userAgent:'test-agent'},
    APP_RELEASE:{version:'3.1.1'},
    AppIndexedDB:repository,
    appData:{currentConferenceId:localId,conferences:[conference]},
    getCurrentConference:function(){return conference;},
    ConferenceLinkStore:{get:function(){return {
      localConferenceId:localId,remoteConferenceId:remoteId,
      linkStatus:'needs_resolution',conflictId:conflictId,
      sessionToken:'must-not-export'
    };}},
    OfflineFirstIntegration:{getConferenceSyncState:function(){return {
      context:{localConferenceId:localId,conferenceId:remoteId,baseRevision:8},
      accessToken:'must-not-export'
    };}},
    MemberRuntimeDiagnostics:{read:function(){return {
      persistentLinkStatusWriteTrace:[{nextLinkStatus:'needs_resolution'}]
    };}},
    SupabaseDeviceIdentity:{getCurrent:function(){return {
      id:'11111111-1111-4111-8111-111111111111',deviceName:'My iPhone',
      platform:'iPhone'
    };}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'device-rescue-export.js'});
  return {
    sandbox:sandbox,records:records,before:before,
    writes:function(){return writes;}
  };
}

(async function run(){
  var full=environment();
  var bundle=await full.sandbox.DeviceRescueExport.createBundle();
  assert.strictEqual(bundle.bundleType,'conference-device-rescue-bundle');
  assert.strictEqual(bundle.conferenceLink.linkStatus,'needs_resolution');
  assert.strictEqual(bundle.stores.sync_operations_queue.records.length,1);
  assert.strictEqual(bundle.stores.conflicts.records.length,1);
  assert.strictEqual(bundle.stores.conflict_resolution_drafts.records.length,1);
  assert.strictEqual(bundle.stores.pending_remote_applications.records.length,1);
  assert.strictEqual(bundle.stores.pending_operations.records.length,1);
  assert.strictEqual(bundle.stores.conflict_resolution_backups.records.length,1);
  assert.strictEqual(bundle.stores.sync_metadata.records.length,1);
  assert.ok(bundle.snapshotHashes.length>=8,'every embedded snapshot must be hashed');
  bundle.snapshotHashes.forEach(function(item){
    assert.match(item.hash,/^[0-9a-f]{64}$/);
  });
  assert.strictEqual(JSON.stringify(bundle).includes('must-not-export'),false);
  assert.strictEqual(bundle.conferenceLink.sessionToken,'[REDACTED]');
  assert.strictEqual(bundle.syncContext.accessToken,'[REDACTED]');
  assert.strictEqual(full.writes(),0,'export must perform zero storage writes');
  assert.deepStrictEqual(full.records,full.before,
    'all synchronization stores must remain byte-equivalent after export');
  var name=full.sandbox.DeviceRescueExport.fileName(bundle);
  assert.ok(name.includes('my-iphone'));
  assert.strictEqual(name.includes('11111111-1111-4111-8111-111111111111'),false,
    'file name must not expose the complete device UUID');

  var partial=environment({failedStore:'conflicts'});
  var partialBundle=await partial.sandbox.DeviceRescueExport.createBundle();
  assert.strictEqual(partialBundle.stores.conflicts.ok,false);
  assert.strictEqual(partialBundle.stores.sync_operations_queue.ok,true);
  assert.strictEqual(partialBundle.readErrors.length,1);
  assert.strictEqual(partial.writes(),0);
  assert.deepStrictEqual(partial.records,partial.before);

  console.log('device rescue export tests: passed');
})().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
