'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const integrationSource=fs.readFileSync('js/platform-integration.js','utf8');
const scriptSource=fs.readFileSync('script.js','utf8');
const propagationSource=fs.readFileSync('supabase/migrations/20260929160000_canonical_conference_participation_accommodation_propagation.sql','utf8');

function environment(){
  const calls=[];
  let failure='';
  const remote='10000000-0000-4000-8000-000000000001';
  const ids={house:'20000000-0000-4000-8000-000000000001',floor:'30000000-0000-4000-8000-000000000001',room:'40000000-0000-4000-8000-000000000001',participation:'50000000-0000-4000-8000-000000000001',occupancy:'60000000-0000-4000-8000-000000000001',person:'70000000-0000-4000-8000-000000000001'};
  const hierarchy=()=>({conferenceId:remote,houses:[{houseId:ids.house,name:'Canonical House',description:null,position:0,revision:2,floors:[{floorId:ids.floor,name:'Canonical Floor',position:0,revision:3,rooms:[{roomId:ids.room,roomNumber:'101',baseCapacity:2,extraBedCapacity:1,notes:null,isClosed:false,closedDay:null,position:0,revision:4,occupancies:[{occupancyId:ids.occupancy,revision:5,arrivalDay:1,leaveDay:3,bedType:'base',extraBedPersonType:null,participationId:ids.participation,participationStatus:'active',person:{personId:ids.person,fullName:'Canonical Occupant',phone:'0100',gender:'female',dateOfBirth:'1990-01-01',church:'Canonical Church'}}]}]}]}]});
  const snapshot={houses:[{id:'legacy-house',floors:[{rooms:[{guests:[{name:'Legacy'}],children:[]}]}]}],peopleDb:{people:[{id:'legacy-person'}]}};
  const lease={owned:true,leaseToken:'80000000-0000-4000-8000-000000000001',expiresAt:'2999-01-01T00:00:00.000Z'};
  const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;}},addEventListener(){},dispatchEvent(){},CustomEvent:function(){},appData:{currentConferenceId:'local',conferences:[{id:'local',...snapshot}]},ConferenceLinkStore:{get(){return {linkStatus:'linked',remoteConferenceId:remote};}},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){calls.push({module,operation,args:JSON.parse(JSON.stringify(args))});if(failure)return Promise.reject({code:failure});if(operation==='get_conference_accommodation')return Promise.resolve(hierarchy());if(operation==='get_resource_lease'||operation==='acquire_resource_lease'||operation==='renew_resource_lease')return Promise.resolve(lease);if(operation==='release_resource_lease')return Promise.resolve({owned:false});return Promise.resolve({ok:true});}}};
  sandbox.window=sandbox;
  vm.runInNewContext(integrationSource,sandbox);
  return {sandbox,calls,remote,ids,snapshotBefore:JSON.stringify(sandbox.appData.conferences[0]),fail(code){failure=code;}};
}

test('linked hierarchy hydration uses the protected P5B read and preserves canonical projection',async()=>{
  const env=environment(),api=env.sandbox.PlatformIntegration;
  await api.hydrateConferenceAccommodation('local',env.remote);
  assert.deepEqual(env.calls[0],{module:'conference',operation:'get_conference_accommodation',args:{p_conference_id:env.remote}});
  const state=api.getConferenceAccommodationState('local'),occupancy=state.houses[0].floors[0].rooms[0].occupancies[0];
  assert.equal(state.houses[0].houseId,env.ids.house);
  assert.equal(state.houses[0].revision,2);
  assert.equal(occupancy.occupancyId,env.ids.occupancy);
  assert.equal(occupancy.revision,5);
  assert.equal(occupancy.participationId,env.ids.participation);
  assert.equal(occupancy.person.fullName,'Canonical Occupant');
  assert.equal(JSON.stringify(env.sandbox.appData.conferences[0]),env.snapshotBefore);
});

test('linked structure mutations use exact canonical operations and expected revisions',async()=>{
  const env=environment(),api=env.sandbox.PlatformIntegration;
  await api.hydrateConferenceAccommodation('local',env.remote);
  const cases=[
    ['create_accommodation_house',{p_name:'H',p_description:null,p_position:0}],
    ['update_accommodation_house',{p_house_id:env.ids.house,p_expected_revision:2,p_name:'H2',p_description:null,p_position:0}],
    ['delete_accommodation_house',{p_house_id:env.ids.house,p_expected_revision:2}],
    ['create_accommodation_floor',{p_house_id:env.ids.house,p_name:'F',p_position:0}],
    ['update_accommodation_floor',{p_floor_id:env.ids.floor,p_expected_revision:3,p_name:'F2',p_position:0}],
    ['delete_accommodation_floor',{p_floor_id:env.ids.floor,p_expected_revision:3}],
    ['create_accommodation_room',{p_floor_id:env.ids.floor,p_room_number:'102',p_base_capacity:2,p_extra_bed_capacity:0,p_notes:null,p_is_closed:false,p_closed_day:null,p_position:1}],
    ['update_accommodation_room',{p_room_id:env.ids.room,p_expected_revision:4,p_room_number:'101',p_base_capacity:3,p_extra_bed_capacity:1,p_notes:null,p_is_closed:false,p_closed_day:null,p_position:0}],
    ['delete_accommodation_room',{p_room_id:env.ids.room,p_expected_revision:4}]
  ];
  for(const [operation,args] of cases){
    await api.mutateConferenceAccommodationStructure('local',operation,args);
    const call=env.calls.at(-2);
    assert.equal(call.operation,operation);
    const expected={...args,p_conference_id:env.remote};
    if(operation==='update_accommodation_room'||operation==='delete_accommodation_room')expected.p_room_lease_tokens=[{roomId:env.ids.room,token:'80000000-0000-4000-8000-000000000001'}];
    assert.deepEqual(call.args,expected);
    assert.equal(env.calls.at(-1).operation,'get_conference_accommodation');
  }
  assert.equal(JSON.stringify(env.sandbox.appData.conferences[0]),env.snapshotBefore);
});

test('assign, move and remove use canonical Participation and occupancy identities',async()=>{
  const env=environment(),api=env.sandbox.PlatformIntegration;
  await api.hydrateConferenceAccommodation('local',env.remote);
  await api.assignConferenceAccommodation('local',{roomId:env.ids.room,participationId:env.ids.participation,arrivalDay:1,leaveDay:3,bedType:'base',extraBedPersonType:null});
  assert.deepEqual(env.calls.at(-2),{module:'conference',operation:'assign_conference_accommodation',args:{p_room_id:env.ids.room,p_participation_id:env.ids.participation,p_arrival_day:1,p_leave_day:3,p_bed_type:'base',p_extra_bed_person_type:null,p_conference_id:env.remote,p_room_lease_tokens:[{roomId:env.ids.room,token:'80000000-0000-4000-8000-000000000001'}]}});
  await api.moveConferenceAccommodation('local',{occupancyId:env.ids.occupancy,expectedRevision:5,roomId:env.ids.room,arrivalDay:1,leaveDay:3,bedType:'base',extraBedPersonType:null});
  assert.equal(env.calls.at(-2).operation,'move_conference_accommodation');
  assert.equal(env.calls.at(-2).args.p_occupancy_id,env.ids.occupancy);
  assert.equal(env.calls.at(-2).args.p_expected_revision,5);
  await api.removeConferenceAccommodation('local',env.ids.occupancy,5);
  assert.deepEqual(env.calls.at(-2),{module:'conference',operation:'remove_conference_accommodation',args:{p_occupancy_id:env.ids.occupancy,p_expected_revision:5,p_conference_id:env.remote,p_room_lease_tokens:[{roomId:env.ids.room,token:'80000000-0000-4000-8000-000000000001'}]}});
  assert.equal(JSON.stringify(env.sandbox.appData.conferences[0]),env.snapshotBefore);
});

test('canonical read and mutation failures preserve state with no legacy fallback or mirror',async()=>{
  const env=environment(),api=env.sandbox.PlatformIntegration;
  env.fail('READ_FAILED');
  await assert.rejects(api.hydrateConferenceAccommodation('local',env.remote),error=>error.code==='READ_FAILED');
  assert.equal(api.getConferenceAccommodationState('local'),null);
  env.fail('');
  await api.hydrateConferenceAccommodation('local',env.remote);
  const before=JSON.stringify(api.getConferenceAccommodationState('local'));
  env.fail('MUTATION_FAILED');
  await assert.rejects(api.removeConferenceAccommodation('local',env.ids.occupancy,5),error=>error.code==='MUTATION_FAILED');
  assert.equal(JSON.stringify(api.getConferenceAccommodationState('local')),before);
  assert.equal(JSON.stringify(env.sandbox.appData.conferences[0]),env.snapshotBefore);
});

test('linked renderer reads only canonical hierarchy and Person occupancy projection',()=>{
  const start=scriptSource.indexOf('function renderCanonicalAccommodation(');
  const end=scriptSource.indexOf('\nfunction renderAccommodation()',start);
  const source=scriptSource.slice(start,end);
  assert.match(source,/state\.houses\.forEach/);
  assert.match(source,/house\.floors/);
  assert.match(source,/floor\.rooms/);
  assert.match(source,/room\.occupancies/);
  assert.match(source,/occupancy\.person\.fullName/);
  assert.match(source,/occupancy\.person\.church/);
  assert.doesNotMatch(source,/current\.houses|room\.guests|room\.children|getPeopleList|peopleDb|\bsave\s*\(/);
  assert.doesNotMatch(source,/occupancy\.occupancyId\s*\+\s*'<\/|participationId\s*\+\s*'<\//);
  const branch=scriptSource.slice(scriptSource.indexOf('function renderAccommodation()'),scriptSource.indexOf('var normalizedSearchQuery',scriptSource.indexOf('function renderAccommodation()')));
  assert.match(branch,/getCanonicalConferenceCoreLink[\s\S]*renderCanonicalAccommodation[\s\S]*return/);
  const header=scriptSource.slice(scriptSource.indexOf('function renderGlobalConferenceHeader'),scriptSource.indexOf('function saveToFile'));
  assert.match(header,/linkedAccommodation[\s\S]*getConferenceAccommodationState/);
  assert.match(header,/linkedAccommodation\?\(canonicalAccommodation\?canonicalAccommodation\.houses:\[\]\):\(current\.houses\|\|\[\]\)/);
});

test('linked participant selection offers only active canonical Participations',()=>{
  const start=scriptSource.indexOf('function assignCanonicalAccommodation(');
  const end=scriptSource.indexOf('\nfunction moveCanonicalAccommodation',start);
  const source=scriptSource.slice(start,end);
  assert.match(source,/getConferenceParticipationState/);
  assert.match(source,/item\.status==='active'/);
  assert.match(source,/participation\.participationId/);
  assert.doesNotMatch(source,/getPeopleList|peopleDb|room\.guests|room\.children|\bsave\s*\(/);
});

test('linked mutation functions never save or mutate snapshot houses/guest arrays',()=>{
  const start=scriptSource.indexOf('function canonicalAccommodationMutation(');
  const end=scriptSource.indexOf('\nfunction renderCanonicalAccommodation',start);
  const source=scriptSource.slice(start,end);
  assert.match(source,/assignConferenceAccommodation/);
  assert.match(source,/moveConferenceAccommodation/);
  assert.match(source,/removeConferenceAccommodation/);
  assert.match(source,/mutateConferenceAccommodationStructure/);
  assert.doesNotMatch(source,/current\.houses\s*=|room\.guests|room\.children|peopleDb|\bsave\s*\(/);
});

test('apology cleanup and deletion remain transactional backend ownership with no reactivation restore',()=>{
  assert.match(propagationSource,/cleanup_conference_accommodation_for_participation[\s\S]*delete from public\.conference_accommodation_occupancies/);
  assert.match(propagationSource,/if v_current\.status='active' and p_status='apologized' then[\s\S]*cleanup_conference_accommodation_for_participation/);
  assert.match(propagationSource,/delete_conference_participation[\s\S]*cleanup_conference_accommodation_for_participation/);
  const statusBranch=propagationSource.indexOf("if v_current.status='active' and p_status='apologized'");
  const reactivation=propagationSource.slice(statusBranch,propagationSource.indexOf('return v_result',statusBranch));
  assert.doesNotMatch(reactivation,/insert into public\.conference_accommodation_occupancies/);
});

test('local-only accommodation remains isolated and no parallel backend was introduced',()=>{
  const legacy=scriptSource.slice(scriptSource.indexOf('function renderAccommodation()'),scriptSource.indexOf('function cloneHouseTemplateToConference',scriptSource.indexOf('function renderAccommodation()')));
  assert.match(legacy,/current\.houses/);
  assert.match(scriptSource,/function saveRoomData[\s\S]*current\.houses = deepClone\(editRoomData\.draftHouses\)[\s\S]*save\(\)/);
  const integration=integrationSource.slice(integrationSource.indexOf('function accommodationPerson'),integrationSource.indexOf('function moduleIdFromRoute'));
  assert.doesNotMatch(integration,/supabase|\.rpc\(|conference_snapshots|localStorage|indexedDB|peopleDb/i);
  assert.match(integration,/invokeProtected\('conference','get_conference_accommodation'/);
});

test('cancelled canonical guest assignment stops before any following prompt or mutation',()=>{
  const begin=scriptSource.indexOf('function assignCanonicalAccommodation(roomId){');
  const end=scriptSource.indexOf('function getCanonicalAccommodationOccupanciesOnDay(',begin);
  assert.ok(begin>=0&&end>begin,'canonical assignment handler must exist');
  const handler=scriptSource.slice(begin,end);
  assert.match(handler,/if\(arrivalText===null\)return;/);
  assert.match(handler,/if\(leaveText===null\)return;/);
  assert.match(handler,/if\(bedText===null\)return;/);
  assert.ok(handler.indexOf('if(arrivalText===null)return;')<handler.indexOf("prompt('يوم المغادرة"));
  assert.ok(handler.indexOf('if(leaveText===null)return;')<handler.indexOf("prompt('نوع السرير"));
  assert.ok(handler.indexOf('if(bedText===null)return;')<handler.indexOf('integration.assignConferenceAccommodation('));
  assert.doesNotMatch(handler,/Number\(prompt\(/);
  assert.doesNotMatch(handler,/confirm\('استخدام سرير إضافي/);
});

test('canonical room cards retain capacity, notes, contact and stay-day details',()=>{
  const start=scriptSource.indexOf('function renderCanonicalAccommodation(state){');
  const end=scriptSource.indexOf('function ',start+10);
  assert.ok(start>=0&&end>start);
  const render=scriptSource.slice(start,end);
  for(const field of ['room.baseCapacity','room.extraBedCapacity','room.notes','occupancy.person.phone','occupancy.person.church','occupancy.arrivalDay','occupancy.leaveDay']){
    assert.ok(render.includes(field),'canonical accommodation display must include '+field);
  }
  assert.ok(render.includes('accommodation-room-details'));
});

test('canonical accommodation summary calculates occupancy and bed totals from canonical rooms',()=>{
  const start=scriptSource.indexOf('function renderCanonicalAccommodation(state){');
  const end=scriptSource.indexOf('function ',start+10);
  assert.ok(start>=0&&end>start);
  const render=scriptSource.slice(start,end);
  for(const token of ['totalBaseBeds','totalExtraBeds','extraBedsUsed','childrenCount','occupancyPercent','accommodation-secondary-summary']){
    assert.ok(render.includes(token),'missing canonical summary '+token);
  }
  assert.match(render,/totalBeds\?Math\.round\(occupied\/totalBeds\*100\):0/);
});

test('canonical accommodation search includes person name phone and church',()=>{
  const start=scriptSource.indexOf('function renderCanonicalAccommodation(state){');
  const end=scriptSource.indexOf('function ',start+10);
  const render=scriptSource.slice(start,end);
  assert.ok(render.includes("person.fullName||''"));
  assert.ok(render.includes("person.phone||''"));
  assert.ok(render.includes("person.church||''"));
  assert.ok(scriptSource.includes('ابحث برقم الغرفة أو اسم النزيل أو الهاتف أو الكنيسة'));
});

test('canonical accommodation shows guardian relationship without local person fallback',()=>{
  const start=scriptSource.indexOf('function renderCanonicalAccommodation(state){');
  const end=scriptSource.indexOf('function ',start+10);
  const render=scriptSource.slice(start,end);
  assert.ok(render.includes('accompaniedGuests'));
  assert.ok(render.includes('occupancy.guardianParticipationId'));
  assert.ok(render.includes('occupancy.guardianFullName'));
});

test('canonical transfer rejects blank and fractional effective days before mutation',()=>{
  const start=scriptSource.indexOf('function moveCanonicalAccommodation(occupancyId){');
  const end=scriptSource.indexOf('function removeCanonicalAccommodation(',start);
  assert.ok(start>=0&&end>start);
  const transfer=scriptSource.slice(start,end);
  assert.ok(transfer.includes('if(effectiveText===null)return;'));
  assert.ok(transfer.includes('effectiveText=effectiveText.trim();'));
  assert.ok(transfer.includes('Number.isSafeInteger(effectiveDay)'));
  assert.ok(transfer.indexOf('Number.isSafeInteger(effectiveDay)')<transfer.indexOf('integration.moveConferenceAccommodation('));
});

test('canonical accommodation filters extra beds children and accompanied guests',()=>{
  const start=scriptSource.indexOf('function renderCanonicalAccommodation(state){');
  const end=scriptSource.indexOf('function ',start+10);
  const render=scriptSource.slice(start,end);
  for(const filter of ["filter==='extra-beds'","filter==='children'","filter==='accompanied'","['extra-beds','بها أسرة إضافية مستخدمة']","['children','بها أطفال']","['accompanied','بها مرافقون']"]){
    assert.ok(render.includes(filter),'missing canonical filter '+filter);
  }
});
