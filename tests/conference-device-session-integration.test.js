"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),test=require("node:test"),vm=require("node:vm");
const migration=fs.readFileSync("supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql","utf8");
const edge=fs.readFileSync("supabase/functions/conference-device-operation/index.ts","utf8");
const session=fs.readFileSync("js/supabase/device-session.js","utf8");
const client=fs.readFileSync("js/supabase/client.js","utf8");
const contractSource=fs.readFileSync("js/supabase/conference-device-operation-contract.js","utf8");
const sandbox={window:{}};vm.runInNewContext(contractSource,sandbox);
const contract=sandbox.window.ConferenceDeviceOperationContract;
const unifiedEdge=fs.readFileSync("supabase/functions/platform-device-operation/index.ts","utf8");
const deviceAdministration=fs.readFileSync("js/supabase/device-authorization-administration-service.js","utf8");
test("dispatcher is service-role-only, verifies all authority dimensions, and derives the actor device",()=>{
  assert.match(migration,/auth\.role\(\) is distinct from 'service_role'/);
  assert.match(migration,/grant execute on function platform\.execute_conference_device_operation[^;]+to service_role/);
  assert.doesNotMatch(migration,/grant execute on function platform\.execute_conference_device_operation[^;]+to (anon|authenticated)/);
  for(const value of ["session.token_hash=p_token_hash","profile.account_status='approved'","uda.status='approved'","device.lifecycle_status='active'","binding.lifecycle_status='active'","v_session.device_id","ACTOR_DEVICE_OVERRIDE_DENIED"])assert.ok(migration.includes(value),value);
});
test("multi-tab sessions coexist and expired rows are bounded",()=>{
  assert.match(migration,/drop index if exists platform_private\.device_sessions_one_active_binding_idx/);
  assert.doesNotMatch(migration,/update platform_private\.device_sessions set revoked_at/);
  assert.match(migration,/delete from platform_private\.device_sessions where expires_at<v_now-interval '7 days'/);
  assert.match(migration,/device_sessions_active_binding_lookup_idx/);
});
test("Edge validates auth, hashes bearer, rejects actor override and never logs secrets",()=>{
  for(const value of ["auth.getUser()","SHA-256","execute_conference_device_operation","p_actor_device_id","p_device_id","PAYLOAD_TOO_LARGE","CONFERENCE_OPERATION_NOT_ALLOWED"])assert.ok(edge.includes(value),value);
  assert.doesNotMatch(edge,/console\.error\([^\n]*(token|authorization|service_role)/i);
});
test("normal runtime keeps the token in tab memory and routes protected RPCs through Edge",()=>{
  assert.match(session,/var memorySession=null/);
  assert.match(session,/platform-device-operation/);
  assert.doesNotMatch(session,/localStorage|sessionStorage|document\.cookie|BroadcastChannel/);
  assert.match(client,/delete protectedArgs\.p_actor_device_id/);
  assert.match(client,/delete protectedArgs\.p_device_id/);
  assert.doesNotMatch(client,/\/api\/platform\/conference-rpc/);
});
test("exact Phase 1C contract is identical in frontend, Edge, dispatcher, and revokes",()=>{
  const declared=[...contract.EDGE_ONLY_PROTECTED].map(row=>row.operation).sort();
  const edgeBlock=edge.match(/const allowed=new Set\(\[([\s\S]*?)\]\);/)[1];
  const edgeOperations=[...edgeBlock.matchAll(/'([a-z0-9_]+)'/g)].map(match=>match[1]).sort();
  const dispatcher=[...migration.matchAll(/when '([a-z0-9_]+)'(?:,'([a-z0-9_]+)')?(?:,'([a-z0-9_]+)')? then/g)].flatMap(match=>match.slice(1).filter(Boolean)).sort();
  assert.deepEqual(edgeOperations,declared);
  assert.deepEqual(dispatcher,declared);
  for(const row of contract.EDGE_ONLY_PROTECTED){
    assert.ok(migration.includes("'"+row.signature+"'"),"missing exact revoke: "+row.signature);
  }
  for(const signature of contract.DIRECT_BROWSER_REQUIRED){
    assert.match(migration,new RegExp('grant execute on function[\\s\\S]{0,800}'+signature.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace('\\(','\\s*\\(')));
  }
  assert.match(client,/ConferenceDeviceOperationContract/);
  assert.doesNotMatch(client,/protectedRpc|device_guarded_\|/);
});
test("live-discovered browser SECURITY DEFINER surface has no unclassified signature",()=>{
  const discovered=[
    'platform.approve_device_authorization(uuid,text)','platform.approve_pending_device_authorization(uuid,uuid,text)','platform.block_device_authorization(uuid,text)','platform.get_my_access_context(text,text,uuid)','platform.get_my_device_authorization()','platform.grant_role_permission(text,text,text)','platform.grant_user_role(uuid,text,text,text,uuid)','platform.has_permission(text,text,uuid)','platform.list_pending_device_authorizations()','platform.register_current_device(text,text,text)','platform.revoke_device_authorization(uuid,text)','platform.revoke_role_permission(text,text,text)','platform.revoke_user_role(uuid)','platform.set_account_status(uuid,text,text)',
    'public.can_user_create_conferences(uuid)','public.grant_system_role(uuid,text)','public.has_conference_role(uuid,text[])','public.is_account_approved(uuid)','public.is_conference_member(uuid)','public.is_conference_owner(uuid)','public.is_current_user_organization_member(uuid)','public.is_system_admin(uuid)','public.is_system_owner(uuid)','public.list_module_permission_grants(uuid,text,uuid)','public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)','public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)','public.revoke_system_role(uuid,text)'
  ];
  const classified=new Set([].concat(contract.DIRECT_BROWSER_REQUIRED,[...contract.EDGE_ONLY_PROTECTED].map(row=>row.signature),contract.INTERNAL_ONLY,contract.POLICY_HELPER_BROWSER_READ));
  assert.deepEqual(discovered.filter(signature=>!classified.has(signature)),[]);
  for(const signature of contract.INTERNAL_ONLY.filter(signature=>discovered.includes(signature))){
    assert.ok(migration.includes(signature),"missing internal-only revoke: "+signature);
  }
  assert.equal(contract.POLICY_HELPER_BROWSER_READ.length,9);
  assert.equal(contract.DIRECT_BROWSER_REQUIRED.length,11);
  assert.equal(contract.EDGE_ONLY_PROTECTED.length,57);
  assert.equal(contract.INTERNAL_ONLY.filter(signature=>discovered.includes(signature)).length,10);
  assert.equal(discovered.length,89-13-52+3);
});
test("five former gateway operations have one Phase 1B/1C route and no gateway fallback",()=>{
  const operations=['list_pending_device_authorizations','approve_pending_device_authorization','list_module_permission_grants','manage_foundation_module_grant','recover_revoke_final_module_manager'];
  for(const operation of operations){
    assert.ok(contract.isProtectedOperation(operation),operation);
    assert.ok(unifiedEdge.includes("'"+operation+"'"),operation);
  }
  assert.match(deviceAdministration,/\.rpc\('list_pending_device_authorizations'/);
  assert.match(deviceAdministration,/\.rpc\('approve_pending_device_authorization'/);
  assert.doesNotMatch(deviceAdministration,/\/api\/platform\/device-authorizations|conference-rpc/);
  assert.equal(fs.existsSync('server/platform-gateway.cjs'),false);
  assert.equal(fs.existsSync('api/gateway.js'),false);
  assert.match(unifiedEdge,/execute_device_operation/);
});
test("literal browser RPC inventory is classified direct-safe or protected",()=>{
  const files=fs.readdirSync('js/supabase').map(name=>'js/supabase/'+name).concat(fs.readdirSync('js/sync').map(name=>'js/sync/'+name)).filter(name=>name.endsWith('.js'));
  const directNames=new Set(contract.DIRECT_BROWSER_REQUIRED.map(signature=>signature.replace(/^[^.]+\./,'').replace(/\(.*/,'')));
  const policyNames=new Set(contract.POLICY_HELPER_BROWSER_READ.map(signature=>signature.replace(/^[^.]+\./,'').replace(/\(.*/,'')));
  const protectedNames=new Set(contract.EDGE_ONLY_PROTECTED.map(row=>row.operation));
  const unclassified=[];
  for(const file of files){for(const match of fs.readFileSync(file,'utf8').matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g)){if(!directNames.has(match[1])&&!policyNames.has(match[1])&&!protectedNames.has(match[1]))unclassified.push(file+':'+match[1]);}}
  assert.deepEqual(unclassified,[]);
});
