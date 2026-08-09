const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const LOCAL='11111111-1111-4111-8111-111111111111';
const CLOUD='22222222-2222-4222-8222-222222222222';
const USER='33333333-3333-4333-8333-333333333333';
const DEVICE='44444444-4444-4444-8444-444444444444';

function environment(settings={}){
  const channels=[];
  const removed=[];
  const events=[];
  const stored=[];
  const suspendedQueue=[];
  const timers=[];
  let accessOverride=null;
  let loggedOut=settings.logout===true;
  let readinessReads=0;
  let operations=settings.operations||[];
  let link=settings.noLink?null:Object.assign({
    localConferenceId:LOCAL,
    remoteConferenceId:CLOUD,
    linkStatus:'cloud_linked',
    knownRevision:3,
    syncState:{initialSnapshotComplete:true}
  },settings.link||{});
  const client={
    channel(name){
      const channel={
        name,
        callback:null,
        statusCallback:null,
        on(type,filter,callback){
          this.filter=filter;
          this.callback=callback;
          return this;
        },
        subscribe(callback){
          this.statusCallback=callback;
          if(!settings.deferSubscribe)callback('SUBSCRIBED');
          return this;
        },
        unsubscribe(){return Promise.resolve();}
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel){
      removed.push(channel);
      if(settings.removeFails)return Promise.reject(new Error('remove'));
      return Promise.resolve();
    }
  };
  const appData={
    currentConferenceId:settings.currentConferenceId===undefined
      ?LOCAL:settings.currentConferenceId,
    conferences:[{id:LOCAL,name:'Local data'}],
    conferenceLifecycle:{records:{
      [LOCAL]:{
        localLifecycle:settings.archived?'archived':'active',
        cloudLifecycle:settings.unpublished?'unpublished':'cloud_linked'
      }
    }}
  };
  const sandbox={
    console,
    Promise,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Math,
    RegExp,
    setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},
    clearTimeout(){},
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    navigator:{onLine:settings.offline!==true},
    appData,
    ConferenceLinkStore:{
      inspect(){return settings.corruptLinks
        ?{ok:false,status:'corrupt'}:{ok:true,status:'read'};},
      get(){return link;}
    },
    FullBackupService:{
      getFullRestoreCloudReviewMarker(){
        return {pending:settings.restore===true};
      },
      isManualRelinkRequired(){
        return settings.manual===true;
      }
    },
    ConferencePublishingEngine:{
      getState(){return {activeConferenceIds:
        settings.publishing?[LOCAL]:[]};}
    },
    ConferencePublishRecovery:{
      getState(){return {activeConferenceIds:
        settings.recovery?[LOCAL]:[]};}
    },
    SupabaseAuth:{
      getSession(){
        return loggedOut?null:{user:{id:USER}};
      }
    },
    SystemAccessService:{
      refresh(){
        if(settings.accessFails)return Promise.reject(new Error('access'));
        if(accessOverride)return accessOverride;
        return Promise.resolve({
          source:settings.cached?'cache':'server',
          fresh:settings.cached?false:true,
          authenticated:true,
          userId:USER,
          accountStatus:settings.blocked?'blocked':'approved'
        });
      }
    },
    ConferenceMembersService:{
      getCurrentAccess(){
        if(settings.membershipFails){
          return Promise.resolve({ok:false,status:'access_denied'});
        }
        return Promise.resolve({
          ok:true,status:'available',data:{
            userId:USER,
            role:settings.role||'owner',
            canSync:['owner','manager'].includes(settings.role||'owner')
          }
        });
      }
    },
    OfflineSyncQueue:{
      getConferenceReadiness(){
        readinessReads++;
        const active=operations.filter(operation=>
          ['pending','processing','failed','server_applied',
            'requires_reconciliation'].includes(operation.status));
        return Promise.resolve(active.length
          ?{ok:false,status:'not_stable',data:{blockingOperations:active}}
          :{ok:true,status:'stable',data:{blockingOperations:[]}});
      }
    },
    AutomaticQueueRunner:{
      suspendConference(id,reason){suspendedQueue.push({id,reason});}
    },
    RemoteUpdateStore:{
      add(record){stored.push(record);return {ok:true,status:'saved'};}
    },
    SupabaseClientLayer:{getClient(){return client;}}
  };
  sandbox.window=sandbox;
  const source=fs.readFileSync(path.join(
    __dirname,'..','js','sync','conference-realtime-manager.js'
  ),'utf8');
  vm.runInNewContext(source,sandbox,{
    filename:'conference-realtime-manager.js'
  });
  sandbox.ConferenceRealtimeManager.subscribe((state,event)=>{
    if(event){
      events.push({state,event});
      if(typeof settings.onRealtimeEvent==='function'){
        settings.onRealtimeEvent(event);
      }
    }
  });
  return {
    manager:sandbox.ConferenceRealtimeManager,
    sandbox,appData,client,channels,removed,events,stored,
    suspendedQueue,timers,
    readinessReads(){return readinessReads;},
    setOperations(value){operations=value;},
    setLink(value){link=value;},
    setAccessPromise(value){accessOverride=value;},
    setLoggedOut(value){loggedOut=value;},
    setCurrentConference(value){appData.currentConferenceId=value;},
    runTimer(index){timers[index].fn();}
  };
}

async function tick(){
  await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
}
function deferred(){
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
}
function accessResult(){
  return {source:'server',fresh:true,authenticated:true,userId:USER,
    accountStatus:'approved'};
}

(async function(){
  const successRoles=[
    'owner','manager','viewer','accommodation_viewer','transport_viewer'
  ];
  for(const role of successRoles){
    const env=environment({role});
    const result=await env.manager.prepareAndSubscribe(
      env.appData,LOCAL,{client:env.client}
    );
    assert.strictEqual(result.ok,true,role);
    assert.strictEqual(result.status,'subscribed');
    assert.strictEqual(env.channels.length,1);
  }
  const normalizedCloudLink=environment({link:{linkStatus:'linked'}});
  assert.strictEqual((await normalizedCloudLink.manager.prepareAndSubscribe(
    normalizedCloudLink.appData,LOCAL,{client:normalizedCloudLink.client}
  )).status,'subscribed');

  const blockers=[
    [{unpublished:true},'conference_link_invalid'],
    [{noLink:true},'conference_link_invalid'],
    [{link:{linkStatus:'unsynced'}},'conference_link_invalid'],
    [{link:{knownRevision:null}},'conference_link_invalid'],
    [{membershipFails:true},'membership_read_denied'],
    [{logout:true},'authentication_required'],
    [{blocked:true},'account_blocked'],
    [{cached:true},'fresh_system_access_required'],
    [{offline:true},'offline'],
    [{restore:true},'cloud_isolation_active'],
    [{manual:true},'cloud_isolation_active'],
    [{publishing:true},'publishing_active'],
    [{recovery:true},'recovery_active'],
    [{link:{conflictId:'x'}},'conference_link_invalid'],
    [{archived:true},'conference_archived'],
    [{operations:[{status:'processing'}]},'queue_not_stable'],
    [{operations:[{status:'server_applied'}]},'queue_not_stable'],
    [{operations:[{status:'pending'}]},'queue_not_stable']
  ];
  for(const [settings,code] of blockers){
    const env=environment(settings);
    const result=await env.manager.prepareAndSubscribe(
      env.appData,LOCAL,{client:env.client}
    );
    assert.strictEqual(result.ok,false,code);
    assert.strictEqual(result.error.code,code);
    assert.strictEqual(env.channels.length,0,code);
  }

  const reconciliation=environment({
    operations:[{status:'requires_reconciliation'}]
  });
  assert.strictEqual((await reconciliation.manager.prepareAndSubscribe(
    reconciliation.appData,LOCAL,{client:reconciliation.client}
  )).status,'subscribed');

  const duplicate=environment({deferSubscribe:true});
  const first=duplicate.manager.prepareAndSubscribe(
    duplicate.appData,LOCAL,{client:duplicate.client}
  );
  const second=duplicate.manager.prepareAndSubscribe(
    duplicate.appData,LOCAL,{client:duplicate.client}
  );
  await tick();
  assert.strictEqual(duplicate.channels.length,1);
  duplicate.channels[0].statusCallback('SUBSCRIBED');
  assert.strictEqual((await first).ok,true);
  assert.strictEqual((await second).ok,true);

  const alreadySubscribed=environment();
  await alreadySubscribed.manager.prepareAndSubscribe(
    alreadySubscribed.appData,LOCAL,{client:alreadySubscribed.client}
  );
  const repeatedResult=await Promise.race([
    alreadySubscribed.manager.prepareAndSubscribe(
      alreadySubscribed.appData,LOCAL,{client:alreadySubscribed.client}
    ),
    new Promise((resolve)=>setTimeout(function(){
      resolve({ok:false,status:'timeout'});
    },50))
  ]);
  assert.strictEqual(repeatedResult.ok,true);
  assert.strictEqual(repeatedResult.status,'already_subscribed');
  assert.strictEqual(alreadySubscribed.channels.length,1);

  const eventEnv=environment();
  await eventEnv.manager.prepareAndSubscribe(
    eventEnv.appData,LOCAL,{client:eventEnv.client}
  );
  const channel=eventEnv.channels[0];
  const payload={
    eventType:'UPDATE',
    commit_timestamp:'2026-07-30T10:00:00.000Z',
    new:{
      id:'snapshot',
      conference_id:CLOUD,
      revision:4,
      updated_by_device_id:DEVICE,
      updated_by_user_id:USER,
      updated_at:'2026-07-30T10:00:00.000Z'
    }
  };
  const eventReadinessBefore=eventEnv.readinessReads();
  channel.callback(payload);
  channel.callback(payload);
  await tick();
  assert.strictEqual(eventEnv.events.length,1);
  assert.strictEqual(
    eventEnv.events[0].event.classification,
    'remote_change_detected'
  );
  assert.strictEqual(eventEnv.stored.length,1);
  assert.strictEqual(
    eventEnv.manager.getState(LOCAL).remoteChangeDetected,true
  );
  const acceptedDiagnostic=eventEnv.manager.getEventDiagnostics();
  assert.strictEqual(acceptedDiagnostic.lastAcceptedRevision,4);
  assert.strictEqual(
    acceptedDiagnostic.lastPostQueueClassification,'remote_change_detected'
  );
  assert.strictEqual(acceptedDiagnostic.lastNotifyResult.executed,true);
  assert.strictEqual(eventEnv.readinessReads()-eventReadinessBefore,1,
    'one remote event performs one queue readiness read');
  assert.deepStrictEqual(
    eventEnv.manager.getDiagnostics().map(item=>item.stage).slice(0,10),
    ['PREPARE_SUBSCRIBE_ENTRY','START_SUBSCRIBE',
      'SUBSCRIBE_ATTEMPT_STARTED',
      'ELIGIBILITY_CHECK_STARTED','ELIGIBILITY_PASSED',
      'CREATE_CHANNEL','SUBSCRIBE_CALLED',
      'CHANNEL_SUBSCRIBED','EVENT_RECEIVED','REVISION_RECEIVED']
  );

  channel.callback(Object.assign({},payload,{
    new:Object.assign({},payload.new,{revision:3})
  }));
  channel.callback(Object.assign({},payload,{
    new:Object.assign({},payload.new,{revision:2})
  }));
  await tick();
  assert.deepStrictEqual(
    eventEnv.events.map(item=>item.event.classification),
    ['remote_change_detected','duplicate_revision','stale_revision']
  );

  const selfEvent=environment();
  await selfEvent.manager.prepareAndSubscribe(
    selfEvent.appData,LOCAL,{
      client:selfEvent.client,
      isConfirmedSelfEvent:event=>event.observedRevision===3
    }
  );
  selfEvent.channels[0].callback(Object.assign({},payload,{
    new:Object.assign({},payload.new,{revision:3})
  }));
  await tick();
  assert.strictEqual(
    selfEvent.events[0].event.classification,'self_update'
  );
  selfEvent.channels[0].callback(Object.assign({},payload,{
    commit_timestamp:'2026-07-30T10:00:01.000Z',
    new:Object.assign({},payload.new,{revision:4})
  }));
  await tick();
  assert.strictEqual(
    selfEvent.events[1].event.classification,
    'remote_change_detected'
  );

  const before=JSON.stringify(eventEnv.appData);
  assert.strictEqual(
    eventEnv.manager.getState(LOCAL).cloudConferenceId,CLOUD
  );
  assert.strictEqual(JSON.stringify(eventEnv.appData),before);
  assert.strictEqual(
    eventEnv.sandbox.ConferenceLinkStore.get().knownRevision,3
  );

  const invalidCount=eventEnv.events.length;
  channel.callback({eventType:'DELETE',new:payload.new});
  channel.callback({
    eventType:'UPDATE',
    new:Object.assign({},payload.new,{conference_id:
      '55555555-5555-4555-8555-555555555555'})
  });
  await tick();
  assert.strictEqual(eventEnv.events.length,invalidCount);

  const conflict=environment();
  await conflict.manager.prepareAndSubscribe(
    conflict.appData,LOCAL,{client:conflict.client}
  );
  conflict.setOperations([{status:'pending'}]);
  const conflictReadinessBefore=conflict.readinessReads();
  conflict.channels[0].callback(payload);
  await tick();
  assert.strictEqual(
    conflict.events[0].event.classification,'potential_conflict'
  );
  const conflictDiagnostic=conflict.manager.getEventDiagnostics();
  assert.strictEqual(
    conflictDiagnostic.lastPostQueueClassification,'potential_conflict'
  );
  assert.strictEqual(conflictDiagnostic.lastDropStage,
    'post_queue_classification');
  assert.strictEqual(conflictDiagnostic.lastDropReason,'potential_conflict');
  const conflictQueueTrace=conflict.manager.getDiagnostics()
    .filter(item=>item.stage==='QUEUE_INSPECTION_COMPLETED').at(-1);
  assert.strictEqual(conflictQueueTrace.data.queueStable,false);
  assert.strictEqual(conflictQueueTrace.data.pendingCount,1);
  assert.strictEqual(conflictQueueTrace.data.processingCount,0);
  assert.strictEqual(conflictQueueTrace.data.failedCount,0);
  assert.strictEqual(conflictQueueTrace.data.conflictCount,0);
  assert.strictEqual(conflict.readinessReads()-conflictReadinessBefore,1,
    'potential conflict performs no additional queue inspection');
  assert.strictEqual(conflict.suspendedQueue.length,0,
    'potential conflict must not suspend local queue processing');
  assert.strictEqual(conflict.manager.getState(LOCAL).status,'suspended');
  assert.strictEqual(
    conflict.sandbox.ConferenceLinkStore.get().knownRevision,3
  );

  const oldGeneration=environment();
  await oldGeneration.manager.prepareAndSubscribe(
    oldGeneration.appData,LOCAL,{client:oldGeneration.client}
  );
  const oldChannel=oldGeneration.channels[0];
  await oldGeneration.manager.close(LOCAL,{client:oldGeneration.client});
  oldChannel.callback(payload);
  await tick();
  assert.strictEqual(oldGeneration.events.length,0);
  assert.strictEqual(oldGeneration.removed.length,1);

  const reconnect=environment();
  await reconnect.manager.prepareAndSubscribe(
    reconnect.appData,LOCAL,{client:reconnect.client}
  );
  reconnect.channels[0].statusCallback('CHANNEL_ERROR');
  await tick();
  assert.strictEqual(reconnect.timers.length,1);
  assert.strictEqual(
    reconnect.manager.getState(LOCAL).status,'reconnecting'
  );
  assert.strictEqual(
    reconnect.manager.maxReconnectAttempts,5
  );

  // A/B: a slow old eligibility attempt cannot race a reconnect cycle.
  let simulatedIphoneRevision=29;
  const slowReconnect=environment({link:{knownRevision:29},
    onRealtimeEvent:event=>{
      if(event.classification==='remote_change_detected'){
        simulatedIphoneRevision=event.observedRevision;
      }
    }});
  await slowReconnect.manager.prepareAndSubscribe(
    slowReconnect.appData,LOCAL,{client:slowReconnect.client}
  );
  const slowOldChannel=slowReconnect.channels[0];
  const slowAccess=deferred();
  slowReconnect.setAccessPromise(slowAccess.promise);
  const staleFlight=slowReconnect.manager.prepareAndSubscribe(
    slowReconnect.appData,LOCAL,{client:slowReconnect.client}
  );
  await tick();
  slowOldChannel.statusCallback('CHANNEL_ERROR');
  await tick();
  assert.strictEqual(slowReconnect.timers.length,1);
  slowAccess.resolve(accessResult());
  assert.strictEqual((await staleFlight).status,'stale_attempt');
  slowReconnect.setAccessPromise(Promise.resolve(accessResult()));
  slowReconnect.runTimer(0);
  await tick();
  const recoveredState=slowReconnect.manager.getState(LOCAL);
  assert.strictEqual(recoveredState.status,'subscribed');
  assert.strictEqual(recoveredState.activeAttemptId,null,
    'successful reconnect releases the active connectPromise/attempt');
  assert.strictEqual(slowReconnect.channels.length,2);
  const slowStages=slowReconnect.manager.getDiagnostics()
    .map(item=>item.stage);
  assert.ok(slowStages.includes('SUBSCRIBE_ATTEMPT_STALE'));
  assert.ok(slowStages.includes('SUBSCRIBE_ATTEMPT_CANCELLED'));
  assert.ok(slowStages.includes('RECONNECT_SCHEDULED'));
  assert.ok(slowStages.includes('RECONNECT_ATTEMPT_STARTED'));
  assert.ok(slowStages.includes('RECONNECT_SUBSCRIBED'));
  assert.strictEqual(slowStages.includes('ILLEGAL_TRANSITION_PREVENTED'),false);

  // Practical regression: the replacement channel accepts the latest laptop
  // revision without refresh or a second channel.
  slowReconnect.channels[1].callback({eventType:'UPDATE',new:{
    id:'latest',conference_id:CLOUD,revision:34,
    updated_by_device_id:DEVICE,updated_by_user_id:USER,
    updated_at:'2026-08-07T10:00:00.000Z'
  }});
  await tick();
  assert.strictEqual(slowReconnect.events.at(-1).event.observedRevision,34);
  assert.strictEqual(simulatedIphoneRevision,34);
  assert.strictEqual(slowReconnect.manager.getState(LOCAL).status,
    'subscribed');

  // C: repeated failures from one channel produce one timer and one attempt.
  const repeatedErrors=environment();
  await repeatedErrors.manager.prepareAndSubscribe(
    repeatedErrors.appData,LOCAL,{client:repeatedErrors.client}
  );
  repeatedErrors.channels[0].statusCallback('CHANNEL_ERROR');
  repeatedErrors.channels[0].statusCallback('CHANNEL_ERROR');
  repeatedErrors.channels[0].statusCallback('CLOSED');
  await tick();
  assert.strictEqual(repeatedErrors.timers.length,1);
  repeatedErrors.runTimer(0);
  await tick();
  assert.strictEqual(repeatedErrors.channels.length,2);
  assert.strictEqual(repeatedErrors.manager.getState(LOCAL).status,
    'subscribed');

  // D: changing conference context invalidates eligibility in flight.
  const conferenceRace=environment();
  const conferenceAccess=deferred();
  conferenceRace.setAccessPromise(conferenceAccess.promise);
  const conferenceFlight=conferenceRace.manager.prepareAndSubscribe(
    conferenceRace.appData,LOCAL,{client:conferenceRace.client}
  );
  conferenceRace.setCurrentConference(
    '55555555-5555-4555-8555-555555555555'
  );
  conferenceAccess.resolve(accessResult());
  assert.strictEqual((await conferenceFlight).status,'stale_attempt');
  assert.strictEqual(conferenceRace.channels.length,0);

  // E: logout invalidates the captured authenticated context.
  const logoutRace=environment();
  const logoutAccess=deferred();
  logoutRace.setAccessPromise(logoutAccess.promise);
  const logoutFlight=logoutRace.manager.prepareAndSubscribe(
    logoutRace.appData,LOCAL,{client:logoutRace.client}
  );
  logoutRace.setLoggedOut(true);
  logoutAccess.resolve(accessResult());
  assert.strictEqual((await logoutFlight).status,'stale_attempt');
  assert.strictEqual(logoutRace.channels.length,0);

  // F: a terminal callback from an old generation cannot dirty the new one.
  const oldClose=environment();
  await oldClose.manager.prepareAndSubscribe(
    oldClose.appData,LOCAL,{client:oldClose.client}
  );
  const supersededChannel=oldClose.channels[0];
  supersededChannel.statusCallback('CHANNEL_ERROR');
  await tick();
  oldClose.runTimer(0);
  await tick();
  const replacementState=oldClose.manager.getState(LOCAL);
  const replacementGeneration=replacementState.generation;
  const replacementTimerCount=oldClose.timers.length;
  const replacementRemovedCount=oldClose.removed.length;
  assert.strictEqual(replacementState.status,'subscribed');
  assert.strictEqual(replacementState.activeAttemptId,null);
  supersededChannel.statusCallback('CLOSED');
  await tick();
  const afterLateClose=oldClose.manager.getState(LOCAL);
  assert.strictEqual(afterLateClose.status,'subscribed');
  assert.strictEqual(afterLateClose.generation,replacementGeneration);
  assert.strictEqual(oldClose.timers.length,replacementTimerCount);
  assert.strictEqual(oldClose.removed.length,replacementRemovedCount);
  assert.strictEqual(oldClose.channels.length,2);
  assert.strictEqual(oldClose.manager.getDiagnostics().some(item=>
    item.stage==='ILLEGAL_TRANSITION_PREVENTED'),false);

  // stop/logout invalidates an in-flight attempt and its reconnect timer.
  const stoppedAttempt=environment();
  const stoppedAccess=deferred();
  stoppedAttempt.setAccessPromise(stoppedAccess.promise);
  const stoppedFlight=stoppedAttempt.manager.prepareAndSubscribe(
    stoppedAttempt.appData,LOCAL,{client:stoppedAttempt.client}
  );
  const stoppedResult=stoppedAttempt.manager.stopAll({
    client:stoppedAttempt.client
  });
  stoppedAccess.resolve(accessResult());
  assert.strictEqual((await stoppedFlight).status,'stale_attempt');
  await stoppedResult;
  assert.strictEqual(stoppedAttempt.manager.getState(LOCAL).status,'closed');
  assert.strictEqual(stoppedAttempt.channels.length,0);

  const identityChange=environment();
  await identityChange.manager.prepareAndSubscribe(
    identityChange.appData,LOCAL,{client:identityChange.client}
  );
  identityChange.setLink(Object.assign(
    {},identityChange.sandbox.ConferenceLinkStore.get(),{
      remoteConferenceId:'66666666-6666-4666-8666-666666666666'
    }
  ));
  await identityChange.manager.prepareAndSubscribe(
    identityChange.appData,LOCAL,{client:identityChange.client}
  );
  assert.strictEqual(identityChange.channels.length,2);
  assert.strictEqual(identityChange.removed.length,1);

  const revalidate=environment();
  await revalidate.manager.prepareAndSubscribe(
    revalidate.appData,LOCAL,{client:revalidate.client}
  );
  revalidate.sandbox.navigator.onLine=false;
  const revalidated=await revalidate.manager.prepareAndSubscribe(
    revalidate.appData,LOCAL,{client:revalidate.client}
  );
  assert.strictEqual(revalidated.ok,false);
  assert.strictEqual(
    revalidate.manager.getState(LOCAL).status,'suspended'
  );

  const source=fs.readFileSync(path.join(
    __dirname,'..','js','sync','conference-realtime-manager.js'
  ),'utf8');
  assert.doesNotMatch(source,/ConferenceRepository\.(prepare|record|save)/);
  assert.doesNotMatch(source,/knownRevision\s*=/);
  assert.doesNotMatch(source,/coalesceSnapshotOperation|enqueueSnapshot/);
  assert.doesNotMatch(source,/applyRemote|applySnapshot/);

  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.ok(
    html.indexOf('conference-queue-integration.js')<
    html.indexOf('conference-realtime-manager.js')
  );
  assert.ok(
    html.indexOf('conference-realtime-manager.js')<
    html.indexOf('automatic-sync-orchestrator.js')
  );
  const orchestrator=fs.readFileSync(path.join(
    __dirname,'..','js','sync','automatic-sync-orchestrator.js'
  ),'utf8');
  assert.ok(
    orchestrator.indexOf('runner.run(')<
    orchestrator.indexOf('manager.prepareAndSubscribe(')
  );
  const worker=fs.readFileSync(path.join(
    __dirname,'..','service-worker.js'
  ),'utf8');
  assert.match(worker,
    /(?:mobile-room-input-ux-v1|launch-membership-integrity-v1|realtime-startup-e2e-v1|linked-lifecycle-compat-v1|realtime-subscribe-trace-v1|realtime-cloud-lifecycle-binding-v1|realtime-runtime-listener-v1|phase-2-(?:6-realtime-integration|7-operational-ui)|member-remote-apply-safe-v1|member-(?:pre-metadata-trace|up-to-date-activation|linked-refresh-trace|activation-completion)-v1)/
  );
  assert.match(worker,/conference-realtime-manager\.js/);

  console.log('conference realtime manager phase 2.6 tests: passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
