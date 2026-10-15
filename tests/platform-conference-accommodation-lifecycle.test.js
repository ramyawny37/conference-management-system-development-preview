'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');
const source=fs.readFileSync('js/platform-integration.js','utf8');
const remote='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
function response(id=remote){return {conferenceId:id,houses:[],pricing:{enabled:true,pricingMode:'per_person_night',prices:{},roomTypePrices:{},revision:0}};}
function environment(handler){
  const listeners={};
  const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},crypto:{randomUUID:()=> '40000000-0000-4000-8000-000000000001'},document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;}},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},dispatchEvent(){},CustomEvent:function(){},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){return handler(operation,args);}}};
  sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
  return {sandbox,api:sandbox.PlatformIntegration,reset(){for(const fn of listeners['platform-session-reset']||[])fn({type:'platform-session-reset'});}};
}
test('accommodation exposes loading, loaded and retryable error states without manufacturing data',async()=>{
  const first=deferred();let calls=0;
  const env=environment(()=>++calls===1?first.promise:Promise.resolve(response()));
  const pending=env.api.hydrateConferenceAccommodation('local',remote);
  assert.equal(env.sandbox.getConferenceAccommodationLoadState('local').status,'loading');
  first.reject({code:'NETWORK_FAILED'});
  await assert.rejects(pending,error=>error.code==='NETWORK_FAILED');
  assert.deepEqual(JSON.parse(JSON.stringify(env.api.getConferenceAccommodationState('local'))),null);
  assert.equal(env.sandbox.getConferenceAccommodationLoadState('local').status,'error');
  await env.api.hydrateConferenceAccommodation('local',remote);
  assert.equal(env.sandbox.getConferenceAccommodationLoadState('local').status,'loaded');
  assert.deepEqual(Array.from(env.api.getConferenceAccommodationState('local').houses),[]);
});
test('accommodation hydration is scoped, deduplicated and invalidated by session reset',async()=>{
  const read=deferred();let calls=0;const env=environment(()=>{calls++;return read.promise;});
  const first=env.api.hydrateConferenceAccommodation('local',remote);
  const duplicate=env.api.hydrateConferenceAccommodation('local',remote);
  assert.equal(first,duplicate);assert.equal(calls,0);
  await Promise.resolve();assert.equal(calls,1);
  await assert.rejects(env.api.hydrateConferenceAccommodation('local',other),error=>error.code==='CANONICAL_CONFERENCE_ACCOMMODATION_SCOPE_CHANGED');
  env.reset();read.resolve(response());
  await assert.rejects(first,error=>error.code==='CANONICAL_CONFERENCE_SESSION_CHANGED'||error.code==='PLATFORM_SESSION_STALE');
  assert.equal(env.api.getConferenceAccommodationState('local'),null);
  assert.equal(env.sandbox.getConferenceAccommodationLoadState('local').status,'idle');
});
