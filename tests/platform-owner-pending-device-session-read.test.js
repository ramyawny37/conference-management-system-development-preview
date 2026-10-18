'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync('supabase/migrations/20261018214500_canonical_owner_pending_device_session_read.sql','utf8');
const operationEdge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

test('canonical owner list is routed behind the unified session-derived device context',()=>{
  assert.match(migration,/require_current_approved_device\(p_actor_device_id\)/);
  assert.match(migration,/is_canonical_platform_owner\(v_actor_user_id\)/);
  assert.match(migration,/list_system_owner_pending_device_authorizations_for_session\(v_session\.device_id\)/);
  assert.match(migration,/require_exact_jsonb_keys\(p_args,array\[\]::text\[\]\)/);
  assert.match(operationEdge,/list_system_owner_pending_device_authorizations/);
  const dispatch=operationEdge.slice(operationEdge.indexOf("rpc('execute_device_operation'"));
  assert.doesNotMatch(dispatch,/actorDeviceId/);
  assert.match(operationEdge,/ACTOR_DEVICE_OVERRIDE_DENIED/);
});

test('pending result excludes rejected, revoked, retired, compromised and unapproved rows',()=>{
  for(const fragment of ["status='pending'","revoked_at is null","lifecycle_status='active'","retired_at is null","compromised_at is null","account_status='approved'"])
    assert.ok(migration.includes(fragment),fragment);
});

test('read RPC and retired listing-session contracts expose no browser or service-role execution path',()=>{
  assert.match(migration,/revoke all on function public\.list_system_owner_pending_device_authorizations_for_session\(uuid\)[\s\S]*from public,anon,authenticated,service_role;[\s\S]*grant execute[\s\S]*to postgres;/i);
  assert.match(migration,/complete_system_owner_pending_device_listing\([\s\S]*\) from public,anon,authenticated,service_role;/i);
  assert.match(migration,/list_system_owner_pending_device_authorizations\([\s\S]*uuid,uuid,uuid,text,bytea[\s\S]*\) from public,anon,authenticated,service_role;/i);
});
