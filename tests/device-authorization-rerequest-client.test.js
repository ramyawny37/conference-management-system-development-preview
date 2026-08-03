'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const repository=fs.readFileSync(path.join(
  root,'js/sync/device-authorization-operation-repository.js'
),'utf8');
const service=fs.readFileSync(path.join(
  root,'js/supabase/current-device-authorization-service.js'
),'utf8');

const ids={
  user:'11111111-1111-4111-8111-111111111111',
  device:'22222222-2222-4222-8222-222222222222'
};
let sequence=0;
let status='revoked';
const calls=[];
const storage={};
const sandbox={
  window:null,Promise,JSON,Object,String,Array,Date,
  SUPABASE_RUNTIME_CONFIG:{url:'https://project-a.example'},
  localStorage:{
    getItem:key=>storage[key]||null,
    setItem:(key,value)=>{storage[key]=value;}
  },
  OrganizationAdministrationUtils:{isUuid:value=>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(String(value||''))},
  SupabaseAuth:{getSession:()=>({user:{id:ids.user}})},
  SupabaseDeviceIdentity:{getOrCreate:()=>({id:ids.device})},
  crypto:{randomUUID:()=>{
    sequence++;
    return '33333333-3333-4333-8333-'+String(sequence).padStart(12,'0');
  }},
  SupabaseClientLayer:{getClient:()=>({rpc:(name,args)=>{
    calls.push({name,args});
    if(name==='get_my_device_authorization'){
      return Promise.resolve({data:{deviceAuthorizationStatus:status}});
    }
    if(name==='request_current_device_authorization'){
      status='pending';
      return Promise.resolve({data:{status:'pending'}});
    }
    return Promise.resolve({data:{accountStatus:'approved'}});
  }})}
};
sandbox.window=sandbox;
vm.runInNewContext(repository,sandbox);
vm.runInNewContext(service,sandbox);

(async function(){
  const before=await sandbox.CurrentDeviceAuthorizationService.getStatus();
  assert.strictEqual(before.data.deviceAuthorizationStatus,'revoked');
  assert.strictEqual(
    sandbox.CurrentDeviceAuthorizationService.getState().canRequestApproval,
    true
  );
  const requested=await sandbox.CurrentDeviceAuthorizationService
    .requestAuthorization();
  assert.strictEqual(requested.ok,true);
  assert.strictEqual(requested.status,'pending');
  const requestCalls=calls.filter(call=>
    call.name==='request_current_device_authorization');
  assert.strictEqual(requestCalls.length,1);
  assert.strictEqual(requestCalls[0].args.p_device_id,ids.device);
  assert.ok(requestCalls[0].args.p_operation_id);
  assert.strictEqual(
    sandbox.CurrentDeviceAuthorizationService.getState()
      .currentDeviceAccessStatus,
    'pending'
  );
  const storedOperations=JSON.parse(
    storage.conference_manager_device_authorization_operations||'[]'
  );
  assert.strictEqual(storedOperations.length,0,
    'successful request must clear the local operation marker');
  console.log('device authorization re-request client tests: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
