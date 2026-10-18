'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const uiSource=fs.readFileSync('js/sync/user-management-ui.js','utf8');
const serviceSource=fs.readFileSync('js/supabase/device-authorization-administration-service.js','utf8');
const userId='11111111-1111-4111-8111-111111111111';
const deviceId='22222222-2222-4222-8222-222222222222';

function uiHarness(result){
  let revoked=false,revocations=0,overviewReads=0;
  const view=()=>({selectedUser:{userId,displayName:'Target',email:'target@example.test'},
    account:{status:'loaded',data:{accountStatus:'approved'}},capabilities:{canViewAccount:true,canViewDevices:true},
    devices:{status:revoked?'empty':'loaded',data:{items:revoked?[]:[{deviceId,deviceName:'Laptop',platform:'Browser',authorizationStatus:'approved',capabilities:{canRevoke:true}}]}}});
  const read={listUsers:()=>Promise.resolve({ok:true,data:{users:[{userId,displayName:'Target',email:'target@example.test',accountStatus:'approved',deviceCount:revoked?0:1}],audit:null,security:null,capabilities:{canViewDevices:true}}}),getOverview:()=>{overviewReads++;return Promise.resolve({ok:true,data:{overview:view()}});}};
  const administration={revokeSystemOwnerDevice:()=>{revocations++;if(result.ok)revoked=true;return Promise.resolve(result);}};
  const sandbox={window:null,Promise,Object,Array,String,JSON,console,confirm:()=>true,document:{getElementById:()=>null},UserManagementReadService:read,DeviceAuthorizationAdministrationService:administration};sandbox.window=sandbox;
  vm.runInNewContext(uiSource,sandbox);
  return {api:sandbox.UserManagementUI,revocations:()=>revocations,overviewReads:()=>overviewReads};
}

test('approved device revocation is confirmed, single-flight, and refreshes user details after success',async()=>{
  const h=uiHarness({ok:true,status:'applied'});
  await h.api.initialize();
  assert.match(h.api.renderSection(),/إلغاء اعتماد الجهاز/);
  const first=h.api.revokeDevice(userId,deviceId);
  const duplicate=await h.api.revokeDevice(userId,deviceId);
  assert.equal(duplicate.status,'busy');
  const result=await first;
  assert.equal(result.ok,true);
  assert.equal(h.revocations(),1);
  assert.equal(h.overviewReads(),2);
  assert.doesNotMatch(h.api.renderSection(),/Laptop/);
});

test('failed or unknown revocation never removes the device or reports success',async()=>{
  for(const status of ['error','unknown']){
    const h=uiHarness({ok:false,status,error:{code:'DENIED'}});
    await h.api.initialize();
    const result=await h.api.revokeDevice(userId,deviceId);
    assert.equal(result.ok,false);
    assert.match(h.api.renderSection(),/Laptop/);
    assert.doesNotMatch(h.api.renderSection(),/تم إلغاء اعتماد الجهاز/);
  }
});

test('canonical client performs revocation through one WebAuthn Edge flow and recovers idempotently',async()=>{
  const calls=[];
  const credential={id:'credential',rawId:new Uint8Array([1]).buffer,type:'public-key',response:{clientDataJSON:new Uint8Array([2]).buffer,authenticatorData:new Uint8Array([3]).buffer,signature:new Uint8Array([4]).buffer,userHandle:null}};
  const client={rpc:()=>Promise.resolve({data:null,error:null}),functions:{invoke:(name,payload)=>{calls.push(payload.body);const action=payload.body.action;if(action==='get-administration-state')return Promise.resolve({data:{ok:true,status:'ready',data:{credentialId:'33333333-3333-4333-8333-333333333333'}},error:null});if(action==='begin-device-revocation')return Promise.resolve({data:{ok:true,status:'challenge_created',data:{options:{challenge:'AQ',allowCredentials:[]},sessionId:'44444444-4444-4444-8444-444444444444',challengeId:'55555555-5555-4555-8555-555555555555',credentialId:'33333333-3333-4333-8333-333333333333'}},error:null});if(action==='finish-device-revocation')return Promise.resolve({data:{ok:true,status:'applied',data:{status:'applied'}},error:null});throw new Error(action);}}};
  const sandbox={window:null,Promise,Object,Array,String,JSON,Uint8Array,ArrayBuffer,console,atob,btoa,crypto:{randomUUID:()=> '66666666-6666-4666-8666-666666666666'},navigator:{credentials:{get:()=>Promise.resolve(credential)}},SupabaseClientLayer:{getClient:()=>client},SupabaseAuth:{getSession:()=>({user:{id:'77777777-7777-4777-8777-777777777777'}})},SupabaseDeviceIdentity:{getOrCreate:()=>({id:'88888888-8888-4888-8888-888888888888'})}};sandbox.window=sandbox;
  vm.runInNewContext(serviceSource,sandbox);
  const result=await sandbox.DeviceAuthorizationAdministrationService.revokeSystemOwnerDevice({targetUserId:userId,deviceId});
  assert.equal(result.ok,true);
  assert.deepEqual(calls.map(call=>call.action),['get-administration-state','begin-device-revocation','finish-device-revocation']);
  assert.equal(calls[2].targetUserId,userId);
  assert.equal(calls[2].targetDeviceId,deviceId);
});

test('current device is labeled and cannot expose a self-revocation action',async()=>{const h=uiHarness({ok:true,status:'applied'});const original=uiSource;assert.match(original,/SupabaseDeviceIdentity\.getCurrent/);assert.match(original,/isCurrent\?' — هذا الجهاز'/);assert.match(original,/canRevoke=!isCurrent&&item\.authorizationStatus/);assert.match(original,/معرّف الجهاز/);});
