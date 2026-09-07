'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const compatibility=fs.readFileSync('supabase/migrations/20260907161000_production_platform_device_admin_compatibility.sql','utf8');
const file='supabase/migrations/20260907163000_production_inventory_authority_retirement_session_only_reconciliation.sql';
const sql=fs.readFileSync(file,'utf8');
const executable=sql.replace(/--[^\n]*/g,'');

test('1 reconciliation is transaction bounded',()=>{assert.match(sql,/^--[\s\S]*\nbegin;/);assert.match(sql,/commit;\s*$/);});
test('2 compatibility placeholder has the exact canonical defaults',()=>{
  assert.match(compatibility,/function platform\.grant_user_role\(uuid,text,text,text,uuid default null\)/);
  assert.doesNotMatch(compatibility,/grant_user_role\(uuid,text,text default|grant_user_role\(uuid,text,text,text default/);
});
test('3 retired Inventory roles remain non-assignable',()=>{
  for(const role of ['inventory_manager','inventory_operator','viewer'])assert.match(sql,new RegExp(`'${role}'[^\n]+false\\)`));
  assert.match(sql,/INVENTORY_AUTHORITY_RETIREMENT_INCOMPLETE/);
});
test('4 no legacy possession mechanism is present',()=>{
  assert.doesNotMatch(sql,/current_device_authorization_id|request_device_id|request_header|x-platform-device-secret|hash_device_secret|secret_hash|public\.user_device_authorizations/i);
});
test('5 possession-required permission evaluation is Phase 1C only',()=>{
  assert.match(sql,/platform_private\.validated_phase1c_device_authorization\(\s*p_user_id,platform_private\.phase1c_context_device_id\(\)/);
  assert.doesNotMatch(sql,/\bcoalesce\s*\(\s*platform_private\.validated_phase1c/i);
});
test('6 access context is metadata-only and asserts no possession',()=>{
  assert.match(sql,/'deviceStatus','not_asserted'/);assert.match(sql,/'possessionVerified',false/);assert.match(sql,/'permissions','\[\]'::jsonb/);
});
test('7 canonical role grant rejects Inventory and unsupported scopes',()=>{
  assert.match(sql,/function platform\.grant_user_role\([\s\S]*p_scope_id uuid default null/);
  assert.match(sql,/INVENTORY_AUTHORITY_RETIRED/);assert.match(sql,/UNSUPPORTED_ROLE_SCOPE/);
});
test('8 role grant uses verified actor context and immutable audit table',()=>{
  assert.match(sql,/actor_authorization_id:=platform_private\.validated_phase1c_device_authorization/);
  assert.match(sql,/insert into platform\.audit_events/);assert.match(sql,/'device_session_dispatcher'/);
});
test('9 privilege surface keeps only the RLS policy helper directly callable',()=>{
  assert.match(sql,/revoke all on function platform_private\.has_permission_for[\s\S]*from public,anon,authenticated,service_role;/);
  assert.match(sql,/grant execute on function platform\.has_permission\(text,text,uuid\) to authenticated;/);
  assert.doesNotMatch(sql,/grant execute on function platform\.(?:get_my_access_context|grant_user_role)/);
});
test('10 no device authority rows or excluded transition surface appear',()=>{
  assert.doesNotMatch(executable,/insert into platform\.(?:devices|user_device_authorizations|device_key_bindings)/i);
  assert.doesNotMatch(sql,/ownership_handoff|binding_recovery|development/i);
});
