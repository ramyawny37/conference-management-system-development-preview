'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var root=path.resolve(__dirname,'..');
var LOCAL='11111111-1111-4111-8111-111111111111';
var CLOUD='22222222-2222-4222-8222-222222222222';
var USER='33333333-3333-4333-8333-333333333333';
var DEVICE='44444444-4444-4444-8444-444444444444';

function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
async function scenario(settings){
  settings=settings||{};
  var callback=null;
  var traces=[];
  var refreshCalls=0;
  var runnerCalls=0;
  var queueStatus=settings.queueStatus||'stable';
  var userId=USER;
  var deviceId=DEVICE;
  var currentId=LOCAL;
  var managerGeneration=4;
  var refreshFailure=settings.refreshFailure||null;
  var phase='startup';
  var link={localConferenceId:LOCAL,remoteConferenceId:CLOUD,
    knownRevision:settings.knownRevision||35,linkStatus:'linked',
    pendingLocalApplication:false,conflictId:null,conflictStatus:null};
  var appData={currentConferenceId:LOCAL,conferences:[{id:LOCAL}],
    conferenceLifecycle:{records:{}}};
  appData.conferenceLifecycle.records[LOCAL]={localLifecycle:'active',
    cloudLifecycle:'cloud_linked'};
  var manager={
    prepareAndSubscribe:function(app,id,options){
      callback=options.onReconnectSubscribed;
      return Promise.resolve({ok:true,status:'subscribed'});
    },
    getState:function(){return {status:'subscribed',
      generation:managerGeneration};},
    traceDiagnostic:function(stage,data){traces.push({stage:stage,data:data});},
    subscribe:function(){return function(){};},
    stopAll:function(){return Promise.resolve();}
  };
  var sandbox={window:null,console:console,Promise:Promise,Date:Date,
    JSON:JSON,Object:Object,String:String,Number:Number,Array:Array,Math:Math,
    structuredClone:global.structuredClone,setTimeout:setTimeout,
    clearTimeout:clearTimeout,addEventListener:function(){},
    removeEventListener:function(){},navigator:{onLine:true},appData:appData,
    SupabaseAuth:{getState:function(){return {authenticated:!!userId,
      user:userId?{id:userId}:null};}},
    SupabaseDeviceIdentity:{getOrCreate:function(){return {id:deviceId};}},
    SupabaseClientLayer:{getState:function(){return {configured:true,
      available:true};},getClient:function(){return {}; }},
    ConferenceLinkStore:{get:function(){return link;}},
    OfflineSyncQueue:{getConferenceReadiness:function(){
      return Promise.resolve(queueStatus==='stable'
        ?{ok:true,status:'stable',data:{blockingOperations:[]}}
        :{ok:false,status:'not_stable',data:{blockingOperations:[{
          status:queueStatus
        }]}});
    }},
    ConferenceRealtimeManager:manager,
    AutomaticSyncPreferences:{get:function(){return {cloudSyncEnabled:true,
      automaticSyncEnabled:true};}},
    FullBackupService:{isFullRestoreCloudReviewPending:function(){return false;},
      isManualRelinkRequired:function(){return false;}},
    getCurrentConference:function(){return currentId?{id:currentId}:null;}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root,
    'js/sync/sync-scheduler-state.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root,
    'js/sync/automatic-sync-orchestrator.js'),'utf8'),sandbox);
  var options={debounceMs:0,appData:appData,realtimeManager:manager,
    linkStore:sandbox.ConferenceLinkStore,queue:sandbox.OfflineSyncQueue,
    auth:sandbox.SupabaseAuth,deviceIdentity:sandbox.SupabaseDeviceIdentity,
    preferences:sandbox.AutomaticSyncPreferences,
    clientLayer:sandbox.SupabaseClientLayer,
    getCurrentConference:sandbox.getCurrentConference,
    serviceCheck:function(){return Promise.resolve({available:true});},
    stateResolver:{resolve:function(){return Promise.resolve({ok:true,
      status:'linked',data:{link:link,remoteConferenceId:CLOUD}});}},
    integration:{getConferenceSyncState:function(){return {context:{
      localConferenceId:LOCAL,conferenceId:CLOUD,
      baseRevision:link.knownRevision}};},
      disconnectRealtime:function(){return Promise.resolve({ok:true});}},
    queueRunner:{run:function(){runnerCalls++;
      return Promise.resolve({ok:true,status:'empty'});}},
    discoveredOpenService:{refreshLinkedLocalConference:function(){
      refreshCalls++;
      if(phase==='startup')return Promise.resolve({ok:true,status:'up_to_date',
        data:{revision:link.knownRevision}});
      if(refreshFailure){
        return Promise.resolve({ok:false,status:refreshFailure});
      }
      var revision=settings.cloudRevision===undefined
        ?40:settings.cloudRevision;
      var previousRevision=link.knownRevision;
      if(revision>previousRevision)link.knownRevision=revision;
      return Promise.resolve({ok:true,
        status:revision>previousRevision?'opened':'up_to_date',
        data:{revision:revision}});
    }}
  };
  sandbox.AutomaticSyncOrchestrator.start(options);
  await delay(30);
  phase='catchup';
  return {sandbox:sandbox,options:options,link:link,traces:traces,
    callback:function(payload){return callback(payload);},
    wait:function(){return delay(40);},
    refreshCalls:function(){return refreshCalls;},
    runnerCalls:function(){return runnerCalls;},
    setQueueStatus:function(value){queueStatus=value;},
    setUser:function(value){userId=value;},
    setDevice:function(value){deviceId=value;},
    setConference:function(value){currentId=value;},
    setRefreshFailure:function(value){refreshFailure=value;},
    setGeneration:function(value){managerGeneration=value;}};
}
function payload(generation,knownRevision){return {localConferenceId:LOCAL,
  cloudConferenceId:CLOUD,knownRevision:knownRevision,
  generation:generation,attemptId:generation};}

(async function(){
  // A/C/J: 35 -> 40, duplicate callbacks/events collapse to one catch-up.
  var applied=await scenario({knownRevision:35,cloudRevision:40});
  var baseline=applied.refreshCalls();
  applied.callback(payload(4,35));
  applied.callback(payload(4,35));
  applied.sandbox.AutomaticSyncOrchestrator.schedule(
    'conference_changed',applied.options
  );
  await applied.wait();
  assert.strictEqual(applied.refreshCalls()-baseline,1);
  assert.strictEqual(applied.link.knownRevision,40);
  var appliedStages=applied.traces.map(function(item){return item.stage;});
  ['RECONNECT_CATCHUP_SCHEDULED','RECONNECT_CATCHUP_STARTED',
    'RECONNECT_CATCHUP_METADATA','RECONNECT_CATCHUP_DOWNLOAD_REQUIRED',
    'RECONNECT_CATCHUP_COMPLETED'].forEach(function(stage){
    assert.ok(appliedStages.includes(stage),stage);
  });

  // B: metadata-only up-to-date path performs no second download path.
  var current=await scenario({knownRevision:40,cloudRevision:40});
  baseline=current.refreshCalls();
  current.callback(payload(4,40));
  await current.wait();
  assert.strictEqual(current.refreshCalls()-baseline,1);
  assert.strictEqual(current.link.knownRevision,40);
  assert.ok(current.traces.some(function(item){
    return item.stage==='RECONNECT_CATCHUP_UP_TO_DATE';
  }));

  // D: an old generation never schedules metadata.
  var stale=await scenario({knownRevision:35,cloudRevision:40});
  baseline=stale.refreshCalls();
  stale.setGeneration(5);
  stale.callback(payload(4,35));
  await stale.wait();
  assert.strictEqual(stale.refreshCalls(),baseline);
  assert.ok(stale.traces.some(function(item){
    return item.stage==='RECONNECT_CATCHUP_STALE';
  }));

  // E/F: any unstable queue, including reconciliation, blocks remote apply.
  for(var queueState of ['pending','requires_reconciliation']){
    var blocked=await scenario({knownRevision:35,cloudRevision:40,
      queueStatus:queueState});
    baseline=blocked.refreshCalls();
    blocked.callback(payload(4,35));
    await blocked.wait();
    assert.strictEqual(blocked.refreshCalls(),baseline,queueState);
    assert.strictEqual(blocked.link.knownRevision,35,queueState);
    assert.ok(blocked.traces.some(function(item){
      return item.stage==='RECONNECT_CATCHUP_BLOCKED';
    }),queueState);
  }

  // G: user/device/conference changes invalidate the scheduled descriptor.
  for(var change of ['user','device','conference']){
    var changed=await scenario({knownRevision:35,cloudRevision:40});
    baseline=changed.refreshCalls();
    changed.callback(payload(4,35));
    if(change==='user')changed.setUser('');
    if(change==='device')changed.setDevice('changed-device');
    if(change==='conference')changed.setConference('other-conference');
    await changed.wait();
    assert.strictEqual(changed.refreshCalls(),baseline,change);
    assert.strictEqual(changed.link.knownRevision,35,change);
  }

  // H/I: metadata/download/materialization failures never publish revision.
  for(var failure of ['metadata_failed','materialization_failed']){
    var failed=await scenario({knownRevision:35,cloudRevision:40,
      refreshFailure:failure});
    baseline=failed.refreshCalls();
    failed.callback(payload(4,35));
    await failed.wait();
    assert.strictEqual(failed.refreshCalls()-baseline,1,failure);
    assert.strictEqual(failed.link.knownRevision,35,failure);
    if(failure==='metadata_failed'){
      failed.setRefreshFailure(null);
      failed.setGeneration(5);
      failed.callback(payload(5,35));
      await failed.wait();
      assert.strictEqual(failed.link.knownRevision,40,
        'metadata failure remains eligible for a later reconnect attempt');
    }
  }

  assert.ok(applied.sandbox.AutomaticSyncOrchestrator.triggerReasons
    .includes('realtime_reconnected'));
  console.log('realtime reconnect catch-up tests passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
