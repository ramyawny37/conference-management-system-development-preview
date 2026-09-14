'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const repositorySource=fs.readFileSync('js/storage/conference-repository.js','utf8');
const activationSource=fs.readFileSync('js/sync/conference-activation-authorization.js','utf8');
const scriptSource=fs.readFileSync('script.js','utf8');

const userA='11111111-1111-4111-8111-111111111111';
const userB='22222222-2222-4222-8222-222222222222';

function runtime(){
  let authUser=userA;
  let systemOwner=false;
  const sandbox={
    window:null,
    JSON,Promise,Object,Array,String,Number,Date,
    structuredClone:value=>structuredClone(value),
    SupabaseAuth:{
      getState(){return {authenticated:!!authUser,user:authUser?{id:authUser}:null};}
    },
    SystemAccessService:{
      getState(){return {
        authenticated:!!authUser,
        profileLoaded:true,
        fresh:true,
        accountStatus:'approved',
        isSystemOwner:systemOwner
      };}
    }
  };
  sandbox.window=sandbox;
  vm.runInNewContext(repositorySource,sandbox,{filename:'conference-repository.js'});
  vm.runInNewContext(activationSource,sandbox,{filename:'conference-activation-authorization.js'});
  return {
    sandbox,
    repository:sandbox.ConferenceRepository,
    gate:sandbox.ConferenceActivationAuthorization,
    setUser(value){authUser=value;},
    setSystemOwner(value){systemOwner=value===true;}
  };
}

function emptyApp(){
  return {
    currentConferenceId:null,
    conferences:[],
    conferenceLifecycle:{schemaVersion:1,records:{}}
  };
}

test('new local conference persists creator provenance without using publish metadata',()=>{
  const env=runtime();
  const added=env.repository.addLocalConference(emptyApp(),{
    id:'local-new',name:'أزمة',organizationId:'org-1',status:'active'
  });
  assert.equal(added.ok,true);
  const record=added.data.conferenceLifecycle.records['local-new'];
  assert.equal(record.localOwnerUserId,userA);
  assert.equal(record.publishMetadata,null);
  assert.equal(record.cloudLifecycle,'unpublished');
});

test('creator opens local conference and authorization becomes active runtime state',async()=>{
  const env=runtime();
  const added=env.repository.addLocalConference(emptyApp(),{
    id:'local-new',name:'أزمة',organizationId:'org-1',status:'active'
  });
  const decision=env.gate.authorizeLocalOnly(added.data,'local-new');
  assert.equal(decision.classification,'authorized_local_only');
  assert.equal(env.gate.canDisplay('local-new'),true);
  assert.equal(env.gate.canEdit('local-new'),true);
  assert.equal(env.gate.canReadProtected('local-new'),false);
  assert.equal(env.gate.canSync('local-new'),false);
  assert.equal(env.gate.getCurrentState().localConferenceId,'local-new');

  env.gate.resetForAccount(userA);
  env.gate.capturePersistedCandidate('local-new','indexeddb');
  const restored=await env.gate.reconcileStartup({
    appData:added.data,
    persistedCandidate:'local-new',
    discovered:[],
    links:{get(){return null;}}
  });
  assert.equal(restored.classification,'authorized_local_only');
  assert.equal(env.gate.getCurrentState().localConferenceId,'local-new');
});

test('different account cannot inherit creator-bound local conference',()=>{
  const env=runtime();
  const added=env.repository.addLocalConference(emptyApp(),{
    id:'local-new',name:'أزمة',organizationId:'org-1',status:'active'
  });
  env.setUser(userB);
  const denied=env.gate.authorizeLocalOnly(added.data,'local-new');
  assert.equal(denied.classification,'unverified_legacy_unscoped');
  assert.equal(env.gate.canDisplay('local-new'),false);
  assert.equal(added.data.conferenceLifecycle.records['local-new'].localOwnerUserId,userA);
});

test('pre-fix unpublished conference stays fail-closed except for confirmed system-owner recovery',()=>{
  const env=runtime();
  const legacy={
    currentConferenceId:null,
    conferences:[{id:'legacy-new',name:'أزمة',organizationId:'org-1',status:'active'}],
    conferenceLifecycle:{schemaVersion:1,records:{
      'legacy-new':{
        localConferenceId:'legacy-new',
        localLifecycle:'active',
        cloudLifecycle:'unpublished',
        localContentVersion:1,
        publishMetadata:null
      }
    }}
  };
  let denied=env.gate.authorizeLocalOnly(legacy,'legacy-new');
  assert.equal(denied.classification,'unverified_legacy_unscoped');
  assert.equal(legacy.conferenceLifecycle.records['legacy-new'].localOwnerUserId,undefined);

  env.setSystemOwner(true);
  env.gate.resetForAccount(userA);
  const recovered=env.gate.authorizeLocalOnly(legacy,'legacy-new');
  assert.equal(recovered.classification,'authorized_local_only');
  assert.equal(legacy.conferenceLifecycle.records['legacy-new'].localOwnerUserId,userA);
  assert.equal(legacy.conferenceLifecycle.records['legacy-new'].publishMetadata,null);
  assert.equal(env.gate.getCurrentState().localConferenceId,'legacy-new');

  env.setUser(userB);
  env.gate.resetForAccount(userB);
  const cannotTakeOver=env.gate.authorizeLocalOnly(legacy,'legacy-new');
  assert.equal(cannotTakeOver.classification,'unverified_legacy_unscoped');
  assert.equal(legacy.conferenceLifecycle.records['legacy-new'].localOwnerUserId,userA);
});

test('legacy recovery requires organization context and confirmed fresh system ownership',()=>{
  const env=runtime();
  env.setSystemOwner(true);
  const legacy={
    conferences:[{id:'legacy-unscoped',name:'Legacy',status:'active'}],
    conferenceLifecycle:{schemaVersion:1,records:{
      'legacy-unscoped':{
        localConferenceId:'legacy-unscoped',
        localLifecycle:'active',
        cloudLifecycle:'unpublished',
        localContentVersion:0,
        publishMetadata:null
      }
    }}
  };
  const denied=env.gate.authorizeLocalOnly(legacy,'legacy-unscoped');
  assert.equal(denied.classification,'unverified_legacy_unscoped');
  assert.equal(legacy.conferenceLifecycle.records['legacy-unscoped'].localOwnerUserId,undefined);
});

test('cloud authorization contract remains separate from local provenance',()=>{
  const env=runtime();
  const remote='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const viewer=env.gate.authorizeCloud({
    localConferenceId:'cloud',
    remoteConferenceId:remote,
    authenticatedUserId:userA,
    role:'viewer'
  });
  assert.equal(viewer.classification,'authorized_cloud_linked');
  assert.equal(viewer.capabilities.display,true);
  assert.equal(viewer.capabilities.edit,false);
  assert.equal(viewer.capabilities.sync,false);
  assert.equal(env.gate.activate('cloud'),true);
  assert.equal(env.gate.getCurrentState().localConferenceId,'cloud');
});

test('startup card still enters through the centralized real open path',()=>{
  assert.match(scriptSource,/function openConferenceFromStartup\(id\)\{\s*return setCurrentConferenceById\(id,\{enterApplication:true\}\);\s*\}/);
  assert.match(scriptSource,/function setCurrentConferenceById\(id, options\)[\s\S]*?activationAuthorization\.authorizeLocalOnly\(appData,String\(id\|\|''\)\)[\s\S]*?activationAuthorization\.canDisplay/);
  assert.match(scriptSource,/function setCurrentConferenceById\(id, options\)[\s\S]*?appData\.currentConferenceId = next\.id;/);
});
