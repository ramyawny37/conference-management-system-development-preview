'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260901051509_reconcile_platform_device_guard.sql'),'utf8');
const clientSource=fs.readFileSync(path.join(root,'js/supabase/client.js'),'utf8');
const deviceOperationContractSource=fs.readFileSync(path.join(root,'js/supabase/conference-device-operation-contract.js'),'utf8');
const platformFoundation=fs.readFileSync(path.join(root,'supabase/migrations/20260831023000_platform_foundation_reconciliation.sql'),'utf8');

assert.match(migration,/public\.is_account_approved\(current_user_id\)/);
assert.match(migration,/platform_private\.current_device_authorization_id\(current_user_id\)/);
assert.match(migration,/platform_private\.request_device_id\(\) is distinct from p_actor_device_id/);
assert.match(migration,/authorization_status = 'approved'[\s\S]*revoked_at is null/);
assert.match(migration,/revoke all on function public\.require_current_approved_device\(uuid\)[\s\S]*from public, anon, authenticated/);
assert.doesNotMatch(migration,/insert into|update\s+platform\.|update\s+public\.user_device_authorizations|grant execute/i);
assert.match(platformFoundation,/current_device_authorization_id[\s\S]*device_authorization\.status='approved'[\s\S]*device\.lifecycle_status='active'[\s\S]*device\.secret_hash=platform_private\.hash_device_secret/);
function platformGuard(input){return input.authorizationStatus==='approved'&&input.lifecycle==='active'&&input.secretValid&&input.requestDeviceId===input.actorDeviceId;}
const approved={authorizationStatus:'approved',lifecycle:'active',secretValid:true,requestDeviceId:'f930',actorDeviceId:'f930'};
assert.equal(platformGuard(approved),true);
assert.equal(platformGuard(Object.assign({},approved,{authorizationStatus:'pending'})),false);
assert.equal(platformGuard(Object.assign({},approved,{authorizationStatus:'revoked'})),false);
assert.equal(platformGuard(Object.assign({},approved,{secretValid:false})),false);
assert.equal(platformGuard(Object.assign({},approved,{requestDeviceId:null})),false);

(async function(){
  const calls=[];
  const rawClient={rpc:function(name,args){calls.push({kind:'direct',name,args});return Promise.resolve({data:'direct',error:null});},auth:{}};
  const sandbox={window:null,console,JSON,Promise,Object,String,Array,Error};
  sandbox.window={location:{hostname:'ramyawny37.github.io'},atob:()=>'',supabase:{createClient:()=>rawClient},SUPABASE_RUNTIME_CONFIG:{url:'https://gppwltrifgfxrkzvvxoe.supabase.co',publishableKey:'sb_publishable_test'},PlatformDeviceSession:{invokeProtected:function(name,args){calls.push({kind:'device-session',name,args});return Promise.resolve({status:'success'});}}};
  vm.runInNewContext(deviceOperationContractSource,sandbox);
  vm.runInNewContext(clientSource,sandbox);
  const client=sandbox.window.SupabaseClientLayer.getClient();
  const guarded=await client.rpc('device_guarded_list_my_organizations',{p_actor_device_id:'f9306733-612d-433f-a38e-5d72855c2fe3'});
  assert.equal(guarded.data.status,'success');
  assert.equal(calls[0].kind,'device-session');
  assert.equal(calls[0].name,'device_guarded_list_my_organizations');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].args,'p_actor_device_id'),false);
  await client.rpc('approve_pending_device_authorization',{p_actor_device_id:'ignored',p_authorization_id:'authorization',p_device_id:'target-device',p_reason:'reason'});
  assert.equal(calls[1].kind,'device-session');
  assert.equal(calls[1].name,'approve_pending_device_authorization');
  assert.equal(calls[1].args.p_device_id,'target-device');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1].args,'p_actor_device_id'),false);
  await client.rpc('get_first_system_bootstrap_status',{});
  assert.equal(calls[2].kind,'direct');
  console.log('Platform device Conference RPC reconciliation contracts: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
