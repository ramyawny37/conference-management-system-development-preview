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
  const calls=[],toasts=[];
  const directory=options.directory||{houses:[{houseId:'house-a',houseAssigned:false,floors:[{name:'F',rooms:[{roomId:'room-a',roomNumber:'1',assigned:false,available:true}]}]}]};
  const service={
    listRoomOptions:id=>{calls.push(['list',id]);return Promise.resolve(directory);},
    assign:(id,house,assign,revision)=>{calls.push(['house',id,house,assign,revision]);return Promise.resolve({assigned:assign});},
    assignRoom:(id,room,assign,revision)=>{calls.push(['room',id,room,assign,revision]);return options.roomFailure?Promise.reject({code:options.roomFailure}):Promise.resolve({assigned:assign});}
  };
  const sandbox={window:null,Promise,String,parseInt,conferenceTabHydrationGeneration:generation,
    getCurrentConference:()=>current,currentConferenceSectionCapability:()=>options.manage!==false,
    CanonicalConferenceHouses:service,prompt:()=>options.answer===undefined?'1':options.answer,
    confirm:()=>options.confirm!==false,showToast:(message,color)=>toasts.push([message,color]),
    canonicalAccommodationMutation:(promise,success,failure)=>promise.then(value=>{calls.push(['refresh']);toasts.push([success]);return value;}).catch(error=>{toasts.push([failure(error),'#E74C3C']);return false;})};
  sandbox.window=sandbox;
  vm.runInNewContext(functions,sandbox);
  return {sandbox,calls,toasts,switchConference(){current={id:'conference-b'};generation++;sandbox.conferenceTabHydrationGeneration=generation;}};
}

test('discovery preserves the exact server-derived accommodation management decision',async()=>{
  const context={window:null,Promise};context.window=context;
  context.PlatformDeviceSession={invokeModuleProtected:()=>Promise.resolve({conferences:[{conferenceId:'conference-a',capabilities:{core:true,accommodation:true,accommodationManage:true}}]})};
  vm.runInNewContext(discovery,context);
  const result=await context.CanonicalConferenceDiscovery.listAccessibleConferences();
  assert.equal(result.data.conferences[0].capabilities.accommodationManage,true);
  assert.doesNotMatch(discovery,/platform_owner|is_canonical_platform_owner|conference_members/);
});

test('empty directory and view-only access never start a canonical mutation',async()=>{
  const empty=runtime({directory:{houses:[]}});assert.equal(await empty.sandbox.chooseCanonicalConferenceHouse(),false);assert.deepEqual(empty.calls,[['list','conference-a']]);
  const viewer=runtime({manage:false});assert.equal(viewer.sandbox.chooseCanonicalConferenceHouse(),false);assert.deepEqual(viewer.calls,[]);
});

test('house and room assignment use one conference identity and wait for coordinated refresh',async()=>{
  const env=runtime();assert.deepEqual(await env.sandbox.chooseCanonicalConferenceHouse(),{assigned:true});
  assert.deepEqual(env.calls,[['list','conference-a'],['house','conference-a','house-a',true,null],['room','conference-a','room-a',true,null],['refresh']]);
  assert.equal(env.toasts.at(-1)[0],'✅ تم تخصيص الغرفة للمؤتمر');
  assert.doesNotMatch(functions,/renderAccommodation\(\)/);
});

test('rejected assignment and late conference selection do not announce success',async()=>{
  const rejected=runtime({roomFailure:'ROOM_CONFERENCE_PERIOD_OVERLAP'});assert.equal(await rejected.sandbox.chooseCanonicalConferenceHouse(),false);
  assert.equal(rejected.toasts.some(item=>item[0]==='✅ تم تخصيص الغرفة للمؤتمر'),false);
  let release;const changed=runtime();changed.sandbox.CanonicalConferenceHouses.listRoomOptions=()=>new Promise(resolve=>{release=resolve;});
  const pending=changed.sandbox.chooseCanonicalConferenceHouse();changed.switchConference();release({houses:[]});assert.equal(await pending,false);
  assert.deepEqual(changed.calls,[]);assert.equal(changed.toasts.some(item=>item[0]==='✅ تم تخصيص الغرفة للمؤتمر'),false);
});

test('room and house unassignment remain permission-gated and coordinated',async()=>{
  const room=runtime();await room.sandbox.unassignCanonicalConferenceRoom('room-a',7);assert.deepEqual(room.calls,[['room','conference-a','room-a',false,7],['refresh']]);
  const house=runtime();await house.sandbox.unassignCanonicalConferenceHouse('house-a',4);assert.deepEqual(house.calls,[['house','conference-a','house-a',false,4],['refresh']]);
});

test('canonical contracts retain overlap and occupied-room protections without duplicate hierarchy',()=>{
  assert.match(roomSql,/assert_conference_room_period_available/);
  assert.match(roomSql,/ROOM_CONFERENCE_PERIOD_OVERLAP/);
  assert.match(roomSql,/ROOM_ASSIGNMENT_HAS_OCCUPANCIES/);
  assert.match(roomSql,/HOUSE_ASSIGNMENT_HAS_ROOMS/);
  assert.match(integration,/record\.remoteConferenceId/);
  assert.doesNotMatch(integration,/appData\.conferences[\s\S]{0,200}assign_conference_(?:house|room)/);
});
