'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const coreSource=fs.readFileSync('core.js','utf8');
const scriptSource=fs.readFileSync('script.js','utf8');

function coreRuntime(){
  const sandbox={window:null,console,Date,Math,Number,String,Object,Array,JSON,isFinite,appData:{conferences:[],currentConferenceId:null}};
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(coreSource,sandbox);
  return sandbox;
}

test('nightly room rows preserve the old and new rooms on their effective nights',()=>{
  const runtime=coreRuntime();
  const person={participationId:'p1',personId:'person-1',name:'Guest',bedType:'base',arrivalDay:1,leftDay:3};
  const moved={participationId:'p1',personId:'person-1',name:'Guest',bedType:'extra',arrivalDay:3,leftDay:6};
  const oldRoom={id:'r101',number:'101',beds:2,extraBeds:0,house:{id:'h',name:'House'},floor:{id:'f1',name:'First'}};
  const newRoom={id:'r205',number:'205',beds:1,extraBeds:1,house:{id:'h',name:'House'},floor:{id:'f2',name:'Second'}};
  runtime.getConferenceHouseRooms=()=>[oldRoom,newRoom];
  runtime.isRoomActiveOnDay=()=>true;
  runtime.getConferenceRoomPeopleOnDay=(room,day)=>room===oldRoom&&day<3?[person]:room===newRoom&&day>=3?[moved,moved]:[];
  const before=runtime.getAccommodationNightRoomRows({id:'c'},2);
  const after=runtime.getAccommodationNightRoomRows({id:'c'},3);
  assert.equal(before[0].persons,1);
  assert.equal(before[1].persons,0);
  assert.equal(after[0].persons,0);
  assert.equal(after[1].persons,1);
  assert.equal(after[1].extraOccupied,1);
  assert.equal(after[1].availableExtraBeds,0);
});

test('nightly rows distinguish closed, empty and occupied assigned rooms',()=>{
  const runtime=coreRuntime();
  const occupied={id:'occupied',number:'1',beds:2,extraBeds:1,house:{},floor:{}};
  const empty={id:'empty',number:'2',beds:2,extraBeds:0,house:{},floor:{}};
  const closed={id:'closed',number:'3',beds:2,extraBeds:0,house:{},floor:{}};
  runtime.getConferenceHouseRooms=()=>[occupied,empty,closed];
  runtime.isRoomActiveOnDay=room=>room!==closed;
  runtime.getConferenceRoomPeopleOnDay=room=>room===occupied?[{participationId:'p',name:'Guest',arrivalDay:1,leftDay:3,bedType:'base'}]:[];
  const rows=runtime.getAccommodationNightRoomRows({id:'c'},1);
  assert.deepEqual(Array.from(rows,row=>[row.roomId,row.closed,row.persons]),[['occupied',false,1],['empty',false,0],['closed',true,0]]);
});

test('searchable selector state exists before the accommodation person picker opens',()=>{
  const start=scriptSource.indexOf("var searchableSelectState={title:'',items:[],onSelect:null};");
  const end=scriptSource.indexOf('function getRoomMoveTargetsFromHouses',start);
  assert.notEqual(start,-1);
  const modal={style:{}},title={textContent:''},input={value:'',focus(){}},list={innerHTML:'',appendChild(){}};
  const sandbox={ge:id=>({searchableSelectModal:modal,searchableSelectTitle:title,searchableSelectSearch:input,searchableSelectList:list}[id]),normalizePersonKey:value=>String(value||''),document:{createElement:()=>({style:{}})},setTimeout:fn=>fn()};
  vm.createContext(sandbox);
  vm.runInContext(scriptSource.slice(start,end),sandbox);
  assert.doesNotThrow(()=>sandbox.openSearchableSelectDialog('People',[],()=>{}));
  assert.equal(modal.style.display,'flex');
  assert.equal(title.textContent,'People');
});

test('move UI opens the canonical effective-day dialog and leaves nightly validation to the server',()=>{
  const start=scriptSource.indexOf('function moveCanonicalAccommodation(');
  const end=scriptSource.indexOf('function removeCanonicalAccommodation(',start);
  const source=scriptSource.slice(start,end);
  assert.match(source,/openCanonicalAccommodationMoveDayDialog\(current,occupancy,room,integration\)/);
  assert.match(source,/getConferenceOperationalDay\(conference\)/);
  assert.match(source,/arrivalDay:day/);
});

test('canonical accommodation dashboard projects only the operational-day segment',()=>{
  const start=scriptSource.indexOf('function getCanonicalAccommodationOccupanciesOnDay(');
  const end=scriptSource.indexOf('function moveCanonicalAccommodation(',start);
  const sandbox={isPersonPresentOnDay:(person,day)=>person.arrivalDay<=day&&(!person.leftDay||person.leftDay>day)};
  vm.createContext(sandbox);
  vm.runInContext(scriptSource.slice(start,end),sandbox);
  const room={occupancies:[
    {occupancyId:'old',participationStatus:'active',arrivalDay:1,leaveDay:3},
    {occupancyId:'new',participationStatus:'active',arrivalDay:3,leaveDay:6},
    {occupancyId:'apology',participationStatus:'apologized',arrivalDay:1,leaveDay:null}
  ]};
  assert.deepEqual(Array.from(sandbox.getCanonicalAccommodationOccupanciesOnDay(room,2),item=>item.occupancyId),['old']);
  assert.deepEqual(Array.from(sandbox.getCanonicalAccommodationOccupanciesOnDay(room,3),item=>item.occupancyId),['new']);
});


test('canonical guest picker keeps active Participation identity and lets the server validate the selected interval',()=>{
  const start=scriptSource.indexOf('function assignCanonicalAccommodation(');
  const end=scriptSource.indexOf('function getCanonicalAccommodationOccupanciesOnDay(',start);
  assert.ok(start>=0&&end>start);
  const source=scriptSource.slice(start,end);
  assert.match(source,/getConferenceOperationalDay\(current\)/);
  assert.match(source,/getConferenceParticipationState\(current\.id\)/);
  assert.match(source,/item\.status==='active'/);
  assert.match(source,/participationId:participation\.participationId/);
  assert.match(source,/server validates overlap and capacity atomically/);
});
