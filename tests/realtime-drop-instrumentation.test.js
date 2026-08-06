'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const LOCAL_A='11111111-1111-4111-8111-111111111111';
const LOCAL_B='22222222-2222-4222-8222-222222222222';
const CLOUD_A='33333333-3333-4333-8333-333333333333';
const CLOUD_B='44444444-4444-4444-8444-444444444444';
const DEVICE='55555555-5555-4555-8555-555555555555';

function load(manager){
  let current=LOCAL_A;
  const timers=[];
  const links={
    [LOCAL_A]:{linkStatus:'linked',remoteConferenceId:CLOUD_A},
    [LOCAL_B]:{linkStatus:'linked',remoteConferenceId:CLOUD_B}
  };
  const sandbox={window:null,Promise,Date,JSON,Object,String,Number,Math,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},
    clearTimeout(){},addEventListener(){},removeEventListener(){},
    navigator:{onLine:true},ConferenceRealtimeManager:manager,
    ConferenceLinkStore:{get(id){return links[id]||null;}},
    SupabaseDeviceIdentity:{getOrCreate(){return {id:DEVICE};}},
    getCurrentConference(){return current?{id:current}:null;},
    appData:{conferenceLifecycle:{records:{
      [LOCAL_A]:{localLifecycle:'active',cloudLifecycle:'cloud_linked'},
      [LOCAL_B]:{localLifecycle:'active',cloudLifecycle:'cloud_linked'}
    }}}
  };
  sandbox.window=sandbox;
  ['js/sync/sync-scheduler-state.js','js/sync/automatic-sync-orchestrator.js']
    .forEach(file=>vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),sandbox,{filename:file}
    ));
  return {sandbox,timers,setCurrent:id=>{current=id;}};
}

(function(){
  const listeners=[];
  const decisions=[];
  const traces=[];
  let subscribeCalls=0;
  const manager={
    subscribe(listener){subscribeCalls++;listeners.push(listener);return ()=>{};},
    recordListenerDecision(value){decisions.push(value);},
    traceDiagnostic(stage,data){traces.push({stage,data});},
    getState(){return {};}
  };
  const env=load(manager);
  const options={realtimeManager:manager,debounceMs:60000,
    preferences:{get(){return {cloudSyncEnabled:true};}}};
  env.sandbox.AutomaticSyncOrchestrator.start(options);
  assert.strictEqual(subscribeCalls,1);
  const listenerA=listeners[0];

  listenerA({}, {classification:'remote_change_detected',
    observedRevision:5,cloudConferenceId:CLOUD_A,
    sourceDeviceId:'66666666-6666-4666-8666-666666666666'});
  let state=env.sandbox.AutomaticSyncOrchestrator.getState();
  assert.strictEqual(state.lastRealtimeListenerResult.accepted,true);
  assert.strictEqual(state.lastRealtimeListenerResult.revision,5);
  assert.ok(Array.from(state.lastScheduledReasons.after)
    .includes('conference_changed'));
  assert.strictEqual(traces.filter(item=>
    item.stage==='CHANGE_SCHEDULED').length,1,
  'accepted event produces exactly one CHANGE_SCHEDULED trace');

  listenerA({}, {classification:'potential_conflict',
    observedRevision:6,cloudConferenceId:CLOUD_A,
    sourceDeviceId:'66666666-6666-4666-8666-666666666666'});
  assert.strictEqual(decisions.at(-1).reason,
    'classification_not_supported');

  listenerA({}, {classification:'self_update',
    observedRevision:7,cloudConferenceId:CLOUD_A,sourceDeviceId:DEVICE});
  assert.strictEqual(decisions.at(-1).reason,'self_update');

  env.setCurrent(LOCAL_B);
  env.sandbox.AutomaticSyncOrchestrator.schedule('conference_changed',options);
  assert.strictEqual(subscribeCalls,2);
  listenerA({}, {classification:'remote_change_detected',
    observedRevision:8,cloudConferenceId:CLOUD_A,
    sourceDeviceId:'66666666-6666-4666-8666-666666666666'});
  assert.strictEqual(decisions.at(-1).reason,'generation_mismatch');

  const unboundManager={traceDiagnostic(){},recordListenerDecision(value){
    this.last=value;
  }};
  const unbound=load(unboundManager);
  unbound.sandbox.AutomaticSyncOrchestrator.start({
    realtimeManager:unboundManager,debounceMs:60000,
    preferences:{get(){return {cloudSyncEnabled:true};}}
  });
  assert.strictEqual(unboundManager.last.reason,'listener_not_bound');

  const source=fs.readFileSync(path.join(root,
    'js/sync/automatic-sync-orchestrator.js'),'utf8');
  assert.strictEqual(/\.rpc\(|getConferenceReadiness|coalesceSnapshotOperation|enqueue/.test(source),false,
    'listener instrumentation adds no RPC or queue operation');
  console.log('realtime drop instrumentation tests passed');
})();
