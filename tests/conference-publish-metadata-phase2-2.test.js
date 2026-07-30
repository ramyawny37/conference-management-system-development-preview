'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var externalCalls=0;
var sandbox={
  window:null,
  JSON:JSON,
  Object:Object,
  String:String,
  Number:Number,
  Array:Array,
  Error:Error,
  Date:Date,
  structuredClone:structuredClone,
  localStorage:{
    getItem:unexpected,
    setItem:unexpected
  },
  indexedDB:{open:unexpected},
  save:unexpected,
  SupabaseClientLayer:{getClient:unexpected},
  SyncQueue:{enqueue:unexpected},
  RealtimeManager:{connect:unexpected},
  AutomaticConferenceLinking:{start:unexpected}
};
sandbox.window=sandbox;

function unexpected(){
  externalCalls++;
  throw new Error('UNEXPECTED_EXTERNAL_CALL');
}

function load(relativePath){
  vm.runInNewContext(
    fs.readFileSync(path.join(root,relativePath),'utf8'),
    sandbox,
    {filename:relativePath}
  );
}

load('js/storage/conference-repository.js');
load('js/storage/conference-publish-manager.js');

var repository=sandbox.ConferenceRepository;
var manager=sandbox.ConferencePublishManager;
var userA='11111111-1111-4111-8111-111111111111';
var userB='22222222-2222-4222-8222-222222222222';
var requestedAt='2026-07-30T10:00:00.000Z';
var checkedAt='2026-07-30T10:01:00.000Z';

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function hasIssue(value,code){
  return value.issues.some(function(item){return item.code===code;});
}

function access(overrides){
  return Object.assign({
    userId:userA,
    checkedAt:checkedAt,
    source:'server',
    fresh:true,
    authenticated:true,
    accountStatus:'approved',
    canCreateConferences:true,
    isSystemOwner:false
  },overrides||{});
}

function record(){
  return repository.createLifecycleRecord({
    localConferenceId:'local-1'
  }).data;
}

function request(source,overrides){
  return manager.transitionLifecycleRecord(
    source,'request_publish',Object.assign({
      requestedAt:requestedAt,
      requestedByUserId:userA,
      requestedByDeviceId:'device-a'
    },overrides||{})
  );
}

assert.deepStrictEqual(plain(manager.getContract()),{
  metadataVersion:1,
  publishIntents:['none','local_only','publish_requested'],
  phaseStates:[
    'unpublished',
    'local_only',
    'waiting_for_authorization',
    'ready_to_publish',
    'publishing',
    'publish_failed'
  ],
  accessSources:['server','cache'],
  recoveryStates:[
    'reconciliation_required',
    'reconciling',
    'retryable_same_operation',
    'manual_review_required',
    'reconciliation_failed'
  ]
});

var defaults=manager.createMetadata().data;
assert.deepStrictEqual(plain(defaults),{
  metadataVersion:1,
  publishIntent:'none',
  requestedAt:null,
  requestedByUserId:null,
  requestedByDeviceId:null,
  lastAccessCheck:null,
  reviewRequired:false,
  reviewReason:null,
  confirmationAt:null,
  operationId:null,
  requestedCloudId:null,
  attemptStartedAt:null,
  lastAttemptAt:null,
  lastPublishStage:null,
  lastPublishError:null,
  snapshotContentVersion:null,
  currentContentVersion:null,
  reconciliationState:null,
  retryCount:0,
  retryAfter:null,
  lastReconciliationAt:null,
  contentChangedBeforeInitialSnapshot:false
});
assert.strictEqual(
  manager.validateMetadata(defaults,'unpublished').ok,true
);

var kept=manager.transitionLifecycleRecord(record(),'keep_local');
assert.strictEqual(kept.ok,true);
assert.strictEqual(kept.data.cloudLifecycle,'local_only');
assert.strictEqual(kept.data.publishMetadata.publishIntent,'local_only');
assert.strictEqual(
  manager.validateMetadata(
    kept.data.publishMetadata,'local_only'
  ).ok,
  true
);

var waiting=request(record());
assert.strictEqual(waiting.ok,true);
assert.strictEqual(
  waiting.data.cloudLifecycle,'waiting_for_authorization'
);
assert.strictEqual(
  waiting.data.publishMetadata.publishIntent,'publish_requested'
);

var ready=manager.transitionLifecycleRecord(
  waiting.data,'authorize',{accessCheck:access()}
);
assert.strictEqual(ready.ok,true);
assert.strictEqual(ready.data.cloudLifecycle,'ready_to_publish');
assert.strictEqual(
  manager.validateMetadata(
    ready.data.publishMetadata,'ready_to_publish'
  ).ok,
  true
);

var invalidated=manager.transitionLifecycleRecord(
  ready.data,'invalidate_authorization',
  {accessCheck:access({
    source:'cache',
    fresh:false
  })}
);
assert.strictEqual(invalidated.ok,true);
assert.strictEqual(
  invalidated.data.cloudLifecycle,'waiting_for_authorization'
);

var cancelled=manager.transitionLifecycleRecord(
  invalidated.data,'cancel_publish',{returnTo:'unpublished'}
);
assert.strictEqual(cancelled.ok,true);
assert.strictEqual(cancelled.data.cloudLifecycle,'unpublished');
assert.strictEqual(cancelled.data.publishMetadata.publishIntent,'none');

var localWaiting=request(kept.data);
assert.strictEqual(localWaiting.ok,true);
var localCancelled=manager.transitionLifecycleRecord(
  localWaiting.data,'cancel_publish',{returnTo:'local_only'}
);
assert.strictEqual(localCancelled.ok,true);
assert.strictEqual(localCancelled.data.cloudLifecycle,'local_only');

var offline=request(record());
assert.strictEqual(offline.ok,true);
assert.strictEqual(offline.data.publishMetadata.lastAccessCheck,null);

var pending=request(record(),{
  accessCheck:access({
    accountStatus:'pending',
    canCreateConferences:false
  })
});
assert.strictEqual(pending.ok,true);
assert.strictEqual(
  manager.transitionLifecycleRecord(
    pending.data,'authorize',{accessCheck:access({
      accountStatus:'pending',
      canCreateConferences:false
    })}
  ).status,
  'account_pending'
);

var noPermission=manager.transitionLifecycleRecord(
  waiting.data,'authorize',{accessCheck:access({
    canCreateConferences:false
  })}
);
assert.strictEqual(noPermission.ok,false);
assert.strictEqual(noPermission.status,'conference_creation_not_allowed');

var owner=manager.transitionLifecycleRecord(
  waiting.data,'authorize',{accessCheck:access({
    canCreateConferences:false,
    isSystemOwner:true
  })}
);
assert.strictEqual(owner.ok,true);

var blocked=manager.transitionLifecycleRecord(
  waiting.data,'authorize',{accessCheck:access({
    accountStatus:'blocked'
  })}
);
assert.strictEqual(blocked.ok,false);
assert.strictEqual(blocked.status,'account_blocked');

var cached=manager.transitionLifecycleRecord(
  waiting.data,'authorize',{accessCheck:access({
    source:'cache',
    fresh:false
  })}
);
assert.strictEqual(cached.ok,false);
assert.strictEqual(cached.status,'fresh_server_access_required');

var changedUser=manager.transitionLifecycleRecord(
  waiting.data,'authorize',{accessCheck:access({userId:userB})}
);
assert.strictEqual(changedUser.ok,false);
assert.strictEqual(changedUser.status,'requesting_user_changed');
assert.strictEqual(changedUser.data.record.publishMetadata.reviewRequired,true);
assert.strictEqual(
  changedUser.data.record.publishMetadata.reviewReason,
  'requesting_user_changed'
);
assert.strictEqual(
  waiting.data.publishMetadata.reviewRequired,false
);

[
  manager.transitionLifecycleRecord(record(),'authorize',{
    accessCheck:access()
  }),
  manager.transitionLifecycleRecord(ready.data,'cancel_publish',{
    returnTo:'unpublished'
  }),
  manager.transitionLifecycleRecord(waiting.data,'keep_local'),
  manager.transitionLifecycleRecord(record(),'not_an_action')
].forEach(function(value){
  assert.strictEqual(value.ok,false);
});

var wrongIntent=plain(defaults);
wrongIntent.publishIntent='unknown';
assert.strictEqual(
  hasIssue(
    manager.validateMetadata(wrongIntent,'unpublished'),
    'PUBLISH_INTENT_INVALID'
  ),
  true
);
var wrongVersion=plain(defaults);
wrongVersion.metadataVersion=2;
assert.strictEqual(
  hasIssue(
    manager.validateMetadata(wrongVersion,'unpublished'),
    'PUBLISH_METADATA_VERSION_UNSUPPORTED'
  ),
  true
);
var unknownField=plain(defaults);
unknownField.automaticRetry=true;
assert.strictEqual(
  hasIssue(
    manager.validateMetadata(unknownField,'unpublished'),
    'PUBLISH_METADATA_FIELD_UNKNOWN'
  ),
  true
);
assert.strictEqual(
  hasIssue(
    manager.validateMetadata(defaults,'unknown_state'),
    'PUBLISH_STATE_NOT_SUPPORTED_IN_PHASE_2_2'
  ),
  true
);

var source={
  conferences:[{
    id:'local-1',
    name:'Conference',
    nested:{value:1}
  }],
  conferenceLifecycle:{
    schemaVersion:1,
    records:{'local-1':record()}
  }
};
var sourceBefore=JSON.stringify(source);
var appTransition=manager.transitionAppData(
  source,'local-1','keep_local'
);
assert.strictEqual(appTransition.ok,true);
assert.strictEqual(JSON.stringify(source),sourceBefore);
appTransition.data.conferences[0].nested.value=9;
assert.strictEqual(source.conferences[0].nested.value,1);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(
    appTransition.data.conferences[0],'publishMetadata'
  ),
  false
);
assert.strictEqual(
  appTransition.data.conferenceLifecycle.records['local-1']
    .publishMetadata.publishIntent,
  'local_only'
);
assert.strictEqual(
  ready.data.publishMetadata.operationId,
  null
);
assert.strictEqual(
  ready.data.publishMetadata.requestedCloudId,
  null
);
assert.strictEqual(
  repository.validateLifecycleRecord(
    ready.data,'local-1'
  ).ok,
  true
);

var indexSource=fs.readFileSync(path.join(root,'index.html'),'utf8');
var workerSource=fs.readFileSync(
  path.join(root,'service-worker.js'),'utf8'
);
assert.ok(
  indexSource.indexOf('js/storage/conference-repository.js')<
  indexSource.indexOf('js/storage/conference-publish-manager.js')
);
assert.ok(
  indexSource.indexOf('js/storage/conference-publish-manager.js')<
  indexSource.indexOf('js/storage/full-backup.js')
);
assert.match(
  workerSource,/js\/storage\/conference-publish-manager\.js/
);
assert.strictEqual(externalCalls,0);

console.log('conference publish metadata phase 2.2 tests: passed');
