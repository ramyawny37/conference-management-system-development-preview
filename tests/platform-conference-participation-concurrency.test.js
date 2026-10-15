'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');
const source=fs.readFileSync('js/platform-integration.js','utf8');
const remote='10000000-0000-4000-8000-000000000001';
const otherRemote='10000000-0000-4000-8000-000000000002';
const participationId='20000000-0000-4000-8000-000000000001';
const personId='30000000-0000-4000-8000-000000000001';
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
async function dispatched(){await Promise.resolve();await Promise.resolve()}
function sessionChanged(error){return error.code==='CANONICAL_CONFERENCE_SESSION_CHANGED'||error.code==='PLATFORM_SESSION_STALE'}
function person(revision=1,name='Person One'){return {personId,fullName:name,phone:'0100',gender:'female',dateOfBirth:'1990-01-02',church:'Church',revision}}
function participation(status='active',revision=1,personValue=person()){return {participationId,conferenceId:remote,personId,status,revision,guardianParticipationId:null,guardianPersonId:null,guardianFullName:null,guardianParticipationStatus:null,person:personValue}}
function list(status='active',revision=1,personValue=person()){return {conferenceId:remote,items:[participation(status,revision,personValue)],totalCount:1,activeCount:status==='active'?1:0,apologizedCount:status==='apologized'?1:0}}
function environment(handler){
  const listeners={};let calls=[];
  const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},crypto:{randomUUID:()=> '40000000-0000-4000-8000-000000000001'},document:{addEventListener(){},getElementById(){return null},querySelector(){return null}},addEventListener(name,fn){(listeners[name]??=[]).push(fn)},dispatchEvent(){},CustomEvent:function(){},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){calls.push({module,operation,args});return handler(operation,args,calls.length)}}};
  sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
  return {api:sandbox.PlatformIntegration,calls,reset(){for(const fn of listeners['platform-session-reset']||[])fn({type:'platform-session-reset'})}};
}
test('hydration started before a successful mutation cannot overwrite the mutation result',async()=>{
  const stale=deferred(),mutation=deferred();let lists=0;
  const env=environment(operation=>operation==='list_conference_participations'?(++lists===1?Promise.resolve(list()):stale.promise):mutation.promise);
  await env.api.hydrateConferenceParticipations('local',remote);
  const refresh=env.api.hydrateConferenceParticipations('local',remote);
  const write=env.api.setConferenceParticipationStatus('local',participationId,'apologized');
  mutation.resolve(participation('apologized',2));await write;
  stale.resolve(list('active',1));const result=await refresh;
  assert.equal(result.items[0].status,'apologized');assert.equal(env.api.getConferenceParticipationState('local').items[0].revision,2);
});
test('failed mutation still invalidates an older hydration response without changing current state',async()=>{
  const stale=deferred(),mutation=deferred();let lists=0;
  const env=environment(operation=>operation==='list_conference_participations'?(++lists===1?Promise.resolve(list()):stale.promise):mutation.promise);
  await env.api.hydrateConferenceParticipations('local',remote);
  const refresh=env.api.hydrateConferenceParticipations('local',remote);
  const write=env.api.setConferenceParticipationStatus('local',participationId,'apologized');
  mutation.reject({code:'PERSON_REVISION_CONFLICT'});await assert.rejects(write,error=>error.code==='PERSON_REVISION_CONFLICT');
  stale.resolve(list('apologized',2));const result=await refresh;
  assert.equal(result.items[0].status,'active');assert.equal(env.api.getConferenceParticipationState('local').items[0].revision,1);
});
test('session change rejects pending hydration and mutation and applies neither response',async()=>{
  const pendingList=deferred(),pendingMutation=deferred();let lists=0;
  const env=environment(operation=>operation==='list_conference_participations'?(++lists===1?Promise.resolve(list()):pendingList.promise):pendingMutation.promise);
  await env.api.hydrateConferenceParticipations('local',remote);
  const refresh=env.api.hydrateConferenceParticipations('local',remote);const write=env.api.setConferenceParticipationStatus('local',participationId,'apologized');await dispatched();env.reset();
  pendingList.resolve(list('apologized',2));pendingMutation.resolve(participation('apologized',2));
  await assert.rejects(refresh,sessionChanged);
  await assert.rejects(write,sessionChanged);
  assert.equal(env.api.getConferenceParticipationState('local'),null);
});
test('same-scope hydration overlaps are deduplicated while a different remote scope fails closed',async()=>{
  const pending=deferred();const env=environment(operation=>operation==='list_conference_participations'?pending.promise:Promise.reject(new Error(operation)));
  const first=env.api.hydrateConferenceParticipations('local',remote);const second=env.api.hydrateConferenceParticipations('local',remote);
  assert.equal(first,second);await dispatched();assert.equal(env.calls.length,1);
  await assert.rejects(env.api.hydrateConferenceParticipations('local',otherRemote),error=>error.code==='CANONICAL_CONFERENCE_PARTICIPATIONS_SCOPE_CHANGED');
  pending.resolve(list());await first;
});
test('completion of an old-session hydration cannot remove the new-session flight',async()=>{
  const oldFlight=deferred(),newFlight=deferred();let lists=0;
  const env=environment(operation=>operation==='list_conference_participations'?(++lists===1?oldFlight.promise:newFlight.promise):Promise.reject(new Error(operation)));
  const old=env.api.hydrateConferenceParticipations('local',remote);await dispatched();env.reset();
  const current=env.api.hydrateConferenceParticipations('local',remote);await dispatched();oldFlight.resolve(list());await assert.rejects(old,sessionChanged);
  const duplicate=env.api.hydrateConferenceParticipations('local',remote);assert.equal(duplicate,current);assert.equal(lists,2);
  newFlight.resolve(list());await current;
});
test('canonical person update shares mutation exclusion and rejects a late response after session change',async()=>{
  const update=deferred();const env=environment(operation=>operation==='list_conference_participations'?Promise.resolve(list()):update.promise);
  await env.api.hydrateConferenceParticipations('local',remote);
  const write=env.api.updateConferenceCanonicalPerson('local',personId,1,{fullName:'Updated',phone:'011',church:'New',gender:'female',dateOfBirth:'1990-01-02'});await dispatched();
  await assert.rejects(env.api.setConferenceParticipationStatus('local',participationId,'apologized'),error=>error.code==='CANONICAL_CONFERENCE_PARTICIPATION_MUTATION_BUSY');
  env.reset();update.resolve(person(2,'Updated'));
  await assert.rejects(write,sessionChanged);assert.equal(env.api.getConferenceParticipationState('local'),null);
});
