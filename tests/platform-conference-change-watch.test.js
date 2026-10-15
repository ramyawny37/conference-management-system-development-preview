'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');
const source=fs.readFileSync('js/platform-integration.js','utf8');
const migration=fs.readFileSync('supabase/migrations/20261015090000_conference_person_change_activity_projection.sql','utf8');
const remote='10000000-0000-4000-8000-000000000001';
const personId='30000000-0000-4000-8000-000000000001';
function participant(name,revision){return {participationId:'20000000-0000-4000-8000-000000000001',conferenceId:remote,personId,status:'active',revision:1,guardianParticipationId:null,guardianPersonId:null,guardianFullName:null,guardianParticipationStatus:null,person:{personId,fullName:name,phone:'0100',gender:'female',dateOfBirth:'1990-01-02',church:'Church',revision}}}
async function drain(){for(let i=0;i<12;i++)await Promise.resolve()}
test('protected activity watcher refreshes central people once and is removed on session reset',async()=>{
  const listeners={},timers=[],events=[];let activityReads=0,peopleReads=0;
  const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,navigator:{onLine:true},crypto:{randomUUID:()=> '40000000-0000-4000-8000-000000000001'},document:{addEventListener(){},getElementById(){return null},querySelector(){return null}},setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){},addEventListener(name,fn){(listeners[name]??=[]).push(fn)},dispatchEvent(event){events.push(event)},CustomEvent:function(type,options){this.type=type;this.detail=options&&options.detail},PlatformDeviceSession:{invokeModuleProtected(module,operation){assert.equal(module,'conference');if(operation==='list_conference_participations'){peopleReads++;const item=participant(peopleReads===1?'Before':'After',peopleReads);return Promise.resolve({conferenceId:remote,items:[item],totalCount:1,activeCount:1,apologizedCount:0})}if(operation==='list_conference_activity'){activityReads++;return Promise.resolve({conferenceId:remote,items:[activityReads===1?{eventId:'event-before',action:'conference.participation.created'}:{eventId:'event-after',action:'platform.person.updated',entityId:personId},{eventId:'event-before',action:'conference.participation.created'}].flat()})}throw new Error(operation)}}};
  sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
  await sandbox.PlatformIntegration.hydrateConferenceParticipations('local',remote);
  await sandbox.PlatformIntegration.hydrateConferenceActivity('local',remote);
  sandbox.PlatformIntegration.getModuleServices().setSelectedConferenceId('local');
  assert.equal(timers.length,1);
  timers.shift()();await drain();
  assert.equal(peopleReads,2);assert.equal(sandbox.PlatformIntegration.getConferenceParticipationState('local').items[0].person.fullName,'After');
  assert.equal(events.filter(event=>event.type==='platform-conference-source-change').length,1);
  for(const fn of listeners['platform-session-reset']||[])fn({type:'platform-session-reset'});
  const pending=timers.splice(0);for(const timer of pending)timer();await drain();assert.equal(activityReads,2);
});
test('activity projection exposes cross-module person changes only through protected conference scope',()=>{
  assert.match(migration,/create or replace function public\.list_conference_activity/);
  assert.match(migration,/require_effective_module_permission\(p_actor_device_id,'conference','conference\.settings\.view','conference',p_conference_id::text\)/);
  assert.match(migration,/event\.action='platform\.person\.updated' and event\.module='reservations'/);
  assert.match(migration,/reservations_event\.conference_id=p_conference_id/);
  assert.match(migration,/participation\.person_id=event\.entity_id/);
  assert.match(migration,/revoke all on function public\.list_conference_activity\(uuid,uuid\) from public,anon,authenticated,service_role/);
  assert.doesNotMatch(migration,/alter\s+(?:table|publication).*realtime|create\s+.*realtime\./i);
});
