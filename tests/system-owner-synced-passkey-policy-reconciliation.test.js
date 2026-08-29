'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260827125056_system_owner_synced_passkey_policy_full_reconciliation_6_20_4.sql'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-authorization/index.ts'),'utf8');

function accepts(backupEligible,backupState,userVerified=true,verified=true,registrationInfo=true){
  return verified && registrationInfo && userVerified && (!backupState || backupEligible);
}

assert.strictEqual(accepts(false,false),true,'non-synced credential must remain accepted');
assert.strictEqual(accepts(true,false),true,'backup-eligible credential must be accepted');
assert.strictEqual(accepts(true,true),true,'synced credential must be accepted');
assert.strictEqual(accepts(false,true),false,'backed-up credential must be backup eligible');
assert.strictEqual(accepts(false,false,false),false,'user verification remains mandatory');
assert.strictEqual(accepts(false,false,true,false),false,'verification.verified remains mandatory');
assert.strictEqual(accepts(false,false,true,true,false),false,'registrationInfo remains mandatory');

assert.match(migration,/check \(not backup_state or backup_eligible\)/i);
assert.match(migration,/privileged_device_audit_webauthn_policy[\s\S]*credential_bootstrap_authorization_issued[\s\S]*credential_recovery_authorization_issued[\s\S]*user_verified = true[\s\S]*not backup_state or backup_eligible/i);
assert.doesNotMatch(migration,/credentials\.backup_eligible=false and credentials\.backup_state=false/i);
assert.strictEqual((migration.match(/p_verification_context->'userVerified' is distinct from 'true'::jsonb/g)||[]).length,2);
assert.strictEqual((migration.match(/jsonb_typeof\(p_verification_context->'backupEligible'\) is distinct from 'boolean'/g)||[]).length,2);
assert.strictEqual((migration.match(/jsonb_typeof\(p_verification_context->'backupState'\) is distinct from 'boolean'/g)||[]).length,2);
assert.strictEqual((migration.match(/p_verification_context->'backupState'='true'::jsonb/g)||[]).length,2);
assert.strictEqual((migration.match(/p_verification_context->'backupEligible'='false'::jsonb/g)||[]).length,2);
assert.strictEqual((migration.match(/\(p_verification_context->>'backupEligible'\)::boolean/g)||[]).length,2);
assert.strictEqual((migration.match(/\(p_verification_context->>'backupState'\)::boolean/g)||[]).length,2);
assert.match(migration,/challenge\.expected_origin<>lower\(p_origin\)/g);
assert.match(migration,/challenge\.expected_rp_id<>lower\(p_rp_id\)/g);
assert.match(migration,/p_new_sign_count<credential\.sign_count/g);
assert.match(migration,/authorization_status='approved' and uda\.revoked_at is null/i);
assert.match(migration,/credentials\.credential_kind='platform_primary'/i);
assert.match(migration,/credentials\.lifecycle_status='active'/i);
assert.match(migration,/credentials\.user_verification_policy='required'/i);
assert.doesNotMatch(migration,/\b(?:grant|revoke)\b/i);
assert.doesNotMatch(migration,/\b(?:enable|disable|force) row level security\b|\b(?:create|alter|drop) policy\b/i);
assert.doesNotMatch(migration,/alter table public\.[a-z_]+\s+(?:add|drop|alter) column/i);

assert.match(edge,/if \(!verification\.verified \|\| !verification\.registrationInfo\)/);
assert.match(edge,/if \(!verification\.verified\)/);
assert.match(edge,/requireUserVerification:\s*true/g);
assert.strictEqual((edge.match(/!context\.userVerified \|\| \(context\.backupState && !context\.backupEligible\)/g)||[]).length,2);
assert.doesNotMatch(edge,/context\.backupEligible \|\| context\.backupState \|\| !context\.userVerified/);
assert.match(edge,/expectedOrigin, expectedRPID: rpID/);
assert.match(edge,/uuid\(body\.challengeId, 'CHALLENGE_ID'\)/);
assert.match(edge,/fail_system_owner_device_possession_challenge/);
assert.match(edge,/function logSafeDiagnostic\(phase: string, error: unknown\): void/);
assert.match(edge,/console\.error\(JSON\.stringify\(\{ phase, errorName, errorMessage \}\)\)/);
assert.match(edge,/\.replace\(\/Bearer\\s\+\\S\+\/gi, '\[REDACTED\]'\)/);
assert.match(edge,/\.replace\(\/\\beyJ\[A-Za-z0-9_\-\]\*\\\.\[A-Za-z0-9_\-\]\+\\\.\[A-Za-z0-9_\-\]\+\\b\/g, '\[REDACTED\]'\)/);
assert.match(edge,/\.replace\(\/\\bsb_\(\?:publishable\|secret\)_\[A-Za-z0-9_\-\]\+\\b\/gi, '\[REDACTED\]'\)/);
assert.match(edge,/\.replace\(\/\[A-Za-z0-9_\-\]\{41,\}\/g, '\[REDACTED\]'\)/);
assert.match(edge,/logSafeDiagnostic\(phase, error\)/);
assert.match(edge,/logSafeDiagnostic\('credential-enrollment', error\)/);
assert.doesNotMatch(edge,/authenticatorAttachment:\s*'platform'/);

console.log('system-owner synced passkey policy reconciliation contracts: passed');
