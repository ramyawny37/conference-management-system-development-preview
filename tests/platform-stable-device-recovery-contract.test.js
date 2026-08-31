'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260831050000_one_time_stable_development_device_recovery.sql'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-authorization/index.ts'),'utf8');
const page=fs.readFileSync(path.join(root,'platform-device-recovery.html'),'utf8');
const versionedPage=fs.readFileSync(path.join(root,'platform-device-recovery-login-v2.html'),'utf8');
const browser=fs.readFileSync(path.join(root,'js/platform-stable-device-recovery.js'),'utf8');
const stateMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260831051000_stable_device_recovery_state_lookup.sql'),'utf8');
const actorMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260831052000_stable_device_recovery_server_actor_resolution.sql'),'utf8');
const retryMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260831210905_stable_device_recovery_expired_challenge_retry_reconciliation.sql'),'utf8');
function exact(input){return Object.assign({owner:true,activeOwner:true,ownerRole:true,source:'approved',sourceActive:true,target:'pending',targetActive:true,targetPrefix:'f9306733',environment:'development_preview',expired:false,consumed:false,credential:'platform_primary',origin:'https://ramyawny37.github.io',rp:'ramyawny37.github.io',userVerified:true,backupEligible:true,backupState:true,enrolledBackupEligible:true,enrolledBackupState:true,signature:true,replay:false},input||{});}
function permits(v){return v.owner&&v.activeOwner&&v.ownerRole&&v.source==='approved'&&v.sourceActive&&v.target==='pending'&&v.targetActive&&v.targetPrefix==='f9306733'&&v.environment==='development_preview'&&!v.expired&&!v.consumed&&v.credential==='platform_primary'&&v.origin==='https://ramyawny37.github.io'&&v.rp==='ramyawny37.github.io'&&v.userVerified&&v.backupEligible===v.enrolledBackupEligible&&v.backupState===v.enrolledBackupState&&(!v.backupState||v.backupEligible)&&v.signature&&!v.replay;}
[
 ['wrong owner',{owner:false}],['inactive owner',{activeOwner:false}],['missing platform_owner',{ownerRole:false}],
 ['wrong source device',{source:'wrong'}],['revoked source device',{source:'revoked'}],['wrong target',{targetPrefix:'b23ece81'}],
 ['target already approved',{target:'approved'}],['b23ece81 target',{targetPrefix:'b23ece81'}],['wrong environment',{environment:'production'}],
 ['expired challenge',{expired:true}],['consumed authorization',{consumed:true}],['wrong WebAuthn credential',{credential:'other'}],
 ['wrong origin',{origin:'https://example.com'}],['wrong RP',{rp:'example.com'}],['userVerified false',{userVerified:false}],
 ['backup-policy violation',{backupEligible:false}],['invalid signature',{signature:false}],['replayed assertion',{replay:true}],
 ['duplicate completion',{consumed:true}],
].forEach(([name,change])=>test(name+' -> DENY',()=>assert.equal(permits(exact(change)),false)));
test('successful exact ceremony approves only f9306733 in controlled contract',()=>assert.equal(permits(exact()),true));
test('migration is exact, one-time, Development-only, and service-role-only',()=>{
  ['9bce8898-%','f9306733-%','b23ece81-%',"environment = 'development_preview'",'consumed_at is null',"expected_origin = 'https://ramyawny37.github.io'", "expected_rp_id = 'ramyawny37.github.io'",'for update','pg_advisory_xact_lock','require_system_owner_webauthn_actor','stable_device_recovery_audit_immutable'].forEach(value=>assert.ok(migration.includes(value),value));
  assert.match(migration,/revoke all on function public\.complete_stable_development_platform_device_recovery[\s\S]*from public,anon,authenticated/i);
  assert.match(migration,/grant execute on function public\.complete_stable_development_platform_device_recovery[\s\S]*to service_role/i);
  assert.doesNotMatch(migration,/grant execute on function public\.complete_stable_development_platform_device_recovery[\s\S]*to authenticated/i);
});
test('completion validates every frozen live and assertion binding before the target update',()=>{
  const completion=migration.slice(migration.indexOf('create or replace function public.complete_stable'));
  ['account_status=\'approved\'','role.code=\'platform_owner\'','source_authorization.status=\'approved\'',"item.status='pending'",'challenge.expires_at <=','challenge.consumed_at is not null','p_new_sign_count < credential.sign_count',"p_verification_context->'userVerified'", "p_verification_context->>'backupEligible'", "p_verification_context->>'backupState'"].forEach(value=>assert.ok(completion.replace(/\s+/g,' ').includes(value.replace(/\s+/g,' ')),value));
  assert.ok(completion.indexOf("item.status='pending'")<completion.indexOf("set status='approved'"));
  assert.ok(completion.indexOf('stable_device_recovery_audit')<completion.indexOf('set consumed_at=pg_catalog.statement_timestamp() where id=recovery.id'));
});
test('Edge verifies assertion and passes only verified policy context to completion',()=>{
  ['begin-stable-development-recovery','finish-stable-development-recovery','verifyAuthenticationResponse','expectedOrigin','expectedRPID: rpID','requireUserVerification: true','complete_stable_development_platform_device_recovery'].forEach(value=>assert.ok(edge.includes(value),value));
});
test('temporary page has one explicit ceremony control and no privileged secret',()=>{
  assert.equal((page.match(/id="recover"/g)||[]).length,1);assert.match(browser,/navigator\.credentials\.get/);
  assert.match(page,/autocomplete="current-password"/);assert.match(browser,/SupabaseAuth\.signInWithPassword/);
  assert.match(browser,/password\.value=''/);assert.doesNotMatch(browser,/signUp|register_device|PlatformIntegration/);
  assert.doesNotMatch(page+browser,/service.role|SUPABASE_SERVICE_ROLE_KEY|postgres(?:ql)?:\/\//i);
});
test('cache-independent recovery entry contains visible login and versioned runtime assets',()=>{
  assert.match(versionedPage,/Development owner email/);assert.match(versionedPage,/Sign in to Development recovery/);
  assert.match(versionedPage,/platform-stable-device-recovery\.js\?rev=recovery-server-actor-v4/);
  assert.doesNotMatch(versionedPage,/service-worker\.js|pwa\.js/);
});
test('recovery uses its target-bound state lookup instead of legacy administration policy',()=>{
  assert.match(browser,/get-stable-development-recovery-state/);assert.doesNotMatch(browser,/['"]get-administration-state['"]/);
  ['STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID','development_preview','https://ramyawny37.github.io','ramyawny37.github.io','require_system_owner_webauthn_actor'].forEach(value=>assert.ok(stateMigration.includes(value),value));
  assert.match(stateMigration,/revoke all on function public\.get_stable_development_platform_device_recovery_state[\s\S]*from public,anon,authenticated/i);
  assert.match(stateMigration,/grant execute on function public\.get_stable_development_platform_device_recovery_state[\s\S]*to service_role/i);
});
test('Edge resolves the immutable recovery actor and does not trust the browser-local device for recovery RPCs',()=>{
  assert.match(actorMigration,/recovery\.actor_public_device_id,recovery\.credential_id/);
  assert.doesNotMatch(actorMigration,/recovery_item\.actor_public_device_id\s*=\s*p_actor_device_id/);
  assert.match(edge,/serverActorDeviceId/);assert.match(edge,/recoveryActorDeviceId/);
  assert.match(edge,/data: \{ status: result\.status, credentialId: result\.credentialId \}/);
  assert.doesNotMatch(edge,/data: \{[^}]*serverActorDeviceId/);
  assert.match(edge,/stableRecoveryAction \? null : uuid\(body\.actorDeviceId/);
  assert.doesNotMatch(browser,/SupabaseDeviceIdentity|getOrCreate|actorDeviceId/);
  assert.doesNotMatch(browser,/credentialId:state\.data\.credentialId/);
});
function retryBegin(challenges,now){
  challenges.forEach(challenge=>{if(!challenge.verified&&!challenge.consumed&&!challenge.failed&&challenge.expires<=now){challenge.failed=true;challenge.failureCode='expired_replaced';}});
  if(challenges.some(challenge=>!challenge.verified&&!challenge.consumed&&!challenge.failed&&challenge.expires>now))throw new Error('STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE');
  const fresh={expires:now+120000,verified:false,consumed:false,failed:false,failureCode:null};challenges.push(fresh);return fresh;
}
function canComplete(challenge,now,authorizationConsumed){return !authorizationConsumed&&!challenge.verified&&!challenge.consumed&&!challenge.failed&&challenge.expires>now;}
test('expired browser ceremony is preserved as failed/replaced and retry creates one fresh challenge',()=>{
  const challenges=[{expires:1000,verified:false,consumed:false,failed:false,failureCode:null}];const old=challenges[0];const fresh=retryBegin(challenges,2000);
  assert.equal(challenges.length,2);assert.equal(old.failed,true);assert.equal(old.failureCode,'expired_replaced');assert.equal(fresh.expires,122000);
});
test('retry before challenge expiry is deterministically rejected',()=>{
  const challenges=[{expires:3000,verified:false,consumed:false,failed:false,failureCode:null}];
  assert.throws(()=>retryBegin(challenges,2000),/STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE/);assert.equal(challenges.length,1);
});
test('expired/replaced challenge cannot complete after retry',()=>{
  const challenges=[{expires:1000,verified:false,consumed:false,failed:false,failureCode:null}];const old=challenges[0];const fresh=retryBegin(challenges,2000);
  assert.equal(canComplete(old,2001,false),false);assert.equal(canComplete(fresh,2001,false),true);
});
test('serialized concurrent begins cannot create two unresolved challenges',()=>{
  const challenges=[];retryBegin(challenges,2000);assert.throws(()=>retryBegin(challenges,2000),/STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE/);
  assert.equal(challenges.filter(challenge=>!challenge.verified&&!challenge.consumed&&!challenge.failed).length,1);
});
test('retry migration preserves history and enforces one serialized unresolved challenge',()=>{
  assert.match(retryMigration,/drop constraint if exists stable_device_recovery_challenges_recovery_authorization_id_key/);
  assert.match(retryMigration,/create unique index if not exists stable_device_recovery_one_unresolved_challenge/);
  assert.match(retryMigration,/where verified_at is null and consumed_at is null and failed_at is null/);
  assert.match(retryMigration,/select \* into recovery[\s\S]*for update/);
  assert.match(retryMigration,/failure_code = 'expired_replaced'/);
  assert.match(retryMigration,/STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE/);
  assert.ok(retryMigration.indexOf("failure_code = 'expired_replaced'")<retryMigration.indexOf('insert into platform_private.stable_device_recovery_challenges'));
  assert.doesNotMatch(retryMigration,/delete\s+from\s+platform_private\.stable_device_recovery_challenges/i);
});
test('retry reconciliation preserves exact one-time completion and frozen device boundaries',()=>{
  ['9bce8898-%','f9306733-%','b23ece81-%','p_new_sign_count < credential.sign_count',"item.status='pending'",'set consumed_at=pg_catalog.statement_timestamp() where id=recovery.id'].forEach(value=>assert.ok(migration.includes(value),value));
  assert.doesNotMatch(retryMigration,/update\s+platform\.user_device_authorizations\s+set\s+status/i);
  assert.doesNotMatch(retryMigration,/stable_device_recovery_authorizations\s*\([^)]*owner_user_id/i);
});
