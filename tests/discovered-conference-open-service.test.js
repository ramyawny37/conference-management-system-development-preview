'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync('js/sync/discovered-conference-open-service.js','utf8');
const remote='10000000-0000-4000-8000-000000000001';
function environment(){
  const calls=[];
  const sandbox={window:null,structuredClone:value=>JSON.parse(JSON.stringify(value)),appData:{conferences:[],currentConferenceId:null},CanonicalConferenceDiscovery:{listAccessibleConferences:()=>Promise.resolve({ok:true,data:{conferences:[{id:remote,name:'Canonical',status:'active',capabilities:{core:true,people:true,accommodation:true,finance:true,edit:true}}]}})},clearConferenceCanonicalState:(id,capabilities)=>{calls.push(['clear',id,capabilities]);return true;},ConferenceActivationAuthorization:{authorizeCloud(input){calls.push(['authorize',input]);return {ok:true,active:true,conferenceId:input.conferenceId,capabilities:input.capabilities};}},activatePersistedConferenceById:(id,options)=>{calls.push(['activate',id,options]);return true;}};
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox);
  return {sandbox,calls};
}
test('authorized open activates immediately without eagerly hydrating unrelated tabs',async()=>{
  const env=environment();
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.ok,true);
  assert.deepEqual(env.calls.map(call=>call[0]),['clear','authorize','activate']);
  assert.equal(env.sandbox.DiscoveredConferenceOpenService.getDiagnostics().canonicalHydrationCount,0);
  assert.equal(env.sandbox.appData.conferences[0].id,remote);
});
test('authorization denial fails closed without runtime activation',async()=>{
  const env=environment();
  env.sandbox.ConferenceActivationAuthorization.authorizeCloud=()=>({ok:false,active:false});
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.status,'activation_authorization_denied');
  assert.equal(env.calls.some(call=>call[0]==='activate'),false);
  assert.equal(env.sandbox.appData.conferences.length,0);
});
test('discovery denial preserves the selected conference',async()=>{
  const env=environment();
  env.sandbox.appData.currentConferenceId='existing';
  env.sandbox.CanonicalConferenceDiscovery.listAccessibleConferences=()=>Promise.resolve({ok:true,data:{conferences:[]}});
  const result=await env.sandbox.DiscoveredConferenceOpenService.open(remote);
  assert.equal(result.status,'access_denied');
  assert.equal(env.sandbox.appData.currentConferenceId,'existing');
});
test('session reset makes an outstanding discovery stale',async()=>{
  const listeners={};
  const env=environment();
  env.sandbox.addEventListener=(name,fn)=>{listeners[name]=fn;};
  vm.runInNewContext(source,env.sandbox);
  let release;
  env.sandbox.CanonicalConferenceDiscovery.listAccessibleConferences=()=>new Promise(resolve=>{release=resolve;});
  const pending=env.sandbox.DiscoveredConferenceOpenService.open(remote);
  listeners['platform-session-reset']();
  release({ok:true,data:{conferences:[{id:remote,capabilities:{core:true}}]}});
  const result=await pending;
  assert.equal(result.status,'stale');
  assert.equal(env.calls.some(call=>call[0]==='activate'),false);
});
