'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(root,
  'supabase/migrations/20260801_5_4_0_device_authorization_foundation.sql'
),'utf8');
var verification=fs.readFileSync(path.join(root,
  'supabase/device-authorization-foundation-readonly-verification.sql'
),'utf8');

[
  /begin\s*;/i,
  /commit\s*;/i,
  /create table public\.user_device_authorizations/i,
  /primary key \(user_id, device_id\)/i,
  /unique \(device_id\)/i,
  /authorization_status text not null default 'registered'/i,
  /authorization_status in \('registered', 'pending', 'approved', 'revoked'\)/i,
  /create table public\.device_authorization_operations/i,
  /operation_id uuid primary key/i,
  /unique \(actor_user_id, operation_id\)/i,
  /create table public\.device_authorization_audit_log/i,
  /create table public\.device_authorization_enforcement/i,
  /enforcement_enabled boolean not null default false/i,
  /insert into public\.device_authorization_enforcement[\s\S]*values \(1, false\)/i,
  /create unique index user_device_authorizations_one_approved_per_user_idx[\s\S]*where authorization_status = 'approved' and revoked_at is null/i,
  /alter table public\.user_device_authorizations enable row level security/i,
  /alter table public\.device_authorization_operations enable row level security/i,
  /alter table public\.device_authorization_audit_log enable row level security/i,
  /alter table public\.device_authorization_enforcement enable row level security/i,
  /create or replace function public\.prevent_device_authorization_audit_mutation/i,
  /DEVICE_AUTHORIZATION_AUDIT_IMMUTABLE/i,
  /create trigger device_authorization_audit_immutable/i,
  /create trigger user_device_authorizations_set_updated_at[\s\S]*execute function public\.set_updated_at\(\)/i,
  /create or replace function public\.require_current_approved_device/i,
  /if current_user_id is null then[\s\S]*AUTH_REQUIRED/i,
  /if not public\.is_account_approved\(current_user_id\) then[\s\S]*SYSTEM_ACCESS_APPROVED_REQUIRED/i,
  /authorizations\.user_id = current_user_id[\s\S]*authorizations\.device_id = p_actor_device_id[\s\S]*authorization_status = 'approved'[\s\S]*revoked_at is null/i,
  /create or replace function public\.register_or_refresh_current_device/i,
  /create or replace function public\.request_current_device_authorization/i,
  /create or replace function public\.get_my_device_authorization/i,
  /P0_3B_PROTECTED_TABLE_MISSING/i,
  /P0_3B_PROTECTED_TABLE_FORCE_RLS_INVALID/i,
  /P0_3B_FUNCTION_OWNER_INVALID/i,
  /P0_3B_INTERNAL_FUNCTION_GRANT_INVALID/i,
  /P0_3B_ENFORCEMENT_MUST_REMAIN_DISABLED/i
].forEach(function(pattern){assert.match(migration,pattern);});

assert.doesNotMatch(migration,
  /grant execute on function public\.require_current_approved_device\(uuid\)[\s\S]*to authenticated/i);
assert.doesNotMatch(migration,
  /grant execute on function public\.prevent_device_authorization_audit_mutation\(\)[\s\S]*to authenticated/i);
assert.doesNotMatch(migration,/grant execute[\s\S]*\bto (?:public|anon)\b/i);

var registrationBody=migration.match(
  /create or replace function public\.register_or_refresh_current_device[\s\S]*?\n\$\$;/i
)[0];
var requestBody=migration.match(
  /create or replace function public\.request_current_device_authorization[\s\S]*?\n\$\$;/i
)[0];
assert.strictEqual(/authorization_status\s*=\s*'pending'/i.test(registrationBody),false,
  'technical registration must not create a pending authorization');
assert.strictEqual(/authorization_status\s*=\s*'approved'/i.test(registrationBody),false,
  'technical registration must not approve a device');
assert.match(registrationBody,/authorization_status, last_registered_at[\s\S]*'registered'/i);
assert.ok(requestBody.indexOf("if access_status is distinct from 'approved'")<
  requestBody.indexOf('select * into existing_operation'),
  'System Access must be checked before idempotency replay');
assert.ok(requestBody.indexOf('device-authorization-user:')<
  requestBody.indexOf('select * into existing_operation'),
  'locks must be acquired before idempotency replay');
assert.match(requestBody,
  /authorization_row\.authorization_status = 'registered'[\s\S]*set authorization_status = 'pending'/i);
assert.match(requestBody,
  /elsif authorization_row\.authorization_status = 'pending'[\s\S]*'unchanged'/i);
assert.match(requestBody,
  /else[\s\S]*request_result := jsonb_build_object\('status', 'denied'\)/i);
assert.strictEqual(/authorization_status\s*=\s*'approved'/i.test(requestBody),false,
  'explicit request must never approve a device');
assert.doesNotMatch(migration,/first[- ](?:login|device|browser)/i);

[
  /protected_table_count/i,
  /protected_table_force_rls_count/i,
  /function_owner/i,
  /security_definer/i,
  /search_path_valid/i,
  /require_current_approved_device\(uuid\)/i,
  /enforcement_disabled/i
].forEach(function(pattern){assert.match(verification,pattern);});

console.log('device authorization foundation contract tests: passed');
