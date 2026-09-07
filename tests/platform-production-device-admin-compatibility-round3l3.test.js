'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const file='supabase/migrations/20260907161000_production_platform_device_admin_compatibility.sql';
const sql=fs.readFileSync(file,'utf8');
const executable=sql.replace(/--[^\n]*/g,'');

test('1 bridge is forward-only and transaction bounded',()=>{
  assert.match(sql,/^--[\s\S]*\nbegin;/);
  assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(executable,/drop\s+(?:table|schema)|truncate/i);
});
test('2 dispatcher device administration signatures are established',()=>{
  assert.match(sql,/function platform\.list_pending_device_authorizations\(\)/);
  assert.match(sql,/function platform\.approve_pending_device_authorization\(/);
  assert.match(sql,/change_session_device_authorization\(\s*p_authorization_id,p_device_id,'approved'/);
});
test('3 no API role receives direct execution',()=>{
  assert.match(sql,/revoke all on function platform\.list_pending_device_authorizations\(\),platform\.approve_pending_device_authorization[\s\S]*from public,anon,authenticated,service_role;/);
  assert.doesNotMatch(executable,/grant\s+execute/i);
});
test('4 actor authority is session-context identity and Platform permission',()=>{
  assert.match(sql,/auth\.uid\(\) is not null/);
  assert.match(sql,/platform_private\.is_account_approved\(auth\.uid\(\)\)/);
  assert.match(sql,/permission\.code=p_permission_code/);
  assert.doesNotMatch(sql,/request_header|x-platform-device|device-secret|current_device_authorization_id/);
});
test('5 exact target is locked and revoked state is terminal',()=>{
  assert.match(sql,/where device_authorization\.id=p_authorization_id\s+and device_authorization\.device_id=p_device_id\s+for update;/);
  assert.match(sql,/DEVICE_AUTHORIZATION_NOT_FOUND/);
  assert.match(sql,/DEVICE_AUTHORIZATION_REVOKED_TERMINAL/);
  assert.match(sql,/DEVICE_AUTHORIZATION_NOT_PENDING/);
});
test('6 final Platform Owner device protection and audit are retained',()=>{
  assert.match(sql,/LAST_PLATFORM_OWNER_DEVICE_RESTRICTION_FORBIDDEN/);
  assert.match(sql,/platform_private\.write_audit_event/);
  assert.match(sql,/'device_session_dispatcher'/);
});
test('7 no identity credential or legacy device is fabricated',()=>{
  assert.doesNotMatch(executable,/insert into platform\.(?:devices|user_device_authorizations|device_key_bindings)/i);
  assert.doesNotMatch(sql,/public\.user_device_authorizations|development|f9306733-612d-433f-a38e-5d72855c2fe3/i);
});
test('8 superseded compile-time signatures fail closed',()=>{
  for(const name of ['approve_device_authorization','block_device_authorization','revoke_device_authorization','set_account_status','grant_user_role','revoke_user_role','grant_role_permission','revoke_role_permission'])
    assert.match(sql,new RegExp(`function platform\\.${name}\\(`));
  assert.match(sql,/DEVICE_SESSION_DISPATCH_REQUIRED/);
  assert.match(sql,/function platform\.grant_user_role\(uuid,text,text,text,uuid default null\)/);
  assert.doesNotMatch(sql,/grant_user_role\(uuid,text,text default|grant_user_role\(uuid,text,text,text default/);
});
test('9 private helpers are isolated from every API role',()=>{
  assert.match(sql,/revoke all on function platform_private\.has_session_actor_permission[\s\S]*from public,anon,authenticated,service_role;/);
});
test('10 bridge is intentionally ordered after reconciliation',()=>{
  assert.ok(file.split('/').pop()>'20260907160000_production_foundation_reconciliation.sql');
});
