'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261016154342_platform_owner_passkey_recovery_canonicalization.sql'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-authorization/index.ts'),'utf8');
const page=fs.readFileSync(path.join(root,'platform-device-recovery-login-v2.html'),'utf8');
const browser=fs.readFileSync(path.join(root,'js/platform-stable-device-recovery.js'),'utf8');

function attempt(change){
  return Object.assign({owner:true,grant:true,reviewed:true,target:'9bd5edb6-c92a-4dd3-a3d5-80c5ebb74d78',
    grantedTarget:'9bd5edb6-c92a-4dd3-a3d5-80c5ebb74d78',targetStatus:'pending',targetActive:true,
    authorizationExpired:false,challengeExpired:false,authorizationConsumed:false,challengeConsumed:false,
    challengeFailed:false,credentialActive:true,userVerificationPolicy:'required',userVerified:true,
    backupEligible:true,backupState:true,enrolledBackupEligible:true,enrolledBackupState:true,
    origin:'https://ramyawny37.github.io',rpId:'ramyawny37.github.io',signature:true,counter:0,storedCounter:0},change||{});
}
function permitted(v){
  return v.owner&&v.grant&&v.reviewed&&v.target===v.grantedTarget&&v.targetStatus==='pending'&&v.targetActive
    &&!v.authorizationExpired&&!v.challengeExpired&&!v.authorizationConsumed&&!v.challengeConsumed&&!v.challengeFailed
    &&v.credentialActive&&v.userVerificationPolicy==='required'&&v.userVerified
    &&v.backupEligible===v.enrolledBackupEligible&&v.backupState===v.enrolledBackupState
    &&(!v.backupState||v.backupEligible)&&v.origin==='https://ramyawny37.github.io'
    &&v.rpId==='ramyawny37.github.io'&&v.signature&&v.counter>=v.storedCounter;
}

test('synchronized platform-owner passkey approves only the reviewed current MacIntel target',()=>{
  assert.equal(permitted(attempt()),true);
});
[
  ['password without reviewed grant',{grant:false}],['dashboard privilege without owner role',{owner:false}],
  ['unreviewed issuance',{reviewed:false}],['changed target device',{target:'a9a48727-16bf-45fd-8491-4de342635d7e'}],
  ['target already approved',{targetStatus:'approved'}],['retired target',{targetActive:false}],
  ['expired authorization',{authorizationExpired:true}],['expired challenge',{challengeExpired:true}],
  ['replayed authorization',{authorizationConsumed:true}],['replayed challenge',{challengeConsumed:true}],
  ['failed challenge',{challengeFailed:true}],['inactive credential',{credentialActive:false}],
  ['user verification absent',{userVerified:false}],['wrong origin',{origin:'https://example.com'}],
  ['wrong RP ID',{rpId:'example.com'}],['bad signature',{signature:false}],
  ['backup-state mismatch',{backupState:false}],['invalid backup policy',{backupEligible:false}],
  ['counter regression',{counter:0,storedCounter:1}],
].forEach(([name,change])=>test(name+' is denied',()=>assert.equal(permitted(attempt(change)),false)));

test('migration issues one reviewed, expiring, target-bound Development grant without an approved source device',()=>{
  ['reviewed_platform_owner_passkey_recovery','PLATFORM_OWNER_PASSKEY_RECOVERY_20261016_CURRENT_MACINTEL',
    "target_device constant uuid:='9bd5edb6-c92a-4dd3-a3d5-80c5ebb74d78'",
    "target_authorization constant uuid:='9a7b9795-33c4-4c75-ba89-9e42e4456442'",
    "active_credential constant uuid:='2106a2d2-d214-4705-bc4f-01262d9581fb'",
    "device.platform='MacIntel'","interval '24 hours'",'independentOfApprovedDevice',
    'source_authorization_id drop not null','source_device_id drop not null']
    .forEach(value=>assert.ok(migration.includes(value),value));
  assert.match(migration,/values\(owner_id,null,null,target_authorization,target_device,target_device,active_credential/);
  assert.doesNotMatch(migration,/source_authorization\.status='approved'/);
});

test('credential validator allows backed-up eligible passkeys but keeps owner, lifecycle, and UV policy checks',()=>{
  const validator=migration.slice(migration.indexOf('create or replace function platform_private.require_platform_owner_recovery_credential'),migration.indexOf('create or replace function public.get_stable'));
  ['is_canonical_platform_owner','platform_primary',"lifecycle_status='active'","user_verification_policy='required'",
    '(not stored.backup_state or stored.backup_eligible)'].forEach(value=>assert.ok(validator.includes(value),value));
  assert.doesNotMatch(validator,/require_canonical_device_authorization/);
  assert.doesNotMatch(validator,/backup_eligible=false|backup_state=false/);
});

test('Edge verifies challenge, origin, RP ID, user verification, signature and enrolled credential material',()=>{
  ['verifyAuthenticationResponse','expectedChallenge: challenge','expectedOrigin','expectedRPID: rpID',
    'requireUserVerification: true','material.publicKeyCose','material.signCount',
    'verification.verified','verification.authenticationInfo','complete_stable_development_platform_device_recovery']
    .forEach(value=>assert.ok(edge.includes(value),value));
});

test('verification rejection burns the challenge and writes immutable denial audit',()=>{
  ['fail_stable_development_platform_device_recovery','ASSERTION_VERIFICATION_FAILED',
    'ASSERTION_NOT_VERIFIED','CREDENTIAL_POLICY_DENIED'].forEach(value=>assert.ok(edge.includes(value),value));
  ['passkey_verification_failed',"result in ('issued','applied','denied')",
    'stable_device_recovery_audit'].forEach(value=>assert.ok(migration.includes(value),value));
});

test('completion serializes and consumes challenge and authorization after exact target revalidation',()=>{
  const completion=migration.slice(migration.indexOf('create or replace function public.complete_stable'));
  ['pg_advisory_xact_lock',"item.status='pending'",'item.device_id=recovery.target_device_id',
    'challenge.expires_at<=','challenge.failed_at is not null','p_new_sign_count<credential.sign_count',
    "p_verification_context->'userVerified'","p_verification_context->>'backupEligible'",
    "p_verification_context->>'backupState'",'set consumed_at=pg_catalog.statement_timestamp() where id=challenge.id',
    'set consumed_at=pg_catalog.statement_timestamp() where id=recovery.id']
    .forEach(value=>assert.ok(completion.replace(/\s+/g,' ').includes(value.replace(/\s+/g,' ')),value));
  assert.ok(completion.indexOf("item.status='pending'")<completion.indexOf("set status='approved'"));
});

test('begin serializes concurrent ceremonies and preserves expired challenges as failed history',()=>{
  const begin=migration.slice(migration.indexOf('create or replace function public.begin_stable'),migration.indexOf('create or replace function public.get_stable_development_platform_device_recovery_material'));
  ['for update',"failure_code='expired_replaced'",'STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE',
    "interval '2 minutes'"].forEach(value=>assert.ok(begin.includes(value),value));
  assert.doesNotMatch(begin,/delete\s+from\s+platform_private\.stable_device_recovery_challenges/i);
});

test('browser reuses the preserved current identity and never creates or clears a device',()=>{
  assert.match(page,/device-storage-namespace\.js\?rev=platform-owner-passkey-recovery-v1/);
  assert.match(browser,/SupabaseDeviceIdentity\.getCurrent/);
  assert.match(browser,/CURRENT_DEVICE_IDENTITY_REQUIRED/);
  assert.match(browser,/targetDeviceId:targetDeviceId/);
  assert.doesNotMatch(browser,/getOrCreate|resetCurrent|localStorage\.removeItem/);
  assert.match(browser,/navigator\.credentials\.get/);
});

test('recovery remains service-role-only and the page carries no privileged secret',()=>{
  ['get_stable_development_platform_device_recovery_state','begin_stable_development_platform_device_recovery',
    'get_stable_development_platform_device_recovery_material','fail_stable_development_platform_device_recovery',
    'complete_stable_development_platform_device_recovery'].forEach(name=>{
      assert.match(migration,new RegExp('revoke all on function public\\.'+name+'[\\s\\S]*?from public,anon,authenticated','i'));
      assert.match(migration,new RegExp('grant execute on function public\\.'+name+'[\\s\\S]*?to service_role','i'));
    });
  assert.doesNotMatch(page+browser,/SUPABASE_SERVICE_ROLE_KEY|service.role|postgres(?:ql)?:\/\//i);
});
