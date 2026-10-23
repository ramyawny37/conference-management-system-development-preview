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

test('canonical move picker excludes closed, current and zero-capacity rooms without using current-day occupancy',()=>{
  const start=ui.indexOf('function moveCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.match(body,/!r\.isClosed&&r\.roomId!==occupancy\.roomId/);
  assert.doesNotMatch(body,/getCanonicalAccommodationOccupanciesOnDay\(r,operationalDay\)\.length/);
  assert.match(body,/Number\(r\.baseCapacity\|\|0\)\+Number\(r\.extraBedCapacity\|\|0\)/);
  assert.match(body,/capacity>0/);
  assert.match(body,/moveConferenceAccommodation\(conference\.id/);
});

test('canonical move day is confirmed in-app and cancellation has no mutation',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const start=ui.indexOf('function moveCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.doesNotMatch(body,/prompt\(/);
  assert.match(body,/openCanonicalAccommodationMoveDayDialog/);
  assert.match(ui,/function closeCanonicalAccommodationMoveDayDialog\(\)/);
  assert.match(ui,/canonicalAccommodationMoveDraft=null/);
  assert.match(ui,/function confirmCanonicalAccommodationMoveDay\(\)/);
  assert.match(ui,/expectedRevision:draft\.revision/);
  assert.match(ui,/currentConferenceSectionCapability\('accommodationManage'\)/);
  assert.match(html,/id="canonicalAccommodationMoveDayModal"/);
  assert.match(html,/id="canonicalAccommodationMoveDayError"/);
  assert.match(html,/onclick="closeCanonicalAccommodationMoveDayDialog\(\)">إلغاء/);
});

test('searchable person and room picker cancellation clears its callback without mutation',()=>{
  const start=ui.indexOf('function closeSearchableSelectDialog(){');
  const end=ui.indexOf('\nfunction renderSearchableSelectList()',start);
  const close=ui.slice(start,end);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(close,/modal\.style\.display = 'none'/);
  assert.match(close,/onSelect: null/);
  assert.doesNotMatch(close,/onSelect\s*\(|assignConferenceAccommodation|moveConferenceAccommodation/);
  assert.match(html,/id="searchableSelectModal"[\s\S]*onclick="closeSearchableSelectDialog\(\)">إلغاء/);
});

test('move effective day accepts ordinary numeric days and rejects malformed input',()=>{
  const start=ui.indexOf('function confirmCanonicalAccommodationMoveDay(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  const match=body.match(/if\(!\/(\^.*?\$)\/\.test\(textValue\)/);
  assert.ok(match,'effective-day input must be validated with a regular expression');
  const numericDay=new RegExp(match[1]);
  assert.equal(numericDay.test('1'),true);
  assert.equal(numericDay.test('12'),true);
  assert.equal(numericDay.test('12a'),false);
  assert.equal(numericDay.test(''),false);
  assert.equal(numericDay.test('-1'),false);
});

test('canonical move checks destination capacity at every occupancy start in requested interval',()=>{
  const start=ui.indexOf('function confirmCanonicalAccommodationMoveDay(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/findCanonicalAccommodationEntity\('room',draft\.roomId\)/);
  assert.match(body,/canonicalAccommodationIntervalsOverlap\(day,draft\.leaveDay,item\.arrivalDay,item\.leaveDay\)/);
  assert.match(body,/boundaries\.push\(Number\(item\.arrivalDay\)\)/);
  assert.match(body,/getCanonicalAccommodationOccupanciesOnDay\(targetRoom,checkDay\)/);
  assert.match(body,/occupants\.length>=capacity/);
  assert.match(body,/item\.bedType==='extra'/);
  assert.match(body,/length>=bedCapacity/);
  assert.ok(body.indexOf('if(isFull)')<body.indexOf('moveConferenceAccommodation('));
});

test('move confirmation stays open on failed central mutation and disables duplicate submission',()=>{
  const start=ui.indexOf('function confirmCanonicalAccommodationMoveDay(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/if\(button\)button\.disabled=true/);
  assert.match(body,/Promise\.resolve\(result\)\.then/);
  assert.match(body,/if\(saved\)\{closeCanonicalAccommodationMoveDayDialog\(\);return saved;\}/);
  assert.match(body,/if\(button\)button\.disabled=false/);
  assert.ok(body.indexOf('closeCanonicalAccommodationMoveDayDialog();')>body.indexOf('Promise.resolve(result).then'));
});

test('successful central accommodation mutation is not misreported as failed when hydration fails',()=>{
  const start=ui.indexOf('function canonicalAccommodationMutation(');
  const end=ui.indexOf('\nfunction refreshCanonicalConferenceOperationalDependencies(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/refreshCanonicalConferenceOperationalDependencies\(conferenceId,generation\)\.then/);
  assert.match(body,/تم تنفيذ العملية، لكن تعذر تحديث البيانات المعروضة/);
  assert.match(body,/return result;/);
  assert.match(body,/\.catch\(function\(error\)/);
});
