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
  const listeners={},elements={},renders=[];
  const flights={core:deferred(),people:deferred(),accommodation:deferred(),transport:deferred()};
  const sandbox={window:null,Promise,Object,String,Number,console,currentTab:1,
    getCurrentConference:()=>current,getCanonicalConferenceCoreLink:()=>({remoteConferenceId:current.id}),
    ge:id=>(elements[id]||(elements[id]={innerHTML:'',style:{}})),
    hydrateCanonicalConferenceCore:()=>flights.core.promise,
    hydrateCanonicalConferenceParticipations:()=>flights.people.promise,
    hydrateCanonicalConferenceAccommodation:()=>flights.accommodation.promise,
    hydrateCanonicalConferenceTransport:()=>flights.transport.promise,
    hydrateCanonicalConferenceRestaurant:()=>Promise.resolve({}),hydrateCanonicalConferenceBranding:()=>Promise.resolve({}),hydrateCanonicalConferenceActivity:()=>Promise.resolve({}),
    renderAccommodation:()=>renders.push(0),renderTransports:()=>renders.push(1),renderAccounts:()=>renders.push(2),renderV3Reports:()=>renders.push(3),renderCards:()=>renders.push(4),renderSearch:()=>renders.push(5),renderSettings:()=>renders.push(6)
  };
  sandbox.window=sandbox;sandbox.addEventListener=(name,handler)=>{listeners[name]=handler;};
  vm.runInNewContext(coordinator,sandbox);
  return {sandbox,flights,elements,renders,listeners,setCurrent:value=>{current=value;}};
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

test('accommodation mutation waits for all downstream hydration before success',async()=>{
  let current={id:'conference-a'};const dependencies=[deferred(),deferred(),deferred()],renders=[],toasts=[];
  const sandbox={window:null,Promise,Object,String,currentTab:4,conferenceTabHydrationGeneration:2,getCurrentConference:()=>current,
    hydrateCanonicalConferenceAccommodation:()=>dependencies[0].promise,hydrateCanonicalConferenceTransport:()=>dependencies[1].promise,hydrateCanonicalConferenceRestaurant:()=>dependencies[2].promise,
    renderTab:(tab,options)=>renders.push([tab,options]),showToast:(message,color)=>toasts.push([message,color])};sandbox.window=sandbox;
  vm.runInNewContext(mutation,sandbox);
  const operation=sandbox.canonicalAccommodationMutation(Promise.resolve({ok:true}),'saved');
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(renders,[]);assert.deepEqual(toasts,[]);
  dependencies.forEach(item=>item.resolve({status:'loaded'}));
  assert.deepEqual(await operation,{ok:true});
  assert.equal(JSON.stringify(renders),JSON.stringify([[4,{skipHydration:true}]]));assert.deepEqual(toasts,[['saved',undefined]]);
});

test('accommodation mutation cannot announce success after scope changes',async()=>{
  let current={id:'conference-a'};const dependencies=[deferred(),deferred(),deferred()],renders=[],toasts=[];
  const sandbox={window:null,Promise,Object,String,currentTab:0,conferenceTabHydrationGeneration:0,getCurrentConference:()=>current,
    hydrateCanonicalConferenceAccommodation:()=>dependencies[0].promise,hydrateCanonicalConferenceTransport:()=>dependencies[1].promise,hydrateCanonicalConferenceRestaurant:()=>dependencies[2].promise,
    renderTab:(...args)=>renders.push(args),showToast:(...args)=>toasts.push(args)};sandbox.window=sandbox;
  vm.runInNewContext(mutation,sandbox);
  const operation=sandbox.canonicalAccommodationMutation(Promise.resolve({ok:true}),'saved');
  await Promise.resolve();await Promise.resolve();current={id:'conference-b'};dependencies.forEach(item=>item.resolve({}));
  assert.equal(await operation,false);assert.deepEqual(renders,[]);
  assert.equal(toasts.some(item=>item[0]==='saved'),false);
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

test('external source change requests a full hydration cycle rather than a stale direct render',()=>{
  const handler=script.slice(script.indexOf("window.addEventListener('platform-conference-source-change'"),script.indexOf('function hydrateCanonicalConferenceAccommodation'));
  assert.match(handler,/renderTab\(currentTab\)/);
  assert.doesNotMatch(handler,/skipHydration:true/);
});
