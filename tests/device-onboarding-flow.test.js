'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');

async function currentDeviceProvisioning(){
  const source=fs.readFileSync('js/sync/current-device-authorization-ui.js','utf8');
  let status='not_registered',registers=0,requests=0;
  const root={style:{},innerHTML:''};
  const window={document:{getElementById:()=>root},confirm:()=>true,
    SupabaseAuth:{initialize:()=>Promise.resolve(),getSession:()=>({user:{id:'u'}})},
    SupabaseClientLayer:{getClient:()=>null},
    SupabaseDeviceIdentity:{getOrCreate:()=>({id:'11111111-1111-4111-8111-111111111111',deviceName:'iPhone',platform:'iOS'})},
    CurrentDeviceAuthorizationService:{
      getStatus:()=>Promise.resolve({ok:true,data:{deviceAuthorizationStatus:status}}),
      getDeviceAwareAccess:()=>Promise.resolve({ok:true,data:{accountStatus:'approved',enforcementEnabled:true}}),
      registerCurrentDevice:()=>{registers++;if(status==='not_registered')status='registered';return Promise.resolve({ok:true,status:'registered'});},
      requestAuthorization:()=>{requests++;status='pending';return Promise.resolve({ok:true,status:'pending'});}
    }};
  vm.runInNewContext(source,{window,Promise,JSON,Object,String,Array,Date,console});
  await window.CurrentDeviceAuthorizationUI.initialize();
  await window.CurrentDeviceAuthorizationUI.ensurePendingAuthorization();
  await window.CurrentDeviceAuthorizationUI.ensurePendingAuthorization();
  assert.equal(status,'pending');assert.equal(registers,2,'register/refresh remains idempotent');assert.equal(requests,1,'pending request must not duplicate');
  status='revoked';await window.CurrentDeviceAuthorizationUI.refresh();await window.CurrentDeviceAuthorizationUI.ensurePendingAuthorization();assert.equal(requests,2,'revoked device uses the existing re-request path');
}

async function startupPolling(){
  const source=fs.readFileSync('js/sync/startup-access-gate.js','utf8'),ids=['startupAccessGate','applicationTopbar','applicationBody','startupScreen','globalConferenceHeader','device_authorization_administration_root','current_device_authorization_root','tab0','tab1','tab2','tab3','tab4','tab5','tab6'],nodes={};ids.forEach(id=>nodes[id]={style:{},innerHTML:''});
  let status='not_registered',ensures=0,home=0,poll=null;
  const window={document:{getElementById:id=>nodes[id]},setTimeout:fn=>{poll=fn;return 1;},clearTimeout:()=>{poll=null;},
    SupabaseAuth:{initialize:()=>Promise.resolve(),getState:()=>({authenticated:true})},SupabaseClientLayer:{getClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{}}})}})},FirstSystemBootstrapService:{getStatus:()=>Promise.resolve({ok:true,status:'completed'})},SystemAccessService:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({accountStatus:'approved',fresh:true})},SupabaseDeviceIdentity:{getOrCreate:()=>({id:'22222222-2222-4222-8222-222222222222',deviceName:'iPhone',platform:'iOS'})},CurrentDeviceAuthorizationUI:{initialize:()=>Promise.resolve(),refresh:()=>Promise.resolve(),getState:()=>({status}),ensurePendingAuthorization:()=>{ensures++;status='pending';return Promise.resolve({ok:true,status:'pending'});}},SyncSettingsUI:{}};
  vm.runInNewContext(source,{window,Promise});
  let result=await window.StartupAccessGate.run({completeApplicationStartup:()=>{home++;}});assert.equal(result.status,'device');assert.equal(ensures,1);assert.equal(home,0);assert(nodes.startupAccessGate.innerHTML.includes('iPhone'));assert(nodes.startupAccessGate.innerHTML.includes('22222222…'));assert(poll);
  status='approved';const callback=poll;callback();await new Promise(resolve=>setImmediate(resolve));assert.equal(home,1,'approval must continue startup without logout or reload');assert.equal(window.StartupAccessGate.isAllowed(),true);
}

async function pendingAdministration(){
  const source=fs.readFileSync('js/sync/device-authorization-administration-ui.js','utf8'),root={style:{},innerHTML:''};let mutation=null;
  const organizations=[{organizationId:'31111111-1111-4111-8111-111111111111',displayName:'Allowed Org'},{organizationId:'32222222-2222-4222-8222-222222222222',displayName:'Denied Org'}];
  const window={document:{getElementById:()=>root},confirm:()=>true,SupabaseAuth:{initialize:()=>Promise.resolve(),getSession:()=>({user:{id:'actor'}})},SupabaseClientLayer:{getClient:()=>null},OrganizationAdministrationService:{listMyOrganizations:()=>Promise.resolve({ok:true,data:{organizations}}),getCurrentAccess:({organizationId})=>Promise.resolve(organizationId===organizations[0].organizationId?{ok:true,data:{role:'organization_owner'}}:{ok:true,data:{role:'member'}}),listMembers:()=>Promise.resolve({ok:true,data:{members:[{userId:'41111111-1111-4111-8111-111111111111',displayName:'Test User'}]}})},UserManagementReadService:{listUsers:()=>Promise.resolve({ok:true,data:{users:[{userId:'41111111-1111-4111-8111-111111111111',email:'test@example.com'}]}})},DeviceAuthorizationAdministrationService:{listMemberDevices:()=>Promise.resolve({ok:true,data:{devices:[{deviceId:'51111111-1111-4111-8111-111111111111',deviceName:'iPhone',platform:'iOS',authorizationStatus:'pending',requestedAt:'2026-08-08T10:00:00Z'}]}}),approveMemberDevice:input=>{mutation={action:'approve',input};return Promise.resolve({ok:true,status:'applied'});},rejectMemberPendingDevice:input=>{mutation={action:'reject',input};return Promise.resolve({ok:true,status:'applied'});}},CurrentDeviceAuthorizationUI:{refresh:()=>Promise.resolve()}};
  vm.runInNewContext(source,{window,Promise,JSON,Object,String,Array,Date,console});
  await window.DeviceAuthorizationAdministrationUI.initialize();assert(root.innerHTML.includes('طلبات اعتماد الأجهزة'));assert(root.innerHTML.includes('Allowed Org'));assert(!root.innerHTML.includes('Denied Org'));assert(root.innerHTML.includes('test@example.com'));assert(root.innerHTML.includes('iPhone'));
  await window.DeviceAuthorizationAdministrationUI.actPending('approve',organizations[0].organizationId,'41111111-1111-4111-8111-111111111111','51111111-1111-4111-8111-111111111111');assert.equal(mutation.action,'approve');assert.equal(mutation.input.deviceId,'51111111-1111-4111-8111-111111111111');
  await window.DeviceAuthorizationAdministrationUI.actPending('reject',organizations[0].organizationId,'41111111-1111-4111-8111-111111111111','51111111-1111-4111-8111-111111111111');assert.equal(mutation.action,'reject');
}

(async()=>{await currentDeviceProvisioning();await startupPolling();await pendingAdministration();console.log('device onboarding flow: PASS');})().catch(error=>{console.error(error);process.exit(1);});
