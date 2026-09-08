const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const migrationPath='supabase/migrations/20260908220000_platform_zero_approved_owner_device_recovery.sql';
const sql=fs.readFileSync(migrationPath,'utf8');

test('recovery is a dedicated service-only SECURITY DEFINER contract',()=>{
  assert.match(sql,/create or replace function platform\.recover_zero_approved_owner_device\(\s*p_target_user_id uuid,\s*p_target_device_id uuid,\s*p_target_authorization_id uuid,\s*p_target_binding_id uuid,\s*p_operation_id uuid,\s*p_reason text\s*\) returns jsonb\s*language plpgsql security definer set search_path=''/is);
  assert.match(sql,/auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql,/revoke all on function platform\.recover_zero_approved_owner_device\(uuid,uuid,uuid,uuid,uuid,text\)\s*from public,anon,authenticated,service_role/is);
  assert.match(sql,/grant execute on function platform\.recover_zero_approved_owner_device\(uuid,uuid,uuid,uuid,uuid,text\)\s*to service_role/is);
  assert.doesNotMatch(sql,/grant execute[\s\S]*to (anon|authenticated)/i);
});

test('canonical approved Platform Owner state is re-read and locked',()=>{
  assert.match(sql,/from platform\.profiles profile[\s\S]*profile\.account_status='approved'[\s\S]*for update/is);
  assert.match(sql,/from platform\.user_roles assignment[\s\S]*join platform\.roles role[\s\S]*assignment\.revoked_at is null[\s\S]*assignment\.expires_at[\s\S]*role\.code='platform_owner'/is);
  assert.match(sql,/from platform\.user_device_authorizations owned[\s\S]*owned\.user_id=p_target_user_id[\s\S]*for update/is);
});

test('zero-approved-active-device guard is owner serialized',()=>{
  assert.match(sql,/pg_advisory_xact_lock\([\s\S]*platform-zero-owner-recovery-user:/);
  assert.match(sql,/approved\.status='approved'[\s\S]*approved_device\.lifecycle_status='active'/);
  assert.match(sql,/if v_approved_active_count<>0 then[\s\S]*APPROVED_DEVICE_EXISTS/);
});

test('exact pending authorization, active device, and active binding are required',()=>{
  for(const fragment of [
    /target_authorization\.id=p_target_authorization_id/,
    /target_authorization\.user_id=p_target_user_id/,
    /target_authorization\.device_id=p_target_device_id/,
    /target_authorization\.status='pending'/,
    /device\.id=p_target_device_id/,
    /device\.lifecycle_status='active'/,
    /binding\.id=p_target_binding_id/,
    /binding\.user_id=target_authorization\.user_id/,
    /binding\.device_id=target_authorization\.device_id/,
    /binding\.device_authorization_id=target_authorization\.id/,
    /binding\.lifecycle_status='active'/,
    /for update of target_authorization,device,binding/
  ]) assert.match(sql,fragment);
});

test('mutation is one exact pending authorization and uses truthful system context',()=>{
  assert.match(sql,/update platform\.user_device_authorizations as target_row set[\s\S]*status='approved'[\s\S]*approved_by=null[\s\S]*where target_row\.id=p_target_authorization_id[\s\S]*target_row\.user_id=p_target_user_id[\s\S]*target_row\.device_id=p_target_device_id[\s\S]*target_row\.status='pending'/i);
  assert.match(sql,/get diagnostics v_changed=row_count/);
  assert.match(sql,/if v_changed<>1/);
  assert.doesNotMatch(sql,/auth\.uid\(\)/);
});

test('operation ledger provides immutable exact-context idempotency',()=>{
  assert.match(sql,/create table platform_private\.zero_approved_owner_device_recovery_operations/);
  assert.match(sql,/operation_id uuid primary key/);
  assert.match(sql,/before update or delete on platform_private\.zero_approved_owner_device_recovery_operations/);
  assert.match(sql,/platform-zero-owner-recovery-operation:/);
  for(const field of ['target_user_id','target_device_id','target_authorization_id','target_binding_id','action','reason'])
    assert.match(sql,new RegExp('v_prior\\.'+field+' is distinct from'));
  assert.match(sql,/return v_prior\.result/);
});

test('audit is immutable, distinct, complete, and emitted once before ledger completion',()=>{
  assert.match(sql,/platform_private\.write_audit_event/);
  assert.match(sql,/device_authorization\.zero_approved_owner_recovery/);
  for(const key of ['recoveryMode','backendContext','deviceId','authorizationId','bindingId','operationId','reason','approvedActiveDeviceCountBefore'])
    assert.match(sql,new RegExp("'"+key+"'"));
  assert.match(sql,/jsonb_build_object\('status','pending'\)/);
  assert.match(sql,/jsonb_build_object\('status','approved','approvedBy',null\)/);
  assert.ok(sql.indexOf('return v_prior.result')<sql.indexOf('platform_private.write_audit_event'));
});

test('recovery does not touch sessions, WebAuthn, legacy authority, or normal functions',()=>{
  assert.doesNotMatch(sql,/\b(insert|update|delete)\s+(into\s+|from\s+)?platform_private\.device_sessions/i);
  assert.doesNotMatch(sql,/webauthn|credential/i);
  assert.doesNotMatch(sql,/public\.user_device_authorizations/i);
  assert.doesNotMatch(sql,/create or replace function platform\.approve_pending_device_authorization/i);
  assert.doesNotMatch(sql,/create or replace function platform\.verify_device_session/i);
  assert.doesNotMatch(sql,/create or replace function platform_private\.change_session_device_authorization/i);
});

test('Production incident identifiers are not hardcoded',()=>{
  for(const id of [
    '11ebe6fe-67a3-488c-8128-d15ad2b79140','72012d1e-04ae-4a5a-a0a6-0f8beb6604b6',
    '64cf766b-2642-414f-ad38-6e0cf01cb958','ddc33db37e1481014b3970e63b282da74743e25d0197b6b4a6e043d03b7ea016',
    'mpezfbvcdfxpgflehuot'
  ]) assert.doesNotMatch(sql,new RegExp(id));
});
