"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),test=require("node:test"),vm=require("node:vm");
const migration=fs.readFileSync("supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql","utf8");
const canonicalDispatcher=fs.readFileSync("supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql","utf8");
const finalizationCorrection=fs.readFileSync("supabase/migrations/20260909220000_device_session_finalization_audit_retention.sql","utf8");
const edge=fs.readFileSync("supabase/functions/conference-device-operation/index.ts","utf8");
const session=fs.readFileSync("js/supabase/device-session.js","utf8");
const client=fs.readFileSync("js/supabase/client.js","utf8");
const contractSource=fs.readFileSync("js/supabase/conference-device-operation-contract.js","utf8");
const sandbox={window:{}};vm.runInNewContext(contractSource,sandbox);
const contract=sandbox.window.ConferenceDeviceOperationContract;
test("dispatcher is service-role-only, verifies all authority dimensions, and derives the actor device",()=>{
  assert.match(migration,/auth\.role\(\) is distinct from 'service_role'/);
  assert.match(migration,/grant execute on function platform\.execute_conference_device_operation[^;]+to service_role/);
  assert.doesNotMatch(migration,/grant execute on function platform\.execute_conference_device_operation[^;]+to (anon|authenticated)/);
  for(const value of ["session.token_hash=p_token_hash","profile.account_status='approved'","uda.status='approved'","device.lifecycle_status='active'","binding.lifecycle_status='active'","v_session.device_id","ACTOR_DEVICE_OVERRIDE_DENIED"])assert.ok(migration.includes(value),value);
});
test("multi-tab sessions coexist and historical audited sessions are retained",()=>{
  assert.match(migration,/drop index if exists platform_private\.device_sessions_one_active_binding_idx/);
  assert.doesNotMatch(migration,/update platform_private\.device_sessions set revoked_at/);
  assert.match(migration,/device_sessions_active_binding_lookup_idx/);
  assert.doesNotMatch(finalizationCorrection,/delete\s+from\s+platform_private\.device_sessions/i);
  assert.doesNotMatch(finalizationCorrection,/update\s+platform_private\.device_sessions\s+set\s+revoked_at/i);
  assert.match(finalizationCorrection,/insert into platform_private\.device_sessions/);
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
  assert.doesNotMatch(client,/delete protectedArgs\.p_device_id/);
  assert.doesNotMatch(client,/\/api\/platform\/conference-rpc/);
});
test("canonical dispatcher owns current routing while the historical Phase 1C migration remains historical",()=>{
  const round3g2=new Set(['search_module_permission_candidates','list_module_permission_catalog_for_administration','list_module_permission_resources_for_administration','manage_catalog_module_grant']);
  const canonical=new Set(['create_canonical_conference','mutate_conference_core','get_conference_core','list_conference_participations','create_conference_participation','set_conference_participation_status','set_conference_participation_guardian','delete_conference_participation','list_conference_houses','mutate_conference_house_directory','assign_conference_house','get_conference_accommodation','assign_conference_accommodation','move_conference_accommodation','remove_conference_accommodation']);
  const declared=[...contract.EDGE_ONLY_PROTECTED].filter(row=>!round3g2.has(row.operation)).map(row=>row.operation).sort();
  const edgeBlock=edge.match(/const allowed=new Set\(\[([\s\S]*?)\]\);/)[1];
  const edgeOperations=[...edgeBlock.matchAll(/'([a-z0-9_]+)'/g)].map(match=>match[1]).sort();
  const dispatcher=[...canonicalDispatcher.matchAll(/when '([a-z0-9_]+)'(?:,'([a-z0-9_]+)')?(?:,'([a-z0-9_]+)')? then/g)].flatMap(match=>match.slice(1).filter(Boolean)).sort();
  assert.deepEqual(edgeOperations.filter(operation=>!canonical.has(operation)),declared);
  assert.deepEqual(edgeOperations.filter(operation=>canonical.has(operation)),[...canonical].sort());
  const retired=new Set(['device_guarded_apply_conference_snapshot','device_guarded_download_conference_snapshot','device_guarded_get_conference_snapshot_metadata','device_guarded_get_sync_conflict','device_guarded_list_sync_conflicts','device_guarded_resolve_sync_conflict','device_guarded_get_my_conference_access','device_guarded_get_my_conference_membership','device_guarded_list_conference_members','device_guarded_lookup_conference_user_by_email','device_guarded_manage_conference_member','device_guarded_add_conference_manager','device_guarded_remove_conference_manager','device_guarded_list_available_conferences','device_guarded_create_organization_conference_idempotent','device_guarded_get_conference_creation_operation','device_guarded_list_eligible_legacy_conference_organizations','device_guarded_assign_legacy_conference_organization']);
  assert.equal([...canonicalDispatcher.matchAll(/execute_device_operation_pre_/g)].length,0);
  assert.ok(dispatcher.includes('get_user_management_actor_capabilities'));
  assert.ok(dispatcher.includes('apply_library_template_content_operation'));
  assert.doesNotMatch(canonicalDispatcher,/organization/i);
  for(const row of contract.EDGE_ONLY_PROTECTED.filter(row=>!round3g2.has(row.operation))){
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
    'platform.approve_device_authorization(uuid,text)','platform.approve_pending_device_authorization(uuid,uuid,text)','platform.block_device_authorization(uuid,text)','platform.get_my_device_authorization()','platform.grant_role_permission(text,text,text)','platform.grant_user_role(uuid,text,text,text,uuid)','platform.has_permission(text,text,uuid)','platform.list_pending_device_authorizations()','platform.register_current_device(text,text,text)','platform.revoke_device_authorization(uuid,text)','platform.revoke_role_permission(text,text,text)','platform.revoke_user_role(uuid)','platform.set_account_status(uuid,text,text)',
    'public.grant_system_role(uuid,text)','public.is_account_approved(uuid)','public.is_system_admin(uuid)','public.is_system_owner(uuid)','public.list_module_permission_grants(uuid,text,uuid)','public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)','public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)','public.revoke_system_role(uuid,text)'
  ];
  const classified=new Set([].concat(contract.DIRECT_BROWSER_REQUIRED,[...contract.EDGE_ONLY_PROTECTED].map(row=>row.signature),contract.INTERNAL_ONLY,contract.POLICY_HELPER_BROWSER_READ));
  assert.deepEqual(discovered.filter(signature=>!classified.has(signature)),[]);
  for(const signature of contract.INTERNAL_ONLY.filter(signature=>discovered.includes(signature))){
    assert.ok(migration.includes(signature),"missing internal-only revoke: "+signature);
  }
  assert.equal(contract.POLICY_HELPER_BROWSER_READ.length,4);
  assert.equal(contract.DIRECT_BROWSER_REQUIRED.length,7);
  assert.ok(contract.EDGE_ONLY_PROTECTED.some(row=>row.operation==='list_module_permission_resources_for_administration'));
  assert.ok(!edge.includes("'list_module_permission_resources_for_administration'"));
  assert.equal(contract.INTERNAL_ONLY.filter(signature=>discovered.includes(signature)).length,10);
  assert.equal(discovered.length,21);
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
