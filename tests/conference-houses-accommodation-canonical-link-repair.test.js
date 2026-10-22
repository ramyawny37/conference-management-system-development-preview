'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const script=fs.readFileSync('script.js','utf8');
const discovery=fs.readFileSync('js/supabase/canonical-conference-discovery.js','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const roomSql=fs.readFileSync('supabase/migrations/20261020131411_conference_room_assignment_foundation.sql','utf8');
const functions=script.slice(script.indexOf('function chooseCanonicalConferenceHouse('),script.indexOf('function createCanonicalAccommodationHouse('));

function runtime(options){
  options=options||{};
  let current={id:'conference-a'},generation=3;
  const calls=[],toasts=[],nodes={conferenceHouseSelectorModal:{style:{}},conferenceHouseSelectorContent:{innerHTML:''},conferenceHouseSelectorConfirm:{disabled:false,textContent:''}};
  const directory=options.directory||{houses:[
    {houseId:'house-a',name:'House A',houseAssigned:false,floors:[{name:'F1',rooms:[{roomId:'room-a',roomNumber:'1',assigned:false,available:true},{roomId:'room-b',roomNumber:'2',assigned:false,available:true},{roomId:'room-c',roomNumber:'3',assigned:false,available:false}]}]},
    {houseId:'house-b',name:'House B',houseAssigned:true,floors:[{name:'F2',rooms:[{roomId:'room-d',roomNumber:'4',assigned:true,available:true},{roomId:'room-e',roomNumber:'5',assigned:false,available:true}]}]}
  ]};
  const service={
    listRoomOptions:id=>{calls.push(['list',id]);return Promise.resolve(directory);},
    assign:(id,house,assign,revision)=>{calls.push(['house',id,house,assign,revision]);return options.houseFailure?Promise.reject({code:options.houseFailure}):Promise.resolve({assigned:assign});},
    assignRoom:(id,room,assign,revision)=>{calls.push(['room',id,room,assign,revision]);return options.roomFailures&&options.roomFailures[room]?Promise.reject({code:options.roomFailures[room]}):Promise.resolve({assigned:assign});}
  };
  const sandbox={window:null,Promise,String,Object,conferenceTabHydrationGeneration:generation,conferenceHouseSelectorState:{status:'idle',conferenceId:null,generation:null,directory:null,selectedHouseId:null,selectedRooms:{}},
    getCurrentConference:()=>current,currentConferenceSectionCapability:()=>options.manage!==false,CanonicalConferenceHouses:service,
    ge:id=>nodes[id]||null,esc:value=>String(value),showToast:(message,color)=>toasts.push([message,color]),confirm:()=>true,
    canonicalAccommodationMutation:promise=>{const startedId=current.id,startedGeneration=generation;return promise.then(value=>{calls.push(['refresh']);return options.hydrationFailure||current.id!==startedId||generation!==startedGeneration?false:value;});}};
  if(options.refreshedRooms)sandbox.canonicalAccommodationState=()=>({houses:[{floors:[{rooms:options.refreshedRooms.map(roomId=>({roomId}))}]}]});
  sandbox.window=sandbox;
  vm.runInNewContext(functions,sandbox);
  return {sandbox,calls,toasts,nodes,switchConference(){current={id:'conference-b'};generation++;sandbox.conferenceTabHydrationGeneration=generation;}};
}

test('discovery preserves the exact server-derived accommodation management decision',async()=>{
  const context={window:null,Promise};context.window=context;
  context.PlatformDeviceSession={invokeModuleProtected:()=>Promise.resolve({conferences:[{conferenceId:'conference-a',capabilities:{core:true,accommodation:true,accommodationManage:true}}]})};
  vm.runInNewContext(discovery,context);
  const result=await context.CanonicalConferenceDiscovery.listAccessibleConferences();
  assert.equal(result.data.conferences[0].capabilities.accommodationManage,true);
  assert.doesNotMatch(discovery,/platform_owner|is_canonical_platform_owner|conference_members/);
});

test('empty directory and view-only access never open or mutate the selector',async()=>{
  const empty=runtime({directory:{houses:[]}});assert.equal(await empty.sandbox.chooseCanonicalConferenceHouse(),false);assert.deepEqual(empty.calls,[['list','conference-a']]);
  const viewer=runtime({manage:false});assert.equal(viewer.sandbox.chooseCanonicalConferenceHouse(),false);assert.deepEqual(viewer.calls,[]);
});

test('house-first selector shows status, changes house, and cancellation clears draft only',async()=>{
  const env=runtime();assert.equal(await env.sandbox.chooseCanonicalConferenceHouse(),true);
  assert.equal(env.nodes.conferenceHouseSelectorModal.style.display,'flex');assert.match(env.nodes.conferenceHouseSelectorContent.innerHTML,/House A/);assert.match(env.nodes.conferenceHouseSelectorContent.innerHTML,/مخصصة بالفعل|غير متاحة/);
  env.sandbox.toggleCanonicalConferenceRoomSelection('room-a',true);assert.equal(env.sandbox.conferenceHouseSelectorState.selectedRooms['room-a'],true);
  env.sandbox.selectCanonicalConferenceHouse('house-b');assert.equal(JSON.stringify(env.sandbox.conferenceHouseSelectorState.selectedRooms),'{}');
  env.sandbox.closeCanonicalConferenceHouseSelector();assert.equal(env.sandbox.conferenceHouseSelectorState.status,'idle');assert.deepEqual(env.calls,[['list','conference-a']]);
});

test('multiple rooms from one house assign sequentially and refresh once before success',async()=>{
  const env=runtime();await env.sandbox.chooseCanonicalConferenceHouse();env.sandbox.toggleCanonicalConferenceRoomSelection('room-a',true);env.sandbox.toggleCanonicalConferenceRoomSelection('room-b',true);
  const result=await env.sandbox.confirmCanonicalConferenceHouseRooms();assert.equal(result.requested,2);assert.equal(result.results.filter(item=>item.ok).length,2);
  assert.deepEqual(env.calls,[['list','conference-a'],['house','conference-a','house-a',true,null],['room','conference-a','room-a',true,null],['room','conference-a','room-b',true,null],['refresh']]);
  assert.equal(env.toasts.at(-1)[0],'✅ تم تخصيص 2 غرفة للمؤتمر');assert.doesNotMatch(functions,/renderAccommodation\(\)/);
});

test('unavailable rooms cannot enter the batch and a middle failure reports partial outcome',async()=>{
  const env=runtime({roomFailures:{'room-b':'ROOM_CONFERENCE_PERIOD_OVERLAP'}});await env.sandbox.chooseCanonicalConferenceHouse();
  env.sandbox.toggleCanonicalConferenceRoomSelection('room-a',true);env.sandbox.toggleCanonicalConferenceRoomSelection('room-b',true);env.sandbox.toggleCanonicalConferenceRoomSelection('room-c',true);
  const result=await env.sandbox.confirmCanonicalConferenceHouseRooms();assert.equal(result.requested,2);assert.equal(result.results.filter(item=>item.ok).length,1);assert.equal(result.results.filter(item=>!item.ok).length,1);
  assert.equal(env.calls.some(item=>item[0]==='room'&&item[2]==='room-c'),false);assert.match(env.toasts.at(-1)[0],/تم تخصيص 1 من 2 غرفة/);assert.match(env.toasts.at(-1)[0],/غرفة 2: تداخل/);
});

test('final hydrated server state reconciles an unconfirmed room response',async()=>{
  const env=runtime({roomFailures:{'room-b':'NETWORK_FAILED'},refreshedRooms:['room-a','room-b']});await env.sandbox.chooseCanonicalConferenceHouse();
  env.sandbox.toggleCanonicalConferenceRoomSelection('room-a',true);env.sandbox.toggleCanonicalConferenceRoomSelection('room-b',true);
  const result=await env.sandbox.confirmCanonicalConferenceHouseRooms();assert.equal(result.results.filter(item=>item.ok).length,2);assert.equal(env.toasts.at(-1)[0],'✅ تم تخصيص 2 غرفة للمؤتمر');
});

test('conference change during a batch prevents later writes and success announcement',async()=>{
  let release;const env=runtime();await env.sandbox.chooseCanonicalConferenceHouse();env.sandbox.toggleCanonicalConferenceRoomSelection('room-a',true);env.sandbox.toggleCanonicalConferenceRoomSelection('room-b',true);
  env.sandbox.CanonicalConferenceHouses.assignRoom=(id,room)=>{env.calls.push(['room',id,room,true,null]);if(room==='room-a')return new Promise(resolve=>{release=resolve;});return Promise.resolve({assigned:true});};
  const pending=env.sandbox.confirmCanonicalConferenceHouseRooms();await Promise.resolve();await Promise.resolve();env.switchConference();release({assigned:true});
  assert.equal(await pending,false);assert.equal(env.calls.some(item=>item[0]==='room'&&item[2]==='room-b'),false);assert.equal(env.toasts.some(item=>/^✅/.test(item[0])),false);
});

test('room and house unassignment remain permission-gated and coordinated',async()=>{
  const room=runtime();await room.sandbox.unassignCanonicalConferenceRoom('room-a',7);assert.deepEqual(room.calls,[['room','conference-a','room-a',false,7],['refresh']]);
  const house=runtime();await house.sandbox.unassignCanonicalConferenceHouse('house-a',4);assert.deepEqual(house.calls,[['house','conference-a','house-a',false,4],['refresh']]);
});

test('canonical contracts retain overlap and occupied-room protections without duplicate hierarchy',()=>{
  assert.match(roomSql,/assert_conference_room_period_available/);assert.match(roomSql,/ROOM_CONFERENCE_PERIOD_OVERLAP/);assert.match(roomSql,/ROOM_ASSIGNMENT_HAS_OCCUPANCIES/);assert.match(roomSql,/HOUSE_ASSIGNMENT_HAS_ROOMS/);
  assert.match(integration,/record\.remoteConferenceId/);assert.doesNotMatch(integration,/appData\.conferences[\s\S]{0,200}assign_conference_(?:house|room)/);assert.doesNotMatch(functions,/\bprompt\s*\(/);
});
