'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');

function read(file){
  return fs.readFileSync(path.join(root,file),'utf8');
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function roomsCount(conference){
  let count=0;
  (conference.houses||[]).forEach(house=>{
    (house.floors||[]).forEach(floor=>{
      count+=(floor.rooms||[]).length;
    });
  });
  return count;
}

function signature(conference){
  return {
    id:String(conference&&conference.id||''),
    people:Array.isArray(conference&&conference.peopleDb&&conference.peopleDb.people)
      ?conference.peopleDb.people.length:0,
    transports:Array.isArray(conference&&conference.transports)
      ?conference.transports.length:0,
    houses:Array.isArray(conference&&conference.houses)
      ?conference.houses.length:0,
    rooms:roomsCount(conference||{}),
    hasPeopleDb:!!(conference&&conference.peopleDb&&typeof conference.peopleDb==='object'&&!Array.isArray(conference.peopleDb)),
    hasTransportsArray:Array.isArray(conference&&conference.transports)
  };
}

function ensureNoDuplicateConferenceMappings(appData,remoteConferenceId){
  const ids=(appData.conferences||[]).map(c=>String(c&&c.id||''));
  const unique=new Set(ids);
  assert.strictEqual(unique.size,ids.length,'no duplicate local conference IDs in appData.conferences');
  const linked=(appData.conferences||[]).filter(c=>String(c&&c.remoteConferenceId||'')===String(remoteConferenceId));
  assert.ok(linked.length<=1,'at most one conference can map to same remoteConferenceId');
}

function createEnvironment(){
  const localA='local-a';
  const localB='local-b';
  const remoteId='22222222-2222-4222-8222-222222222222';
  const userId='11111111-1111-4111-8111-111111111111';
  const stableClient={id:'client-1'};

  const conferenceA={
    id:localA,
    name:'A',
    status:'active',
    conf:{name:'A',startDate:'2026-08-01',endDate:'2026-08-04',days:4},
    houses:[{id:'h1',name:'H1',floors:[{id:'f1',name:'F1',rooms:[
      {id:'r1',number:'101',closed:false,guests:[{id:'g1',name:'P1'}],children:[]},
      {id:'r2',number:'102',closed:false,guests:[{id:'g2',name:'P2'}],children:[{id:'c1',name:'P3'}]}
    ]}]}],
    peopleDb:{version:'1.0.0',people:[
      {id:'p1',fullName:'P1'},{id:'p2',fullName:'P2'},{id:'p3',fullName:'P3'},{id:'p4',fullName:'P4'}
    ]},
    transports:[{id:'t1',name:'Bus',capacity:4,seats:[{seat:1,name:'P1',type:'adult'}]}],
    activityLog:[]
  };
  const conferenceB={
    id:localB,
    name:'B',
    status:'active',
    conf:{name:'B',startDate:'2026-08-01',endDate:'2026-08-02',days:2},
    houses:[{id:'hb',name:'HB',floors:[{id:'fb',name:'FB',rooms:[{id:'rb',number:'201',closed:false,guests:[],children:[]}]}]}],
    peopleDb:{version:'1.0.0',people:[{id:'pb',fullName:'PB'}]},
    transports:[{id:'tb',name:'Car',capacity:1,seats:[{seat:1,name:'PB',type:'adult'}]}],
    activityLog:[]
  };

  let appData={
    version:'5.0.0',
    currentConferenceId:localA,
    conferences:[clone(conferenceA),clone(conferenceB)],
    conferenceLifecycle:{
      schemaVersion:1,
      records:{
        [localA]:{
          localConferenceId:localA,
          localLifecycle:'active',
          cloudLifecycle:'cloud_linked',
          localContentVersion:4,
          publishMetadata:null
        },
        [localB]:{
          localConferenceId:localB,
          localLifecycle:'active',
          cloudLifecycle:'local_only',
          localContentVersion:1,
          publishMetadata:null
        }
      }
    }
  };
  const initialAppData=clone(appData);

  const saves=[];
  const queueOps=[];
  const syncResults=[];
  const traces=[];
  const links={
    [localA]:{
      localConferenceId:localA,
      remoteConferenceId:remoteId,
      knownRevision:4,
      linkStatus:'linked',
      pendingLocalApplication:false,
      syncState:{pendingLocalChanges:false}
    }
  };

  function getCurrentConference(){
    return (appData.conferences||[]).find(c=>String(c.id)===String(appData.currentConferenceId))||null;
  }

  function trace(stage){
    const current=getCurrentConference();
    traces.push({stage,appData:clone(appData),current:current?clone(current):null,sign:current?signature(current):null});
  }

  const sandbox={
    window:null,
    Promise,Date,JSON,Object,Array,String,Number,Math,RegExp,
    structuredClone:clone,
    deepClone:clone,
    navigator:{onLine:true},
    console:console,
    APP_RELEASE:{version:'5.0.0'},
    currentTab:0,
    applicationStorageState:{},
    storageInitializationPromise:null,
    applicationSelectionRestored:false,
    SK:'conf_v5',
    alert:function(){},
    ge:function(id){
      if(id==='applicationBody')return {style:{display:'none'}};
      return null;
    },
    updateLogoText:function(){},
    syncConferencePeriod:function(conf){
      conf=conf||{};
      conf.conf=conf.conf||{};
      conf.conf.days=conf.conf.days||conf.days||1;
      conf.days=conf.conf.days;
      conf.nights=Math.max(0,conf.days-1);
      conf.schedule=Array.isArray(conf.schedule)?conf.schedule:[];
      conf.conf.nights=conf.nights;
      conf.conf.schedule=conf.schedule;
      return {valid:true,days:conf.days,nights:conf.nights};
    },
    normalizePersonRecord:function(person){
      person=person||{};
      return {id:person.id||'x',fullName:String(person.fullName||''),createdAt:person.createdAt||'now',updatedAt:person.updatedAt||'now'};
    },
    normalizeConferenceImportRecovery:function(target){
      target.conferenceImportRecovery=target.conferenceImportRecovery||{};
      return target.conferenceImportRecovery;
    },
    linkRoomPeopleToDatabase:function(){},
    normalizeConferencePeopleReferences:function(){},
    createDefaultRestaurant:function(){return {};},
    normalizeRestaurantV3:function(v){return v||{};},
    normalizeAccommodationV3:function(v){return v||{};},
    normalizeAirConditioningV3:function(v){return v||{};},
    normalizeFinancialV3:function(v){return v||{};},
    normalizeConferenceAccounts:function(){},
    ensureAccommodationDisplayState:function(conf){
      conf.accommodationDisplayedRoomIds=Array.isArray(conf.accommodationDisplayedRoomIds)?conf.accommodationDisplayedRoomIds:[];
    },
    uid:function(){return 'uid-1';},
    migrateToV3:function(){},
    createDefaultFloor:function(){return {id:'df',name:'F',rooms:[]};},
    convertLegacyRoomsToHouses:function(){return [];},
    localStorage:{
      getItem:function(){return null;},
      setItem:function(){}
    },
    notifyPersistenceFailure:function(){},
    setApplicationMode:function(){},
    refreshPeopleDatalist:function(){},
    renderAccommodation:function(){},
    renderTransports:function(){},
    renderSettings:function(){},
    switchTab:function(){return true;},
    restoreLastApplicationTab:function(){},
    showToast:function(){},
    isConferenceImportRecoveryPending:function(){return false;},
    SupabaseAuth:{
      getState:function(){return {authenticated:true,user:{id:userId}};},
      getSession:function(){return {user:{id:userId}};}
    },
    SupabaseClientLayer:{getClient:function(){return stableClient;}},
    SupabaseDeviceIdentity:{
      getOrCreate:function(){
        return {id:'33333333-3333-4333-8333-333333333333'};
      }
    },
    AutomaticSyncOrchestrator:{schedule:function(){}},
    ConferenceRepository:{
      recordLocalChange:function(input,id){
        const next=clone(input);
        next.conferenceLifecycle.records[id].localContentVersion++;
        return {ok:true,data:next};
      }
    },
    ConferenceLinkStore:{
      get:function(id){return links[id]?clone(links[id]):null;},
      findByRemoteId:function(id){
        return Object.values(links).find(l=>l.remoteConferenceId===id)||null;
      },
      save:function(input){
        links[input.localConferenceId]=clone(input);
        return {ok:true,status:'saved',data:clone(input)};
      }
    },
    StorageRepository:{
      getAppSnapshot:function(){
        return Promise.resolve({data:clone(appData),savedAt:null});
      },
      saveAppSnapshot:function(snapshot,options){
        const cloned=clone(snapshot);
        saves.push(cloned);
        if(options&&options.skipSyncQueue===true){
          return Promise.resolve({ok:true,status:'saved'});
        }
        return Promise.resolve().then(function(){
          return sandbox.OfflineFirstIntegration.handleLocalSave(cloned)
            .then(function(result){
              syncResults.push(clone(result));
              return result;
            });
        });
      }
    },
    AppIndexedDB:{
      validateAppSnapshot:function(snapshot){
        return {
          valid:!!(snapshot&&snapshot.data&&Array.isArray(snapshot.data.conferences)),
          data:snapshot&&snapshot.data?snapshot.data:null
        };
      }
    },
    OfflineSyncQueue:{
      coalesceSnapshotOperation:function(input){
        queueOps.push(clone(input));
        return Promise.resolve({ok:true,status:'enqueued',data:{operation:clone(input)}});
      }
    },
    OfflineFirstIntegration:null,
    DiscoveredConferenceOpenService:{
      refreshLinkedLocalConference:function(localConferenceId){
        assert.strictEqual(localConferenceId,localA);
        const next=clone(appData);
        const idx=next.conferences.findIndex(c=>c.id===localA);
        assert.ok(idx>=0);
        const remoteSnapshot=clone(next.conferences[idx]);
        next.conferences[idx]=remoteSnapshot;
        appData=next;
        sandbox.appData=appData;
        return Promise.resolve({ok:true,status:'opened'});
      }
    },
    StartupConferenceDiscovery:{refresh:function(){return Promise.resolve({ok:true});}},
    ConferenceMembersService:{getCurrentAccess:function(){return Promise.resolve({ok:true,status:'available',data:{role:'manager',userId:userId,canSync:true}});}},
    CurrentDeviceAuthorizationService:{getStatus:function(){return Promise.resolve({ok:true,data:{deviceAuthorizationStatus:'approved'}});}},
    SystemAccessService:{refresh:function(){return Promise.resolve({source:'server',fresh:true,authenticated:true,accountStatus:'approved'});}},
    StartupAccessGate:{run:function(){return Promise.resolve({status:'started'});}},
    SupabaseSnapshotSync:{
      inspectInitialSnapshot:function(){return Promise.resolve({ok:true,status:'found',data:{revision:4,schemaVersion:'1',appVersion:'test'}});},
      listAvailableConferences:function(){return Promise.resolve({ok:true,data:{conferences:[{id:remoteId,deletedAt:null}]}});},
      downloadSnapshot:function(){return Promise.resolve({ok:true,status:'downloaded',data:{revision:4,snapshot:clone(conferenceA),schemaVersion:'1',appVersion:'test'}});}
    },
    applyAppData:function(value){appData=clone(value);sandbox.appData=appData;},
    getAppData:function(){return appData;}
  };
  sandbox.window=sandbox;
  sandbox.appData=appData;

  vm.runInNewContext(read('core.js'),sandbox,{filename:'core.js'});
  vm.runInNewContext(read('state.js'),sandbox,{filename:'state.js'});
  vm.runInNewContext(read('script.js'),sandbox,{filename:'script.js'});
  vm.runInNewContext(read('js/sync/offline-first-integration.js'),sandbox,{filename:'js/sync/offline-first-integration.js'});
  sandbox.restoreLastApplicationTab=function(){};
  sandbox.switchTab=function(){return true;};
  appData=clone(initialAppData);
  sandbox.appData=appData;

  return {
    sandbox,
    getAppData:()=>appData,
    traces,
    saves,
    queueOps,
    syncResults,
    localA,
    localB,
    remoteId,
    trace
  };
}

async function run(){
  const env=createEnvironment();
  const sandbox=env.sandbox;

  function assertStable(stage){
    const current=sandbox.getCurrentConference();
    const sign=signature(current);
    assert.strictEqual(sign.id,env.localA,stage+': currentConference.id must remain local-a');
    assert.strictEqual(sign.people,4,stage+': peopleDb.people.length must remain 4');
    assert.strictEqual(sign.transports,1,stage+': transports.length must remain 1');
    assert.strictEqual(sign.houses,1,stage+': houses.length must remain 1');
    assert.strictEqual(sign.rooms,2,stage+': rooms count must remain 2');
    assert.strictEqual(sign.hasPeopleDb,true,stage+': peopleDb must exist');
    assert.strictEqual(sign.hasTransportsArray,true,stage+': transports must be array');
    env.trace(stage);
  }

  // Startup + initial normalization
  sandbox.normalizeAppData();
  assertStable('startup_normalize');

  // Activation
  assert.strictEqual(sandbox.activatePersistedConferenceById(env.localA,{alreadyPersisted:true,accessRole:'manager'}),true);
  assertStable('post_activation');

  // Remote apply (no-op payload replacement with same object shape)
  await sandbox.DiscoveredConferenceOpenService.refreshLinkedLocalConference(env.localA);
  assertStable('post_remote_apply');

  // Conference switch A -> B -> A
  sandbox.appData.currentConferenceId=env.localB;
  sandbox.setCurrentConference(sandbox.getCurrentConference());
  assert.strictEqual(String(sandbox.getCurrentConference().id),env.localB);
  sandbox.appData.currentConferenceId=env.localA;
  sandbox.setCurrentConference(sandbox.getCurrentConference());
  assertStable('post_switch_back');

  // Render side-effects already invoked by switch/activation; assert still stable
  assertStable('post_render');

  // Before save
  assertStable('pre_save');

  assert.strictEqual(
    sandbox.OfflineFirstIntegration.configureConferenceSync(env.localA,{
      conferenceId:env.remoteId,
      baseRevision:4,
      schemaVersion:'1',
      appVersion:'5.0.0'
    }).ok,
    true
  );

  // Save path
  assert.strictEqual(sandbox.save(),true);
  await new Promise(function(resolve){setTimeout(resolve,0);});
  assertStable('post_save_memory');

  assert.ok(env.saves.length>=1,'StorageRepository.saveAppSnapshot must be called');
  const lastSaved=env.saves[env.saves.length-1];
  const savedCurrent=(lastSaved.conferences||[]).find(c=>String(c.id)===String(lastSaved.currentConferenceId));
  assert.ok(savedCurrent,'saved snapshot must include current conference object');
  const savedSign=signature(savedCurrent);
  assert.strictEqual(savedSign.id,env.localA);
  assert.strictEqual(savedSign.people,4,'saved snapshot must keep people=4');
  assert.strictEqual(savedSign.transports,1,'saved snapshot must keep transports=1');

  // StorageRepository forwards the saved snapshot to handleLocalSave unchanged.
  // Queue payload confirms the exact conference object passed downstream.

  // No duplicate local IDs, no duplicate remote mapping in appData
  ensureNoDuplicateConferenceMappings(sandbox.appData,env.remoteId);

  // Queue operation snapshot integrity
  if(env.queueOps.length<1){
    console.log('sync results',env.syncResults);
  }
  assert.ok(env.queueOps.length>=1,'queue operation should be prepared');
  const q=env.queueOps[env.queueOps.length-1];
  const qSign=signature(q.snapshot);
  assert.strictEqual(qSign.id,env.localA,'queue snapshot must target same conference');
  assert.strictEqual(qSign.people,4,'queue snapshot people must remain 4');
  assert.strictEqual(qSign.transports,1,'queue snapshot transports must remain 1');

  console.log('owner runtime integrity integration test: passed');
}

run().catch(function(error){
  console.error(error&&error.stack||error);
  process.exit(1);
});
