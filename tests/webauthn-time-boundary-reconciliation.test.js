'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260827130503_webauthn_time_boundary_reconciliation_6_20_5.sql'),'utf8');

assert.match(migration,/^begin;[\s\S]*commit;\s*$/i);
assert.strictEqual((migration.match(/^CREATE OR REPLACE FUNCTION public\./gm)||[]).length,2);
assert.strictEqual((migration.match(/^\$function\$;$/gm)||[]).length,2);
assert.match(migration,/public\.begin_system_owner_device_possession_challenge\(/);
assert.match(migration,/public\.complete_system_owner_pending_device_listing\(/);
assert.match(migration,/now\(\)\+interval '2 minutes'/);
assert.match(migration,/now\(\)\+interval '5 minutes'/);
assert.doesNotMatch(migration,/statement_timestamp\(\)\+interval '(?:2|5) minutes'/);
assert.match(migration,/credential:=public\.require_system_owner_webauthn_actor/);
assert.match(migration,/PLATFORM_DEVICE_CHALLENGE_ARGUMENT_INVALID/);
assert.match(migration,/PLATFORM_DEVICE_LIST_CHALLENGE_BINDING_INVALID/);
assert.match(migration,/PLATFORM_DEVICE_MUTATION_CHALLENGE_BINDING_INVALID/);
assert.match(migration,/PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED/);
assert.match(migration,/challenge\.expected_origin<>lower\(p_origin\)/);
assert.match(migration,/challenge\.expected_rp_id<>lower\(p_rp_id\)/);
assert.match(migration,/p_new_sign_count<credential\.sign_count/);
assert.match(migration,/p_verification_context->'userVerified' is distinct from 'true'::jsonb/);
assert.match(migration,/jsonb_typeof\(p_verification_context->'backupEligible'\) is distinct from 'boolean'/);
assert.match(migration,/jsonb_typeof\(p_verification_context->'backupState'\) is distinct from 'boolean'/);
assert.doesNotMatch(migration,/\b(?:grant|revoke)\b/i);
assert.doesNotMatch(migration,/row level security|\b(?:create|alter|drop) policy\b/i);
assert.doesNotMatch(migration,/alter table|create table|drop table|\b(?:insert|update|delete)\b(?=[^$]*(?:commit;|$))/i);

console.log('WebAuthn time-boundary reconciliation contracts: passed');
