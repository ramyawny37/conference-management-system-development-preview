'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('cards.js','utf8');

test('person card follows the active stay while retaining its participation key',()=>{
  const conference={id:'c1',name:'Conference',peopleDb:{people:[{id:'person-1',fullName:'Same Person'}]},branding:{},transports:[]};
  const oldRoom={id:'room-101',number:'101',house:{id:'h',name:'House'},floor:{id:'f',name:'Floor'},occupancies:[]};
  const newRoom={id:'room-205',number:'205',house:{id:'h',name:'House'},floor:{id:'f',name:'Floor'},occupancies:[]};
  const stay={participationId:'participation-1',personId:'person-1',name:'Same Person',arrivalDay:3,leftDay:6,isChild:false};
  let activeRoom=oldRoom;
  const sandbox={window:{PlatformIntegration:null},getCurrentConference:()=>conference,getCanonicalConferenceCoreLink:()=>false,
    getConferenceHouseRooms:()=>[oldRoom,newRoom],getAllRooms:()=>[oldRoom,newRoom],getConferenceOperationalDay:()=>4,
    getConferenceRoomPeopleOnDay:room=>room===activeRoom?[stay]:[],console};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const before=sandbox.CardEngine.getPersonCards()[0];
  activeRoom=newRoom;
  const after=sandbox.CardEngine.getPersonCards()[0];
  assert.equal(before.key,'person|adult|participation:participation-1');
  assert.equal(after.key,before.key);
  assert.equal(before.roomNumber,'101');
  assert.equal(after.roomNumber,'205');
  assert.equal(sandbox.CardEngine.getPersonCards().length,1);
  assert.equal(after.hasLeft,false);
});

test('room cards include only residents selected by the operational-day projection',()=>{
  const conference={id:'c1',name:'Conference',peopleDb:{people:[]},branding:{},transports:[]};
  const room={id:'room-1',number:'1',house:{id:'h',name:'House'},floor:{id:'f',name:'Floor'}};
  let residents=[];
  const sandbox={window:{PlatformIntegration:null},getCurrentConference:()=>conference,getCanonicalConferenceCoreLink:()=>false,
    getConferenceHouseRooms:()=>[room],getAllRooms:()=>[room],getConferenceOperationalDay:()=>2,getConferenceRoomPeopleOnDay:()=>residents,console};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  assert.equal(sandbox.CardEngine.getRoomCards().length,0);
  residents=[{participationId:'p',personId:'person',name:'Resident',isChild:false}];
  assert.equal(sandbox.CardEngine.getRoomCards()[0].members.length,1);
  assert.equal(sandbox.CardEngine.getRoomCards()[0].members[0].hasLeft,false);
});

test('historical card projection accepts an explicit day without changing the public API',()=>{
  const conference={id:'c1',name:'Conference',peopleDb:{people:[]},branding:{},transports:[]};
  const oldRoom={id:'old',number:'101',house:{},floor:{}},newRoom={id:'new',number:'205',house:{},floor:{}};
  const calls=[];
  const sandbox={window:{PlatformIntegration:null},getCurrentConference:()=>conference,getCanonicalConferenceCoreLink:()=>false,
    getConferenceHouseRooms:()=>[oldRoom,newRoom],getAllRooms:()=>[oldRoom,newRoom],getConferenceOperationalDay:()=>4,
    getConferenceRoomPeopleOnDay:(room,day)=>{calls.push(day);return room===oldRoom&&day===2?[{participationId:'p1',personId:'x',name:'Guest',leftDay:3,isChild:false}]:[];},console};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const cards=sandbox.CardEngine.getPersonCards(2);
  assert.equal(cards.length,1);
  assert.equal(cards[0].roomNumber,'101');
  assert.equal(cards[0].hasLeft,false);
  assert.deepEqual(calls,[2,2]);
});
