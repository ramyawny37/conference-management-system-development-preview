'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const uiSource=fs.readFileSync(path.join(root,'js/sync/device-authorization-administration-ui.js'),'utf8');
const serviceSource=fs.readFileSync(path.join(root,'js/supabase/device-authorization-administration-service.js'),'utf8');
function harness(){const element={style:{},innerHTML:''},calls=[];let devices=[{targetUserId:'11111111-1111-4111-8111-111111111111',deviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'A'}];const service={getSystemOwnerAdministrationState:()=>Promise.resolve({ok:true,status:'ready'}),listSystemOwnerPendingDevices:()=>{calls.push('list');return Promise.resolve({ok:true,status:'listed',data:{devices}});},approveSystemOwnerPendingDevice:input=>{calls.push({approve:input});devices=[];return Promise.resolve({ok:true,status:'applied'});},rejectSystemOwnerPendingDevice:input=>{calls.push({reject:input});devices=[];return Promise.resolve({ok:true,status:'applied'});}};const sandbox={window:null,Promise,Object,Array,String,JSON,console,document:{getElementById:()=>element},SupabaseAuth:{initialize:()=>Promise.resolve(),getSession:()=>({user:{id:'actor'}})},SupabaseClientLayer:{getClient:()=>null},DeviceAuthorizationAdministrationService:service};sandbox.window=sandbox;vm.runInNewContext(uiSource,sandbox);return {api:sandbox.DeviceAuthorizationAdministrationUI,element,calls,sandbox};}
test('Platform pending administration uses only the canonical WebAuthn owner path',()=>{assert.match(uiSource,/listSystemOwnerPendingDevices/);assert.match(uiSource,/approveSystemOwnerPendingDevice/);assert.match(uiSource,/rejectSystemOwnerPendingDevice/);assert.doesNotMatch(uiSource+serviceSource,/listMemberDevices|approveMemberDevice|rejectMemberPendingDevice|revokeMemberDevice|replaceMemberActiveDevice|organizationId/);assert.doesNotMatch(uiSource,/listPlatformPendingDevices/);});
test('Platform pending administration loads automatically and refreshes from the server after approval',async()=>{const h=harness();await h.api.initialize();assert.deepEqual(h.calls,['list']);assert.match(h.element.innerHTML,/aaaaaaaa/);await h.api.actPlatformPending('approve','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.doesNotMatch(h.element.innerHTML,/aaaaaaaa/);assert.equal(JSON.stringify(h.calls),JSON.stringify(['list',{approve:{targetUserId:'11111111-1111-4111-8111-111111111111',deviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}},'list']));});

test('Unknown pending-device action is rejected without dispatching approval',async()=>{const h=harness();const result=await h.api.actPlatformPending('revoke','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(result.ok,false);assert.equal(result.status,'invalid_input');assert.deepEqual(h.calls,[]);});

test('Successful approval awaits user overview refresh before completion',async()=>{const h=harness();let release,started=0,completed=false;const gate=new Promise(resolve=>{release=resolve;});h.sandbox.UserManagementUI={refreshUsers:()=>{started++;return gate;}};await h.api.initialize();await h.api.refreshPlatformPendingRequests();const action=h.api.actPlatformPending('approve','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').then(()=>{completed=true;});for(let i=0;i<10&&started===0;i++)await Promise.resolve();assert.equal(started,1);assert.equal(completed,false);release();await action;assert.equal(completed,true);});

test('pending request count updates after protected approval and rejection',async()=>{
  for(const action of ['approve','reject']){
    const h=harness();
    await h.api.initialize();
    assert.match(h.element.innerHTML,/طلبات اعتماد الأجهزة \(1\)/);
    await h.api.actPlatformPending(action,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.match(h.element.innerHTML,/طلبات اعتماد الأجهزة \(0\)/);
    assert.match(h.element.innerHTML,/لا توجد طلبات اعتماد معلقة/);
  }
});

test('read-only pending listing uses the canonical device session and never WebAuthn',async()=>{
  const calls=[];
  const client={rpc:()=>Promise.resolve({data:null,error:null})};
  const sandbox={window:null,Promise,Object,Array,String,JSON,Uint8Array,ArrayBuffer,console,atob,btoa,
    navigator:{credentials:{get:()=>{throw new Error('PASSKEY_PROMPTED');}}},crypto:{},
    SupabaseClientLayer:{getClient:()=>client},SupabaseAuth:{getSession:()=>({user:{id:'11111111-1111-4111-8111-111111111111'}})},
    SupabaseDeviceIdentity:{getOrCreate:()=>({id:'22222222-2222-4222-8222-222222222222'})},
    PlatformDeviceSession:{invokeModuleProtected:(module,operation,args)=>{calls.push({module,operation,args});return Promise.resolve({status:'success',devices:[]});}}};
  sandbox.window=sandbox;vm.runInNewContext(serviceSource,sandbox);
  const result=await sandbox.DeviceAuthorizationAdministrationService.listSystemOwnerPendingDevices();
  assert.equal(result.ok,true);assert.equal(result.status,'listed');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{module:'platform',operation:'list_system_owner_pending_device_authorizations',args:{}}]);
});

test('repeated navigation reads the list without invoking an administrative decision',async()=>{
  const h=harness();await h.api.initialize();await h.api.initialize();await h.api.initialize();
  assert.deepEqual(h.calls,['list','list','list']);
});

test('legacy WebAuthn listing actions are absent from the active Edge contract',()=>{
  const edge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-authorization/index.ts'),'utf8');
  assert.doesNotMatch(edge,/begin-pending-device-list|finish-pending-device-list|list-pending-devices|complete_system_owner_pending_device_listing/);
  assert.match(edge,/begin-pending-device-approval/);assert.match(edge,/begin-pending-device-rejection/);assert.match(edge,/begin-device-revocation/);
});

test('older pending-device list responses cannot overwrite newer results',async()=>{
  const h=harness();
  let releaseOld;
  let calls=0;
  h.sandbox.DeviceAuthorizationAdministrationService.listSystemOwnerPendingDevices=()=>{
    calls++;
    if(calls===1)return new Promise(resolve=>{releaseOld=resolve;});
    return Promise.resolve({ok:true,status:'listed',data:{devices:[]}});
  };
  const first=h.api.refreshPlatformPendingRequests();
  const second=h.api.refreshPlatformPendingRequests();
  await second;
  assert.match(h.element.innerHTML,/طلبات اعتماد الأجهزة \(0\)/);
  releaseOld({ok:true,status:'listed',data:{devices:[{targetUserId:'11111111-1111-4111-8111-111111111111',deviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'Stale'}]}});
  await first;
  assert.match(h.element.innerHTML,/طلبات اعتماد الأجهزة \(0\)/);
  assert.doesNotMatch(h.element.innerHTML,/Stale/);
});
