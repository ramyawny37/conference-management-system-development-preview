'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(root,
  'supabase/migrations/20260826_6_18_0_conference_lifecycle_hardening.sql'),
  'utf8');
var preflight=fs.readFileSync(path.join(root,
  'supabase/conference-lifecycle-hardening-readonly-preflight.sql'),'utf8');
var verification=fs.readFileSync(path.join(root,
  'supabase/conference-lifecycle-hardening-readonly-verification.sql'),'utf8');
var snapshotSync=fs.readFileSync(path.join(root,
  'js/supabase/snapshot-sync.js'),'utf8');

assert.match(migration,/^begin;/im);
assert.match(migration,/commit;\s*$/i);
assert.match(migration,/create temporary table migration_6_18_0_data_baseline/i);
assert.match(migration,/MIGRATION_CHANGED_DATA_OR_HISTORY/);
assert.match(migration,
  /revoke insert, update, delete, truncate, references, trigger[\s\S]*on table public\.conferences[\s\S]*from public, anon, authenticated/i);
[
  'conferences_insert_own',
  'conferences_update_manager',
  'conferences_delete_owner'
].forEach(function(policy){
  assert.match(migration,new RegExp('drop policy if exists '+policy,'i'));
});
assert.match(migration,/create_conference_idempotent\(uuid,uuid,text,jsonb\)/);
assert.match(migration,
  /device_guarded_create_conference_idempotent\(uuid,uuid,uuid,text,jsonb\)/);
assert.match(migration,
  /create_organization_conference_idempotent\(uuid,uuid,uuid,text,jsonb\)/);
assert.match(migration,
  /device_guarded_create_organization_conference_idempotent\(uuid,uuid,uuid,uuid,text,jsonb\)/);
assert.match(migration,/require_current_approved_device/);
assert.match(migration,/system_user_access/);
assert.match(migration,/can_user_create_conferences/);
assert.match(migration,
  /revoke all on function public\.add_conference_owner_membership\(\)[\s\S]*from public, anon, authenticated/i);
assert.match(migration,
  /create or replace function public\.prevent_invalid_conference_organization_change\(\)/i);
assert.match(migration,/GENERAL_CONFERENCE_REPARENTING_NOT_ALLOWED/);
assert.match(migration,/ACTIVE_CONFERENCE_ORGANIZATION_REQUIRED/);
assert.match(migration,/CONFERENCE_OWNER_ORGANIZATION_MEMBERSHIP_REQUIRED/);
assert.match(migration,/CONFERENCE_MEMBERS_ORGANIZATION_MEMBERSHIP_REQUIRED/);
assert.match(migration,/LEGACY_ASSIGNMENT_IS_NOT_NULL_TO_ORGANIZATION_ONLY/);
assert.match(migration,
  /before update of organization_id on public\.conferences/i);
assert.match(migration,/BROWSER_CONFERENCE_WRITE_PRIVILEGE_REMAINS/);
assert.match(migration,/BROWSER_CONFERENCE_WRITE_POLICY_REMAINS/);
assert.match(migration,/UNGUARDED_CONFERENCE_LIFECYCLE_MUTATOR/);
assert.match(migration,/authorization-plane operations/i);
assert.match(migration,/Content[\s\S]*section locks do not authorize/i);
assert.doesNotMatch(migration,/\balter role\b|\bcreate role\b|\bdrop role\b/i);
assert.doesNotMatch(migration,/\bdelete\s+from\b|\btruncate\s+table\b/i);

[preflight,verification].forEach(function(sql){
  assert.match(sql,/begin transaction read only/i);
  assert.doesNotMatch(sql,
    /^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);
});
assert.match(preflight,/EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP/);
assert.match(preflight,/GUARDED_ORGANIZATION_CONFERENCE_CREATE_UNAVAILABLE/);
assert.match(preflight,/UNREVIEWED_CONFERENCE_LIFECYCLE_MUTATOR/);
assert.match(preflight,/role_membership_fingerprint/);
assert.match(verification,/BROWSER_CONFERENCE_WRITE_PRIVILEGE_REMAINS/);
assert.match(verification,/OBSOLETE_CONFERENCE_CREATE_EXECUTE_REMAINS/);
assert.match(verification,/CONFERENCE_ORGANIZATION_CHANGE_GUARD_MISSING/);
assert.match(verification,/OWNER_BOOTSTRAP_BROWSER_EXECUTE_REMAINS/);
assert.match(verification,/CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP_REMAINS/);
assert.match(verification,/role_membership_fingerprint/);

assert.doesNotMatch(snapshotSync,/function\s+createConference\s*\(/);
assert.doesNotMatch(snapshotSync,/createConference\s*:\s*createConference/);
assert.doesNotMatch(snapshotSync,
  /\.from\(['"]conferences['"]\)[\s\S]{0,160}\.(?:insert|update|delete)\s*\(/);
assert.match(snapshotSync,
  /\.rpc\(['"]device_guarded_create_organization_conference_idempotent['"]/);

console.log('conference lifecycle hardening tests: passed');
