'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const integrationSource=fs.readFileSync('js/platform-integration.js','utf8');
const gateSource=fs.readFileSync('js/sync/startup-access-gate.js','utf8');
const DEVICE='11ebe6fe-67a3-488c-8128-d15ad2b79140';
const BINDING='64cf766b-2642-414f-ad38-6e0cf01cb958';
const THUMB='ddc33db37e1481014b3970e63b282da74743e25d0197b6b4a6e043d03b7ea016';

function harness(options){
  options=options||{};
  const ids=['startupAccessGate','applicationTopbar','applicationBody','startupScreen','globalConferenceHeader','device_authorization_administration_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'];
  const nodes=Object.fromEntries(ids.map(id=>[id,{style:{display:'none'},innerHTML:''}]));
  const queued=[];
  let status=options.status||'pending',enrollmentCalls=0,sessionCalls=0,identityId=DEVICE;
  const window={
    location:{hostname:'ramyawny37.github.io'},history:{pushState(){}},
    document:{visibilityState:'visible',getElementById:id=>nodes[id]||null,addEventListener(){},querySelector(){return null;}},
    addEventListener(){},setTimeout(fn){queued.push(fn);return queued.length;},clearTimeout(){},navigator:{platform:'MacIntel'},
    SupabaseAuth:{initialize:()=>Promise.resolve(),getState:()=>({authenticated:true}),getAccountIdentity:()=>({authenticated:true}),getSession:()=>({user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}})},
    SupabaseClientLayer:{getClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{}}})}})},
    SupabaseDeviceIdentity:{getCurrent:()=>({id:identityId,deviceName:'',platform:'MacIntel',createdAt:''}),getOrCreate:()=>({id:identityId,platform:'MacIntel'})},
    FirstSystemBootstrapService:{getStatus:()=>Promise.resolve({ok:true,status:'completed'})},
    SystemAccessService:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({accountStatus:'approved',fresh:true})},
    CurrentDeviceAuthorizationUI:{getState:()=>({status:'unavailable'})},
    CurrentDeviceAuthorizationService:{getLastDiagnostic:()=>({})},AccessDiagnosticsUI:{render:()=>''},SyncSettingsUI:{signOut(){}},
    PlatformDeviceSession:{ensureValid(){sessionCalls++;return Promise.resolve({verified:true});}}
  };
  window.window=window;
  vm.runInNewContext(integrationSource,{window,Promise,Date,String,Array,Object,JSON,Error});
  window.PlatformDeviceEnrollment={ensure(){
    enrollmentCalls++;
    if(options.failure)return Promise.reject({code:'DEVICE_ENROLLMENT_DENIED'});
    const data={deviceId:DEVICE,bindingId:BINDING,publicKeyThumbprint:THUMB,status};
    const result={record:{deviceId:DEVICE,bindingId:BINDING,publicKeyThumbprint:THUMB},status,data};
    window.PlatformIntegration.reconcileNativeDevice(result);
    return Promise.resolve(result);
  }};
  vm.runInNewContext(gateSource,{window,Promise,Date,String,Array,Object,setTimeout:window.setTimeout});
  return {window,nodes,counts:()=>({enrollmentCalls,sessionCalls}),setStatus:value=>{status=value;},setIdentity:value=>{identityId=value;},poll:()=>queued.shift()&&queued.shift(),drainOne:()=>{const fn=queued.shift();if(fn)fn();}};
}

async function settle(){for(let i=0;i<12;i++)await Promise.resolve();}

test('native pending result reconciles integration context and survives polling until approved',async()=>{
  const state=harness();
  assert.equal((await state.window.StartupAccessGate.run({completeApplicationStartup:()=>{state.nodes.applicationBody.style.display='block';}})).status,'device');
  assert.equal(state.window.PlatformIntegration.getContext().deviceId,DEVICE);
  assert.equal(state.window.PlatformIntegration.getContext().deviceStatus,'pending');
  assert.equal(state.window.PlatformIntegration.getDeviceIdentity().id,DEVICE);
  assert.match(state.nodes.startupAccessGate.innerHTML,/الحالة:<\/strong> بانتظار الاعتماد/);
  assert.match(state.nodes.startupAccessGate.innerHTML,/11ebe6fe…/);
  assert.deepEqual(state.counts(),{enrollmentCalls:1,sessionCalls:0});
  await state.window.StartupAccessGate.evaluate();
  assert.deepEqual(state.counts(),{enrollmentCalls:2,sessionCalls:0});
  assert.equal(state.window.PlatformIntegration.getDeviceIdentity().id,DEVICE);
  state.setStatus('approved');await state.window.StartupAccessGate.evaluate();
  assert.deepEqual(state.counts(),{enrollmentCalls:3,sessionCalls:1});
  assert.equal(state.window.StartupAccessGate.getState().canonicalState,'DEVICE_APPROVED');
  assert.equal(state.window.StartupAccessGate.isAllowed(),true);
});

test('genuine native enrollment failure remains distinct from pending',async()=>{
  const state=harness({failure:true});
  const result=await state.window.StartupAccessGate.run({completeApplicationStartup:()=>{}});
  assert.equal(result.status,'device_error');
  assert.match(state.nodes.startupAccessGate.innerHTML,/تعذر إنشاء طلب الاعتماد/);
  assert.doesNotMatch(state.nodes.startupAccessGate.innerHTML,/الحالة:<\/strong> بانتظار الاعتماد/);
  assert.deepEqual(state.counts(),{enrollmentCalls:1,sessionCalls:0});
});

for(const denied of ['revoked','blocked'])test(denied+' remains fail-closed without a device session',async()=>{
  const state=harness({status:denied});
  const result=await state.window.StartupAccessGate.run({completeApplicationStartup:()=>{}});
  assert.equal(result.status,'device');
  assert.equal(state.window.StartupAccessGate.getState().canonicalState,'DEVICE_REVOKED');
  assert.deepEqual(state.counts(),{enrollmentCalls:1,sessionCalls:0});
});
