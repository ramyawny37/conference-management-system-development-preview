'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync('supabase/migrations/20260909220000_device_session_finalization_audit_retention.sql','utf8');
const foundation=fs.readFileSync('supabase/migrations/20260902122033_platform_device_session_foundation_1b.sql','utf8');
const boundary=fs.readFileSync('supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql','utf8');
const rehearsal=fs.readFileSync('tests/sql/platform-device-session-finalization-audit-retention-rehearsal.sql','utf8');

test('finalization retains historical sessions and immutable audit history',()=>{
  assert.match(migration,/create or replace function platform\.complete_device_session/);
  assert.doesNotMatch(migration,/delete\s+from\s+platform_private\.device_sessions/i);
  assert.doesNotMatch(migration,/delete\s+from\s+platform_private\.device_session_audit/i);
  assert.doesNotMatch(migration,/alter\s+table|drop\s+(?:constraint|index)|create\s+(?:unique\s+)?index/i);
  assert.match(foundation,/session_id uuid not null unique references platform_private\.device_sessions\(id\) on delete restrict/);
});

test('finalization semantics remain exact apart from obsolete cleanup',()=>{
  const start=boundary.indexOf('create or replace function platform.complete_device_session(');
  const end=boundary.indexOf('\n\ncreate or replace function platform_private.require_exact_jsonb_keys',start);
  const expected=boundary.slice(start,end).replace("  delete from platform_private.device_sessions where expires_at<v_now-interval '7 days';\n",'');
  const normalized=value=>value.replace(/\s+/g,' ').trim();
  assert.equal(normalized(migration),normalized(expected));
  for(const value of [
    "auth.role() is distinct from 'service_role'","octet_length(p_token_hash)<>32",
    "pg_advisory_xact_lock","v_challenge.consumed_at is not null","v_challenge.failed_at is not null",
    "v_challenge.expires_at<=v_now","DEVICE_SESSION_AUTHORITY_INVALID","profile.account_status='approved'",
    "uda.status='approved'","binding.lifecycle_status='active'","device.lifecycle_status='active'",
    "v_now+interval '5 minutes'","insert into platform_private.device_sessions",
    "update platform_private.device_session_challenges set consumed_at=v_now,session_id=p_session_id",
    "insert into platform_private.device_session_audit"
  ])assert.ok(migration.includes(value),value);
  assert.doesNotMatch(migration,/update\s+platform_private\.device_sessions\s+set\s+revoked_at/i);
});

test('rollback rehearsal covers retention, success, replay, authority, and multiple sessions',()=>{
  for(const value of [
    'OLD_AUDITED_SESSION_REMOVED','OLD_AUDIT_REMOVED','NORMAL_FINALIZATION_FAILED',
    'REPLAY_ACCEPTED','INVALID_AUTHORITY_ACCEPTED','MULTIPLE_SESSION_BEHAVIOR_FAILED',
    'device_session_audit_session_id_fkey','on delete restrict','rollback;'
  ])assert.ok(rehearsal.includes(value),value);
});
