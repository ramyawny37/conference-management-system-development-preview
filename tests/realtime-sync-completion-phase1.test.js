'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var root=path.resolve(__dirname,'..');
var REMOTE_ONE='11111111-1111-4111-8111-111111111111';
var REMOTE_TWO='22222222-2222-4222-8222-222222222222';
var USER_ID='33333333-3333-4333-8333-333333333333';
var DEVICE_ONE='44444444-4444-4444-8444-444444444444';
var DEVICE_TWO='55555555-5555-4555-8555-555555555555';

function delay(milliseconds){
  return new Promise(function(resolve){setTimeout(resolve,milliseconds);});
}

function deferred(){
  var resolve;
  var reject;
  var promise=new Promise(function(res,rej){resolve=res;reject=rej;});
  return {promise:promise,resolve:resolve,reject:reject};
}

function load(files,extra){
  var values={};
  var sandbox=Object.assign({
    window:null,
    Promise:Promise,
    Date:Date,
    JSON:JSON,
    Object:Object,
    String:String,
    Number:Number,
    Array:Array,
    Math:Math,
    Error:Error,
    structuredClone:global.structuredClone,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    navigator:{onLine:true},
    localStorage:{
      getItem:function(key){
        return Object.prototype.hasOwnProperty.call(values,key)
          ?values[key]
          :null;
      },
      setItem:function(key,value){values[key]=value;},
      removeItem:function(key){delete values[key];}
    },
    addEventListener:function(){},
    removeEventListener:function(){}
  },extra||{});
  sandbox.window=sandbox;
  files.forEach(function(file){
    vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),
      sandbox,
      {filename:file}
    );
  });
  return {window:sandbox,values:values};
}

async function testSupabaseRealtimeDeliveryAndDurableMarker(){
  var postgresHandler=null;
  var subscriptionHandler=null;
  var channel={
    on:function(type,filter,handler){
      assert.strictEqual(type,'postgres_changes');
      assert.strictEqual(filter.table,'conference_snapshots');
      assert.strictEqual(filter.filter,'conference_id=eq.'+REMOTE_ONE);
      postgresHandler=handler;
      return channel;
    },
    subscribe:function(handler){
      subscriptionHandler=handler;
      return channel;
    },
    unsubscribe:function(){return Promise.resolve();}
  };
  var client={
    channel:function(name){
      assert.strictEqual(name,'conference-snapshot-'+REMOTE_ONE);
      return channel;
    },
    removeChannel:function(value){
      assert.strictEqual(value,channel);
      return Promise.resolve();
    }
  };
  var loaded=load([
    'js/sync/remote-update-store.js',
    'js/sync/realtime.js',
    'js/sync/offline-first-integration.js'
  ],{
    SupabaseAuth:{
      getSession:function(){return {user:{id:USER_ID}};}
    },
    SupabaseClientLayer:{
      getClient:function(){return client;}
    }
  });
  var integration=loaded.window.OfflineFirstIntegration;
  var connectedPromise=integration.connectRealtime(REMOTE_ONE,{
    realtime:loaded.window.RealtimeSync,
    deviceIdentity:{id:DEVICE_ONE}
  });
  subscriptionHandler('SUBSCRIBED');
  var connected=await connectedPromise;
  assert.strictEqual(connected.ok,true);

  postgresHandler({eventType:'UPDATE',new:{
    conference_id:REMOTE_ONE,
    revision:7,
    updated_at:'2026-07-30T10:00:00.000Z',
    updated_by_device_id:DEVICE_TWO
  }});
  var update=integration.getRemoteUpdate(REMOTE_ONE);
  assert.ok(update,JSON.stringify({
    realtime:loaded.window.RealtimeSync.getState(),
    store:loaded.window.RemoteUpdateStore.getState()
  }));
  assert.strictEqual(update.revision,7);
  assert.strictEqual(update.deviceId,DEVICE_TWO);
  var markers=loaded.window.RemoteUpdateStore.list(REMOTE_ONE);
  assert.strictEqual(markers.length,1);
  assert.strictEqual(markers[0].status,'unreviewed');

  postgresHandler({eventType:'UPDATE',new:{
    conference_id:REMOTE_ONE,
    revision:8,
    updated_by_device_id:DEVICE_ONE
  }});
  markers=loaded.window.RemoteUpdateStore.list(REMOTE_ONE);
  assert.strictEqual(markers[0].status,'self_update');
  assert.strictEqual(markers[0].revision,8);
  [
    {eventType:'UPDATE',new:{revision:9,updated_by_device_id:DEVICE_TWO}},
    {eventType:'UPDATE',new:{
      conference_id:REMOTE_ONE,updated_by_device_id:DEVICE_TWO
    }},
    {eventType:'UPDATE',new:{
      conference_id:REMOTE_ONE,revision:-1,
      updated_by_device_id:DEVICE_TWO
    }},
    {eventType:'UPDATE',new:{
      conference_id:REMOTE_ONE,revision:'9',
      updated_by_device_id:DEVICE_TWO
    }},
    {eventType:'UPDATE',new:{
      conference_id:REMOTE_TWO,revision:9,
      updated_by_device_id:DEVICE_TWO
    }},
    {eventType:'DELETE',new:{
      conference_id:REMOTE_ONE,revision:9,
      updated_by_device_id:DEVICE_TWO
    }}
  ].forEach(function(payload){postgresHandler(payload);});
  assert.strictEqual(
    loaded.window.RemoteUpdateStore.list(REMOTE_ONE).length,
    2
  );

  var disconnected=await integration.disconnectRealtime({
    realtime:loaded.window.RealtimeSync
  });
  assert.strictEqual(disconnected.ok,true);
  assert.strictEqual(loaded.window.RealtimeSync.getState().connected,false);
}

async function testOrchestratorRealtimeLifecycle(){
  var currentLocalId='local-one';
  var remoteByLocal={
    'local-one':REMOTE_ONE,
    'local-two':REMOTE_TWO
  };
  var events=[];
  var integration={
    connectRealtime:function(remoteId){
      events.push('connect:'+remoteId);
      return Promise.resolve({ok:true,status:'connected'});
    },
    disconnectRealtime:function(){
      events.push('disconnect');
      return Promise.resolve({ok:true,status:'disconnected'});
    }
  };
  var loaded=load([
    'js/sync/sync-scheduler-state.js',
    'js/sync/automatic-sync-orchestrator.js'
  ],{
    SupabaseAuth:{
      getState:function(){return {authenticated:true};}
    },
    SupabaseClientLayer:{
      getState:function(){return {configured:true,available:true};},
      getClient:function(){return {};}
    }
  });
  var options={
    debounceMs:0,
    preferences:{get:function(){return {cloudSyncEnabled:true};}},
    serviceCheck:function(){return Promise.resolve({available:true});},
    getCurrentConference:function(){return {id:currentLocalId};},
    stateResolver:{resolve:function(input){
      return Promise.resolve({
        ok:true,
        status:'linked',
        data:{
          localConferenceId:input.localConferenceId,
          remoteConferenceId:remoteByLocal[input.localConferenceId],
          link:{remoteConferenceId:remoteByLocal[input.localConferenceId]}
        }
      });
    }},
    queueRunner:{run:function(){
      events.push('queue:'+currentLocalId);
      return Promise.resolve({ok:true});
    }},
    integration:integration
  };
  var orchestrator=loaded.window.AutomaticSyncOrchestrator;
  orchestrator.start(options);
  await delay(15);
  assert.deepStrictEqual(events.slice(0,2),[
    'queue:local-one',
    'connect:'+REMOTE_ONE
  ]);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(orchestrator.getRealtimeState())),
    {status:'connected',conferenceId:REMOTE_ONE,error:null}
  );

  currentLocalId='local-two';
  orchestrator.schedule('conference_changed',options);
  await delay(15);
  assert.ok(events.indexOf('disconnect')>=0);
  assert.ok(events.indexOf('connect:'+REMOTE_TWO)>=0);
  assert.strictEqual(
    orchestrator.getRealtimeState().conferenceId,
    REMOTE_TWO
  );

  loaded.window.navigator.onLine=false;
  orchestrator.schedule('offline_event',options);
  await delay(15);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(orchestrator.getRealtimeState())),
    {status:'disconnected',conferenceId:null,error:null}
  );

  loaded.window.navigator.onLine=true;
  orchestrator.schedule('online_event',options);
  await delay(15);
  assert.strictEqual(
    orchestrator.getRealtimeState().conferenceId,
    REMOTE_TWO
  );

  var stopped=orchestrator.stop();
  await stopped.promise;
  await delay(0);
  assert.strictEqual(events[events.length-1],'disconnect');
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(orchestrator.getRealtimeState())),
    {status:'disconnected',conferenceId:null,error:null}
  );
}

async function testRealtimeTerminalStatesAndLateSubscribed(){
  var terminalStatuses=['CHANNEL_ERROR','CLOSED','TIMED_OUT'];
  for(var index=0;index<terminalStatuses.length;index++){
    var subscriptionHandler=null;
    var removed=0;
    var channel={
      on:function(type,filter,handler){return channel;},
      subscribe:function(handler){
        subscriptionHandler=handler;
        return channel;
      }
    };
    var loaded=load(['js/sync/realtime.js']);
    var client={
      channel:function(){return channel;},
      removeChannel:function(){removed++;return Promise.resolve();}
    };
    var connected=loaded.window.RealtimeSync.connect(REMOTE_ONE,{
      client:client,
      session:{user:{id:USER_ID}}
    });
    subscriptionHandler(terminalStatuses[index]);
    var result=await connected;
    assert.strictEqual(result.ok,false);
    assert.strictEqual(removed,1);
    subscriptionHandler('SUBSCRIBED');
    assert.notStrictEqual(
      loaded.window.RealtimeSync.getState().status,
      'connected'
    );
    assert.strictEqual(
      loaded.window.RealtimeSync.getState().conferenceId,
      null
    );
  }

  subscriptionHandler=null;
  channel={
    on:function(){return channel;},
    subscribe:function(handler){subscriptionHandler=handler;return channel;}
  };
  var cleanupFailure=load(['js/sync/realtime.js']);
  var failedConnect=cleanupFailure.window.RealtimeSync.connect(REMOTE_ONE,{
    client:{
      channel:function(){return channel;},
      removeChannel:function(){return Promise.reject(new Error('REMOVE'));}
    },
    session:{user:{id:USER_ID}}
  });
  subscriptionHandler('CHANNEL_ERROR');
  await failedConnect;
  assert.strictEqual(
    cleanupFailure.window.RealtimeSync.getState().lastError.code,
    'REALTIME_CHANNEL_CLEANUP_FAILED'
  );
}

async function testDuplicateRealtimeConnect(){
  var subscriptions=0;
  var channels=0;
  var subscriptionHandler=null;
  var channel={
    on:function(){return channel;},
    subscribe:function(handler){
      subscriptions++;
      subscriptionHandler=handler;
      return channel;
    }
  };
  var loaded=load(['js/sync/realtime.js']);
  var options={
    client:{
      channel:function(){channels++;return channel;},
      removeChannel:function(){return Promise.resolve();}
    },
    session:{user:{id:USER_ID}}
  };
  var first=loaded.window.RealtimeSync.connect(REMOTE_ONE,options);
  var duplicatePending=await loaded.window.RealtimeSync.connect(
    REMOTE_ONE,options
  );
  assert.strictEqual(duplicatePending.status,'connecting');
  assert.strictEqual(channels,1);
  assert.strictEqual(subscriptions,1);
  subscriptionHandler('SUBSCRIBED');
  assert.strictEqual((await first).status,'connected');
  assert.strictEqual(
    (await loaded.window.RealtimeSync.connect(REMOTE_ONE,options)).status,
    'already_connected'
  );
  assert.strictEqual(channels,1);
}

function testPayloadValidationAndNoRevisionMutation(){
  var loaded=load([
    'js/sync/remote-update-store.js',
    'js/sync/offline-first-integration.js'
  ]);
  var integration=loaded.window.OfflineFirstIntegration;
  var before={
    localRevision:2,
    linkedRevision:2,
    baseRevision:2,
    queueOperations:0,
    snapshotsApplied:0
  };
  var invalid=[
    {type:'other',conferenceId:REMOTE_ONE,revision:3,deviceId:DEVICE_TWO},
    {type:'snapshot_changed',revision:3,deviceId:DEVICE_TWO},
    {type:'snapshot_changed',conferenceId:REMOTE_ONE,deviceId:DEVICE_TWO},
    {type:'snapshot_changed',conferenceId:REMOTE_ONE,revision:-1,
      deviceId:DEVICE_TWO},
    {type:'snapshot_changed',conferenceId:REMOTE_ONE,revision:'3',
      deviceId:DEVICE_TWO},
    {type:'snapshot_changed',conferenceId:REMOTE_TWO,revision:3,
      deviceId:DEVICE_TWO},
    {type:'snapshot_changed',conferenceId:REMOTE_ONE,revision:3}
  ];
  invalid.forEach(function(event){
    var result=integration.handleRealtimeEvent(event,{
      expectedConferenceId:REMOTE_ONE,
      deviceIdentity:{id:DEVICE_ONE},
      remoteUpdateStore:loaded.window.RemoteUpdateStore
    });
    assert.strictEqual(result.ok,false);
  });
  var untrusted=integration.handleRealtimeEvent({
    type:'snapshot_changed',
    conferenceId:REMOTE_ONE,
    revision:3,
    deviceId:DEVICE_TWO
  },{
    expectedConferenceId:REMOTE_ONE,
    remoteUpdateStore:loaded.window.RemoteUpdateStore
  });
  assert.strictEqual(untrusted.ok,false);
  var storeFailure=integration.handleRealtimeEvent({
    type:'snapshot_changed',
    conferenceId:REMOTE_ONE,
    revision:3,
    deviceId:DEVICE_TWO
  },{
    expectedConferenceId:REMOTE_ONE,
    deviceIdentity:{id:DEVICE_ONE},
    remoteUpdateStore:{add:function(){
      return {ok:false,status:'storage_write_failed'};
    }}
  });
  assert.strictEqual(storeFailure.ok,false);
  assert.strictEqual(storeFailure.error.code,'storage_write_failed');

  var self=integration.handleRealtimeEvent({
    type:'snapshot_changed',conferenceId:REMOTE_ONE,
    revision:3,deviceId:DEVICE_ONE
  },{
    expectedConferenceId:REMOTE_ONE,
    deviceIdentity:{id:DEVICE_ONE},
    remoteUpdateStore:loaded.window.RemoteUpdateStore
  });
  assert.strictEqual(self.ok,true);
  assert.strictEqual(
    loaded.window.RemoteUpdateStore.list(REMOTE_ONE)[0].status,
    'self_update'
  );
  assert.deepStrictEqual(before,{
    localRevision:2,
    linkedRevision:2,
    baseRevision:2,
    queueOperations:0,
    snapshotsApplied:0
  });
}

function testRemoteUpdateStoreContracts(){
  var loaded=load(['js/sync/remote-update-store.js']);
  var store=loaded.window.RemoteUpdateStore;
  var event={
    remoteConferenceId:REMOTE_ONE,
    revision:4,
    sourceDeviceId:DEVICE_TWO,
    receivedAt:'2026-07-30T10:00:00.000Z',
    status:'unreviewed'
  };
  assert.strictEqual(store.add(event).status,'saved');
  var duplicate=store.add(Object.assign({},event,{
    receivedAt:'2026-07-30T10:01:00.000Z'
  }));
  assert.strictEqual(duplicate.status,'duplicate');
  assert.strictEqual(duplicate.duplicate,true);
  assert.strictEqual(store.list(REMOTE_ONE).length,1);
  [
    Object.assign({},event,{revision:null}),
    Object.assign({},event,{revision:-1}),
    Object.assign({},event,{sourceDeviceId:null}),
    Object.assign({},event,{remoteConferenceId:'invalid'})
  ].forEach(function(invalid){
    assert.strictEqual(store.add(invalid).ok,false);
  });

  var corruptValues=[
    '{',
    '[]',
    JSON.stringify({[REMOTE_ONE]:{}}),
    JSON.stringify({[REMOTE_ONE]:[{remoteConferenceId:REMOTE_ONE}]})
  ];
  corruptValues.forEach(function(raw){
    var writes=0;
    var corrupt=load(['js/sync/remote-update-store.js'],{
      localStorage:{
        getItem:function(){return raw;},
        setItem:function(){writes++;}
      }
    }).window.RemoteUpdateStore;
    assert.strictEqual(corrupt.inspect().ok,false);
    assert.strictEqual(corrupt.add(event).ok,false);
    assert.strictEqual(writes,0);
  });

  var failed=load(['js/sync/remote-update-store.js'],{
    localStorage:{
      getItem:function(){return null;},
      setItem:function(){throw new Error('QUOTA');}
    }
  }).window.RemoteUpdateStore;
  assert.strictEqual(failed.add(event).status,'storage_write_failed');
}

async function testOrchestratorBlockersAndRaces(){
  function orchestratorEnvironment(settings){
    settings=settings||{};
    var connectIds=[],queues=0,current='local-one';
    var loaded=load([
      'js/sync/sync-scheduler-state.js',
      'js/sync/automatic-sync-orchestrator.js'
    ],{
      SupabaseAuth:{getState:function(){return {authenticated:true};}},
      SupabaseClientLayer:{
        getState:function(){return {configured:true,available:true};},
        getClient:function(){return {};}
      }
    });
    var options={
      debounceMs:0,
      preferences:{get:function(){return {cloudSyncEnabled:true};}},
      serviceCheck:function(){return Promise.resolve({available:true});},
      getCurrentConference:function(){return {id:current};},
      fullBackupService:{
        isFullRestoreCloudReviewPending:function(){
          return settings.marker===true;
        },
        isManualRelinkRequired:function(){
          return settings.manual===true;
        }
      },
      stateResolver:{resolve:function(input){
        var remote=input.localConferenceId==='local-two'
          ?REMOTE_TWO
          :REMOTE_ONE;
        return Promise.resolve({
          ok:true,status:settings.state||'linked',
          data:{
            remoteConferenceId:remote,
            link:{remoteConferenceId:remote}
          }
        });
      }},
      automaticLinking:{evaluate:function(){
        return Promise.resolve({ok:true,status:'skipped',data:{linked:false}});
      }},
      queueRunner:{run:function(){
        queues++;
        return settings.queuePromise||Promise.resolve(
          settings.queueFailure?{ok:false}:{ok:true}
        );
      }},
      integration:{
        connectRealtime:function(remoteId){
          connectIds.push(remoteId);
          return settings.connectPromise||Promise.resolve({
            ok:true,status:'connected'
          });
        },
        disconnectRealtime:function(){
          return settings.disconnectPromise||Promise.resolve({
            ok:true,status:'disconnected'
          });
        }
      }
    };
    return {
      loaded:loaded,options:options,
      orchestrator:loaded.window.AutomaticSyncOrchestrator,
      connects:function(){return connectIds.length;},
      connectIds:function(){return connectIds.slice();},
      queues:function(){return queues;},
      setCurrent:function(value){current=value;}
    };
  }

  var marker=orchestratorEnvironment({marker:true});
  var blocked=marker.orchestrator.start(marker.options);
  assert.strictEqual(blocked.ok,false);
  assert.strictEqual(blocked.code,'FULL_RESTORE_CLOUD_REVIEW_PENDING');
  await delay(5);
  assert.strictEqual(marker.queues(),0);
  assert.strictEqual(marker.connects(),0);

  var blockerCases=[
    {manual:true},
    {state:'needs_resolution'},
    {state:'pending_local_application'},
    {state:'local_only'},
    {queueFailure:true}
  ];
  for(var index=0;index<blockerCases.length;index++){
    var environment=orchestratorEnvironment(blockerCases[index]);
    environment.orchestrator.start(environment.options);
    await delay(10);
    assert.strictEqual(environment.connects(),0);
    if(blockerCases[index].manual){
      assert.strictEqual(environment.queues(),0);
    }
    var stopped=environment.orchestrator.stop();
    await stopped.promise;
  }

  var duplicate=orchestratorEnvironment({});
  assert.strictEqual(duplicate.orchestrator.start(duplicate.options).ok,true);
  assert.strictEqual(
    duplicate.orchestrator.start(duplicate.options).status,
    'already_started'
  );
  await delay(10);
  assert.strictEqual(duplicate.connects(),1);
  var duplicateStop=duplicate.orchestrator.stop();
  await duplicateStop.promise;

  var queueWait=deferred();
  var switched=orchestratorEnvironment({queuePromise:queueWait.promise});
  switched.orchestrator.start(switched.options);
  await delay(5);
  switched.setCurrent('local-two');
  queueWait.resolve({ok:true});
  await delay(15);
  assert.strictEqual(switched.connectIds().indexOf(REMOTE_ONE),-1);
  var switchedStop=switched.orchestrator.stop();
  await switchedStop.promise;

  var connectWait=deferred();
  var stopping=orchestratorEnvironment({connectPromise:connectWait.promise});
  stopping.orchestrator.start(stopping.options);
  await delay(5);
  var stopResult=stopping.orchestrator.stop();
  connectWait.resolve({ok:true,status:'connected'});
  await stopResult.promise;
  await delay(0);
  assert.notStrictEqual(
    stopping.orchestrator.getRealtimeState().status,
    'connected'
  );
  var restart=stopping.orchestrator.start(stopping.options);
  if(restart.promise)await restart.promise;
}

async function testProductionManagerSubscriberLifecycle(){
  var current={id:'local-one'};
  var activeListeners=[];
  var subscribeCount=0;
  var unsubscribeCount=0;
  var traces=[];
  var links={
    'local-one':{linkStatus:'cloud_linked',remoteConferenceId:REMOTE_ONE},
    'local-two':{linkStatus:'cloud_linked',remoteConferenceId:REMOTE_TWO}
  };
  var manager={
    subscribe:function(listener){
      subscribeCount++;
      activeListeners.push(listener);
      return function(){
        unsubscribeCount++;
        var index=activeListeners.indexOf(listener);
        if(index>=0)activeListeners.splice(index,1);
      };
    },
    traceDiagnostic:function(stage){traces.push(stage);},
    stopAll:function(){return Promise.resolve();}
  };
  var loaded=load([
    'js/sync/sync-scheduler-state.js',
    'js/sync/automatic-sync-orchestrator.js'
  ],{
    ConferenceRealtimeManager:manager,
    ConferenceLinkStore:{get:function(id){return links[id]||null;}},
    SupabaseDeviceIdentity:{getOrCreate:function(){return {id:DEVICE_ONE};}},
    getCurrentConference:function(){return current;}
  });
  var orchestrator=loaded.window.AutomaticSyncOrchestrator;
  var options={
    debounceMs:10000,
    preferences:{get:function(){return {cloudSyncEnabled:true};}},
    realtimeManager:manager
  };
  assert.strictEqual(orchestrator.start(options).status,'started');
  assert.strictEqual(orchestrator.start(options).status,'already_started');
  assert.strictEqual(subscribeCount,1);
  assert.strictEqual(activeListeners.length,1);
  var firstListener=activeListeners[0];
  firstListener({}, {cloudConferenceId:REMOTE_ONE,observedRevision:2,
    sourceDeviceId:DEVICE_TWO,classification:'remote_change_detected'});
  assert.strictEqual(orchestrator.getState().lastScheduledReason,
    'conference_changed');
  assert.strictEqual(traces.filter(function(stage){
    return stage==='CHANGE_SCHEDULED';
  }).length,1);
  firstListener({}, {cloudConferenceId:REMOTE_ONE,observedRevision:3,
    sourceDeviceId:DEVICE_ONE,classification:'self_update'});
  assert.strictEqual(traces.filter(function(stage){
    return stage==='CHANGE_SCHEDULED';
  }).length,1);
  current={id:'local-two'};
  orchestrator.schedule('conference_changed',options);
  assert.strictEqual(activeListeners.length,1);
  assert.strictEqual(subscribeCount,2);
  assert.strictEqual(unsubscribeCount,1);
  firstListener({}, {cloudConferenceId:REMOTE_ONE,observedRevision:4,
    sourceDeviceId:DEVICE_TWO,classification:'remote_change_detected'});
  assert.strictEqual(traces.filter(function(stage){
    return stage==='CHANGE_SCHEDULED';
  }).length,1);
  var stopped=orchestrator.stop();
  await stopped.promise;
  assert.strictEqual(activeListeners.length,0);
  assert.strictEqual(unsubscribeCount,2);
}

async function run(){
  await testSupabaseRealtimeDeliveryAndDurableMarker();
  await testOrchestratorRealtimeLifecycle();
  await testRealtimeTerminalStatesAndLateSubscribed();
  await testDuplicateRealtimeConnect();
  testPayloadValidationAndNoRevisionMutation();
  testRemoteUpdateStoreContracts();
  await testOrchestratorBlockersAndRaces();
  await testProductionManagerSubscriberLifecycle();
  console.log('realtime sync completion phase 1 tests: passed');
}

run().catch(function(error){
  console.error(error);
  process.exitCode=1;
});
