'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sql=read('supabase/migrations/20261003140000_canonical_conference_transport_foundation.sql');
const runtime=read('js/supabase/canonical-conference-transport.js');
const transport=read('transport.js');
const script=read('script.js');
const platform=read('js/platform-integration.js');
const edge=read('supabase/functions/platform-device-operation/index.ts');

test('1 canonical model normalizes vehicles and Participation assignments',()=>{assert.match(sql,/create table public\.conference_transport_vehicles/);assert.match(sql,/create table public\.conference_transport_assignments/);assert.doesNotMatch(sql,/transport_state|transport jsonb/i);});
test('2 assignment identity is canonical Participation',()=>assert.match(sql,/foreign key\(participation_id,conference_id\) references public\.conference_participations\(id,conference_id\)/));
test('3 Transport does not require Accommodation occupancy',()=>{const body=sql.slice(sql.indexOf('create function public.set_conference_transport_assignment'),sql.indexOf('create function public.remove_conference_transport_assignment'));assert.doesNotMatch(body,/accommodation|occupanc|room_id/i);});
test('4 Accommodation is optional read-only display derivation',()=>assert.match(sql,/left join public\.conference_accommodation_occupancies/));
test('5 independent child seat does not require guardian',()=>assert.match(sql,/if p_mode='independent' then if p_seat is null/));
test('6 shared child requires canonical active guardian assignment',()=>assert.match(sql,/part\.guardian_participation_id[\s\S]*guardian\.status<>'active'[\s\S]*assignment_mode='independent'/));
test('7 no Transport guardian field duplicates canonical relation',()=>assert.doesNotMatch(sql,/guardian_person_id|guardian_name/));
test('8 mutations require exact Transport manage permission',()=>assert.match(sql,/require_conference_transport_context\(p_device,p_conference,'conference\.transport\.manage',true\)/));
test('9 reads require exact Transport view permission',()=>assert.match(sql,/require_conference_transport_context\(p_actor_device_id,p_conference_id,'conference\.transport\.view',false\)/));
test('10 protected tables deny browser and service direct DML',()=>assert.match(sql,/revoke all on table[\s\S]*from public,anon,authenticated,service_role/));
test('11 protected functions deny direct execution',()=>assert.match(sql,/revoke all on function[\s\S]*get_conference_transport[\s\S]*from public,anon,authenticated,service_role/));
test('12 all operations are dispatcher allowlisted',()=>{for(const name of ['get_conference_transport','mutate_conference_transport_vehicle','set_conference_transport_assignment','remove_conference_transport_assignment'])assert.match(edge,new RegExp(name));});
test('13 replay and revisions use the canonical Participation ledger',()=>{assert.match(sql,/conference_participation_operations/);assert.doesNotMatch(sql,/conference_transport_operations|transport_replay/);assert.match(sql,/CONFERENCE_TRANSPORT_REVISION_CONFLICT/);assert.match(sql,/pg_advisory_xact_lock/);});
test('14 linked runtime filters canonical vehicles through active Accommodation',()=>{assert.match(transport,/CanonicalConferenceTransport\.getVehicles/);assert.match(transport,/getConferenceOperationalResidents\(conference\)\.byParticipationId/);});
test('15 linked mutations do not use generic canEdit',()=>assert.match(script,/canonicalTransport\?!!canonicalState\.canManage:canEditCurrentConferenceData\(\)/));
test('16 retired snapshot serialization cannot capture linked Transport',()=>{assert.doesNotMatch(platform,/prepareLegacyConferenceSerialization|serializeConferenceSnapshot/);assert.doesNotMatch(platform,/conference_snapshots/);});
test('17 linked candidates derive from canonical active Accommodation',()=>assert.match(transport,/getConferenceOperationalResidents\(current/));
test('18 Transport participant creation has no Accommodation mutation',()=>{const body=runtime.slice(runtime.indexOf('function createParticipant'),runtime.indexOf('function clear'));assert.match(body,/createConferenceParticipationWithPerson/);assert.doesNotMatch(body,/Accommodation|occupancy|room/i);});
test('19 removing Accommodation cannot delete Transport assignment',()=>assert.doesNotMatch(sql,/conference_accommodation_occupancies[\s\S]{0,120}references public\.conference_transport/));
test('20 discovery edit no longer requires Transport manage',()=>{assert.match(sql,/'edit',v_can_sync and v_can_accommodation_manage/);assert.doesNotMatch(sql,/'edit',v_can_sync and v_can_accommodation_manage and v_can_transport_manage/);});

test('21 runtime reads and mutates only through protected operations',async()=>{
  const calls=[],local='local-1',remote='30000000-0000-4000-8000-000000000001';
  const context={window:{},Promise,JSON,Date,Math};context.window=context;
  context.crypto={randomUUID:()=>`00000000-0000-4000-8000-00000000000${calls.length}`};
  context.ConferenceLinkStore={get:id=>id===local?{linkStatus:'linked',remoteConferenceId:remote}:null};
  context.PlatformIntegration={getConferenceParticipationState:()=>({items:[{participationId:'p1',status:'active',person:{fullName:'No room'}}]}),createConferenceParticipationWithPerson:()=>Promise.resolve({items:[]})};
  context.PlatformDeviceSession={invokeModuleProtected(module,operation,args){calls.push({module,operation,args});if(operation==='get_conference_transport')return Promise.resolve({conferenceId:remote,canManage:true,vehicles:[{vehicleId:'v1',name:'Bus',capacity:2,position:0,revision:1}],assignments:[]});return Promise.resolve({});}};
  vm.runInNewContext(runtime,context);
  await context.CanonicalConferenceTransport.hydrate(local);
  await context.CanonicalConferenceTransport.setAssignment(local,{participationId:'p1',vehicleId:'v1',mode:'independent',riderKind:'adult',seatNumber:1});
  assert.equal(calls[0].operation,'get_conference_transport');assert.equal(calls[1].operation,'set_conference_transport_assignment');assert.equal(calls[2].operation,'get_conference_transport');
  assert.equal(calls.every(call=>call.module==='conference'),true);
  assert.equal(context.CanonicalConferenceTransport.getActiveParticipations(local)[0].participationId,'p1');
});

test('22 projection supports assigned rider with no room',async()=>{
  const context={window:{},Promise,JSON,Date,Math,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}};context.window=context;
  context.ConferenceLinkStore={get:()=>({linkStatus:'linked',remoteConferenceId:'c1'})};context.PlatformIntegration={getConferenceParticipationState:()=>({items:[]})};
  context.PlatformDeviceSession={invokeModuleProtected:()=>Promise.resolve({conferenceId:'c1',canManage:true,vehicles:[{vehicleId:'v1',name:'Bus',capacity:1,revision:1}],assignments:[{assignmentId:'a1',vehicleId:'v1',participationId:'p1',mode:'independent',riderKind:'adult',seatNumber:1,revision:1,person:{personId:'person1',fullName:'Transport only'},roomNumber:null}]})};
  vm.runInNewContext(runtime,context);await context.CanonicalConferenceTransport.hydrate('local');const seat=context.CanonicalConferenceTransport.getVehicles('local')[0].seats[0];assert.equal(seat.name,'Transport only');assert.equal(seat.room,'');assert.equal(seat.participationId,'p1');
});
