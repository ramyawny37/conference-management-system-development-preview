'use strict';

const assert=require('assert');
const RepairStore=require('../js/sync/wrong-remote-binding-repair-store.js');
const RepairService=require('../js/sync/wrong-remote-binding-repair-service.js');

const LINK_KEY='conference_manager_sync_links';
const REPAIR_KEY='conference_manager_wrong_remote_binding_repair_v1';
const oldRemote='11111111-1111-4111-8111-111111111111';
const newRemote='22222222-2222-4222-8222-222222222222';

function clone(value){return JSON.parse(JSON.stringify(value));}

function memoryStorage(initial){
  const values=Object.assign({},initial||{});
  return {
    getItem(key){return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;},
    setItem(key,value){values[key]=String(value);},
    removeItem(key){delete values[key];}
  };
}

function conference(id,name,people){
  return {
    id,name,
    peopleDb:{version:'1.0.0',people:Array.from({length:people},(_,i)=>({id:'p'+i}))},
    houses:[{id:'h1',floors:[{id:'f1',rooms:[{id:'r1'}]}]}],
    transports:[]
  };
}

function environment(config){
  config=config||{};
  const originalApp={currentConferenceId:'local-a',conferences:[conference('local-a','Local',1)]};
  const originalLinks={
    'local-a':{localConferenceId:'local-a',remoteConferenceId:oldRemote,
      knownRevision:3,linkStatus:'linked'},
    'local-b':{localConferenceId:'local-b',remoteConferenceId:
      '33333333-3333-4333-8333-333333333333',knownRevision:7,linkStatus:'linked'}
  };
  const storage=memoryStorage({[LINK_KEY]:JSON.stringify(originalLinks)});
  let persisted=clone(originalApp);
  let runtime=clone(originalApp);
  let context={conferenceId:oldRemote,baseRevision:3,schemaVersion:'1',appVersion:'3.1.1'};
  let manual=['local-z'];
  let accessChecks=0;
  const calls={saves:[],downloads:0,uploads:0,publications:0,queues:0,activations:0};
  const backup={
    getManualRelinkConferenceIds(){return manual.slice();},
    setManualRelinkConferenceIds(ids){manual=ids.slice();return {ok:true};},
    clearManualRelinkRequirement(id){manual=manual.filter(value=>value!==id);return {ok:true};},
    isManualRelinkRequired(id){return manual.indexOf(id)>=0;}
  };
  const links={
    get(id){const all=JSON.parse(storage.getItem(LINK_KEY)||'{}');return clone(all[id]||null);},
    save(link){
      const all=JSON.parse(storage.getItem(LINK_KEY)||'{}');
      all[link.localConferenceId]=clone(link);
      storage.setItem(LINK_KEY,JSON.stringify(all));
      backup.clearManualRelinkRequirement(link.localConferenceId);
      return {ok:true,data:clone(link)};
    }
  };
  const deps={
    storage,
    repairStore:RepairStore,
    backup,
    links,
    getAppData(){return runtime;},
    setAppData(value){runtime=clone(value);},
    activate(){calls.activations++;return config.activationFails?false:true;},
    repository:{
      saveAppSnapshot(value,options){
        calls.saves.push(clone(options));persisted=clone(value);return Promise.resolve({ok:true});
      },
      getAppSnapshot(){return Promise.resolve({data:clone(persisted)});}
    },
    integration:{
      getConferenceSyncState(){return {context:context?clone(context):null};},
      configureConferenceSync(id,value){
        if(config.contextFails&&value.conferenceId===newRemote)return {ok:false};
        context=clone(value);return {ok:true};
      },
      removeConferenceSync(){context=null;return {ok:true};},
      handleLocalSave(){calls.queues++;},
      publishConferenceRevision(){calls.publications++;}
    },
    remote:{
      listAvailableConferences(){return Promise.resolve({ok:true,data:{conferences:[{
        id:newRemote,name:'Correct',organizationId:'org-1'
      }]}});},
      downloadSnapshot(){calls.downloads++;return Promise.resolve({ok:true,data:{
        revision:9,schemaVersion:'1',appVersion:'3.1.1',snapshot:conference('remote','Correct',4)
      }});},
      uploadSnapshot(){calls.uploads++;return Promise.resolve({ok:true});}
    },
    members:{
      getCurrentAccess(){
        accessChecks++;
        return Promise.resolve({ok:true,data:{role:accessChecks===1?'owner':'manager'}});
      },
      addManager(){return Promise.resolve({ok:true,data:{role:'manager'}});}
    },
    organization:{
      getCurrentAccess(){return Promise.resolve({ok:true,data:{canManageMembers:true}});},
      listMembers(){return Promise.resolve({ok:true,data:{members:[
        {userId:'member-1',displayName:'Member One',role:'viewer',isCurrentUser:false}
      ]}});}
    }
  };
  return {deps,calls,storage,originalApp,originalLinks,get persisted(){return persisted;},
    get runtime(){return runtime;},get context(){return context;},get manual(){return manual;}};
}

async function selectTarget(env){
  const listed=await RepairService.listOwnerConferences(env.deps);
  assert.strictEqual(listed.ok,true);
  return listed.data.conferences[0].token;
}

(async function run(){
  const success=environment();
  const successToken=await selectTarget(success);
  const repaired=await RepairService.repairMemberLink('local-a',successToken,success.deps);
  assert.strictEqual(repaired.status,'repaired');
  assert.strictEqual(success.persisted.conferences[0].peopleDb.people.length,4);
  assert.strictEqual(success.manual.indexOf('local-a'),-1,'manual relink must be cleared');
  assert.strictEqual(success.calls.saves.length,1);
  assert.deepStrictEqual(success.calls.saves[0],{skipSyncQueue:true});
  assert.strictEqual(success.calls.uploads,0);
  assert.strictEqual(success.calls.publications,0);
  assert.strictEqual(success.calls.queues,0);
  assert.strictEqual(JSON.parse(success.storage.getItem(REPAIR_KEY)).status,'completed');

  const failure=environment({contextFails:true});
  const failureToken=await selectTarget(failure);
  const failed=await RepairService.repairMemberLink('local-a',failureToken,failure.deps);
  assert.strictEqual(failed.status,'rolled_back');
  assert.deepStrictEqual(failure.persisted,failure.originalApp,'appData rollback');
  assert.deepStrictEqual(JSON.parse(failure.storage.getItem(LINK_KEY)),failure.originalLinks,
    'full LinkStore rollback');
  assert.strictEqual(failure.context.conferenceId,oldRemote,'context rollback');
  assert.deepStrictEqual(failure.manual,['local-z'],'manual relink rollback');
  assert.strictEqual(JSON.parse(failure.storage.getItem(REPAIR_KEY)).status,'prepared',
    'failed repair must retain active backup');
  assert.strictEqual(failure.calls.saves.length,2);
  failure.calls.saves.forEach(options=>assert.deepStrictEqual(options,{skipSyncQueue:true}));
  assert.strictEqual(failure.calls.uploads,0);
  assert.strictEqual(failure.calls.publications,0);
  assert.strictEqual(failure.calls.queues,0);

  const contents=JSON.parse(failure.storage.getItem(REPAIR_KEY));
  ['appData','links','context','manualRelink','oldLink'].forEach(field=>{
    assert.ok(Object.prototype.hasOwnProperty.call(contents,field),'backup field '+field);
  });
  console.log('wrong remote binding repair service tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
