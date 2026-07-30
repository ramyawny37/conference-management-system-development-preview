'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var userId='11111111-1111-4111-8111-111111111111';
var operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
var cloudId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
var now='2026-07-30T12:00:00.000Z';

function source(text){
  return fs.readFileSync(path.join(root,text),'utf8');
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function environment(settings){
  settings=settings||{};
  var calls={
    create:0,
    membership:0,
    upload:0,
    persist:0,
    queue:0,
    realtime:0
  };
  var current=null;
  var links=Object.create(null);
  var ids=[operationId,cloudId];
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
    APP_RELEASE:{version:'5.0.0'},
    navigator:{onLine:settings.online!==false},
    crypto:{randomUUID:function(){return ids.shift();}},
    SupabaseAuth:{
      getSession:function(){
        return settings.unauthenticated
          ?null:{user:{id:settings.authUserId||userId}};
      },
      getState:function(){
        return {authenticated:!settings.unauthenticated};
      }
    },
    SystemAccessService:{
      refresh:function(){
        if(settings.accessReject){
          return Promise.reject(new Error('ACCESS_FAILED'));
        }
        return Promise.resolve(Object.assign({
          authenticated:true,
          profileLoaded:true,
          fresh:true,
          source:'server',
          userId:userId,
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
        return settings.linkStoreInvalid
          ?{ok:false,status:'malformed'}
          :{ok:true,status:'read',data:plain(links)};
      },
      get:function(id){
        return settings.existingLink||links[id]||null;
      },
      save:function(input){
        if(settings.linkSaveFailure&&
          (!settings.linkFailureStatus||
            settings.linkFailureStatus===input.linkStatus)){
          return {ok:false,status:'storage_error'};
        }
        links[input.localConferenceId]=plain(input);
        return {ok:true,status:'saved',data:plain(input)};
      }
    },
    SupabaseSnapshotSync:{
      createConferenceIdempotent:function(input){
        calls.create++;
        if(settings.createGate)return settings.createGate.promise;
        if(settings.createResult)return Promise.resolve(settings.createResult);
        return Promise.resolve({
          ok:true,
          status:settings.duplicate?'duplicate':'created',
          data:{
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
      uploadInitialSnapshot:function(input){
        calls.upload++;
        calls.snapshot=plain(input.snapshot);
        if(settings.changeDuringUpload){
          current.conferences[0].name='Changed during publishing';
          current.conferenceLifecycle.records['local-1']
            .localContentVersion=3;
        }
        return Promise.resolve(settings.uploadResult||{
          ok:true,
          status:'applied',
          data:{revision:1,operationId:input.operationId}
        });
      }
    },
    SyncQueue:{enqueue:function(){calls.queue++;}},
    RealtimeManager:{connect:function(){calls.realtime++;}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source(
    'js/storage/conference-repository.js'
  ),sandbox);
  vm.runInNewContext(source(
    'js/storage/conference-publishing-engine.js'
  ),sandbox);
  vm.runInNewContext(source(
    'js/storage/conference-publish-manager.js'
  ),sandbox);

  var repository=sandbox.ConferenceRepository;
  var manager=sandbox.ConferencePublishManager;
  var record=repository.createLifecycleRecord({
    localConferenceId:'local-1',
    localContentVersion:2
  }).data;
  var requested=manager.transitionLifecycleRecord(
    record,'request_publish',{
      requestedAt:now,
      requestedByUserId:userId,
      requestedByDeviceId:'device-a'
    }
  );
  var authorized=manager.transitionLifecycleRecord(
    requested.data,'authorize',{accessCheck:{
      userId:userId,
      checkedAt:now,
      source:'server',
      fresh:true,
      authenticated:true,
      accountStatus:'approved',
      canCreateConferences:true,
      isSystemOwner:false
    }}
  );
  current={
    version:'5.0.0',
    conferences:[{
      id:'local-1',
      name:'Local conference',
      nested:{value:1}
    }],
    conferenceLifecycle:{
      schemaVersion:1,
      records:{'local-1':authorized.data}
    }
  };
  var original=current;
  var options={
    navigator:sandbox.navigator,
    crypto:sandbox.crypto,
    clock:function(){return now;},
    getCurrentAppData:function(){return current;},
    applyAppData:function(value){current=value;},
    persistAppData:function(value){
      calls.persist++;
      if(settings.persistFailureAt===calls.persist){
        return Promise.reject(new Error('PERSIST_FAILED'));
      }
      return Promise.resolve({ok:true});
    },
    appVersion:'5.0.0',
    schemaVersion:'1'
  };
  return {
    sandbox:sandbox,
    manager:manager,
    calls:calls,
    links:links,
    original:original,
    options:options,
    current:function(){return current;}
  };
}

function confirmation(overrides){
  return Object.assign({
    confirmed:true,
    userId:userId,
    confirmedAt:now
  },overrides||{});
}

async function publish(env,confirmationValue){
  return env.manager.publishConference(
    env.original,'local-1',
    confirmationValue===undefined?confirmation():confirmationValue,
    env.options
  );
}

async function run(){
  var membershipSandbox={
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
        assert.strictEqual(table,'conference_members');
        var filters={};
        var query={
          select:function(){return query;},
          eq:function(key,value){
            filters[key]=value;
            return query;
          },
          maybeSingle:function(){
            assert.strictEqual(filters.conference_id,cloudId);
            assert.strictEqual(filters.user_id,userId);
            return Promise.resolve({data:{
              conference_id:cloudId,
              user_id:userId,
              role:'owner'
            },error:null});
          }
        };
        return query;
      }};
    }}
  };
  membershipSandbox.window=membershipSandbox;
  vm.runInNewContext(source(
    'js/supabase/snapshot-sync.js'
  ),membershipSandbox);
  assert.strictEqual(
    (await membershipSandbox.SupabaseSnapshotSync
      .verifyOwnerMembership({
        conferenceId:cloudId,
        userId:userId
      })).status,
    'owner_verified'
  );

  var storedLinks=null;
  var linkSandbox={
    window:null,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Date:Date,
    structuredClone:structuredClone,
    localStorage:{
      getItem:function(){return storedLinks;},
      setItem:function(key,value){storedLinks=value;}
    }
  };
  linkSandbox.window=linkSandbox;
  vm.runInNewContext(source(
    'js/sync/conference-link-store.js'
  ),linkSandbox);
  var realLinks=linkSandbox.ConferenceLinkStore;
  assert.ok(realLinks.statuses.indexOf('linking')>=0);
  assert.ok(realLinks.statuses.indexOf('cloud_linked')>=0);
  assert.ok(realLinks.statuses.indexOf('link_failed')>=0);
  assert.strictEqual(realLinks.save({
    localConferenceId:'local-a',
    remoteConferenceId:cloudId,
    knownRevision:0,
    linkStatus:'linking',
    initialOperationId:operationId,
    linkedByUserId:userId,
    syncState:{initialSnapshotComplete:false}
  }).ok,true);
  assert.strictEqual(realLinks.save({
    localConferenceId:'local-b',
    remoteConferenceId:cloudId,
    knownRevision:0,
    linkStatus:'linking'
  }).status,'remote_already_linked');
  storedLinks='{broken';
  assert.strictEqual(realLinks.inspect().ok,false);

  var notReady=environment();
  notReady.original.conferenceLifecycle.records['local-1']
    .cloudLifecycle='waiting_for_authorization';
  assert.strictEqual((await publish(notReady)).status,
    'not_ready_to_publish');
  assert.strictEqual(notReady.calls.create,0);

  var existingAttempt=environment();
  var existingMetadata=existingAttempt.original.conferenceLifecycle
    .records['local-1'].publishMetadata;
  existingMetadata.operationId=operationId;
  existingMetadata.requestedCloudId=cloudId;
  assert.strictEqual(
    (await publish(existingAttempt)).status,
    'invalid_existing_attempt'
  );

  for(var item of [
    {settings:{online:false},status:'offline'},
    {settings:{restoreMarker:true},status:'cloud_isolation_active'},
    {settings:{manualRelink:true},status:'cloud_isolation_active'},
    {settings:{existingLink:{linkStatus:'linked'}},
      status:'conference_link_exists'},
    {settings:{linkStoreInvalid:true},
      status:'conference_link_store_invalid'},
    {settings:{access:{source:'cache',fresh:false}},
      status:'authorization_failed'},
    {settings:{access:{accountStatus:'pending',
      canCreateConferences:false}},status:'account_pending'},
    {settings:{access:{accountStatus:'blocked'}},
      status:'account_blocked'},
    {settings:{access:{canCreateConferences:false}},
      status:'authorization_failed'},
    {settings:{access:{canCreateConferences:false,
      isSystemOwner:true}},status:'cloud_linked'}
  ]){
    var prerequisite=environment(item.settings);
    var prerequisiteResult=await publish(prerequisite);
    assert.strictEqual(prerequisiteResult.status,item.status);
    if(item.status!=='cloud_linked'){
      assert.strictEqual(prerequisite.calls.create,0);
    }
  }

  var noConfirmation=environment();
  assert.strictEqual((await publish(noConfirmation,{})).status,
    'confirmation_required');
  var changedUser=environment({authUserId:
    '22222222-2222-4222-8222-222222222222'});
  assert.strictEqual((await publish(changedUser)).status,
    'requesting_user_changed');

  var success=environment();
  var before=JSON.stringify(success.original);
  var successResult=await publish(success);
  assert.strictEqual(successResult.ok,true);
  assert.strictEqual(successResult.status,'cloud_linked');
  assert.strictEqual(successResult.data.operationId,operationId);
  assert.strictEqual(successResult.data.requestedCloudId,cloudId);
  assert.strictEqual(successResult.data.revision,1);
  assert.strictEqual(success.calls.create,1);
  assert.strictEqual(success.calls.membership,1);
  assert.strictEqual(success.calls.upload,1);
  assert.strictEqual(success.calls.queue,0);
  assert.strictEqual(success.calls.realtime,0);
  assert.strictEqual(JSON.stringify(success.original),before);
  assert.strictEqual(
    success.current().conferenceLifecycle.records['local-1']
      .cloudLifecycle,
    'cloud_linked'
  );
  assert.strictEqual(
    success.current().conferenceLifecycle.records['local-1']
      .publishMetadata,
    null
  );
  assert.strictEqual(success.links['local-1'].linkStatus,
    'cloud_linked');
  assert.strictEqual(success.links['local-1'].knownRevision,1);
  assert.strictEqual(success.links['local-1'].initialOperationId,
    operationId);
  assert.strictEqual(success.calls.snapshot.nested.value,1);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      success.calls.snapshot,'conferenceLifecycle'
    ),
    false
  );
  success.calls.snapshot.nested.value=9;
  assert.strictEqual(success.original.conferences[0].nested.value,1);

  var duplicate=environment({duplicate:true});
  assert.strictEqual((await publish(duplicate)).status,'cloud_linked');
  assert.strictEqual(duplicate.calls.create,1);

  var changed=environment({changeDuringUpload:true});
  var changedResult=await publish(changed);
  assert.strictEqual(
    changedResult.status,'cloud_linked_local_changes_pending'
  );
  assert.strictEqual(
    changed.current().conferences[0].name,
    'Changed during publishing'
  );
  assert.strictEqual(
    changed.links['local-1'].syncState.pendingLocalChanges,true
  );
  assert.strictEqual(changed.calls.queue,0);

  var unknown=environment({createResult:{
    ok:false,status:'error',data:{operationId:operationId},
    error:{code:'NETWORK_ERROR'}
  }});
  var unknownResult=await publish(unknown);
  assert.strictEqual(
    unknownResult.status,'conference_creation_result_unknown'
  );
  assert.strictEqual(
    unknownResult.recovery,'requires_reconciliation'
  );
  var unknownMetadata=unknown.current()
    .conferenceLifecycle.records['local-1'].publishMetadata;
  assert.strictEqual(unknownMetadata.operationId,operationId);
  assert.strictEqual(unknownMetadata.requestedCloudId,cloudId);
  assert.strictEqual(
    unknown.current().conferenceLifecycle.records['local-1']
      .cloudLifecycle,
    'publish_failed'
  );
  assert.strictEqual(unknown.links['local-1'].linkStatus,'linking');

  var creationFailed=environment({createResult:{
    ok:false,
    status:'error',
    data:{operationId:operationId},
    error:{code:'ACCESS_DENIED'}
  }});
  assert.strictEqual(
    (await publish(creationFailed)).status,
    'authorization_failed'
  );
  assert.strictEqual(
    creationFailed.current().conferenceLifecycle.records['local-1']
      .publishMetadata.operationId,
    operationId
  );

  for(var failure of [
    {
      settings:{membershipResult:{
        ok:false,status:'owner_not_verified'
      }},
      status:'membership_verification_failed'
    },
    {
      settings:{uploadResult:{
        ok:false,status:'error',error:{code:'UPLOAD_FAILED'}
      }},
      status:'initial_snapshot_failed'
    },
    {
      settings:{uploadResult:{
        ok:true,status:'applied',data:{revision:null}
      }},
      status:'revision_missing_or_invalid'
    },
    {
      settings:{
        linkSaveFailure:true,
        linkFailureStatus:'cloud_linked'
      },
      status:'conference_link_save_failed'
    }
  ]){
    var failed=environment(failure.settings);
    var failedResult=await publish(failed);
    assert.strictEqual(failedResult.status,failure.status);
    assert.strictEqual(
      failed.current().conferenceLifecycle.records['local-1']
        .cloudLifecycle,
      'publish_failed'
    );
    assert.strictEqual(failed.calls.queue,0);
    assert.strictEqual(failed.calls.realtime,0);
  }

  var finalPersist=environment({persistFailureAt:2});
  var finalPersistResult=await publish(finalPersist);
  assert.strictEqual(finalPersistResult.status,
    'local_finalization_failed');
  assert.strictEqual(finalPersistResult.recovery,
    'requires_reconciliation');
  assert.strictEqual(finalPersist.links['local-1'].linkStatus,
    'cloud_linked');
  assert.notStrictEqual(
    finalPersist.current().conferenceLifecycle.records['local-1']
      .cloudLifecycle,
    'cloud_linked'
  );

  var gateResolve;
  var gatePromise=new Promise(function(resolve){gateResolve=resolve;});
  var active=environment({createGate:{promise:gatePromise}});
  var first=publish(active);
  await Promise.resolve();
  await Promise.resolve();
  var second=await publish(active);
  assert.strictEqual(second.status,'publishing_attempt_active');
  gateResolve({
    ok:true,status:'created',
    data:{operationId:operationId,conferenceId:cloudId}
  });
  assert.strictEqual((await first).status,'cloud_linked');
  assert.strictEqual(active.calls.create,1);

  var indexSource=source('index.html');
  assert.ok(
    indexSource.indexOf('conference-repository.js')<
    indexSource.indexOf('conference-publishing-engine.js')
  );
  assert.ok(
    indexSource.indexOf('conference-publishing-engine.js')<
    indexSource.indexOf('conference-publish-manager.js')
  );
  assert.match(
    source('service-worker.js'),
    /js\/storage\/conference-publishing-engine\.js/
  );

  console.log('conference publishing engine phase 2.3 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
