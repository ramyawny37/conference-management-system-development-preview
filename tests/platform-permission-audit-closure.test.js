'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const migration=read('supabase/migrations/20261019113121_close_legacy_permission_path_and_audit_grants.sql');
const edge=read('supabase/functions/platform-device-operation/index.ts');
const service=read('js/sync/module-permission-administration-service.js');
const contract=read('js/supabase/conference-device-operation-contract.js');
const index=read('index.html');
const worker=read('service-worker.js');

test('the active client and Edge surface expose only the canonical permission writer',()=>{
  assert.match(service,/invoke\('manage_catalog_module_grant'/);
  assert.doesNotMatch(service,/invoke\('manage_foundation_module_grant'/);
  const allowlist=edge.match(/const platform=new Set\(\[([^\]]*)\]\)/)[1];
  assert.match(allowlist,/'manage_catalog_module_grant'/);
  assert.doesNotMatch(allowlist,/'manage_foundation_module_grant'/);
  assert.doesNotMatch(contract,/\['manage_foundation_module_grant'/);
  const asset='conference-device-operation-contract.js?rev=permission-audit-closure-v1';
  assert.match(index,new RegExp(asset.replace(/[.?]/g,'\\$&')));
  assert.match(worker,new RegExp(asset.replace(/[.?]/g,'\\$&')));
});

test('the dispatcher retirement is fail-fast and preserves independent recovery',()=>{
  assert.match(migration,/LEGACY_PERMISSION_DISPATCH_BRANCH_NOT_FOUND/);
  assert.match(migration,/LEGACY_PERMISSION_DISPATCH_BRANCH_REMAINS/);
  assert.match(migration,/FINAL_MANAGER_RECOVERY_BRANCH_MISSING/);
  assert.doesNotMatch(migration,/drop function public\.manage_foundation_module_grant/i);
  assert.doesNotMatch(migration,/drop function public\.recover_revoke_final_module_manager/i);
});

test('grant audit is atomic and emitted only for a newly inserted active grant',()=>{
  assert.match(migration,/if v_id is null then[\s\S]*insert into platform\.permission_grants[\s\S]*insert into platform\.audit_events[\s\S]*'permission\.granted'/i);
  assert.match(migration,/actor_user_id,actor_device_authorization_id,subject_user_id/);
  assert.match(migration,/p_operation_id,'rpc'/);
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('permission-grant:/);
});

test('revoke audit is atomic and emitted only on the active-to-revoked transition',()=>{
  assert.match(migration,/select \* into v_grant from platform\.permission_grants where id=p_grant for update/);
  assert.match(migration,/if v_grant\.revoked_at is null then[\s\S]*update platform\.permission_grants[\s\S]*insert into platform\.audit_events[\s\S]*'permission\.revoked'/i);
  assert.match(migration,/revoke_permission_grant\(a,p_actor_device_id,g,p_revocation_reason,p_operation_id\)/);
});

test('authorization remains device-bound and delegation cannot elevate the actor',()=>{
  assert.match(migration,/validated_phase1c_device_authorization\(p_actor,p_actor_device_id\)/);
  assert.match(migration,/PLATFORM_OWNER_REQUIRED/);
  assert.match(migration,/require_effective_module_permission\(p_actor_device_id,p_module_key,expected_code,null,null\)/);
  assert.match(migration,/ROLE_EXCEEDS_ACTOR_AUTHORITY/);
});

test('audit payload includes target, module, permission, scope, resource and operation identity',()=>{
  for(const field of ['targetUserId','moduleKey','permissionKey','grantScope','resourceType','resourceId'])assert.match(migration,new RegExp("'"+field+"'"));
  assert.match(migration,/operation_id,source/);
});
