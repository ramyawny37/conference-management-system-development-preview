'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('cards.js','utf8');
test('canonical accommodation cards never invoke forbidden local people resolver',()=>{
 const conference={id:'conference-1',name:'Conference',branding:{},transports:[]};
 const room={id:'room-1',number:'101',house:{id:'house-1',name:'House'},floor:{id:'floor-1',name:'Floor'}};
 const occupant={personId:'person-1',participationId:'participation-1',name:'Canonical Guest',isChild:false,arrivalDay:1,leaveDay:null};
 const sandbox={window:{PlatformIntegration:{getConferenceCoreState:()=>({core:{name:'Conference'}}),getConferenceBrandingState:()=>({branding:{}})}},getCurrentConference:()=>conference,getCanonicalConferenceCoreLink:()=>true,getConferenceParticipationItems:()=>[{personId:'person-1',person:{fullName:'Canonical Guest'}}],getAllRooms:()=>[room],getConferenceTransportVehicles:()=>[],getConferenceOperationalDay:()=>1,getConferenceRoomPeopleOnDay:()=>[occupant],gn:()=>{throw Error('LINKED_CONFERENCE_LEGACY_PEOPLE_FORBIDDEN')},gl:()=>{throw Error('legacy leave helper forbidden')},console};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const people=sandbox.CardEngine.getPersonCards();
 assert.equal(people.length,1);assert.equal(people[0].name,'Canonical Guest');
 const rooms=sandbox.CardEngine.getRoomCards();
 assert.equal(rooms.length,1);assert.equal(rooms[0].members[0].name,'Canonical Guest');
});
