'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'script.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
const start=ui.indexOf('function renderCanonicalAccommodation(');
const end=ui.indexOf('\nfunction renderAccommodation()',start);
const renderer=ui.slice(start,end);
test('canonical accommodation source parses',()=>assert.doesNotThrow(()=>new vm.Script(ui,{filename:'script.js'})));
test('one active accommodation renderer, without restoring legacy local UI',()=>{
  assert.ok(start>=0&&end>start);
  const entry=ui.slice(end,ui.indexOf('\nfunction ',end+10));
  assert.match(entry,/renderCanonicalAccommodation\(canonicalAccommodationState\(\)\)/);
  assert.doesNotMatch(entry,/getAllRooms\(|ensureAccommodationDisplayState\(/);
});
test('house summaries and floor toggles use canonical house/room identities',()=>{
  assert.match(renderer,/accommodation-house-summary/);
  assert.match(renderer,/houseRooms\.length-houseClosed/);
  assert.match(renderer,/accommodationCollapsedFloors\[floorKey\]/);
  assert.match(renderer,/toggleAccommodationFloor/);
  assert.match(renderer,/filter==='all'/);
});
test('room states and guest badges derive from canonical operational occupancies',()=>{
  assert.match(renderer,/getCanonicalAccommodationOccupanciesOnDay/);
  for(const state of ['room-status-closed','room-status-over','room-status-full','room-status-partial','room-status-empty'])assert.ok(renderer.includes(state),state);
  assert.match(renderer,/accommodation-arrival-badge/);
  assert.match(renderer,/room\.keyHolderOccupancyId===occupancy\.occupancyId/);
  assert.match(renderer,/extraBedPersonType==='child'/);
  assert.match(renderer,/bedType==='extra'/);
});
test('write actions remain permission gated and route to platform integration',()=>{
  for(const name of ['moveCanonicalAccommodation','removeCanonicalAccommodation','setCanonicalAccommodationArrival','setCanonicalAccommodationRoomKey']){
    const i=ui.indexOf('function '+name+'(');
    const j=ui.indexOf('\nfunction ',i+10);
    const body=ui.slice(i,j);
    assert.ok(i>=0,name);
    assert.match(body,/currentConferenceSectionCapability\('accommodationManage'\)/);
    assert.match(body,/PlatformIntegration|integration\./);
  }
});
test('responsive room and guest layouts and collapsed floors exist',()=>{
  assert.match(css,/floor-section\.is-collapsed>\.rooms-grid\{display:none\}/);
  assert.match(css,/accommodation-house-metrics/);
  assert.match(css,/accommodation-guest-row/);
  assert.match(css,/accommodation-room-card\.room-status-over/);
  assert.match(css,/@media\(max-width:680px\)/);
});

test('canonical move picker excludes closed, current and full rooms',()=>{
  const start=ui.indexOf('function moveCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.match(body,/!r\.isClosed&&r\.roomId!==occupancy\.roomId/);
  assert.match(body,/getCanonicalAccommodationOccupanciesOnDay\(r,getConferenceOperationalDay\(current\)\)\.length/);
  assert.match(body,/Number\(r\.baseCapacity\|\|0\)\+Number\(r\.extraBedCapacity\|\|0\)/);
  assert.match(body,/integration\.moveConferenceAccommodation/);
});
