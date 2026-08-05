'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const LOCAL='11111111-1111-4111-8111-111111111111';
const CLOUD='22222222-2222-4222-8222-222222222222';
const USER='33333333-3333-4333-8333-333333333333';
const DEVICE='44444444-4444-4444-8444-444444444444';
const REVISION=7;

function load(sandbox,file){
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox,{
    filename:file
  });
}

async function delay(ms){
  await new Promise(resolve=>setTimeout(resolve,ms));
}

(async function(){
  let persisted=0;
  let queueOperations=0;
  let channelCreations=0;
  let runnerInvocations=0;
  const link={
    localConferenceId:LOCAL,
    remoteConferenceId:CLOUD,
    knownRevision:REVISION,
    linkStatus:'linked',
    pendingLocalApplication:false
  };
  const conference={id:LOCAL,name:'Conference',status:'active'};
  const appData={
    currentConferenceId:LOCAL,
    conferences:[conference],
    conferenceLifecycle:{schemaVersion:1,records:{
      [LOCAL]:{
        localConferenceId:LOCAL,
        localLifecycle:'active',
        cloudLifecycle:'unpublished',
        localContentVersion:4,
        publishMetadata:null
      }
    }}
  };
  const channel={
    on(type,filter,callback){this.eventCallback=callback;return this;},
    subscribe(callback){this.statusCallback=callback;callback('SUBSCRIBED');return this;},
    unsubscribe(){return Promise.resolve();}
  };
  const client={
    from(){return {select(){return {limit(){return Promise.resolve({error:null});}};}};},
    channel(){channelCreations++;return channel;},
    removeChannel(){return Promise.resolve();}
  };
  const sandbox={
    window:null,console,Promise,Date,JSON,Object,Array,String,Number,Math,RegExp,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    setTimeout,clearTimeout,setImmediate,
    addEventListener(){},removeEventListener(){},
    navigator:{onLine:true},appData,
    APP_RELEASE:{version:'3.1.1'},
    AutomaticSyncPreferences:{get(){return {
      cloudSyncEnabled:true,automaticSyncEnabled:true,
      automaticLinkingEnabled:true
    };}},
    SupabaseRuntimeConfig:{getPublicState(){return {configured:true};}},
    SupabaseAuth:{
      initialize(){return Promise.resolve({authenticated:true});},
      getState(){return {authenticated:true,user:{id:USER}};},
      getSession(){return {user:{id:USER}};}
    },
    SupabaseDeviceIdentity:{getOrCreate(){return {id:DEVICE};}},
    SupabaseClientLayer:{
      getState(){return {configured:true,available:true};},
      getClient(){return client;}
    },
    ConferenceLinkStore:{
      inspect(){return {ok:true,status:'read'};},
      get(id){return id===LOCAL?structuredClone(link):null;}
    },
    ConflictResolutionDraftStore:{get(){return Promise.resolve({ok:false});}},
    PendingRemoteApplicationStore:{get(){return Promise.resolve({ok:false});}},
    FullBackupService:{
      getFullRestoreCloudReviewMarker(){return {pending:false};},
      isFullRestoreCloudReviewPending(){return false;},
      isManualRelinkRequired(){return false;}
    },
    StorageRepository:{saveAppSnapshot(value,options){
      assert.strictEqual(options.skipSyncQueue,true);
      persisted++;
      return Promise.resolve({ok:true,data:value});
    }},
    SystemAccessService:{refresh(){return Promise.resolve({
      source:'server',fresh:true,authenticated:true,userId:USER,
      accountStatus:'approved'
    });}},
    ConferenceMembersService:{getCurrentAccess(){return Promise.resolve({
      ok:true,status:'available',data:{userId:USER,role:'owner'}
    });}},
    OfflineSyncQueue:{
      getConferenceReadiness(){return Promise.resolve({
        ok:true,status:'stable',data:{blockingOperations:[]}
      });},
      coalesceSnapshotOperation(){queueOperations++;}
    },
    AutomaticQueueRunner:{run(){
      runnerInvocations++;
      return Promise.resolve({ok:true,status:'empty'});
    }},
    ConferencePublishingEngine:{getState(){return {activeConferenceIds:[]};}},
    ConferencePublishRecovery:{
      getState(){return {activeConferenceIds:[]};},
      scanCandidates(){return {ok:true,data:{candidates:[]}};}
    },
    RemoteUpdateStore:{add(){return {ok:true};}},
    getCurrentConference(){
      return sandbox.appData.conferences.find(item=>item.id===LOCAL)||null;
    }
  };
  sandbox.window=sandbox;
  [
    'js/sync/sync-scheduler-state.js',
    'js/sync/offline-first-integration.js',
    'js/sync/automatic-conference-linking.js',
    'js/sync/conference-sync-state-resolver.js',
    'js/sync/conference-realtime-manager.js',
    'js/sync/automatic-sync-orchestrator.js'
  ].forEach(file=>load(sandbox,file));

  const linking=sandbox.AutomaticConferenceLinking.initialize();
  await linking.promise;
  const started=sandbox.AutomaticSyncOrchestrator.start({debounceMs:0});
  assert.strictEqual(started.status,'started');
  await delay(40);

  assert.strictEqual(
    sandbox.appData.conferenceLifecycle.records[LOCAL].cloudLifecycle,
    'cloud_linked'
  );
  assert.strictEqual(persisted,1);
  assert.strictEqual(queueOperations,0);
  assert.strictEqual(link.knownRevision,REVISION);
  const context=sandbox.OfflineFirstIntegration.getConferenceSyncState(LOCAL);
  assert.strictEqual(context.context.conferenceId,CLOUD);
  assert.strictEqual(context.context.baseRevision,REVISION);
  const realtime=sandbox.ConferenceRealtimeManager.getState(LOCAL);
  assert.strictEqual(realtime.status,'subscribed');
  assert.strictEqual(realtime.cloudConferenceId,CLOUD);
  assert.strictEqual(realtime.userId,USER);
  assert.ok(realtime.identity);
  assert.ok(realtime.generation>0);
  assert.strictEqual(channelCreations,1);

  const secondSchedule=sandbox.AutomaticSyncOrchestrator.schedule(
    'local_save',{debounceMs:0}
  );
  assert.strictEqual(secondSchedule.ok,true);
  await delay(40);
  const afterSecondEvaluation=sandbox.AutomaticSyncOrchestrator.getState();
  assert.strictEqual(afterSecondEvaluation.evaluationInProgress,false);
  assert.strictEqual(afterSecondEvaluation.followUpPending,false);
  assert.strictEqual(runnerInvocations,2);
  assert.strictEqual(channelCreations,1);

  const stages=sandbox.ConferenceRealtimeManager.getDiagnostics()
    .map(item=>item.stage);
  [
    'STARTUP','ORCHESTRATOR_SCHEDULED','EVALUATE_SCHEDULED_ENTRY',
    'ROUTE_RESOLVED','LIFECYCLE_READY','PREPARE_SUBSCRIBE_CALLED',
    'PREPARE_SUBSCRIBE_ENTRY','START_SUBSCRIBE',
    'ELIGIBILITY_CHECK_STARTED','ELIGIBILITY_PASSED','CREATE_CHANNEL',
    'SUBSCRIBE_CALLED','CHANNEL_SUBSCRIBED'
  ].forEach(stage=>assert.ok(stages.includes(stage),'missing stage '+stage));

  console.log('runtime snapshot:',JSON.stringify({
    cloudConferenceId:realtime.cloudConferenceId,
    userId:realtime.userId,
    identity:realtime.identity,
    generation:realtime.generation,
    status:realtime.status,
    connected:realtime.connected,
    trace:stages.filter(stage=>[
      'ROUTE_RESOLVED','REALTIME_ROUTE_EVALUATED',
      'PREPARE_SUBSCRIBE_CALLED','START_SUBSCRIBE','CREATE_CHANNEL',
      'SUBSCRIBE_CALLED','CHANNEL_SUBSCRIBED'
    ].includes(stage))
  }));

  const stopped=sandbox.AutomaticSyncOrchestrator.stop();
  await stopped.promise;
  console.log('realtime startup end-to-end tests: passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
