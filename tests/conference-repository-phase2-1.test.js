'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var storageReads=0;
var sandbox={
  window:null,
  JSON:JSON,
  Object:Object,
  String:String,
  Number:Number,
  Array:Array,
  Error:Error,
  structuredClone:structuredClone,
  localStorage:{
    getItem:function(){storageReads++;throw new Error('UNEXPECTED_READ');},
    setItem:function(){throw new Error('UNEXPECTED_WRITE');}
  },
  AppIndexedDB:{
    getAppSnapshot:function(){
      throw new Error('UNEXPECTED_INDEXEDDB_READ');
    },
    saveAppSnapshot:function(){
      throw new Error('UNEXPECTED_INDEXEDDB_WRITE');
    }
  }
};
sandbox.window=sandbox;

vm.runInNewContext(
  fs.readFileSync(path.join(
    root,'js/storage/conference-repository.js'
  ),'utf8'),
  sandbox,
  {filename:'conference-repository.js'}
);

var repository=sandbox.ConferenceRepository;

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function conference(id){
  return {
    id:id,
    name:'Conference '+id,
    status:'active',
    nested:{value:1}
  };
}

function appData(items){
  return {
    version:'2.0.0',
    currentConferenceId:items.length?items[0].id:null,
    conferences:items,
    templates:[],
    archives:[]
  };
}

function hasIssue(result,code){
  return result.issues.some(function(item){return item.code===code;});
}

var contract=plain(repository.getContract());
assert.deepStrictEqual(contract,{
  schemaVersion:1,
  localLifecycles:['active','archived'],
  cloudLifecycles:[
    'unpublished',
    'local_only',
    'waiting_for_authorization',
    'ready_to_publish',
    'publishing',
    'cloud_linked',
    'publish_failed',
    'sync_suspended'
  ],
  repositoryProperty:'conferenceLifecycle',
  publishMetadataPhase:'2.2'
});

var created=repository.createLifecycleRecord({
  localConferenceId:'local-1'
});
assert.strictEqual(created.ok,true);
assert.deepStrictEqual(plain(created.data),{
  localConferenceId:'local-1',
  localLifecycle:'active',
  cloudLifecycle:'unpublished',
  localContentVersion:0,
  publishMetadata:null
});

var invalidState=repository.createLifecycleRecord({
  localConferenceId:'local-1',
  cloudLifecycle:'unknown'
});
assert.strictEqual(invalidState.ok,false);
assert.strictEqual(
  hasIssue(invalidState,'CLOUD_LIFECYCLE_INVALID'),
  true
);

var prematureMetadata=repository.validateLifecycleRecord({
  localConferenceId:'local-1',
  localLifecycle:'active',
  cloudLifecycle:'unpublished',
  localContentVersion:0,
  publishMetadata:{publishIntent:'none'}
},'local-1');
assert.strictEqual(prematureMetadata.ok,false);
assert.strictEqual(
  hasIssue(
    prematureMetadata,
    'PUBLISH_METADATA_NOT_SUPPORTED_IN_PHASE_2_1'
  ),
  true
);

var emptySource=appData([]);
var emptyBefore=JSON.stringify(emptySource);
var emptyPrepared=repository.prepareAppData(emptySource);
assert.strictEqual(emptyPrepared.ok,true);
assert.strictEqual(emptyPrepared.status,'prepared');
assert.strictEqual(JSON.stringify(emptySource),emptyBefore);
assert.deepStrictEqual(
  plain(emptyPrepared.data.conferenceLifecycle),
  {schemaVersion:1,records:{}}
);

var legacy=appData([conference('local-1'),conference('local-2')]);
var legacyBefore=JSON.stringify(legacy);
var unclassified=repository.prepareAppData(legacy);
assert.strictEqual(unclassified.ok,false);
assert.strictEqual(unclassified.status,'classification_required');
assert.strictEqual(unclassified.issues.length,2);
assert.strictEqual(JSON.stringify(legacy),legacyBefore);

var classified=repository.prepareAppData(legacy,{
  classifyConference:function(item,id){
    item.nested.value=99;
    return {
      localLifecycle:id==='local-2'?'archived':'active',
      cloudLifecycle:id==='local-1'?'cloud_linked':'unpublished',
      localContentVersion:id==='local-1'?4:0
    };
  }
});
assert.strictEqual(classified.ok,true);
assert.strictEqual(classified.status,'prepared');
assert.strictEqual(JSON.stringify(legacy),legacyBefore);
assert.strictEqual(legacy.conferences[0].nested.value,1);
assert.deepStrictEqual(
  plain(classified.data.conferenceLifecycle.records['local-1']),
  {
    localConferenceId:'local-1',
    localLifecycle:'active',
    cloudLifecycle:'cloud_linked',
    localContentVersion:4,
    publishMetadata:null
  }
);
assert.deepStrictEqual(
  plain(classified.data.conferenceLifecycle.records['local-2']),
  {
    localConferenceId:'local-2',
    localLifecycle:'archived',
    cloudLifecycle:'unpublished',
    localContentVersion:0,
    publishMetadata:null
  }
);

classified.data.conferences[0].name='Changed';
assert.strictEqual(legacy.conferences[0].name,'Conference local-1');

var alreadyPrepared=repository.prepareAppData(classified.data);
assert.strictEqual(alreadyPrepared.ok,true);
assert.strictEqual(alreadyPrepared.status,'already_prepared');
alreadyPrepared.data.conferenceLifecycle.records['local-1']
  .localContentVersion=20;
assert.strictEqual(
  classified.data.conferenceLifecycle.records['local-1']
    .localContentVersion,
  4
);

var found=repository.getLifecycle(classified.data,'local-1');
assert.strictEqual(found.ok,true);
assert.strictEqual(found.status,'found');
found.data.localContentVersion=100;
assert.strictEqual(
  classified.data.conferenceLifecycle.records['local-1']
    .localContentVersion,
  4
);

var duplicate=appData([conference('same'),conference('same')]);
var duplicateResult=repository.prepareAppData(duplicate,{
  classifyConference:function(){
    return {cloudLifecycle:'unpublished'};
  }
});
assert.strictEqual(duplicateResult.ok,false);
assert.strictEqual(
  hasIssue(duplicateResult,'CONFERENCE_ID_DUPLICATE'),
  true
);

var corrupted=plain(classified.data);
corrupted.conferenceLifecycle.records['local-1'].cloudLifecycle='bad';
var corruptedResult=repository.prepareAppData(corrupted);
assert.strictEqual(corruptedResult.ok,false);
assert.strictEqual(
  hasIssue(corruptedResult,'CLOUD_LIFECYCLE_INVALID'),
  true
);

var orphaned=plain(classified.data);
orphaned.conferenceLifecycle.records.orphan={
  localConferenceId:'orphan',
  localLifecycle:'active',
  cloudLifecycle:'unpublished',
  localContentVersion:0,
  publishMetadata:null
};
var orphanResult=repository.prepareAppData(orphaned);
assert.strictEqual(orphanResult.ok,false);
assert.strictEqual(hasIssue(orphanResult,'ORPHAN_LIFECYCLE_RECORD'),true);

assert.strictEqual(storageReads,0);

var indexSource=fs.readFileSync(path.join(root,'index.html'),'utf8');
var workerSource=fs.readFileSync(
  path.join(root,'service-worker.js'),'utf8'
);
assert.ok(
  indexSource.indexOf('js/storage/storage-repository.js')<
  indexSource.indexOf('js/storage/conference-repository.js')
);
assert.ok(
  indexSource.indexOf('js/storage/conference-repository.js')<
  indexSource.indexOf('js/storage/full-backup.js')
);
assert.match(workerSource,/js\/storage\/conference-repository\.js/);

console.log('conference repository phase 2.1 tests: passed');
