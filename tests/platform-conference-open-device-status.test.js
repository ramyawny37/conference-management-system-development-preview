'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../js/supabase/current-device-authorization-service.js'),'utf8');
let directRpcCalls=0;
const deviceId='f9306733-612d-433f-a38e-5d72855c2fe3';
const sandbox={window:null,console,Date,JSON,Promise,String,Array,Object};
sandbox.window={
  PlatformIntegration:{
    awaitAuthorizationReady:()=>Promise.resolve({ready:true,platform:true}),
    isManagedOrigin:()=>true,
    getContext:()=>({deviceId:deviceId,deviceStatus:'approved'}),
    getDeviceIdentity:()=>({id:deviceId}),
    getSafeDiagnostic:()=>({}),
    recordDeviceResolution:()=>{}
  },
  OrganizationAdministrationUtils:{isUuid:()=>true},
  SupabaseClientLayer:{getClient:()=>({rpc:()=>{directRpcCalls++;return Promise.resolve({data:{deviceAuthorizationStatus:'not_registered'},error:null});}})},
  SupabaseAuth:{getSession:()=>({user:{id:'11111111-1111-4111-8111-111111111111'}})},
  SupabaseDeviceIdentity:{getOrCreate:()=>({id:deviceId})},
  crypto:{randomUUID:()=>deviceId},
  setTimeout,
  clearTimeout
};

vm.runInNewContext(source,sandbox);
sandbox.window.CurrentDeviceAuthorizationService.getStatus().then(function(response){
  assert.equal(response.ok,true);
  assert.equal(response.data.deviceAuthorizationStatus,'approved');
  assert.equal(directRpcCalls,0);
  console.log('Platform Conference-open device status contract: passed');
}).catch(function(error){console.error(error);process.exitCode=1;});
