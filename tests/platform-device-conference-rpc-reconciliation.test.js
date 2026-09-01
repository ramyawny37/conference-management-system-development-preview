'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260901051509_reconcile_platform_device_guard.sql'),'utf8');
const clientSource=fs.readFileSync(path.join(root,'js/supabase/client.js'),'utf8');

assert.match(migration,/public\.is_account_approved\(current_user_id\)/);
assert.match(migration,/platform_private\.current_device_authorization_id\(current_user_id\)/);
assert.match(migration,/platform_private\.request_device_id\(\) is distinct from p_actor_device_id/);
assert.match(migration,/authorization_status = 'approved'[\s\S]*revoked_at is null/);
assert.match(migration,/revoke all on function public\.require_current_approved_device\(uuid\)[\s\S]*from public, anon, authenticated/);
assert.doesNotMatch(migration,/insert into|update\s+platform\.|update\s+public\.user_device_authorizations|grant execute/i);

(async function(){
  const calls=[];
  const rawClient={rpc:function(name,args){calls.push({kind:'direct',name,args});return Promise.resolve({data:'direct',error:null});},auth:{}};
  const sandbox={window:null,console,JSON,Promise,Object,String,Array,Error};
  sandbox.window={location:{hostname:'integrated-platform-development-git-develop-ramyawny37-3662.vercel.app'},atob:()=>'',supabase:{createClient:()=>rawClient},SUPABASE_RUNTIME_CONFIG:{url:'https://gppwltrifgfxrkzvvxoe.supabase.co',publishableKey:'sb_publishable_test'},fetch:function(url,options){calls.push({kind:'gateway',url,body:JSON.parse(options.body)});return Promise.resolve({json:()=>Promise.resolve({data:{status:'success'},error:null})});}};
  vm.runInNewContext(clientSource,sandbox);
  const client=sandbox.window.SupabaseClientLayer.getClient();
  const guarded=await client.rpc('device_guarded_list_my_organizations',{p_actor_device_id:'f9306733-612d-433f-a38e-5d72855c2fe3'});
  assert.equal(guarded.data.status,'success');
  assert.equal(calls[0].kind,'gateway');
  assert.equal(calls[0].url,'/api/platform/conference-rpc');
  await client.rpc('get_first_system_bootstrap_status',{});
  assert.equal(calls[1].kind,'direct');
  console.log('Platform device Conference RPC reconciliation contracts: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
