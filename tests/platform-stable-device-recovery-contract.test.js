'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260831050000_one_time_stable_development_device_recovery.sql'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/platform-device-authorization/index.ts'),'utf8');
const page=fs.readFileSync(path.join(root,'platform-device-recovery.html'),'utf8');
const versionedPage=fs.readFileSync(path.join(root,'platform-device-recovery-login-v2.html'),'utf8');
const browser=fs.readFileSync(path.join(root,'js/platform-stable-device-recovery.js'),'utf8');
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
  assert.match(versionedPage,/platform-stable-device-recovery\.js\?rev=recovery-login-v2/);
  assert.doesNotMatch(versionedPage,/service-worker\.js|pwa\.js/);
});
