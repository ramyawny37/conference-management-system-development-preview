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
  assert.equal(env.links[remote].remoteConferenceId,remote);
  assert.equal(env.getData().conferences[0].name,'Canonical');
});
test('canonical hydration failure has no fallback and does not activate',async()=>{
  const env=environment('finance');const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);assert.equal(result.status,'canonical_hydration_failed');assert.equal(env.calls.includes('activate'),false);
});
test('runtime contains no linked whole-document read, revision, queue, or recovery contract',()=>{
  assert.doesNotMatch(source,/conference_snapshots|SupabaseSnapshotSync|OfflineSyncQueue|snapshotRevision|baseRevision|needs_resolution|recovery|fallback/i);
});

test('automatic link persistence failure stops before runtime mutation or hydration',async()=>{
  const env=environment();
  env.sandbox.ConferenceLinkStore.save=()=>({ok:false,status:'storage_error'});
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);
  assert.equal(result.status,'conference_link_save_failed');
  assert.equal(result.error.code,'CONFERENCE_LINK_SAVE_FAILED');
  assert.equal(env.getData().currentConferenceId,null);
  assert.equal(env.getData().conferences.length,0);
  assert.equal(env.calls.includes('activate'),false);
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

test('canonical hydration failure does not persist a new link or runtime conference',async()=>{
  const env=environment('finance');
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,false);
  assert.equal(result.status,'canonical_hydration_failed');
  assert.equal(env.links[remote],undefined);
  assert.equal(env.getData().conferences.length,0);
  assert.equal(env.getData().currentConferenceId,null);
});

test('transport hydration receives authorized remote identity before link persistence',async()=>{
  const env=environment();
  let hydratedRemoteId=null;
  env.sandbox.CanonicalConferenceTransport.hydrate=(localId,remoteId)=>{
    assert.equal(env.links[remote],undefined);
    hydratedRemoteId=remoteId;
    return Promise.resolve({});
  };
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,true);
  assert.equal(hydratedRemoteId,remote);
});
