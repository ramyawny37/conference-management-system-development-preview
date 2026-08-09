'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260816_6_12_0_conference_section_lock_device_guard.sql'
), 'utf8');
const historical = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260806_6_0_0_conference_section_locks.sql'
), 'utf8');
const lockClient = fs.readFileSync(path.join(root, 'js/sync/conference-locks.js'), 'utf8');
const manager = fs.readFileSync(
  path.join(root, 'js/sync/conference-edit-lock-manager.js'),
  'utf8'
);

function body(name) {
  const pattern = new RegExp(
    'create or replace function public\\.' + name + '[\\s\\S]*?\\n\\$\\$;',
    'i'
  );
  const match = migration.match(pattern);
  assert.ok(match, name + ' definition is required');
  return match[0];
}

const guard = body('require_conference_section_lock_writer');
assert.match(guard, /require_current_approved_device\(p_actor_device_id\)/i);
assert.match(guard, /conference_members[\s\S]*?members\.user_id\s*=\s*actor_id/i);
assert.match(guard, /actor_role not in \('owner','manager'\)/i);
assert.match(guard, /CONFERENCE_WRITE_ACCESS_DENIED/);

['acquire', 'renew', 'release'].forEach(action => {
  const sql = body(action + '_conference_section_lock');
  assert.ok(
    (sql.match(/require_conference_section_lock_writer/gi) || []).length >= 2,
    action + ' must guard before and after its row lock'
  );
});

const acquire = body('acquire_conference_section_lock');
const renew = body('renew_conference_section_lock');
const release = body('release_conference_section_lock');
assert.match(acquire, /effective_ttl < 30 or effective_ttl > 300/i);
assert.match(acquire, /for update/i);
assert.match(acquire, /current_lock\.expires_at <= server_now[\s\S]*?update public\.conference_locks/i);
assert.match(renew, /current_lock\.expires_at<=server_now[\s\S]*?'LOCK_EXPIRED'/i);
assert.match(renew, /current_lock\.user_id<>current_user_id or current_lock\.device_id<>p_device_id[\s\S]*?'LOCK_NOT_OWNED'/i);
assert.match(renew, /current_lock\.lock_token<>p_lock_token[\s\S]*?'LOCK_TOKEN_MISMATCH'/i);
assert.match(release, /current_lock\.user_id<>current_user_id or current_lock\.device_id<>p_device_id[\s\S]*?'LOCK_NOT_OWNED'/i);
assert.match(release, /current_lock\.lock_token<>p_lock_token[\s\S]*?'LOCK_TOKEN_MISMATCH'/i);

assert.match(migration, /revoke all on function public\.require_conference_section_lock_writer\(uuid,uuid\)[\s\S]*?from public,anon,authenticated/i);
assert.match(migration, /CONFERENCE_SECTION_LOCK_GUARD_MISSING/);
assert.doesNotMatch(migration, /system_owner/i);
assert.doesNotMatch(migration, /\b(?:truncate|drop table|delete from public\.(?!conference_locks))\b/i);

assert.match(historical, /p_ttl_seconds integer default 120/);
assert.match(manager, /TTL_SECONDS=120,HEARTBEAT_MS=40000/);
assert.match(manager, /if\(!result\|\|!result\.ok\|\|!result\.data\|\|!result\.data\.owned\)/);
assert.match(manager, /state\.status='lost'[\s\S]*?clearTimer\(\)/);
assert.match(lockClient, /'expired',[\s\S]*?'not_owner',[\s\S]*?'not_found'/);

console.log('conference section lock device guard tests: passed');
