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
  assert.match(renderer,/activeKeyHolder&&String\(activeKeyHolder\.occupancyId\)===String\(occupancy\.occupancyId\)/);
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

test('move dialog defaults effective day within the occupancy stay interval',()=>{
  const start=ui.indexOf('function openCanonicalAccommodationMoveDayDialog(');
  const end=ui.indexOf('\nfunction confirmCanonicalAccommodationMoveDay(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/Math\.max\(firstDay,Math\.min\(Number\(getConferenceOperationalDay\(conference\)\),lastDay\)\)/);
  assert.match(body,/input\.value=String\(suggestedDay\)/);
  assert.match(body,/input\.min=String\(firstDay\)/);
  assert.match(body,/input\.max=Number\.isFinite\(lastDay\)\?String\(lastDay\):''/);
});

test('move confirmation refuses a second submit while first mutation is pending',()=>{
  const start=ui.indexOf('function confirmCanonicalAccommodationMoveDay(');
  const end=ui.indexOf('\nfunction removeCanonicalAccommodation(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/if\(!draft\|\|!input\|\|!error\|\|button&&button\.disabled\)return false/);
  assert.match(body,/if\(button\)button\.disabled=true/);
});

test('central house directory room editor accepts numeric base and extra bed capacities',()=>{
  const start=ui.indexOf('function canonicalHouseRoomDraft(');
  const end=ui.indexOf('\nfunction addCanonicalHouseRoom(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  const expressions=[...body.matchAll(/!\/(\^.*?\$)\/\.test\((?:baseText|extraText)\)/g)];
  assert.equal(expressions.length,2);
  for(const match of expressions){
    const valid=new RegExp(match[1]);
    assert.equal(valid.test('0'),true);
    assert.equal(valid.test('12'),true);
    assert.equal(valid.test('12a'),false);
    assert.equal(valid.test('-1'),false);
  }
});

test('central house directory room editor rejects zero or unsafe total bed capacity',()=>{
  const start=ui.indexOf('function canonicalHouseRoomDraft(');
  const end=ui.indexOf('\nfunction addCanonicalHouseRoom(',start);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/base\+extra<1/);
  assert.match(body,/!Number\.isSafeInteger\(base\+extra\)/);
  assert.match(body,/يجب أن تحتوي الغرفة على سرير واحد على الأقل/);
});

test('central house room draft behavior accepts valid beds and rejects zero capacity before mutation',()=>{
  const start=ui.indexOf('function canonicalHouseRoomDraft(');
  const end=ui.indexOf('\nfunction addCanonicalHouseRoom(',start);
  const source=ui.slice(start,end)+';this.draft=canonicalHouseRoomDraft;';
  function execute(values){
    const queue=values.slice(),toasts=[],sandbox={prompt:()=>queue.shift(),showToast:message=>toasts.push(message),String,Number};
    vm.runInNewContext(source,sandbox);
    return {value:sandbox.draft(null),toasts};
  }
  assert.deepEqual(JSON.parse(JSON.stringify(execute(['101','2','1']).value)),{roomNumber:'101',baseCapacity:2,extraBedCapacity:1,notes:'',position:0});
  const rejected=execute(['101','0','0']);
  assert.equal(rejected.value,null);
  assert.equal(rejected.toasts.length,1);
});

test('central house directory editors reject blank names without sending mutations',()=>{
  for(const [name,next] of [
    ['createHouseTemplate','editCanonicalHouseDirectory'],
    ['editCanonicalHouseDirectory','deactivateCanonicalHouse'],
    ['addCanonicalHouseFloor','canonicalHouseRoomDraft'],
    ['editCanonicalHouseFloor','deleteCanonicalHouseFloor']
  ]){
    const start=ui.indexOf('function '+name+'(');
    const end=ui.indexOf('\nfunction '+next+'(',start);
    const body=ui.slice(start,end);
    assert.ok(start>=0&&end>start,name);
    assert.match(body,/name===null/,name);
    assert.match(body,/name=String\(name\)\.trim\(\)/,name);
    assert.match(body,/if\(!name\)\{showToast\(/,name);
    assert.ok(body.indexOf('if(!name){showToast(')<body.indexOf('CanonicalConferenceHouses.mutate('),name);
  }
});

test('retired conference-scoped structure writers are absent from the active frontend',()=>{
  for(const name of ['canonicalAccommodationStructure','createCanonicalAccommodationHouse','editCanonicalAccommodationHouse','deleteCanonicalAccommodationHouse','createCanonicalAccommodationFloor','editCanonicalAccommodationFloor','deleteCanonicalAccommodationFloor','createCanonicalAccommodationRoom','editCanonicalAccommodationRoom','toggleCanonicalAccommodationRoom','deleteCanonicalAccommodationRoom']){
    assert.doesNotMatch(ui,new RegExp('function\\s+'+name+'\\s*\\('),name);
  }
  assert.match(ui,/function editCanonicalHouseRoom\(/);
});

test('canonical accommodation key summary counts only holders present on operational day',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/var deliveredKeys=rooms\.filter/);
  assert.match(body,/canonicalAccommodationActiveKeyHolder\(room,operationalDay\)/);
  const helperStart=ui.indexOf('function canonicalAccommodationActiveKeyHolder(');
  const helperEnd=ui.indexOf('\nfunction ',helperStart+1);
  const helper=ui.slice(helperStart,helperEnd);
  assert.match(helper,/getCanonicalAccommodationOccupanciesOnDay\(room,day\)/);
  assert.match(helper,/String\(item\.occupancyId\)===String\(room\.keyHolderOccupancyId\)/);
});

test('key filters, room detail and guest badge use the same active-day holder',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.match(body,/filter==='key-delivered'&&!canonicalAccommodationActiveKeyHolder\(room,operationalDay\)/);
  assert.match(body,/filter==='key-not-delivered'&&canonicalAccommodationActiveKeyHolder\(room,operationalDay\)/);
  assert.match(body,/var activeKeyHolder=canonicalAccommodationActiveKeyHolder\(room,operationalDay\)/);
  assert.match(body,/activeKeyHolder\.person&&activeKeyHolder\.person\.fullName/);
  assert.match(body,/activeKeyHolder&&String\(activeKeyHolder\.occupancyId\)===String\(occupancy\.occupancyId\)/);
});

test('key handover checks conference, room revision, permission and current occupant at selection time',()=>{
  const start=ui.indexOf('function setCanonicalAccommodationRoomKey(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/String\(selectedConference\.id\)!==conferenceId/);
  assert.match(body,/String\(latestRoom\.roomAssignmentRevision\)!==String\(room\.roomAssignmentRevision\)/);
  assert.match(body,/currentConferenceSectionCapability\('accommodationManage'\)/);
  assert.match(body,/getCanonicalAccommodationOccupanciesOnDay\(latestRoom,getConferenceOperationalDay\(selectedConference\)\)/);
  assert.match(body,/String\(item\.occupancyId\)===String\(holder\.occupancyId\)/);
  assert.match(body,/setConferenceAccommodationRoomKey\(selectedConference\.id,latestRoom\.roomId,latestRoom\.roomAssignmentRevision/);
});
test('key handover can be cleared even when the room has no active occupants',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.match(body,/canManage&&\(roomOccupancies\.length\|\|room\.keyHolderOccupancyId\)/);
});

test('key handover rejects stale conference hydration generation',()=>{
  const start=ui.indexOf('function setCanonicalAccommodationRoomKey(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/generation=conferenceTabHydrationGeneration/);
  assert.match(body,/generation!==conferenceTabHydrationGeneration/);
  assert.ok(body.indexOf('generation!==conferenceTabHydrationGeneration')<body.indexOf('setConferenceAccommodationRoomKey('));
});

test('key handover rejects a change to the conference operational day',()=>{
  const start=ui.indexOf('function setCanonicalAccommodationRoomKey(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/day=getConferenceOperationalDay\(current\)/);
  assert.match(body,/String\(getConferenceOperationalDay\(selectedConference\)\)!==String\(day\)/);
  assert.ok(body.indexOf('String(getConferenceOperationalDay(selectedConference))!==String(day)')<body.indexOf('setConferenceAccommodationRoomKey('));
});

test('canonical accommodation searches house floor room notes and guest identity',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/roomSearchLocations\[String\(room\.roomId\)\]/);
  assert.match(body,/house:house\.name\|\|''/);
  assert.match(body,/floor:floor\.name\|\|''/);
  assert.match(body,/location\.house\|\|''/);
  assert.match(body,/location\.floor\|\|''/);
  assert.match(body,/room\.notes\|\|''/);
  assert.match(body,/person\.fullName\|\|''/);
});
test('canonical accommodation hides nonmatching house groups without mutating data',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.match(body,/var visibleHouseRooms=/);
  assert.match(body,/matchingRooms\.indexOf\(room\)>=0/);
  assert.match(body,/if\(!visibleHouseRooms\)return/);
});

test('canonical search preserves text caret and selection after filtering rerender',()=>{
  const start=ui.indexOf('function updateAccommodationSearch(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(body,/previousInput\.selectionStart/);
  assert.match(body,/previousInput\.selectionEnd/);
  assert.match(body,/previousInput\.selectionDirection/);
  assert.match(body,/renderAccommodation\(\)/);
  assert.match(body,/input\.setSelectionRange\(Math\.min\(selectionStart,length\),Math\.min\(selectionEnd,length\),selectionDirection\)/);
});

test('canonical guest cards tolerate missing person details',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.match(body,/roomOccupancies\.forEach\(function\(occupancy\)\{var person=occupancy\.person\|\|\{\}/);
  assert.match(body,/esc\(person\.fullName\|\|'نزيل بدون اسم'\)/);
  assert.match(body,/esc\(person\.church\|\|''\)/);
  assert.match(body,/person\.phone\?' • '\+esc\(person\.phone\)/);
});
test('available-room filter excludes zero-capacity rooms',()=>{
  const start=ui.indexOf('function renderCanonicalAccommodation(');
  const end=ui.indexOf('\nfunction ',start+1);
  const body=ui.slice(start,end);
  assert.match(body,/filter==='available'&&\(room\.isClosed\|\|Number\(room\.baseCapacity\|\|0\)\+Number\(room\.extraBedCapacity\|\|0\)<=0/);
});
