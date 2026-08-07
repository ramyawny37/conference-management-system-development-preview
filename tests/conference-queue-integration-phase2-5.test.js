'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var userId='11111111-1111-4111-8111-111111111111';
var cloudId='22222222-2222-4222-8222-222222222222';
var deviceId='33333333-3333-4333-8333-333333333333';
var operationIds=[
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
];

function source(file){
  return fs.readFileSync(path.join(root,file),'utf8');
}

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function environment(settings){
  settings=settings||{};
  var calls={
    membership:0,
    access:0,
    enqueue:0,
    linkSave:0,
    configure:0,
    realtime:0,
    createConference:0
  };
  var operations=[];
  var nextOperation=0;
  var appData={
    version:'5.0.0',
    currentConferenceId:'local-1',
    conferences:[{
      id:'local-1',
      name:'Conference',
      nested:{value:1}
    }],
    conferenceLifecycle:{
      schemaVersion:1,
      records:{
        'local-1':{
          localConferenceId:'local-1',
          localLifecycle:settings.archived?'archived':'active',
          cloudLifecycle:settings.lifecycle||'cloud_linked',
          localContentVersion:settings.localContentVersion===undefined
            ?2:settings.localContentVersion,
          publishMetadata:null
        }
      }
    }
  };
  var link=Object.assign({
    localConferenceId:'local-1',
    remoteConferenceId:cloudId,
    knownRevision:4,
    linkStatus:settings.linkStatus||'cloud_linked',
    pendingLocalApplication:false,
    conflictId:null,
    conflictStatus:null,
    syncState:{
      initialSnapshotComplete:true,
      pendingLocalChanges:settings.pendingLocalChanges!==false,
      snapshotContentVersion:1,
      currentContentVersion:2
    }
  },settings.link||{});
  var queue={
    getAllOperations:function(){
      return Promise.resolve({
        ok:true,status:'listed',
        data:{operations:plain(operations)}
      });
    },
    coalesceSnapshotOperation:function(input){
      calls.enqueue++;
      if(settings.queueFailure){
        return Promise.resolve({ok:false,status:'error'});
      }
      var candidate=operations.filter(function(operation){
        return operation.conferenceId===input.conferenceId&&
          operation.status==='pending'&&operation.attempts===0;
      })[0];
      if(candidate){
        Object.assign(candidate,plain(input));
        candidate.cloudConferenceId=input.conferenceId;
        candidate.queueSchemaVersion=1;
        return Promise.resolve({
          ok:true,status:'coalesced',
          data:{operation:plain(candidate)}
        });
      }
      var operation=Object.assign({
        queueSchemaVersion:1,
        cloudConferenceId:input.conferenceId,
        operationId:operationIds[nextOperation++],
        status:'pending',
        attempts:0,
        createdAt:'2026-07-30T14:00:00.000Z',
        updatedAt:'2026-07-30T14:00:00.000Z'
      },plain(input));
      operations.push(operation);
      return Promise.resolve({
        ok:true,status:'enqueued',
        data:{operation:plain(operation)}
      });
    }
  };
  var sandbox={
    window:null,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Error:Error,
    Promise:Promise,
    structuredClone:structuredClone,
    navigator:{onLine:settings.online!==false},
    appData:appData,
    isConferenceImportRecoveryPending:function(){
      return settings.importRecovery===true;
    },
    APP_RELEASE:{version:'5.0.0'},
    SupabaseAuth:{
      getSession:function(){return {user:{id:userId}};},
      getState:function(){return {authenticated:true};}
    },
    SupabaseDeviceIdentity:{
      getOrCreate:function(){return {id:deviceId};}
    },
    SystemAccessService:{
      refresh:function(){
        calls.access++;
        return Promise.resolve(Object.assign({
          authenticated:true,
          profileLoaded:true,
          fresh:true,
          source:'server',
          userId:userId,
          accountStatus:'approved',
          canCreateConferences:false,
          isSystemOwner:settings.systemOwner===true
        },settings.access||{}));
      }
    },
    ConferenceMembersService:{
      getCurrentAccess:function(){
        calls.membership++;
        if(settings.membershipDenied){
          return Promise.resolve({
            ok:false,status:'access_denied'
          });
        }
        return Promise.resolve({
          ok:true,status:'available',data:{
            userId:userId,
            role:settings.role||'owner',
            canSync:settings.canSync!==false
          }
        });
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
    ConferencePublishingEngine:{
      getState:function(){
        return {activeConferenceIds:settings.publishing
          ?['local-1']:[]};
      }
    },
    ConferencePublishRecovery:{
      getState:function(){
        return {activeConferenceIds:settings.recovering
          ?['local-1']:[]};
      }
    },
    ConferenceLinkStore:{
      inspect:function(){
        return settings.corruptLinks
          ?{ok:false,status:'malformed'}
          :{ok:true,status:'read',data:{'local-1':plain(link)}};
      },
      get:function(){return settings.noLink?null:plain(link);},
      list:function(){
        if(settings.noLink)return [];
        return [plain(link)].concat(plain(settings.additionalLinks||[]));
      },
      findByRemoteId:function(){
        return settings.noLink?null:plain(link);
      },
      save:function(input){
        calls.linkSave++;
        if(settings.linkSaveFailure){
          return {ok:false,status:'storage_error'};
        }
        link=plain(input);
        return {ok:true,status:'saved',data:plain(link)};
      }
    },
    OfflineSyncQueue:queue,
    OfflineFirstIntegration:{
      configureConferenceSync:function(){
        calls.configure++;
        return {ok:true};
      }
    },
    RealtimeSync:{connect:function(){calls.realtime++;}},
    SupabaseSnapshotSync:{
      createConferenceIdempotent:function(){
        calls.createConference++;
      }
    }
  };
  sandbox.window=sandbox;
  [
    'js/storage/conference-repository.js',
    'js/sync/conference-queue-integration.js'
  ].forEach(function(file){
    vm.runInNewContext(source(file),sandbox,{filename:file});
  });
  var options={
    appData:appData,
    queue:queue,
    links:sandbox.ConferenceLinkStore,
    navigator:sandbox.navigator,
    schemaVersion:'1',
    appVersion:'5.0.0'
  };
  return {
    sandbox:sandbox,
    integration:sandbox.ConferenceQueueIntegration,
    calls:calls,
    appData:appData,
    operations:operations,
    options:options,
    link:function(){return link;}
  };
}

async function prepare(env){
  return env.integration.prepareConference(
    env.appData,'local-1',env.options
  );
}

async function run(){
  var versionSource=environment({pendingLocalChanges:false});
  var versionBefore=JSON.stringify(versionSource.appData);
  var versioned=versionSource.sandbox.ConferenceRepository
    .recordLocalChange(versionSource.appData,'local-1');
  assert.strictEqual(versioned.ok,true);
  assert.strictEqual(
    versioned.data.conferenceLifecycle.records['local-1']
      .localContentVersion,
    3
  );
  assert.strictEqual(JSON.stringify(versionSource.appData),versionBefore);

  var owner=environment();
  var prepared=await prepare(owner);
  assert.strictEqual(prepared.ok,true);
  assert.strictEqual(prepared.status,'prepared');
  assert.strictEqual(owner.operations.length,1);
  var operation=owner.operations[0];
  assert.strictEqual(operation.queueSchemaVersion,1);
  assert.strictEqual(operation.localConferenceId,'local-1');
  assert.strictEqual(operation.cloudConferenceId,cloudId);
  assert.strictEqual(operation.operationType,'snapshot');
  assert.strictEqual(operation.baseRevision,4);
  assert.strictEqual(operation.localContentVersion,2);
  assert.strictEqual(operation.createdByUserId,userId);
  assert.strictEqual(
    operation.idempotencyKey,
    'snapshot|local-1|'+cloudId+'|4|2'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      operation.snapshot,'conferenceLifecycle'
    ),
    false
  );
  operation.snapshot.nested.value=8;
  assert.strictEqual(owner.appData.conferences[0].nested.value,1);
  assert.strictEqual(
    owner.link().syncState.pendingLocalChanges,false
  );
  assert.strictEqual(owner.calls.configure,1);
  assert.strictEqual(owner.calls.realtime,0);
  assert.strictEqual(owner.calls.createConference,0);

  owner.link().syncState.pendingLocalChanges=true;
  var duplicate=await prepare(owner);
  assert.strictEqual(duplicate.status,'already_prepared');
  assert.strictEqual(owner.operations.length,1);
  assert.strictEqual(owner.calls.enqueue,1);

  var manager=environment({role:'manager'});
  assert.strictEqual((await prepare(manager)).ok,true);

  for(var item of [
    {settings:{role:'viewer'},status:'membership_write_denied'},
    {settings:{membershipDenied:true,systemOwner:true},
      status:'membership_write_denied'},
    {settings:{access:{accountStatus:'blocked'}},
      status:'account_blocked'},
    {settings:{online:false},status:'offline'},
    {settings:{restoreMarker:true},
      status:'cloud_isolation_active'},
    {settings:{manualRelink:true},
      status:'cloud_isolation_active'},
    {settings:{publishing:true},status:'publishing_active'},
    {settings:{recovering:true},status:'reconciliation_active'},
    {settings:{archived:true},status:'conference_archived'},
    {settings:{noLink:true},status:'conference_link_missing'},
    {settings:{linkStatus:'linking'},
      status:'conference_link_invalid'},
    {settings:{link:{knownRevision:null}},
      status:'conference_link_invalid'},
    {settings:{link:{conflictId:
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}},
      status:'conference_link_invalid'},
    {settings:{corruptLinks:true},
      status:'conference_link_store_invalid'}
  ]){
    var rejected=environment(item.settings);
    var rejectedResult=await prepare(rejected);
    assert.strictEqual(rejectedResult.status,item.status);
    assert.strictEqual(rejected.calls.enqueue,0);
  }

  var noCreatePermission=environment({
    access:{canCreateConferences:false}
  });
  assert.strictEqual((await prepare(noCreatePermission)).ok,true);

  var queueFailure=environment({queueFailure:true});
  assert.strictEqual(
    (await prepare(queueFailure)).status,
    'queue_operation_save_failed'
  );
  assert.strictEqual(
    queueFailure.link().syncState.pendingLocalChanges,true
  );

  var markerFailure=environment({linkSaveFailure:true});
  assert.strictEqual(
    (await prepare(markerFailure)).status,
    'link_marker_update_failed'
  );
  assert.strictEqual(markerFailure.operations.length,1);

  var coalesced=environment();
  await prepare(coalesced);
  coalesced.link().syncState.pendingLocalChanges=true;
  coalesced.appData.conferences[0].name='Newer';
  coalesced.appData.conferenceLifecycle.records['local-1']
    .localContentVersion=3;
  await prepare(coalesced);
  assert.strictEqual(coalesced.operations.length,1);
  assert.strictEqual(
    coalesced.operations[0].localContentVersion,3
  );
  assert.strictEqual(
    coalesced.operations[0].snapshot.name,'Newer'
  );

  var processing=environment();
  await prepare(processing);
  processing.operations[0].status='processing';
  processing.operations[0].attempts=1;
  processing.link().syncState.pendingLocalChanges=true;
  processing.appData.conferences[0].name='Later';
  processing.appData.conferenceLifecycle.records['local-1']
    .localContentVersion=3;
  await prepare(processing);
  assert.strictEqual(processing.operations.length,2);
  assert.strictEqual(
    processing.operations[0].snapshot.name,'Conference'
  );
  assert.strictEqual(processing.operations[1].snapshot.name,'Later');

  var validation=environment({pendingLocalChanges:false});
  var validOperation={
    queueSchemaVersion:1,
    operationId:operationIds[0],
    localConferenceId:'local-1',
    conferenceId:cloudId,
    cloudConferenceId:cloudId,
    baseRevision:4,
    snapshot:{nested:{value:1}}
  };
  assert.strictEqual(
    (await validation.integration.validateOperation(
      validOperation,validation.options
    )).ok,
    true
  );
  assert.strictEqual(
    (await validation.integration.validateOperation(
      Object.assign({},validOperation,{baseRevision:3}),
      validation.options
    )).status,
    'base_revision_mismatch'
  );
  assert.strictEqual(
    (await validation.integration.validateOperation(
      Object.assign({},validOperation,{
        conferenceId:'44444444-4444-4444-8444-444444444444'
      }),
      validation.options
    )).status,
    'cloud_id_mismatch'
  );

  var legacy=environment({
    linkStatus:'linked',
    lifecycle:'unpublished',
    pendingLocalChanges:false
  });
  assert.strictEqual(
    legacy.integration.inspectScope(
      legacy.appData,'local-1',legacy.options
    ).data.legacy,
    true
  );
  assert.strictEqual((await prepare(legacy)).status,'legacy_managed');

  var linkedOperation=Object.assign({},validOperation);
  var linkedSnapshotBefore=JSON.stringify(linkedOperation.snapshot);
  var linkedValidation=await legacy.integration.validateOperation(
    linkedOperation,legacy.options
  );
  assert.strictEqual(linkedValidation.ok,true);
  assert.strictEqual(linkedValidation.status,'write_authorized');
  assert.strictEqual(legacy.calls.access,1);
  assert.strictEqual(legacy.calls.membership,1);
  assert.strictEqual(JSON.stringify(linkedOperation.snapshot),linkedSnapshotBefore);

  var missingCloud=await legacy.integration.validateOperation(
    Object.assign({},linkedOperation,{cloudConferenceId:null}),legacy.options
  );
  assert.strictEqual(missingCloud.status,'cloud_id_mismatch');
  assert.strictEqual((await legacy.integration.validateOperation(
    Object.assign({},linkedOperation,{cloudConferenceId:
      '44444444-4444-4444-8444-444444444444'}),legacy.options
  )).status,'cloud_id_mismatch');
  assert.strictEqual((await legacy.integration.validateOperation(
    Object.assign({},linkedOperation,{baseRevision:3}),legacy.options
  )).status,'base_revision_mismatch');

  var unsynced=environment({
    linkStatus:'unsynced',lifecycle:'unpublished',pendingLocalChanges:false
  });
  assert.strictEqual((await unsynced.integration.validateOperation(
    linkedOperation,unsynced.options
  )).status,'legacy_link_contract_mismatch');

  var legacyWithoutLocal=Object.assign({},linkedOperation);
  delete legacyWithoutLocal.queueSchemaVersion;
  delete legacyWithoutLocal.localConferenceId;
  assert.strictEqual((await legacy.integration.validateOperation(
    legacyWithoutLocal,legacy.options
  )).ok,true);

  var missingMapping=environment({noLink:true,pendingLocalChanges:false});
  assert.strictEqual((await missingMapping.integration.validateOperation(
    legacyWithoutLocal,missingMapping.options
  )).status,'local_conference_missing');

  var ambiguousMapping=environment({
    linkStatus:'linked',lifecycle:'unpublished',pendingLocalChanges:false,
    additionalLinks:[Object.assign({},legacy.link(),{
      localConferenceId:'local-other'
    })]
  });
  assert.strictEqual((await ambiguousMapping.integration.validateOperation(
    legacyWithoutLocal,ambiguousMapping.options
  )).status,'ambiguous_remote_link');
  assert.strictEqual((await ambiguousMapping.integration.validateOperation(
    linkedOperation,ambiguousMapping.options
  )).status,'ambiguous_remote_link');

  var localMismatch=environment({
    linkStatus:'linked',lifecycle:'unpublished',pendingLocalChanges:false
  });
  assert.notStrictEqual((await localMismatch.integration.validateOperation(
    Object.assign({},linkedOperation,{localConferenceId:'local-other'}),
    localMismatch.options
  )).ok,true);

  for(var guardedSettings of [
    {restoreMarker:true},
    {manualRelink:true},
    {importRecovery:true},
    {publishing:true},
    {recovering:true},
    {membershipDenied:true},
    {access:{accountStatus:'blocked'}}
  ]){
    var guarded=environment(Object.assign({
      linkStatus:'linked',lifecycle:'unpublished',pendingLocalChanges:false
    },guardedSettings));
    assert.strictEqual((await guarded.integration.validateOperation(
      linkedOperation,guarded.options
    )).ok,false);
    assert.strictEqual(guarded.calls.enqueue,0);
    assert.strictEqual(guarded.calls.linkSave,0);
    assert.strictEqual(guarded.calls.createConference,0);
  }

  var pendingLegacy=environment({
    linkStatus:'linked',lifecycle:'unpublished',pendingLocalChanges:false,
    link:{pendingLocalApplication:true}
  });
  assert.strictEqual((await pendingLegacy.integration.validateOperation(
    linkedOperation,pendingLegacy.options
  )).status,'legacy_link_contract_mismatch');

  var scanA=environment();
  var batch=await scanA.integration.prepareCandidates(
    scanA.appData,scanA.options
  );
  assert.strictEqual(batch.ok,true);
  assert.strictEqual(batch.data.results.length,1);

  var processed=0;
  var validated=0;
  var finalizationOrder=[];
  var runnerSandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Date:Date,
    Math:Math,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    structuredClone:structuredClone
  };
  runnerSandbox.window=runnerSandbox;
  vm.runInNewContext(
    source('js/sync/automatic-queue-runner.js'),
    runnerSandbox
  );
  var runnerOperation=Object.assign({},validOperation,{
    deviceId:deviceId,
    status:'pending',
    attempts:0
  });
  var runnerOptions={
    connectivity:'online',
    reasons:['local_save'],
    preferences:{get:function(){
      return {cloudSyncEnabled:true,automaticSyncEnabled:true};
    }},
    clientLayer:{getState:function(){
      return {configured:true,available:true};
    }},
    auth:{getState:function(){return {authenticated:true};}},
    deviceIdentity:{getOrCreate:function(){return {id:deviceId};}},
    appData:validation.appData,
    queue:{
      getReadyOperations:function(){
        return Promise.resolve({ok:true,data:{
          operations:[plain(runnerOperation)]
        }});
      },
      getAllOperations:function(){
        return Promise.resolve({ok:true,data:{
          operations:[plain(runnerOperation)]
        }});
      },
      markApplied:function(){
        finalizationOrder.push('queue_applied');
        return Promise.resolve({ok:true,status:'applied'});
      }
    },
    linkStore:{
      findByRemoteId:function(){return plain(validation.link());}
    },
    stateResolver:{resolve:function(){
      return Promise.resolve({ok:true,status:'linked'});
    }},
    pendingApplicationStore:{get:function(){
      return Promise.resolve({ok:false,status:'not_found'});
    }},
    queueIntegration:{
      prepareCandidates:function(){
        return Promise.resolve({ok:true,status:'prepared'});
      },
      validateOperation:function(){
        validated++;
        return Promise.resolve({ok:true,status:'write_authorized'});
      }
    },
    processor:{processOperation:function(){
      processed++;
      return Promise.resolve({
        ok:true,status:'server_applied',data:{
          revision:5,
          previousRevision:4,
          operation:plain(runnerOperation)
        }
      });
    }},
    integration:{applySuccessfulSyncRevision:function(){
      finalizationOrder.push('link_revision_saved');
      return Promise.resolve({ok:true,status:'revision_published'});
    }}
  };
  var runnerResult=await runnerSandbox.AutomaticQueueRunner.run(
    runnerOptions
  );
  assert.strictEqual(runnerResult.ok,true);
  assert.strictEqual(processed,1);
  assert.ok(validated>=2);
  assert.deepStrictEqual(
    finalizationOrder,
    ['link_revision_saved','queue_applied']
  );

  var processorSandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    structuredClone:structuredClone
  };
  processorSandbox.window=processorSandbox;
  vm.runInNewContext(
    source('js/sync/sync-processor.js'),
    processorSandbox
  );
  var processorMarkApplied=0;
  var processorCheckpoint=0;
  var deferredQueue={
    getOperation:function(){
      return Promise.resolve({
        ok:true,status:'found',data:{
          operationId:operationIds[0],
          conferenceId:cloudId,
          deviceId:deviceId,
          baseRevision:4,
          snapshot:{name:'Stable'},
          schemaVersion:'1',
          appVersion:'5.0.0',
          status:'pending',
          attempts:0
        }
      });
    },
    getReadyOperations:function(){
      return Promise.resolve({ok:true,data:{operations:[]}});
    },
    startProcessing:function(){
      return Promise.resolve({ok:true,data:{
        operationId:operationIds[0],
        conferenceId:cloudId,
        deviceId:deviceId,
        baseRevision:4,
        snapshot:{name:'Stable'},
        schemaVersion:'1',
        appVersion:'5.0.0',
        status:'processing',
        attempts:1
      }});
    },
    markApplied:function(){
      processorMarkApplied++;
      return Promise.resolve({ok:true});
    },
    checkpointServerApplied:function(id,input){
      processorCheckpoint++;
      return Promise.resolve({ok:true,data:{
        operationId:id,conferenceId:cloudId,deviceId:deviceId,
        status:'server_applied',attempts:1,result:{
          revision:input.revision,
          previousRevision:input.previousRevision
        }
      }});
    },
    markConflict:function(){return Promise.resolve({ok:true});},
    markFailed:function(){return Promise.resolve({ok:true});}
  };
  var deferredResult=await processorSandbox.SyncQueueProcessor
    .processOperation(operationIds[0],{
      queue:deferredQueue,
      deferAppliedFinalization:true,
      snapshotSync:{uploadSnapshot:function(){
        return Promise.resolve({ok:true,status:'applied',data:{
          revision:5,
          previousRevision:4,
          conferenceId:cloudId
        }});
      }}
    });
  assert.strictEqual(deferredResult.status,'server_applied');
  assert.strictEqual(processorCheckpoint,1);
  assert.strictEqual(processorMarkApplied,0);

  var indexSource=source('index.html');
  assert.ok(
    indexSource.indexOf('conference-sync-state-resolver')<
    indexSource.indexOf('conference-queue-integration.js')
  );
  assert.ok(
    indexSource.indexOf('conference-queue-integration.js')<
    indexSource.indexOf('automatic-queue-runner')
  );
  assert.match(
    source('service-worker.js'),
    /js\/sync\/conference-queue-integration\.js/
  );
  assert.doesNotMatch(
    source('js/sync/conference-queue-integration.js'),
    /createConferenceIdempotent|RealtimeSync|connectRealtime/
  );

  console.log('conference queue integration phase 2.5 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
