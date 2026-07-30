'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var userId='11111111-1111-4111-8111-111111111111';
var otherUser='22222222-2222-4222-8222-222222222222';
var operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
var cloudId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
var otherCloudId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
var now='2026-07-30T13:00:00.000Z';

function source(file){
  return fs.readFileSync(path.join(root,file),'utf8');
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function environment(settings){
  settings=settings||{};
  var calls={
    inspectOperation:0,
    create:0,
    membership:0,
    inspectSnapshot:0,
    upload:0,
    persist:0,
    queue:0,
    realtime:0
  };
  var current;
  var links=Object.create(null);
  var sandbox={
    window:null,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Error:Error,
    Date:Date,
    Promise:Promise,
    structuredClone:structuredClone,
    navigator:{onLine:settings.online!==false},
    SupabaseAuth:{
      getSession:function(){
        return {user:{id:settings.userId||userId}};
      },
      getState:function(){return {authenticated:true};}
    },
    SystemAccessService:{
      refresh:function(){
        return Promise.resolve(Object.assign({
          authenticated:true,
          profileLoaded:true,
          fresh:true,
          source:'server',
          userId:settings.userId||userId,
          accountStatus:'approved',
          canCreateConferences:true,
          isSystemOwner:false,
          checkedAt:now
        },settings.access||{}));
      }
    },
    FullBackupService:{
      getFullRestoreCloudReviewMarker:function(){
        return {pending:settings.restoreMarker===true};
      },
      isManualRelinkRequired:function(){
        return settings.manualRelink===true;
      }
    },
    ConferenceLinkStore:{
      inspect:function(){
        return settings.corruptLinks
          ?{ok:false,status:'malformed'}
          :{ok:true,status:'read',data:plain(links)};
      },
      get:function(id){return links[id]||null;},
      save:function(input){
        if(settings.linkSaveFails){
          return {ok:false,status:'storage_error'};
        }
        links[input.localConferenceId]=plain(input);
        return {ok:true,status:'saved',data:plain(input)};
      }
    },
    SupabaseSnapshotSync:{
      inspectConferenceCreationOperation:function(input){
        calls.inspectOperation++;
        if(settings.inspectionGate)return settings.inspectionGate.promise;
        if(settings.operationResult){
          return Promise.resolve(settings.operationResult);
        }
        return Promise.resolve({
          ok:true,
          status:settings.operationMissing?'not_found':'created',
          data:settings.operationMissing?{
            operationId:input.operationId,
            requestedConferenceId:input.requestedConferenceId
          }:{
            userId:userId,
            operationId:input.operationId,
            conferenceId:input.requestedConferenceId
          }
        });
      },
      createConferenceIdempotent:function(input){
        calls.create++;
        calls.creationInput=plain(input);
        return Promise.resolve(settings.createResult||{
          ok:true,status:'duplicate',data:{
            operationId:input.operationId,
            conferenceId:input.requestedConferenceId
          }
        });
      },
      verifyOwnerMembership:function(){
        calls.membership++;
        return Promise.resolve(settings.membershipResult||{
          ok:true,status:'owner_verified'
        });
      },
      inspectInitialSnapshot:function(){
        calls.inspectSnapshot++;
        return Promise.resolve(settings.snapshotResult||{
          ok:true,
          status:settings.snapshotMissing?'not_found':'found',
          data:settings.snapshotMissing
            ?{conferenceId:cloudId}
            :{conferenceId:cloudId,revision:4}
        });
      },
      uploadInitialSnapshot:function(input){
        calls.upload++;
        calls.uploadInput=plain(input);
        if(settings.changeBeforeUpload){
          current.conferences[0].name='Changed before first snapshot';
          current.conferenceLifecycle.records['local-1']
            .localContentVersion=3;
        }
        return Promise.resolve(settings.uploadResult||{
          ok:true,status:'applied',
          data:{revision:1,operationId:input.operationId}
        });
      }
    },
    SyncQueue:{enqueue:function(){calls.queue++;}},
    RealtimeManager:{connect:function(){calls.realtime++;}}
  };
  sandbox.window=sandbox;
  [
    'js/storage/conference-repository.js',
    'js/storage/conference-publishing-engine.js',
    'js/storage/conference-publish-recovery.js',
    'js/storage/conference-publish-manager.js'
  ].forEach(function(file){
    vm.runInNewContext(source(file),sandbox,{filename:file});
  });
  var metadata=sandbox.ConferencePublishManager.createMetadata({
    publishIntent:'publish_requested',
    requestedAt:now,
    requestedByUserId:userId,
    requestedByDeviceId:'device-a',
    lastAccessCheck:{
      userId:userId,
      checkedAt:now,
      source:'server',
      fresh:true,
      authenticated:true,
      accountStatus:'approved',
      canCreateConferences:true,
      isSystemOwner:false
    },
    confirmationAt:now,
    operationId:operationId,
    requestedCloudId:cloudId,
    attemptStartedAt:now,
    lastAttemptAt:now,
    lastPublishStage:'conference_creation',
    lastPublishError:{
      code:'NETWORK_ERROR',
      stage:'conference_creation',
      remoteCode:'NETWORK_ERROR'
    },
    snapshotContentVersion:2,
    currentContentVersion:2,
    reconciliationState:'reconciliation_required',
    retryCount:settings.retryCount||0,
    retryAfter:settings.retryAfter||null,
    lastReconciliationAt:null
  }).data;
  if(settings.corruptMetadata)metadata.operationId='invalid';
  current={
    version:'5.0.0',
    conferences:[{
      id:'local-1',
      name:'Local conference',
      nested:{value:1}
    }],
    conferenceLifecycle:{
      schemaVersion:1,
      records:{
        'local-1':{
          localConferenceId:'local-1',
          localLifecycle:settings.archived?'archived':'active',
          cloudLifecycle:settings.lifecycle||'publish_failed',
          localContentVersion:2,
          publishMetadata:metadata
        }
      }
    }
  };
  if(settings.preexistingContentChange){
    current.conferences[0].name='Changed before first snapshot';
    current.conferenceLifecycle.records['local-1']
      .localContentVersion=3;
  }
  if(settings.link!==false){
    links['local-1']=Object.assign({
      localConferenceId:'local-1',
      remoteConferenceId:settings.linkCloudId||cloudId,
      knownRevision:settings.linkStatus==='cloud_linked'?4:0,
      linkStatus:settings.linkStatus||'linking',
      initialOperationId:operationId
    },settings.link||{});
  }
  var original=current;
  var options={
    navigator:sandbox.navigator,
    clock:function(){return now;},
    getCurrentAppData:function(){return current;},
    applyAppData:function(value){current=value;},
    persistAppData:function(value){
      calls.persist++;
      if(settings.persistFailureAt===calls.persist){
        return Promise.reject(new Error('PERSIST_FAILED'));
      }
      return Promise.resolve(value);
    },
    appVersion:'5.0.0',
    schemaVersion:'1'
  };
  return {
    sandbox:sandbox,
    recovery:sandbox.ConferencePublishRecovery,
    manager:sandbox.ConferencePublishManager,
    calls:calls,
    links:links,
    original:original,
    options:options,
    current:function(){return current;}
  };
}

async function reconcile(env){
  return env.manager.reconcileConference(
    env.original,'local-1',env.options
  );
}

async function run(){
  var tableSandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Error:Error,
    Date:Date,
    Uint8Array:Uint8Array,
    structuredClone:structuredClone,
    SupabaseAuth:{getSession:function(){
      return {user:{id:userId}};
    }},
    SupabaseClientLayer:{getClient:function(){
      return {from:function(table){
        var query={
          select:function(){return query;},
          eq:function(){return query;},
          maybeSingle:function(){
            if(table==='conference_creation_operations'){
              return Promise.resolve({data:{
                user_id:userId,
                operation_id:operationId,
                conference_id:cloudId,
                created_at:now,
                updated_at:now
              },error:null});
            }
            if(table==='conference_snapshots'){
              return Promise.resolve({data:{
                conference_id:cloudId,
                revision:7,
                schema_version:'1',
                app_version:'5.0.0',
                updated_at:now
              },error:null});
            }
            throw new Error('UNEXPECTED_TABLE');
          }
        };
        return query;
      }};
    }}
  };
  tableSandbox.window=tableSandbox;
  vm.runInNewContext(
    source('js/supabase/snapshot-sync.js'),
    tableSandbox
  );
  var inspectedOperation=await tableSandbox.SupabaseSnapshotSync
    .inspectConferenceCreationOperation({
      operationId:operationId,
      requestedConferenceId:cloudId,
      userId:userId
    });
  assert.strictEqual(inspectedOperation.status,'created');
  assert.strictEqual(
    inspectedOperation.data.conferenceId,cloudId
  );
  var inspectedSnapshot=await tableSandbox.SupabaseSnapshotSync
    .inspectInitialSnapshot(cloudId);
  assert.strictEqual(inspectedSnapshot.status,'found');
  assert.strictEqual(inspectedSnapshot.data.revision,7);

  ['unpublished','local_only','waiting_for_authorization',
    'ready_to_publish'].forEach(function(state){
    var ignored=environment({lifecycle:state,link:false});
    var scan=ignored.manager.scanRecoveryCandidates(
      ignored.original,ignored.options
    );
    assert.strictEqual(scan.ok,true);
    assert.strictEqual(scan.data.candidates.length,0);
    assert.strictEqual(ignored.calls.inspectOperation,0);
  });
  var archived=environment({archived:true});
  assert.strictEqual(
    archived.recovery.scanCandidates(
      archived.original,archived.options
    ).data.candidates.length,
    0
  );

  var pending=environment();
  var pendingScan=pending.recovery.scanCandidates(
    pending.original,pending.options
  );
  assert.strictEqual(pendingScan.data.candidates.length,1);
  assert.strictEqual(pendingScan.data.cloudWritesStarted,false);
  assert.strictEqual(pending.calls.inspectOperation,0);
  assert.strictEqual(pending.calls.create,0);

  var existing=environment();
  var existingResult=await reconcile(existing);
  assert.strictEqual(existingResult.status,'cloud_linked');
  assert.strictEqual(existing.calls.create,0);
  assert.strictEqual(existing.calls.upload,0);
  assert.strictEqual(existing.calls.membership,1);
  assert.strictEqual(existing.calls.inspectSnapshot,1);
  assert.strictEqual(existing.links['local-1'].knownRevision,4);
  assert.strictEqual(
    existing.current().conferenceLifecycle.records['local-1']
      .cloudLifecycle,
    'cloud_linked'
  );

  var absent=environment({
    operationMissing:true,
    snapshotMissing:true
  });
  var absentResult=await reconcile(absent);
  assert.strictEqual(absentResult.ok,true);
  assert.strictEqual(absent.calls.create,1);
  assert.strictEqual(absent.calls.upload,1);
  assert.strictEqual(
    absent.calls.creationInput.operationId,operationId
  );
  assert.strictEqual(
    absent.calls.creationInput.requestedConferenceId,cloudId
  );
  assert.strictEqual(
    absent.calls.uploadInput.operationId,operationId
  );

  var ambiguousCreation=environment({
    operationMissing:true,
    createResult:{
      ok:false,
      status:'error',
      error:{code:'NETWORK_ERROR'}
    }
  });
  var ambiguousResult=await reconcile(ambiguousCreation);
  assert.strictEqual(
    ambiguousResult.status,'conference_creation_result_unknown'
  );
  assert.strictEqual(
    ambiguousResult.recovery,'requires_reconciliation'
  );
  assert.strictEqual(
    ambiguousCreation.current().conferenceLifecycle
      .records['local-1'].publishMetadata.operationId,
    operationId
  );

  var noSnapshot=environment({snapshotMissing:true});
  assert.strictEqual((await reconcile(noSnapshot)).ok,true);
  assert.strictEqual(noSnapshot.calls.create,0);
  assert.strictEqual(noSnapshot.calls.upload,1);

  var changed=environment({
    snapshotMissing:true,
    preexistingContentChange:true
  });
  var changedResult=await reconcile(changed);
  assert.strictEqual(
    changedResult.status,'cloud_linked_local_changes_pending'
  );
  assert.strictEqual(
    changed.current().conferences[0].name,
    'Changed before first snapshot'
  );
  assert.strictEqual(
    changed.calls.uploadInput.snapshot.name,
    'Changed before first snapshot'
  );
  assert.strictEqual(
    changed.links['local-1'].syncState.pendingLocalChanges,true
  );

  var finalOnly=environment({linkStatus:'cloud_linked'});
  assert.strictEqual((await reconcile(finalOnly)).ok,true);
  assert.strictEqual(finalOnly.calls.create,0);
  assert.strictEqual(finalOnly.calls.upload,0);

  for(var item of [
    {
      settings:{membershipResult:{
        ok:false,status:'owner_not_verified'
      }},
      status:'membership_verification_failed'
    },
    {
      settings:{operationResult:{
        ok:false,status:'integrity_conflict',
        error:{code:'CONFERENCE_ID_MISMATCH'}
      }},
      status:'integrity_conflict'
    },
    {
      settings:{userId:otherUser},
      status:'requesting_user_changed'
    },
    {
      settings:{access:{source:'cache',fresh:false}},
      status:'fresh_authorization_required'
    },
    {
      settings:{access:{accountStatus:'pending'}},
      status:'account_pending'
    },
    {
      settings:{access:{accountStatus:'blocked'}},
      status:'account_blocked'
    },
    {settings:{online:false},status:'offline'},
    {
      settings:{restoreMarker:true},
      status:'cloud_isolation_active'
    },
    {
      settings:{manualRelink:true},
      status:'cloud_isolation_active'
    },
    {
      settings:{corruptLinks:true},
      status:'conference_link_store_invalid'
    }
  ]){
    var stopped=environment(item.settings);
    var stoppedResult=await reconcile(stopped);
    assert.strictEqual(stoppedResult.status,item.status);
    assert.strictEqual(stopped.calls.create,0);
    assert.strictEqual(stopped.calls.upload,0);
  }

  var corruptMetadata=environment({corruptMetadata:true});
  var corruptScan=corruptMetadata.recovery.scanCandidates(
    corruptMetadata.original,corruptMetadata.options
  );
  assert.strictEqual(corruptScan.data.candidates.length,0);
  assert.strictEqual(corruptScan.data.rejected[0].reason,
    'invalid_publish_metadata');

  var revokedBefore=environment({
    operationMissing:true,
    access:{canCreateConferences:false}
  });
  assert.strictEqual(
    (await reconcile(revokedBefore)).status,
    'conference_creation_not_authorized'
  );
  assert.strictEqual(revokedBefore.calls.create,0);

  var revokedAfter=environment({
    access:{canCreateConferences:false}
  });
  assert.strictEqual((await reconcile(revokedAfter)).ok,true);
  assert.strictEqual(revokedAfter.calls.create,0);

  var linkMismatch=environment({linkCloudId:otherCloudId});
  var mismatchScan=linkMismatch.recovery.scanCandidates(
    linkMismatch.original,linkMismatch.options
  );
  assert.strictEqual(mismatchScan.data.candidates.length,0);
  assert.strictEqual(mismatchScan.data.rejected[0].reason,
    'cloud_id_mismatch');

  var transient=environment({operationResult:{
    ok:false,status:'error',error:{code:'NETWORK_ERROR'}
  }});
  var transientResult=await reconcile(transient);
  assert.strictEqual(
    transientResult.status,'operation_inspection_failed'
  );
  assert.strictEqual(
    transient.current().conferenceLifecycle.records['local-1']
      .publishMetadata.retryCount,
    1
  );
  var secondTransient=await transient.manager.reconcileConference(
    transient.current(),'local-1',transient.options
  );
  assert.strictEqual(secondTransient.status,'retry_backoff_active');
  assert.strictEqual(transient.calls.inspectOperation,1);

  var exhausted=environment({retryCount:3});
  assert.strictEqual(
    (await reconcile(exhausted)).status,'retry_limit_reached'
  );
  assert.strictEqual(exhausted.calls.inspectOperation,0);

  var gateResolve;
  var gatePromise=new Promise(function(resolve){gateResolve=resolve;});
  var active=environment({
    inspectionGate:{promise:gatePromise}
  });
  var first=reconcile(active);
  await Promise.resolve();
  var second=await reconcile(active);
  assert.strictEqual(second.status,'reconciliation_active');
  gateResolve({
    ok:true,status:'created',data:{
      userId:userId,
      operationId:operationId,
      conferenceId:cloudId
    }
  });
  assert.strictEqual((await first).ok,true);
  assert.strictEqual(active.calls.inspectOperation,1);

  var finalizationFailure=environment({persistFailureAt:1});
  var finalizationResult=await reconcile(finalizationFailure);
  assert.strictEqual(
    finalizationResult.status,'local_finalization_failed'
  );
  assert.strictEqual(
    finalizationFailure.links['local-1'].linkStatus,
    'cloud_linked'
  );
  finalizationFailure.options.persistAppData=function(value){
    return Promise.resolve(value);
  };
  var resumed=await finalizationFailure.manager.reconcileConference(
    finalizationFailure.current(),'local-1',
    finalizationFailure.options
  );
  assert.strictEqual(resumed.ok,true);
  assert.strictEqual(finalizationFailure.calls.create,0);
  assert.strictEqual(finalizationFailure.calls.upload,0);

  var isolatedFailures=environment();
  var recoveryBatch=await isolatedFailures.recovery.recoverCandidates(
    isolatedFailures.original,isolatedFailures.options
  );
  assert.strictEqual(recoveryBatch.ok,true);
  assert.strictEqual(recoveryBatch.data.results.length,1);

  [
    existing,absent,noSnapshot,changed,finalOnly,revokedAfter,
    active,finalizationFailure
  ].forEach(function(env){
    assert.strictEqual(env.calls.queue,0);
    assert.strictEqual(env.calls.realtime,0);
  });

  var indexSource=source('index.html');
  assert.ok(
    indexSource.indexOf('conference-publishing-engine.js')<
    indexSource.indexOf('conference-publish-recovery.js')
  );
  assert.ok(
    indexSource.indexOf('conference-publish-recovery.js')<
    indexSource.indexOf('conference-publish-manager.js')
  );
  assert.match(
    source('service-worker.js'),
    /js\/storage\/conference-publish-recovery\.js/
  );

  console.log('conference publish recovery phase 2.4 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
