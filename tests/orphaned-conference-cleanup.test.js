'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const LOCAL='058f2855-ae3a-4768-8c60-931a97c88150';
const REMOTE='ed337f4c-58fa-4e21-be27-9e9645f42860';
const OTHER='835cb97d-50cd-4bba-8285-1d81dfa8608e';
const STORE_NAMES=[
  'conferences','rooms','sync_metadata','pending_operations',
  'sync_operations_queue','conflicts','local_backups',
  'pending_remote_applications','conflict_resolution_drafts',
  'conflict_resolution_backups'
];
const UI_SOURCE=fs.readFileSync(path.join(__dirname,
  '../js/sync/sync-settings-ui.js'),'utf8');

function clone(value){return JSON.parse(JSON.stringify(value));}
function storage(initial){
  const values=new Map(Object.entries(initial||{}));
  return {
    get length(){return values.size;},
    key(index){return [...values.keys()][index]||null;},
    getItem(name){return values.has(name)?values.get(name):null;},
    setItem(name,value){values.set(name,String(value));},
    removeItem(name){values.delete(name);},
    values
  };
}
function request(action){
  const value={onsuccess:null,onerror:null,result:undefined,error:null};
  queueMicrotask(()=>{
    try{value.result=action();if(value.onsuccess)value.onsuccess();}
    catch(error){value.error=error;if(value.onerror)value.onerror();}
  });
  return value;
}
function objectStore(records){
  let values=records.map(clone);
  return {
    openCursor(){
      let index=0;
      const cursorRequest={onsuccess:null,onerror:null,result:null,error:null};
      function emit(){
        queueMicrotask(()=>{
          if(index>=values.length){
            cursorRequest.result=null;
          }else{
            const current=index;
            cursorRequest.result={
              key:values[current].conferenceId||values[current].localConferenceId||current,
              value:clone(values[current]),
              continue(){index++;emit();},
              delete(){return request(()=>{values.splice(current,1);index=current-1;});},
              update(next){return request(()=>{values[current]=clone(next);});}
            };
          }
          if(cursorRequest.onsuccess)cursorRequest.onsuccess();
        });
      }
      emit();
      return cursorRequest;
    },
    records(){return clone(values);}
  };
}
function fixture(environment='production'){
  const appData={
    currentConferenceId:LOCAL,
    conferences:[{id:LOCAL,name:'Production Smoke Test 2'},{id:OTHER,name:'Real'}],
    conferenceLifecycle:{records:{[LOCAL]:{cloudLifecycle:'cloud_linked'},[OTHER]:{cloudLifecycle:'cloud_linked'}}}
  };
  const links={
    [LOCAL]:{localConferenceId:LOCAL,remoteConferenceId:REMOTE,linkStatus:'linked',knownRevision:13},
    [OTHER]:{localConferenceId:OTHER,remoteConferenceId:'916c0d83-4c5a-4a9e-89bb-4faa671166f7',linkStatus:'linked',knownRevision:2}
  };
  const localStorage=storage({
    conf_v5:JSON.stringify(appData),
    conference_manager_sync_links:JSON.stringify(links),
    conference_manager_link_status_diagnostics_v1:JSON.stringify([
      {localConferenceId:LOCAL,reason:'membership_read_denied'},
      {localConferenceId:OTHER,reason:'linked'}
    ]),
    'sb-mpezfbvcdfxpgflehuot-auth-token':'AUTH_PRESERVED',
    'device-identity:user':'DEVICE_PRESERVED',
    'organization-context':'ORGANIZATION_PRESERVED'
  });
  const stores={};
  STORE_NAMES.forEach(name=>{
    stores[name]=objectStore(name==='conferences'?[{
      conferenceId:'**app_snapshot**',data:appData
    },{conferenceId:LOCAL},{conferenceId:OTHER}]:[
      {conferenceId:REMOTE,localConferenceId:LOCAL,value:'target'},
      {conferenceId:OTHER,localConferenceId:OTHER,value:'other'}
    ]);
  });
  const authState={authenticated:true,user:{id:'user-one'}};
  const deviceState={id:'device-one',deviceName:'Windows'};
  let stopCount=0;
  const sandbox={
    window:null,Promise,JSON,Object,String,Array,Date,console,
    structuredClone:clone,queueMicrotask,
    BrowserStorageNamespace:{environment,key:value=>value},
    localStorage,appData,
    AppIndexedDB:{runTransaction(names,mode,executor){
      assert.deepStrictEqual(Array.from(names),STORE_NAMES);
      assert.strictEqual(mode,'readwrite');
      return Promise.resolve(executor(stores));
    }},
    ConferenceLinkStore:{get(id){
      const all=JSON.parse(localStorage.getItem('conference_manager_sync_links')||'{}');
      return all[id]||null;
    }},
    ConferenceRealtimeManager:{getState(id){return id===LOCAL?{
      status:'suspended',reason:'membership_read_denied',cloudConferenceId:null
    }:null;}},
    AutomaticSyncOrchestrator:{stop(){stopCount++;return {ok:true,status:'stopped',promise:Promise.resolve()};}},
    SupabaseAuth:{getState(){return clone(authState);}},
    SupabaseDeviceIdentity:{getCurrent(){return clone(deviceState);}}
  };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,
    '../js/sync/orphaned-conference-cleanup.js'),'utf8'),sandbox);
  return {sandbox,localStorage,stores,authState,deviceState,get stopCount(){return stopCount;}};
}

(async function(){
  const env=fixture();
  const inspected=env.sandbox.OrphanedConferenceCleanup.inspect(LOCAL);
  assert.strictEqual(inspected.ok,true);
  assert.strictEqual(inspected.status,'orphan_confirmed');

  const result=await env.sandbox.OrphanedConferenceCleanup.cleanup(LOCAL);
  assert.strictEqual(result.ok,true,JSON.stringify(result));
  assert.strictEqual(result.status,'local_orphan_removed');
  assert.strictEqual(env.stopCount,1);

  const saved=JSON.parse(env.localStorage.getItem('conf_v5'));
  assert.strictEqual(saved.currentConferenceId,null,'currentConferenceId must clear');
  assert.deepStrictEqual(saved.conferences.map(item=>item.id),[OTHER]);
  assert(saved.conferenceLifecycle.records[OTHER]);
  assert(!saved.conferenceLifecycle.records[LOCAL]);
  const savedLinks=JSON.parse(env.localStorage.getItem('conference_manager_sync_links'));
  assert(!savedLinks[LOCAL]);
  assert(savedLinks[OTHER]);
  const diagnostics=JSON.parse(env.localStorage.getItem(
    'conference_manager_link_status_diagnostics_v1'));
  assert.deepStrictEqual(diagnostics.map(item=>item.localConferenceId),[OTHER]);

  STORE_NAMES.forEach(name=>{
    const records=env.stores[name].records();
    if(name==='conferences'){
      const snapshot=records.find(item=>item.conferenceId==='**app_snapshot**');
      assert(snapshot);
      assert.deepStrictEqual(snapshot.data.conferences.map(item=>item.id),[OTHER]);
      assert(records.some(item=>item.conferenceId===OTHER));
      assert(!records.some(item=>item.conferenceId===LOCAL));
      return;
    }
    assert(!records.some(item=>item.localConferenceId===LOCAL||item.conferenceId===REMOTE),
      name+' retained target data');
    assert(records.some(item=>item.localConferenceId===OTHER),name+' removed another conference');
  });

  assert.strictEqual(env.localStorage.getItem('sb-mpezfbvcdfxpgflehuot-auth-token'),'AUTH_PRESERVED');
  assert.strictEqual(env.localStorage.getItem('device-identity:user'),'DEVICE_PRESERVED');
  assert.strictEqual(env.localStorage.getItem('organization-context'),'ORGANIZATION_PRESERVED');
  assert.deepStrictEqual(env.sandbox.SupabaseAuth.getState(),env.authState);
  assert.deepStrictEqual(env.sandbox.SupabaseDeviceIdentity.getCurrent(),env.deviceState);

  const second=await env.sandbox.OrphanedConferenceCleanup.cleanup(LOCAL);
  assert.strictEqual(second.ok,true);
  assert.strictEqual(second.status,'already_clean');
  assert.strictEqual(env.stopCount,1,'idempotent cleanup must not stop runtime again');

  const network=fixture();
  network.sandbox.ConferenceRealtimeManager.getState=()=>({
    status:'suspended',reason:'prerequisite_check_failed',cloudConferenceId:null
  });
  assert.strictEqual(network.sandbox.OrphanedConferenceCleanup.inspect(LOCAL).ok,false,
    'temporary/network failure must not expose cleanup');

  const development=fixture('development');
  assert.strictEqual(development.sandbox.OrphanedConferenceCleanup.inspect(LOCAL).status,
    'development_environment_blocked');
  const devResult=await development.sandbox.OrphanedConferenceCleanup.cleanup(LOCAL);
  assert.strictEqual(devResult.ok,false);
  assert.strictEqual(development.localStorage.getItem('conf_v5').includes('Production Smoke Test 2'),true);

  assert(UI_SOURCE.includes('إزالة النسخة المحلية لهذا المؤتمر'));
  assert(UI_SOURCE.includes('لن يتم حذف أي بيانات سحابية'));
  assert(UI_SOURCE.includes('هوية الجهاز أو جلسة تسجيل الدخول'));
  assert(!/location\.reload\s*\(/.test(UI_SOURCE),
    'cleanup UI must not force a reload');

  console.log('orphaned conference local-only cleanup tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
