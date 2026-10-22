'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const core=fs.readFileSync('core.js','utf8');
const transport=fs.readFileSync('transport.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const cards=fs.readFileSync('cards.js','utf8');
const accounts=fs.readFileSync('js/conference/accounts.js','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');

function functionSource(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} exists`);
  const body=source.indexOf('{',start); let depth=0,quote='',escaped=false;
  for(let index=body;index<source.length;index++){
    const char=source[index];
    if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue;}
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++; else if(char==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`${name} is incomplete`);
}

function canonicalEnvironment(){
  const conference={id:'local',name:'Canonical Conference',conf:{name:'Canonical Conference',days:3},houses:[{id:'legacy-house'}],peopleDb:{people:[{id:'legacy-person',fullName:'Legacy Person'}]},transports:[]};
  const guardian={participationId:'part-guardian',conferenceId:'remote',personId:'person-guardian',status:'apologized',revision:2,person:{personId:'person-guardian',fullName:'Canonical Guardian',phone:'010'}};
  const child={participationId:'part-child',conferenceId:'remote',personId:'person-child',status:'active',revision:1,guardianParticipationId:'part-guardian',guardianPersonId:'person-guardian',guardianFullName:'Canonical Guardian',guardianParticipationStatus:'apologized',person:{personId:'person-child',fullName:'Canonical Child',phone:'011'}};
  const unassigned={participationId:'part-unassigned',conferenceId:'remote',personId:'person-unassigned',status:'active',revision:1,guardianParticipationId:null,guardianPersonId:null,guardianFullName:null,guardianParticipationStatus:null,person:{personId:'person-unassigned',fullName:'Canonical Unassigned',phone:'012'}};
  const occupancy={occupancyId:'occupancy-child',revision:1,arrivalDay:1,leaveDay:3,bedType:'base',extraBedPersonType:null,participationId:child.participationId,participationStatus:'active',guardianParticipationId:child.guardianParticipationId,guardianPersonId:child.guardianPersonId,guardianFullName:child.guardianFullName,guardianParticipationStatus:child.guardianParticipationStatus,person:child.person};
  const accommodation={localConferenceId:'local',remoteConferenceId:'remote',houses:[{houseId:'house-1',name:'Canonical House',floors:[{floorId:'floor-1',name:'Canonical Floor',rooms:[{roomId:'room-1',roomNumber:'101',baseCapacity:2,extraBedCapacity:0,isClosed:false,closedDay:null,occupancies:[occupancy]}]}]}]};
  const participation={localConferenceId:'local',remoteConferenceId:'remote',items:[guardian,child,unassigned],totalCount:3,activeCount:2,apologizedCount:1};
  const sandbox={window:null,console,Date,Math,JSON,Object,Array,String,Number,RegExp,isFinite,appData:{currentConferenceId:'local',conferences:[conference]},getCanonicalConferenceCoreLink:id=>id==='local'?{linkStatus:'linked',remoteConferenceId:'remote'}:null,PlatformIntegration:{getConferenceAccommodationState:()=>accommodation,getConferenceParticipationState:()=>participation},CanonicalConferenceRestaurant:{getParticipations:id=>id==='local'?participation.items:[]},isRoomActiveOnDay:()=>true,gl:person=>!!person.leftDay,gn:person=>person.name||'',resolvePersonName:(id,name)=>name};
  sandbox.window=sandbox;
  vm.runInNewContext(core,sandbox);
  vm.runInNewContext(transport,sandbox);
  vm.runInNewContext(cards,sandbox);
  for(const name of ['isPersonPresentOnDay','personsOnDay','getRestaurantV3People','getSeatEditorPersonId','isSharedChildAssignedToTransport','getEligibleSharedChildren'])vm.runInNewContext(functionSource(script,name),sandbox);
  return {sandbox,conference,guardian,child,occupancy,accommodation,participation};
}

test('linked shared selectors derive only canonical Participation and Accommodation state',()=>{
  const env=canonicalEnvironment(),s=env.sandbox;
  const rooms=s.getConferenceHouseRooms(env.conference);
  assert.equal(rooms.length,1); assert.equal(rooms[0].id,'room-1'); assert.equal(rooms[0].number,'101');
  assert.equal(rooms[0].house.name,'Canonical House'); assert.equal(rooms[0].floor.name,'Canonical Floor');
  const people=s.getConferenceRoomPeople(rooms[0],env.conference);
  assert.equal(people.length,1); assert.equal(people[0].personId,'person-child'); assert.equal(people[0].isChild,true);
  assert.equal(people[0].guardianFullName,'Canonical Guardian'); assert.equal(people[0].guardianParticipationStatus,'apologized');
  assert.equal(s.getConferenceRoomPeopleOnDay(rooms[0],1,env.conference).length,1);
  assert.equal(s.getConferenceRoomPeopleOnDay(rooms[0],3,env.conference).length,0);
});

test('Transportation derives child identity and requires the guardian current active status for sharing',()=>{
  const env=canonicalEnvironment(),s=env.sandbox;
  const active=s.activeGuests(1);
  assert.equal(active.children.length,1); assert.equal(active.children[0].guardian,'Canonical Guardian');
  assert.equal(active.children[0].guardianParticipationStatus,'apologized');
  assert.equal(s.getEligibleSharedChildren('person-guardian','Canonical Guardian').length,0);
  env.occupancy.guardianParticipationStatus='active';
  const eligible=s.getEligibleSharedChildren('person-guardian','Canonical Guardian');
  assert.equal(eligible.length,1); assert.equal(eligible[0].personId,'person-child');
  assert.equal(s.getSeatEditorPersonId('Canonical Child'),'');
});

test('Restaurant, cards, summaries and air-conditioning consume canonical projections and intervals',()=>{
  const env=canonicalEnvironment(),s=env.sandbox;
  assert.deepEqual(Array.from(s.getRestaurantV3People(env.conference),item=>item.name),['Canonical Child']);
  assert.deepEqual(JSON.parse(JSON.stringify(s.personsOnDay(1))),{adults:0,children:1});
  assert.deepEqual(JSON.parse(JSON.stringify(s.personsOnDay(3))),{adults:0,children:0});
  const childCard=s.CardEngine.getPersonCards().find(card=>card.personId==='person-child');
  assert.equal(childCard.guardianName,'Canonical Guardian'); assert.equal(childCard.guardianParticipationStatus,'apologized');
  const room=s.getAllRooms()[0];
  assert.equal(s.getAirConditioningRoomPersons(room,1),1); assert.equal(s.getAirConditioningRoomPersons(room,3),0);
});

test('guardian relation survives apology in downstream derived state',()=>{
  const env=canonicalEnvironment(),s=env.sandbox;
  assert.equal(s.getConferenceRoomPeople(s.getAllRooms()[0],env.conference)[0].guardianParticipationId,'part-guardian');
});

test('guardian delete result removes every cascaded Participation from frontend canonical state',async()=>{
  const remote='50000000-0000-4000-8000-000000000001',guardian='70000000-0000-4000-8000-000000000001',child='70000000-0000-4000-8000-000000000002';
  const person=id=>({personId:id,fullName:id});
  const items=[
    {participationId:guardian,conferenceId:remote,personId:'person-guardian',status:'active',revision:1,guardianParticipationId:null,guardianPersonId:null,guardianFullName:null,guardianParticipationStatus:null,person:person('person-guardian')},
    {participationId:child,conferenceId:remote,personId:'person-child',status:'active',revision:1,guardianParticipationId:guardian,guardianPersonId:'person-guardian',guardianFullName:'person-guardian',guardianParticipationStatus:'active',person:person('person-child')}
  ];
  const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},crypto:{randomUUID:()=> '80000000-0000-4000-8000-000000000001'},document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;}},addEventListener(){},dispatchEvent(){},CustomEvent:function(){},appData:{currentConferenceId:'local',conferences:[{id:'local'}]},ConferenceLinkStore:{get:()=>({linkStatus:'linked',remoteConferenceId:remote})},PlatformDeviceSession:{invokeModuleProtected(module,operation){if(operation==='list_conference_participations')return Promise.resolve({conferenceId:remote,totalCount:2,activeCount:2,apologizedCount:0,items});if(operation==='delete_conference_participation')return Promise.resolve({participationId:guardian,conferenceId:remote,personId:'person-guardian',deleted:true,deletedParticipationIds:[child,guardian]});throw new Error(operation);}}};
  sandbox.window=sandbox; vm.runInNewContext(integration,sandbox);
  await sandbox.PlatformIntegration.hydrateConferenceParticipations('local',remote);
  await sandbox.PlatformIntegration.deleteConferenceParticipation('local',guardian);
  assert.equal(sandbox.PlatformIntegration.getConferenceParticipationState('local').items.length,0);
});

test('linked branches have no legacy fallback, mirror or guardian lookup through peopleDb',()=>{
  const restaurant=functionSource(script,'getRestaurantV3People');
  assert.match(restaurant,/if\(linked&&window\.CanonicalConferenceRestaurant\)getConferenceOperationalResidents/);
  assert.match(restaurant,/else \{/);
  assert.doesNotMatch(restaurant.slice(0,restaurant.indexOf('else {')),/peopleDb|room\.guests|room\.children/);
  for(const source of [transport,functionSource(script,'getSeatEditorPersonId'),functionSource(script,'getEligibleSharedChildren')])assert.doesNotMatch(source,/peopleDb|getPeopleDb|getPeopleList/);
  assert.match(cards,/guardianFullName \|\| entry\.guardian/);
  assert.match(accounts,/getConferenceRoomPeopleOnDay/);
  assert.match(core,/arrivalDay<=dayNumber&&\(!isFinite\(leftDay\)\|\|leftDay<1\|\|leftDay>dayNumber\)/);
});
