'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../js/supabase/current-device-authorization-service.js'),'utf8');
let directRpcCalls=0;
let sessionChecks=0;
const deviceId='f9306733-612d-433f-a38e-5d72855c2fe3';
const userId='11111111-1111-4111-8111-111111111111';
const sandbox={window:null,console,Date,JSON,Promise,String,Array,Object};
sandbox.window={
  PlatformIntegration:{
    awaitAuthorizationReady:()=>Promise.resolve({ready:true,platform:false}),
    isManagedOrigin:()=>false,
    getSafeDiagnostic:()=>({}),
    recordDeviceResolution:()=>{}
  },
  PlatformDeviceSession:{
    ensureValid:()=>{sessionChecks++;return Promise.resolve({ok:true});},
    getSession:()=>({userId,deviceId,authorizationId:'22222222-2222-4222-8222-222222222222'})
  },
  OrganizationAdministrationUtils:{isUuid:()=>true},
  SupabaseClientLayer:{getClient:()=>({rpc:()=>{directRpcCalls++;return Promise.resolve({data:{deviceAuthorizationStatus:'pending'},error:null});}})},
  SupabaseAuth:{getSession:()=>({user:{id:userId}})},
  SupabaseDeviceIdentity:{getOrCreate:()=>({id:deviceId})},
  crypto:{randomUUID:()=>deviceId},
  setTimeout,
  clearTimeout
};

vm.runInNewContext(source,sandbox);
sandbox.window.CurrentDeviceAuthorizationService.getStatus().then(function(response){
  assert.equal(response.ok,true);
  assert.equal(response.data.deviceAuthorizationStatus,'approved');
  assert.equal(sessionChecks,1);
  assert.equal(directRpcCalls,0);
  console.log('Platform Conference-open device status contract: passed');
}).catch(function(error){console.error(error);process.exitCode=1;});
