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
