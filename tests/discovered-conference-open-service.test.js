'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('js/sync/discovered-conference-open-service.js','utf8');
const remote='10000000-0000-4000-8000-000000000001';
function environment(failure){
  const calls=[];let data={conferences:[],currentConferenceId:null};const links={};
  const hydrate=name=>function(){calls.push(name);return name===failure?Promise.reject({code:'FAILED_'+name}):Promise.resolve({});};
  const sandbox={window:null,structuredClone:value=>JSON.parse(JSON.stringify(value)),appData:data,
    CanonicalConferenceDiscovery:{listAccessibleConferences:()=>Promise.resolve({ok:true,data:{conferences:[{id:remote,name:'Canonical',status:'active',capabilities:{edit:true}}]}})},
    ConferenceLinkStore:{findByRemoteId:id=>Object.values(links).find(x=>x.remoteConferenceId===id)||null,save:value=>{links[value.localConferenceId]=value;return {ok:true};}},
    PlatformIntegration:{hydrateConferenceCore:hydrate('core'),hydrateConferenceParticipations:hydrate('participation'),hydrateConferenceAccommodation:hydrate('accommodation'),hydrateConferenceAirConditioning:hydrate('air_conditioning')},
    CanonicalConferenceBranding:{hydrate:hydrate('branding')},CanonicalConferenceFinance:{hydrate:hydrate('finance')},CanonicalConferenceTransport:{hydrate:hydrate('transport')},CanonicalConferenceRestaurant:{hydrate:hydrate('restaurant')},
    ConferenceActivationAuthorization:{authorizeCloud(input){calls.push('authorizeCloud');return {ok:input.canonicalAccess===true,active:input.canonicalAccess===true,conferenceId:input.conferenceId,capabilities:input.capabilities,role:null};}},
    activatePersistedConferenceById:(id,options)=>{calls.push('activate');calls.push(options&&options.activationDecision&&options.activationDecision.capabilities&&options.activationDecision.capabilities.edit===true?'decision:edit':'decision:missing');return true;}};
  sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
  return {sandbox,calls,links,getData:()=>sandbox.appData};
}
test('linked open hydrates every canonical owner without snapshot infrastructure',async()=>{
  const env=environment();const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,true);assert.equal(result.status,'opened');
  assert.deepEqual(env.calls,['core','participation','accommodation','air_conditioning','branding','finance','transport','restaurant','authorizeCloud','activate','decision:edit']);
  assert.equal(env.links[remote],undefined);
  assert.equal(result.data.conferenceId,remote);
  assert.equal(env.getData().conferences[0].name,'Canonical');
});
test('denied canonical activation cannot enter application',async()=>{
  const env=environment();
  env.sandbox.ConferenceActivationAuthorization.authorizeCloud=()=>({ok:false,active:false,reason:'access_denied'});
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);
  assert.equal(result.status,'activation_authorization_denied');
  assert.equal(env.calls.includes('activate'),false);
  assert.equal(env.getData().conferences.length,0);
  assert.equal(env.getData().currentConferenceId,null);
});

test('canonical hydration failure has no fallback and does not activate',async()=>{
  const env=environment('finance');const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);assert.equal(result.status,'canonical_hydration_failed');assert.equal(env.calls.includes('activate'),false);
});
test('runtime contains no linked whole-document read, revision, queue, or recovery contract',()=>{
  assert.doesNotMatch(source,/conference_snapshots|SupabaseSnapshotSync|OfflineSyncQueue|snapshotRevision|baseRevision|needs_resolution|recovery|fallback/i);
});

test('canonical open never writes to legacy link store',async()=>{
  const env=environment();
  env.sandbox.ConferenceLinkStore.save=()=>{throw new Error('legacy link store must not be used');};
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,true);
  assert.equal(result.data.conferenceId,remote);
  assert.equal(env.links[remote],undefined);
});

test('failed hydration preserves previously selected conference',async()=>{
  const env=environment('finance');
  env.sandbox.appData.currentConferenceId='existing-conference';
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);
  assert.equal(result.status,'canonical_hydration_failed');
  assert.equal(env.getData().currentConferenceId,'existing-conference');
  assert.equal(env.calls.includes('activate'),false);
});

test('canonical hydration failure does not create a runtime conference',async()=>{
  const env=environment('finance');
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);
  assert.equal(result.status,'canonical_hydration_failed');
  assert.equal(env.links[remote],undefined);
  assert.equal(env.getData().conferences.length,0);
  assert.equal(env.getData().currentConferenceId,null);
});

test('transport hydration receives authorized remote identity without local link persistence',async()=>{
  const env=environment();
  let hydratedRemoteId=null;
  env.sandbox.CanonicalConferenceTransport={hydrate:(localId,remoteId)=>{
    assert.equal(env.links[remote],undefined);
    hydratedRemoteId=remoteId;
    return Promise.resolve({});
  }};
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,true);
  assert.equal(hydratedRemoteId,remote);
});

test('restaurant hydration receives authorized remote identity without local link persistence',async()=>{
  const env=environment();
  let hydratedRemoteId=null;
  env.sandbox.CanonicalConferenceRestaurant={hydrate:(localId,remoteId)=>{
    assert.equal(env.links[remote],undefined);
    hydratedRemoteId=remoteId;
    return Promise.resolve({});
  }};
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,true);
  assert.equal(hydratedRemoteId,remote);
});

test('session reset invalidates pending discovery before activation',async()=>{
  const env=environment();
  const listeners={};
  env.sandbox.addEventListener=(name,fn)=>{(listeners[name]??=[]).push(fn);};
  // Re-evaluate with the event dispatcher installed, as the listener is bound at module load.
  vm.runInNewContext(source,env.sandbox);
  let resolveDiscovery;
  env.sandbox.CanonicalConferenceDiscovery.listAccessibleConferences=()=>new Promise(resolve=>{resolveDiscovery=resolve;});
  const pending=env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(typeof resolveDiscovery,'function');
  for(const fn of listeners['platform-session-reset']||[])fn({type:'platform-session-reset'});
  resolveDiscovery({ok:true,data:{conferences:[{id:remote,name:'Canonical',capabilities:{edit:true}}]}});
  const outcome=await pending;
  assert.equal(outcome.ok,false);
  assert.equal(outcome.status,'stale');
  assert.equal(env.calls.includes('activate'),false);
  assert.equal(env.getData().conferences.length,0);
});
