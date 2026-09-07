'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const file='supabase/migrations/20260907162000_production_phase1c_session_only_reconciliation.sql';
const sql=fs.readFileSync(file,'utf8');
const executable=sql.replace(/--[^\n]*/g,'');

test('1 migration is transaction bounded',()=>{
  assert.match(sql,/^--[\s\S]*\nbegin;/);
  assert.match(sql,/commit;\s*$/);
});
test('2 exact core signature is reconciled with catalog preconditions',()=>{
  assert.match(sql,/to_regprocedure\('platform\.execute_conference_device_operation\(uuid,uuid,bytea,text,jsonb\)'\)/);
  assert.match(sql,/to_regprocedure\('platform\.execute_conference_device_operation_phase1c_core\(uuid,uuid,bytea,text,jsonb\)'\)/);
  assert.match(sql,/rename to execute_conference_device_operation_phase1c_core/);
  assert.match(sql,/PHASE1C_CORE_CONTRACT_INVALID/);
});
test('3 no legacy or header credential fallback exists',()=>{
  assert.doesNotMatch(sql,/public\.user_device_authorizations|current_device_authorization_id|request_device_id|request_header|x-platform-device|device.secret_hash|device-secret/i);
  assert.doesNotMatch(sql,/\bcoalesce\s*\(\s*platform_private\.validated_phase1c/i);
});
test('4 no excluded transition surface is referenced',()=>{
  assert.doesNotMatch(sql,/ownership_handoff|binding_recovery|handoff_challenge|regexp_replace/i);
});
test('5 validated helper rechecks the full cryptographic session chain',()=>{
  for(const fragment of ['session.token_hash=token_hash',"session.purpose='PLATFORM_DEVICE_SESSION'",'session.revoked_at is null',
    'session.expires_at>pg_catalog.statement_timestamp()',"binding.algorithm='ECDSA_P256_SHA256'","binding.lifecycle_status='active'",
    'binding.revoked_at is null','binding.retired_at is null',"device_authorization.status='approved'",'device_authorization.revoked_at is null',
    "device.lifecycle_status='active'",'device.retired_at is null','device.compromised_at is null',"profile.account_status='approved'"])
    assert.ok(sql.includes(fragment),fragment);
});
test('6 approved-device and permission guards are Phase 1C context only',()=>{
  assert.match(sql,/authorization_id:=platform_private\.validated_phase1c_device_authorization\(actor_user_id,p_actor_device_id\)/);
  assert.match(sql,/platform_private\.validated_phase1c_device_authorization\(\s*p_user_id,platform_private\.phase1c_context_device_id\(\)/);
});
test('7 dispatcher is backend-only and installs transaction-local verified context',()=>{
  assert.match(sql,/auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql,/set_config\('platform\.phase1c_context'[\s\S]*,true\)/);
  assert.match(sql,/return platform\.execute_conference_device_operation_phase1c_core/);
});
test('8 helpers and core are inaccessible while only dispatcher is granted',()=>{
  assert.match(sql,/revoke all on function platform\.execute_conference_device_operation_phase1c_core[\s\S]*from public,anon,authenticated,service_role;/);
  assert.match(sql,/revoke all on function platform_private\.validated_phase1c_device_authorization[\s\S]*from public,anon,authenticated,service_role;/);
  assert.match(sql,/grant execute on function platform\.execute_conference_device_operation\(uuid,uuid,bytea,text,jsonb\) to service_role;/);
});
test('9 migration fabricates no authority or credential rows',()=>{
  assert.doesNotMatch(executable,/insert into platform\.(?:devices|user_device_authorizations|device_key_bindings|user_roles)/i);
  assert.doesNotMatch(executable,/update platform\.(?:devices|user_device_authorizations|device_key_bindings)/i);
});
test('10 Production substitute ordering is explicit',()=>{
  assert.ok(file.split('/').pop()>'20260907161000_production_platform_device_admin_compatibility.sql');
  assert.ok(fs.existsSync('supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql'));
});
