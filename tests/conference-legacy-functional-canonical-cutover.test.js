'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const core=fs.readFileSync('core.js','utf8');
const transport=fs.readFileSync('transport.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const cards=fs.readFileSync('cards.js','utf8');
const accounts=fs.readFileSync('js/conference/accounts.js','utf8');

function source(name,next){
  const start=script.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,name);
  const end=next?script.indexOf(`function ${next}(`,start+1):script.length;
  return script.slice(start,end<0?script.length:end);
}

function runtime(){
  const housed={participationId:'housed',participationStatus:'active',personId:'person-housed',name:'Housed',person:{personId:'person-housed',fullName:'Housed'},arrivalDay:1,leaveDay:null,isChild:false};
  const child={participationId:'child',participationStatus:'active',personId:'person-child',name:'Child',person:{personId:'person-child',fullName:'Child'},arrivalDay:1,leaveDay:3,isChild:true,guardianParticipationId:'housed',guardianPersonId:'person-housed',guardianFullName:'Housed',guardianParticipationStatus:'active'};
  const conference={id:'conference'};
  const accommodation={houses:[{houseId:'house',name:'House',floors:[{floorId:'floor',name:'Floor',rooms:[{roomId:'room',roomNumber:'101',baseCapacity:3,extraBedCapacity:0,isClosed:false,occupancies:[housed,child]}]}]}]};
  const vehicles=[{id:'vehicle',seats:[{seat:1,name:'Housed',participationId:'housed',riders:[]},{seat:2,name:'Unhoused',participationId:'unhoused',riders:[]},{seat:3,name:'',riders:[{r:{name:'Child',participationId:'child'}}]}]}];
  const sandbox={window:null,console,JSON,Object,Array,String,Number,Date,Math,isFinite,appData:{currentConferenceId:'conference',conferences:[conference]},getCanonicalConferenceCoreLink:()=>({remoteConferenceId:'conference'}),PlatformIntegration:{getConferenceAccommodationState:()=>accommodation},CanonicalConferenceTransport:{isLinked:()=>true,getVehicles:()=>JSON.parse(JSON.stringify(vehicles))},isRoomActiveOnDay:()=>true,isPersonPresentOnDay:(person,day)=>person.arrivalDay<=day&&(!person.leaveDay||person.leaveDay>day),gl:()=>false,gn:value=>value.name};
  sandbox.window=sandbox;
  vm.runInNewContext(core,sandbox);
  vm.runInNewContext(transport,sandbox);
  vm.runInNewContext(cards,sandbox);
  return {sandbox,conference,accommodation};
}

test('one accommodation projection owns every operational person list',()=>{
  const {sandbox:s,conference}=runtime();
  assert.deepEqual(Array.from(s.getConferenceOperationalResidents(conference).all,p=>p.participationId),['housed','child']);
  assert.deepEqual(Array.from(s.activeGuests().adults,p=>p.participationId),['housed']);
  assert.deepEqual(Array.from(s.activeGuests().children,p=>p.participationId),['child']);
  assert.equal(s.allGuestsForPick().some(p=>p.participationId==='unhoused'),false);
  const seats=s.getConferenceTransportVehicles(conference)[0].seats;
  assert.equal(seats[0].participationId,'housed');
  assert.equal(seats[1].name,'');
  assert.equal(seats[2].riders[0].r.participationId,'child');
  assert.deepEqual(Array.from(s.CardEngine.getPersonCards(),card=>card.personId).sort(),['person-child','person-housed']);
});

test('day boundaries remove departed residents from downstream counts',()=>{
  const {sandbox:s,conference}=runtime();
  assert.deepEqual(Array.from(s.getConferenceOperationalResidents(conference,2).all,p=>p.participationId),['housed','child']);
  assert.deepEqual(Array.from(s.getConferenceOperationalResidents(conference,3).all,p=>p.participationId),['housed']);
});

test('tabs hydrate their real canonical dependencies and lifecycle refreshes before success',()=>{
  const hydration=source('hydrateConferenceTabDataOnDemand','renderTab');
  assert.match(hydration,/tabId===1[\s\S]*hydrateCanonicalConferenceAccommodation[\s\S]*hydrateCanonicalConferenceTransport/);
  assert.match(hydration,/tabId===3[\s\S]*hydrateCanonicalConferenceAccommodation[\s\S]*hydrateCanonicalConferenceRestaurant/);
  assert.match(hydration,/tabId===4[\s\S]*hydrateCanonicalConferenceAccommodation[\s\S]*hydrateCanonicalConferenceTransport[\s\S]*hydrateCanonicalConferenceBranding/);
  const status=source('setCanonicalParticipantStatus','openQuickAddPersonForGuest');
  assert.match(status,/setConferenceParticipationStatus[\s\S]*refreshCanonicalConferenceOperationalDependencies[\s\S]*showToast/);
  assert.match(source('canonicalAccommodationMutation','canonicalAccommodationState'),/refreshCanonicalConferenceOperationalDependencies[\s\S]*renderTab\(currentTab,\{skipHydration:true\}\)/);
});

test('cards, accounts and reports remain occupancy-derived without local mirrors',()=>{
  assert.match(cards,/getConferenceRoomPeople\(room,context\.conference\)/);
  assert.match(accounts,/getConferenceRoomPeopleOnDay/);
  assert.match(script,/calculateAccommodationSummary\(conference\)/);
  assert.doesNotMatch(source('getRestaurantV3People','findRestaurantV3Person').split('else {')[0],/peopleDb|getPeopleList/);
});
