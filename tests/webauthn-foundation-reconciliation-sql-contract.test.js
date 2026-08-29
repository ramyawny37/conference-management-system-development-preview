'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,
  'supabase/migrations/20260826224848_webauthn_privileged_device_foundation_reconciliation_6_19_1.sql'),'utf8');
const historical=fs.readFileSync(path.join(root,
  'supabase/migrations/obsolete/20260824_6_16_0_webauthn_privileged_device_security_foundation.sql'),'utf8');
const verification=fs.readFileSync(path.join(root,
  'supabase/webauthn-privileged-device-foundation-reconciliation-readonly-verification.sql'),'utf8');

function foundationContract(sql,endMarker){
  const start=sql.indexOf('-- Phase A only:');
  const end=sql.indexOf(endMarker,start);
  assert.ok(start>=0 && end>start,'foundation contract markers must exist');
  return sql.slice(start,end).trim();
}

assert.strictEqual(
  foundationContract(migration,'-- Reconciliation-specific data'),
  foundationContract(historical,'commit;'),
  'the complete 6.16 foundation contract must remain byte-for-byte unchanged'
);
assert.strictEqual((migration.match(/^create table public\./gmi)||[]).length,9);
assert.strictEqual((migration.match(/^create or replace function public\.guard_/gmi)||[]).length,7);
assert.strictEqual((migration.match(/^create trigger /gmi)||[]).length,9);
assert.strictEqual((migration.match(/enable row level security;/gi)||[]).length,9);
assert.match(migration,/EXPECTED_MIGRATION_6_19_0_IS_NOT_CURRENT/);
assert.match(migration,/WEBAUTHN_FOUNDATION_RELATION_CONFLICT/);
assert.match(migration,/WEBAUTHN_FOUNDATION_FUNCTION_CONFLICT/);
assert.match(migration,/WEBAUTHN_FOUNDATION_TRIGGER_CONFLICT/);
assert.match(migration,/USER_DEVICE_AUTHORIZATIONS_PRIMARY_KEY_INVALID/);
assert.match(migration,/register_or_refresh_current_device\(uuid,text,text\)/);
assert.match(migration,/request_current_device_authorization\(uuid,uuid\)/);
assert.match(migration,/require_current_approved_device\(uuid\)/);
assert.doesNotMatch(migration,
  /^(?:update|delete|truncate)\s+public\.(?:devices|user_device_authorizations|conference_members|conferences|organization_members)|^insert\s+into\s+public\.(?:devices|user_device_authorizations|conference_members|conferences|organization_members)/gmi);
assert.doesNotMatch(migration,/grant\s+execute[\s\S]*?to\s+(?:public|anon|authenticated)/i);
assert.match(migration,/where singleton_id=1 and enabled=false/);
assert.match(migration,/WEBAUTHN_PHASE_A_FEATURE_MUST_BE_DISABLED/);
assert.match(verification,/exact_required_tables_exist/);
assert.match(verification,/exact_nine_reconciliation_triggers_present/);
assert.match(verification,/onboarding_and_6_17_6_19_functions_present/);
assert.match(verification,/devices_row_count_for_audit/);
assert.match(verification,/user_device_authorizations_row_count_for_audit/);

console.log('WebAuthn foundation reconciliation SQL contract tests: passed');
