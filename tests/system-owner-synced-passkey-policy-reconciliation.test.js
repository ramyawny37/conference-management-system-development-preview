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
assert.doesNotMatch(edge,/DEVELOPMENT_APP_ORIGIN|vercel/i);
assert.match(edge,/requestOrigin\.toLowerCase\(\) === expectedOrigin/);
assert.match(edge,/APP_ORIGIN_DENIED/);
assert.doesNotMatch(edge,/Access-Control-Allow-Origin':\s*'\*'/);
assert.match(edge,/expectedOrigin, expectedRPID: rpID/);


const migrationDirectory=path.join(root,'supabase/migrations');
const orderedMigrations=fs.readdirSync(migrationDirectory)
  .filter(name=>/^\d.*\.sql$/.test(name))
  .sort()
  .map(name=>({name,sql:fs.readFileSync(path.join(migrationDirectory,name),'utf8')}));
function definitionInMigration(sql,name){
  const marker='create or replace function public.'+name+'(';
  const start=sql.toLowerCase().lastIndexOf(marker);
  if(start<0)return null;
  const end=sql.indexOf('end; '+String.fromCharCode(36,36)+';',start);
  assert.ok(end>start,'definition unterminated: '+name);
  return sql.slice(start,end+8);
}
function effectiveDefinition(name){
  for(let index=orderedMigrations.length-1;index>=0;index--){
    const definition=definitionInMigration(orderedMigrations[index].sql,name);
    if(definition)return {definition,migration:orderedMigrations[index].name};
  }
  assert.fail('effective definition missing: '+name);
}
for(const name of ['get_system_owner_platform_device_administration_state','require_system_owner_webauthn_actor']){
  const effective=effectiveDefinition(name),definition=effective.definition;
  assert.match(effective.migration,/restore_canonical_owner_webauthn_device_administration\.sql$/,
    'forward reconciliation must own effective definition: '+name);
  assert.match(definition,/is_canonical_platform_owner\(p_actor_user_id\)/i,'owner guard: '+name);
  assert.match(definition,/require_canonical_device_authorization\(/i,'approved device guard: '+name);
  assert.match(definition,/credential_kind='platform_primary'/i,'primary credential: '+name);
  assert.match(definition,/lifecycle_status='active'/i,'active credential: '+name);
  assert.match(definition,/user_verification_policy='required'/i,'UV policy: '+name);
  assert.match(definition,/\(not stored\.backup_state or stored\.backup_eligible\)/i,'synced-passkey policy: '+name);
  assert.doesNotMatch(definition,/stored\.backup_eligible=false|stored\.backup_state=false/i,'obsolete passkey rejection: '+name);
}

function administrationAllowed(change){
  const value=Object.assign({owner:true,deviceStatus:'approved',deviceRevoked:false,
    credentialKind:'platform_primary',credentialStatus:'active',userVerificationPolicy:'required',
    backupEligible:true,backupState:true,credentialDevice:'old',actorDevice:'current',serviceRole:true},change||{});
  return value.serviceRole&&value.owner&&value.deviceStatus==='approved'&&!value.deviceRevoked
    &&value.credentialKind==='platform_primary'&&value.credentialStatus==='active'
    &&value.userVerificationPolicy==='required'&&(!value.backupState||value.backupEligible)
    &&((value.backupEligible&&value.backupState)||value.credentialDevice===value.actorDevice);
}
assert.strictEqual(administrationAllowed(),true,'synced owner passkey on approved device is accepted');
assert.strictEqual(administrationAllowed({backupEligible:true,backupState:false,credentialDevice:'current'}),true,'eligible non-backed-up passkey is accepted only on its device');
assert.strictEqual(administrationAllowed({backupEligible:false,backupState:false,credentialDevice:'current'}),true,'single-device passkey is accepted on its device');
[
  ['invalid backup flags',{backupEligible:false,backupState:true}],
  ['cross-device non-synced credential',{backupEligible:false,backupState:false}],
  ['UV policy not required',{userVerificationPolicy:'preferred'}],
  ['inactive credential',{credentialStatus:'revoked'}],
  ['wrong credential kind',{credentialKind:'recovery'}],
  ['pending actor device',{deviceStatus:'pending'}],
  ['revoked actor device',{deviceRevoked:true}],
  ['non-owner actor',{owner:false}],
  ['non-service caller',{serviceRole:false}],
].forEach(([label,change])=>assert.strictEqual(administrationAllowed(change),false,label+' is rejected'));

console.log('system-owner synced passkey policy reconciliation contracts: passed');
