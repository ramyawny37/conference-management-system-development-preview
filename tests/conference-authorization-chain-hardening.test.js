'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var sql=fs.readFileSync(path.join(root,
  'supabase/migrations/20260826_6_17_0_conference_authorization_chain_hardening.sql'),'utf8');
var preflight=fs.readFileSync(path.join(root,
  'supabase/conference-authorization-chain-hardening-readonly-preflight.sql'),'utf8');
var verification=fs.readFileSync(path.join(root,
  'supabase/conference-authorization-chain-hardening-readonly-verification.sql'),'utf8');

assert.match(sql,/to_regprocedure\(mapping\.legacy_signature\)/);
assert.match(sql,/BROWSER_EXECUTABLE_LEGACY_FUNCTION_HAS_NO_GUARDED_PATH/);
assert.match(sql,/REQUIRED_GUARDED_MEMBERSHIP_RPC_UNAVAILABLE/);
assert.match(sql,/execute format\([\s\S]*revoke all on function %s from public, anon, authenticated/i);
assert.match(sql,
  /revoke insert, update, delete, truncate, references, trigger[\s\S]*on table public\.conference_members[\s\S]*from public, anon, authenticated/i);
assert.match(sql,/drop policy if exists conference_members_insert_owner/i);
assert.match(sql,/drop policy if exists conference_members_update_owner/i);
assert.match(sql,/drop policy if exists conference_members_delete_owner/i);

assert.match(sql,
  /create or replace function[\s\S]*public\.require_conference_member_organization_membership\(\)/i);
assert.match(sql,
  /join public\.organization_members[\s\S]*organization_members\.user_id = new\.user_id/i);
assert.match(sql,
  /create trigger conference_members_require_organization_membership[\s\S]*before insert or update of conference_id, user_id/i);
assert.match(sql,/CONFERENCE_MEMBER_REQUIRES_ORGANIZATION_MEMBERSHIP/);

assert.match(sql,
  /create or replace function\s+public\.prevent_conference_member_organization_removal\(\)/i);
assert.match(sql,
  /join public\.conference_members[\s\S]*conferences\.organization_id = old\.organization_id[\s\S]*conference_members\.user_id = old\.user_id/i);
assert.match(sql,/ORGANIZATION_MEMBER_HAS_CONFERENCE_MEMBERSHIPS/);
assert.match(sql,
  /create trigger organization_members_protect_conference_memberships[\s\S]*before delete on public\.organization_members/i);
assert.match(sql,/EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP/);
assert.match(sql,/LEGACY_MEMBERSHIP_MUTATION_EXECUTE_REMAINS/);
assert.match(sql,/DEVICE_GUARDED_MEMBERSHIP_ENTRY_POINT_MISSING/);
assert.match(sql,/MEMBERSHIP_ENTRY_POINT_IS_NOT_DEVICE_GUARDED/);
assert.match(sql,/CONFERENCE_ORGANIZATION_MEMBERSHIP_GUARD_INVALID/);
assert.match(sql,/ORGANIZATION_CONFERENCE_MEMBERSHIP_GUARD_INVALID/);
assert.doesNotMatch(sql,/\b(?:grant|alter role|create role|drop role)\b/i);
assert.match(sql,/authorization-plane operation/i);
assert.match(sql,/section locks protect synchronized conference content sections/i);
assert.match(preflight,/begin transaction read only/i);
assert.match(preflight,/UNREVIEWED_CONFERENCE_MEMBERS_WRITE_POLICY/);
assert.match(preflight,/UNREVIEWED_CONFERENCE_MEMBERS_MUTATOR/);
assert.match(preflight,/REQUIRED_GUARDED_MEMBERSHIP_RPC_IS_NOT_DEVICE_GUARDED/);
assert.doesNotMatch(preflight,
  /^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);
assert.match(verification,/begin transaction read only/i);
assert.match(verification,/BROWSER_CONFERENCE_MEMBERS_WRITE_PRIVILEGE_REMAINS/);
assert.match(verification,/BROWSER_CONFERENCE_MEMBERS_WRITE_POLICY_REMAINS/);
assert.match(verification,/UNGUARDED_CONFERENCE_MEMBERS_MUTATOR_EXECUTABLE/);
assert.match(verification,/MEMBERSHIP_ENTRY_POINT_IS_NOT_DEVICE_GUARDED/);
assert.doesNotMatch(verification,
  /^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);
[
  'organization_conference_membership_gap_count',
  'organization_member_fingerprint','conference_member_fingerprint',
  'anon_any_write','authenticated_any_write',
  'role_membership_fingerprint'
].forEach(function(field){assert.ok(verification.includes(field),field);});

console.log('conference authorization chain hardening tests: passed');
