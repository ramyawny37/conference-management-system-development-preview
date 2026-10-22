'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const script=fs.readFileSync('script.js','utf8');
const platformIntegration=fs.readFileSync('js/platform-integration.js','utf8');
const coordinator=script.slice(script.indexOf('var conferenceTabHydrationFlights='),script.indexOf('function reconcileConferenceRoute'));
const mutation=script.slice(script.indexOf('function canonicalAccommodationMutation('),script.indexOf('function canonicalAccommodationState('));

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function platformRuntime(){
  const listeners={},requests=[];
  const sandbox={window:null,console,Promise,JSON,Object,String,Array,Date,RegExp,Error,Uint8Array,Math,setTimeout,clearTimeout,navigator:{onLine:true},crypto:{randomUUID:()=> '40000000-0000-4000-8000-000000000001'},document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;}},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},dispatchEvent(){},CustomEvent:function(){},PlatformDeviceSession:{invokeModuleProtected(module,operation,args){const item=deferred();requests.push({module,operation,args,...item});return item.promise;}}};
  sandbox.window=sandbox;vm.runInNewContext(platformIntegration,sandbox);
  return {sandbox,requests,reset(){for(const fn of listeners['platform-session-reset']||[])fn({type:'platform-session-reset'});}};
}
function hydrationRuntime(){
  let current={id:'conference-a'};
  const listeners={},elements={},renders=[],calls={core:0,people:0,accommodation:0,transport:0};
  const flights={core:deferred(),people:deferred(),accommodation:deferred(),transport:deferred()};
  const sandbox={window:null,Promise,Object,String,Number,console,currentTab:1,
    getCurrentConference:()=>current,getCanonicalConferenceCoreLink:()=>({remoteConferenceId:current.id}),
    ge:id=>(elements[id]||(elements[id]={innerHTML:'',style:{}})),
    hydrateCanonicalConferenceCore:()=>{calls.core++;return flights.core.promise;},
    hydrateCanonicalConferenceParticipations:()=>{calls.people++;return flights.people.promise;},
    hydrateCanonicalConferenceAccommodation:()=>{calls.accommodation++;return flights.accommodation.promise;},
    hydrateCanonicalConferenceTransport:()=>{calls.transport++;return flights.transport.promise;},
    hydrateCanonicalConferenceRestaurant:()=>Promise.resolve({}),hydrateCanonicalConferenceBranding:()=>Promise.resolve({}),hydrateCanonicalConferenceActivity:()=>Promise.resolve({}),
    renderAccommodation:()=>renders.push(0),renderTransports:()=>renders.push(1),renderAccounts:()=>renders.push(2),renderV3Reports:()=>renders.push(3),renderCards:()=>renders.push(4),renderSearch:()=>renders.push(5),renderSettings:()=>renders.push(6)
  };
  sandbox.window=sandbox;sandbox.addEventListener=(name,handler)=>{listeners[name]=handler;};
  vm.runInNewContext(coordinator,sandbox);
  return {sandbox,flights,elements,renders,listeners,calls,setCurrent:value=>{current=value;}};
}

test('tab stays in loading state until every canonical dependency succeeds',async()=>{
  const env=hydrationRuntime(),s=env.sandbox;
  assert.equal(s.renderTab(1),true);
  assert.match(env.elements.tab1.innerHTML,/aria-busy="true"/);
  assert.deepEqual(env.renders,[]);
  const flight=s.hydrateConferenceTabDataOnDemand(1);
  Object.values(env.flights).forEach(item=>item.resolve({status:'loaded'}));
  await flight;
  assert.equal(s.getConferenceTabHydrationState('conference-a',1).status,'ready');
  assert.deepEqual(env.renders,[1]);
  const calls=JSON.stringify(env.calls);
  assert.equal(s.renderTab(1),true);
  assert.equal(JSON.stringify(env.calls),calls);
  assert.deepEqual(env.renders,[1,1]);
});

test('failed and denied hydration never render stale tab data',async()=>{
  for(const scenario of [{code:'NETWORK_FAILED',status:'error'},{code:'MODULE_PERMISSION_REQUIRED',status:'denied'}]){
    const env=hydrationRuntime(),s=env.sandbox;
    s.renderTab(1);const flight=s.hydrateConferenceTabDataOnDemand(1);
    env.flights.core.resolve({});env.flights.people.resolve({});env.flights.transport.resolve({});env.flights.accommodation.reject({code:scenario.code});
    await assert.rejects(flight);
    assert.equal(s.getConferenceTabHydrationState('conference-a',1).status,scenario.status);
    assert.deepEqual(env.renders,[]);
    assert.doesNotMatch(env.elements.tab1.innerHTML,/aria-busy="true"/);
  }
});

test('late conference and session responses cannot redraw or publish ready state',async()=>{
  const switched=hydrationRuntime(),flight=switched.sandbox.hydrateConferenceTabDataOnDemand(1);
  switched.setCurrent({id:'conference-b'});Object.values(switched.flights).forEach(item=>item.resolve({}));
  await assert.rejects(flight,error=>error.code==='CANONICAL_CONFERENCE_SCOPE_CHANGED');
  assert.deepEqual(switched.renders,[]);
  assert.equal(switched.sandbox.getConferenceTabHydrationState('conference-a',1),null);

  const reset=hydrationRuntime(),resetFlight=reset.sandbox.hydrateConferenceTabDataOnDemand(1);
  reset.listeners['platform-session-reset']();Object.values(reset.flights).forEach(item=>item.resolve({}));
  await assert.rejects(resetFlight,error=>error.code==='CANONICAL_CONFERENCE_SESSION_CHANGED');
  assert.deepEqual(reset.renders,[]);
  assert.equal(reset.sandbox.getConferenceTabHydrationState('conference-a',1),null);
});

test('rapid tab navigation renders only the active tab and reuses completed ready states',async()=>{
  const env=hydrationRuntime(),s=env.sandbox;
  s.currentTab=1;const transportFlight=s.hydrateConferenceTabDataOnDemand(1);
  s.currentTab=0;const accommodationFlight=s.hydrateConferenceTabDataOnDemand(0);
  Object.values(env.flights).forEach(item=>item.resolve({}));
  await Promise.all([transportFlight,accommodationFlight]);
  assert.deepEqual(env.renders,[0]);
  const calls=JSON.stringify(env.calls);
  s.currentTab=1;assert.equal(s.renderTab(1),true);
  assert.equal(JSON.stringify(env.calls),calls);
  assert.deepEqual(env.renders,[0,1]);
});

test('invalidation makes an in-flight response stale and only the replacement may become ready',async()=>{
  const env=hydrationRuntime(),s=env.sandbox;
  const stale=s.hydrateConferenceTabDataOnDemand(1);
  s.invalidateConferenceTabHydration('conference-a',[1]);
  const fresh=s.hydrateConferenceTabDataOnDemand(1);
  Object.values(env.flights).forEach(item=>item.resolve({}));
  await assert.rejects(stale,error=>error.code==='CANONICAL_CONFERENCE_HYDRATION_STALE');
  await fresh;
  const state=s.getConferenceTabHydrationState('conference-a',1);
  assert.equal(state.status,'ready');assert.equal(state.invalidation,1);
});

test('accommodation mutation waits for all downstream hydration before success',async()=>{
  let current={id:'conference-a'};const dependencies=[deferred(),deferred(),deferred(),deferred()],renders=[],toasts=[],states={};
  const sandbox={window:null,Promise,Object,String,currentTab:4,conferenceTabHydrationGeneration:2,getCurrentConference:()=>current,
    hydrateCanonicalConferenceAccommodation:()=>dependencies[0].promise,hydrateCanonicalConferenceTransport:()=>dependencies[1].promise,hydrateCanonicalConferenceRestaurant:()=>dependencies[2].promise,hydrateCanonicalConferenceBranding:()=>dependencies[3].promise,
    getConferenceTabHydrators:()=>[sandbox.hydrateCanonicalConferenceBranding],runConferenceHydrators:(id,hydrators)=>Promise.all([...new Set(hydrators)].map(fn=>fn(id))),invalidateConferenceTabHydration:()=>{},conferenceTabHydrationKey:(id,tab)=>id+':'+tab,getConferenceTabHydrationInvalidation:()=>1,conferenceTabHydrationStates:states,conferenceTabHydrationFlights:{},renderConferenceTabHydrationState:()=>{},renderReadyConferenceTab:(...args)=>renders.push(args),isConferenceHydrationDenied:()=>false,
    showToast:(message,color)=>toasts.push([message,color])};sandbox.window=sandbox;
  vm.runInNewContext(mutation,sandbox);
  const operation=sandbox.canonicalAccommodationMutation(Promise.resolve({ok:true}),'saved');
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(renders,[]);assert.deepEqual(toasts,[]);
  dependencies.forEach(item=>item.resolve({status:'loaded'}));
  assert.deepEqual(await operation,{ok:true});
  assert.equal(JSON.stringify(renders),JSON.stringify([[4,'conference-a',2,1]]));assert.deepEqual(toasts,[['saved',undefined]]);
});

test('accommodation mutation cannot announce success after scope changes',async()=>{
  let current={id:'conference-a'};const dependencies=[deferred(),deferred(),deferred()],renders=[],toasts=[],states={};
  const sandbox={window:null,Promise,Object,String,currentTab:0,conferenceTabHydrationGeneration:0,getCurrentConference:()=>current,
    hydrateCanonicalConferenceAccommodation:()=>dependencies[0].promise,hydrateCanonicalConferenceTransport:()=>dependencies[1].promise,hydrateCanonicalConferenceRestaurant:()=>dependencies[2].promise,
    getConferenceTabHydrators:()=>[],runConferenceHydrators:(id,hydrators)=>Promise.all(hydrators.map(fn=>fn(id))),invalidateConferenceTabHydration:()=>{},conferenceTabHydrationKey:(id,tab)=>id+':'+tab,getConferenceTabHydrationInvalidation:()=>1,conferenceTabHydrationStates:states,conferenceTabHydrationFlights:{},renderConferenceTabHydrationState:()=>{},renderReadyConferenceTab:(...args)=>renders.push(args),isConferenceHydrationDenied:()=>false,
    showToast:(...args)=>toasts.push(args)};sandbox.window=sandbox;
  vm.runInNewContext(mutation,sandbox);
  const operation=sandbox.canonicalAccommodationMutation(Promise.resolve({ok:true}),'saved');
  await Promise.resolve();await Promise.resolve();current={id:'conference-b'};dependencies.forEach(item=>item.resolve({}));
  assert.equal(await operation,false);assert.deepEqual(renders,[]);
  assert.equal(toasts.some(item=>item[0]==='saved'),false);
});

test('mutation completion waits for a tab activated while downstream refresh is running',async()=>{
  let current={id:'conference-a'},settled=false;const operational=[deferred(),deferred(),deferred()],activeTab=deferred(),states={};
  const sandbox={window:null,Promise,Object,String,currentTab:4,conferenceTabHydrationGeneration:0,getCurrentConference:()=>current,
    hydrateCanonicalConferenceAccommodation:()=>operational[0].promise,hydrateCanonicalConferenceTransport:()=>operational[1].promise,hydrateCanonicalConferenceRestaurant:()=>operational[2].promise,
    getConferenceTabHydrators:()=>[],runConferenceHydrators:(id,hydrators)=>Promise.all(hydrators.map(fn=>fn(id))),invalidateConferenceTabHydration:()=>{},conferenceTabHydrationKey:(id,tab)=>id+':'+tab,getConferenceTabHydrationInvalidation:()=>1,conferenceTabHydrationStates:states,conferenceTabHydrationFlights:{},renderConferenceTabHydrationState:()=>{},renderReadyConferenceTab:()=>{},isConferenceHydrationDenied:()=>false,
    hydrateConferenceTabDataOnDemand:tab=>{assert.equal(tab,6);return activeTab.promise;},showToast:()=>{}};sandbox.window=sandbox;
  vm.runInNewContext(mutation,sandbox);
  const operation=sandbox.canonicalAccommodationMutation(Promise.resolve({ok:true}),'saved').then(value=>{settled=true;return value;});
  await Promise.resolve();await Promise.resolve();sandbox.currentTab=6;operational.forEach(item=>item.resolve({}));
  await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
  activeTab.resolve({});assert.deepEqual(await operation,{ok:true});assert.equal(settled,true);
});

test('every tab-level platform hydration rejects a response from the previous session',async()=>{
  const remote='10000000-0000-4000-8000-000000000001';
  const cases=[
    ['core',env=>env.sandbox.PlatformIntegration.hydrateConferenceCore('local',remote)],
    ['air',env=>env.sandbox.PlatformIntegration.hydrateConferenceAirConditioning('local',remote)],
    ['finance',env=>env.sandbox.CanonicalConferenceFinance.hydrate('local',remote)],
    ['branding',env=>env.sandbox.PlatformIntegration.hydrateConferenceBranding('local',remote)],
    ['activity',env=>env.sandbox.PlatformIntegration.hydrateConferenceActivity('local',remote)]
  ];
  for(const [name,start] of cases){
    const env=platformRuntime(),pending=start(env);
    await Promise.resolve();
    assert.equal(env.requests.length,1);
    env.reset();env.requests[0].resolve({});
    await assert.rejects(pending,error=>{assert.ok(['CANONICAL_CONFERENCE_SESSION_CHANGED','PLATFORM_SESSION_STALE'].includes(error.code),name+': '+error.code);return true;});
  }
});

test('external source change invalidates ready states and requests a full hydration cycle',()=>{
  const handler=script.slice(script.indexOf("window.addEventListener('platform-conference-source-change'"),script.indexOf('function hydrateCanonicalConferenceAccommodation'));
  assert.match(handler,/renderTab\(currentTab\)/);
  assert.match(handler,/invalidateConferenceTabHydration\(current\.id\)/);
  assert.doesNotMatch(handler,/skipHydration:true/);
  const calls=[],listeners={},sandbox={window:null,currentTab:3,getCurrentConference:()=>({id:'conference-a'}),invalidateConferenceTabHydration:id=>calls.push(['invalidate',id]),renderTab:tab=>calls.push(['render',tab])};
  sandbox.window=sandbox;sandbox.addEventListener=(name,fn)=>{listeners[name]=fn;};
  vm.runInNewContext('if(window.addEventListener)'+handler,sandbox);
  listeners['platform-conference-source-change']({detail:{localConferenceId:'conference-a'}});
  assert.deepEqual(calls,[['invalidate','conference-a'],['render',3]]);
});
