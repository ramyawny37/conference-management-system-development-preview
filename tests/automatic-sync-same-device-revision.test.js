'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const localId='11111111-1111-4111-8111-111111111111';
const remoteId='22222222-2222-4222-8222-222222222222';
const localDevice='33333333-3333-4333-8333-333333333333';
const otherDevice='44444444-4444-4444-8444-444444444444';

function environment(knownRevision){
  const schedules=[];
  const link={
    linkStatus:'linked',remoteConferenceId:remoteId,
    knownRevision:knownRevision
  };
  const sandbox={window:null,Promise,Date,JSON,Object,String,Number,Array,Math,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    setTimeout(){return 1;},
    clearTimeout(){},addEventListener(){},removeEventListener(){},
    navigator:{onLine:true},
    getCurrentConference(){return {id:localId};},
    ConferenceLinkStore:{get(id){return id===localId?link:null;}},
    SupabaseDeviceIdentity:{getOrCreate(){return {id:localDevice};}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root,
    'js/sync/sync-scheduler-state.js'),'utf8'),sandbox);
  const source=fs.readFileSync(path.join(root,
    'js/sync/automatic-sync-orchestrator.js'),'utf8')
    .replace(
      "      schedule('conference_changed',options);\n    };\n  }",
      "      global.__schedules.push('conference_changed');\n    };\n  }"
    ).replace(
      'global.AutomaticSyncOrchestrator=Object.freeze({',
      'global.__createRealtimeEventHandler=createRealtimeEventHandler;'+
        'global.AutomaticSyncOrchestrator=Object.freeze({'
    );
  sandbox.__schedules=schedules;
  vm.runInNewContext(source,sandbox);
  const options={debounceMs:60000,linkStore:sandbox.ConferenceLinkStore,
    deviceIdentity:sandbox.SupabaseDeviceIdentity,
    getCurrentConference:sandbox.getCurrentConference};
  const handler=sandbox.__createRealtimeEventHandler(options);
  function emit(deviceId,revision,duplicate){
    handler({}, {ok:true,status:'update_marked',data:{
      duplicate:duplicate===true,
      update:{conferenceId:remoteId,revision:revision,deviceId:deviceId}
    }});
  }
  return {sandbox,schedules,emit};
}

function managerEnvironment(knownRevision){
  const listeners=[];
  const decisions=[];
  const traces=[];
  const link={
    linkStatus:'linked',remoteConferenceId:remoteId,
    knownRevision:knownRevision
  };
  const manager={
    subscribe(listener){listeners.push(listener);return function(){};},
    recordListenerDecision(decision){decisions.push(decision);},
    traceDiagnostic(stage,data){traces.push({stage,data});}
  };
  const sandbox={window:null,Promise,Date,JSON,Object,String,Number,Array,Math,
    structuredClone:value=>JSON.parse(JSON.stringify(value)),
    setTimeout(){return 1;},clearTimeout(){},
    addEventListener(){},removeEventListener(){},navigator:{onLine:true},
    getCurrentConference(){return {id:localId};},
    ConferenceRealtimeManager:manager,
    ConferenceLinkStore:{get(id){return id===localId?link:null;}},
    SupabaseDeviceIdentity:{getOrCreate(){return {id:localDevice};}},
    appData:{conferenceLifecycle:{records:{[localId]:{
      localLifecycle:'active',cloudLifecycle:'cloud_linked'
    }}}}
  };
  sandbox.window=sandbox;
  ['js/sync/sync-scheduler-state.js','js/sync/automatic-sync-orchestrator.js']
    .forEach(file=>vm.runInNewContext(
      fs.readFileSync(path.join(root,file),'utf8'),sandbox,{filename:file}
    ));
  const options={debounceMs:60000,realtimeManager:manager,
    linkStore:sandbox.ConferenceLinkStore,
    deviceIdentity:sandbox.SupabaseDeviceIdentity,
    getCurrentConference:sandbox.getCurrentConference,
    preferences:{get(){return {cloudSyncEnabled:true};}}};
  assert.strictEqual(
    sandbox.AutomaticSyncOrchestrator.start(options).status,'started'
  );
  assert.strictEqual(listeners.length,1);
  function emit(classification,deviceId,revision){
    listeners[0]({}, {classification:classification,
      sourceDeviceId:deviceId,observedRevision:revision,
      cloudConferenceId:remoteId});
  }
  function scheduleCount(){
    return traces.filter(item=>item.stage==='CHANGE_SCHEDULED').length;
  }
  return {link,decisions,emit,scheduleCount};
}

(function(){
  const current=environment(5);
  current.emit(localDevice,5);
  assert.strictEqual(current.schedules.length,0,
    'same-device revision already applied must stay suppressed');

  const advanced=environment(5);
  advanced.emit(localDevice,6);
  assert.deepStrictEqual(advanced.schedules,['conference_changed'],
    'same-device advanced revision must schedule refresh');

  const remote=environment(5);
  remote.emit(otherDevice,6);
  assert.deepStrictEqual(remote.schedules,['conference_changed'],
    'different-device advanced revision behavior must remain unchanged');

  const duplicate=environment(5);
  duplicate.emit(localDevice,6);
  duplicate.emit(localDevice,6);
  duplicate.emit(localDevice,6,true);
  assert.deepStrictEqual(duplicate.schedules,['conference_changed'],
    'duplicate revision must schedule exactly once');

  console.log('same-device realtime revision tests passed');
})();

(function(){
  const current=managerEnvironment(5);
  current.emit('self_update',localDevice,5);
  assert.strictEqual(current.scheduleCount(),0);
  assert.strictEqual(current.decisions.at(-1).reason,'self_update');

  const advanced=managerEnvironment(5);
  advanced.emit('self_update',localDevice,6);
  assert.strictEqual(advanced.scheduleCount(),1,
    'manager must schedule an advanced same-device revision');
  assert.strictEqual(advanced.decisions.at(-1).accepted,true);
  advanced.link.knownRevision=6;
  advanced.emit('self_update',localDevice,6);
  assert.strictEqual(advanced.scheduleCount(),1,
    'stale duplicate self revision must not schedule twice');

  const remote=managerEnvironment(5);
  remote.emit('remote_change_detected',otherDevice,6);
  assert.strictEqual(remote.scheduleCount(),1,
    'other-device remote behavior must remain unchanged');

  const unsupported=managerEnvironment(5);
  unsupported.emit('potential_conflict',otherDevice,6);
  assert.strictEqual(unsupported.scheduleCount(),0);
  assert.strictEqual(unsupported.decisions.at(-1).reason,
    'classification_not_supported');
  unsupported.emit('self_update',localDevice,'6');
  assert.strictEqual(unsupported.scheduleCount(),0);
  assert.strictEqual(unsupported.decisions.at(-1).reason,
    'revision_invalid');

  console.log('manager same-device realtime revision tests passed');
})();
