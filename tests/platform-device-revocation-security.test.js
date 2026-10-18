'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync('supabase/migrations/20261018132246_canonical_platform_device_revocation.sql','utf8');
const correction=fs.readFileSync('supabase/migrations/20261018232937_allow_owner_revoke_without_target_key_binding.sql','utf8');
const lifecycle=fs.readFileSync('supabase/migrations/20261019000421_canonical_device_revocation_lifecycle.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-authorization/index.ts','utf8');
const dispatcher=fs.readFileSync('supabase/migrations/20261010201800_flatten_platform_device_operation_dispatcher.sql','utf8');
const sessionGuard=fs.readFileSync('supabase/migrations/20260909120555_production_validated_phase1c_variable_disambiguation.sql','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');

test('revocation reuses the canonical WebAuthn challenge, operation ledger, and audit boundary',()=>{
  assert.match(migration,/SYSTEM_OWNER_DEVICE_REVOKE/);
  assert.match(migration,/revoke_system_owner_device/);
  assert.match(migration,/device_possession_challenge_consumers/);
  assert.match(migration,/system_owner_device_authorization_operations/);
  assert.match(migration,/privileged_device_authorization_audit_log/);
  assert.match(migration,/write_audit_event/);
  assert.match(migration,/OWNER_LAST_APPROVED_DEVICE_REVOCATION_FORBIDDEN/);
  assert.match(migration,/ACTOR_DEVICE_REVOCATION_FORBIDDEN/);
  assert.match(migration,/p_verification_context->'userVerified' is distinct from 'true'/);
  assert.match(edge,/begin-device-revocation/);
  assert.match(edge,/finish-device-revocation/);
  assert.match(edge,/requireUserVerification: true/);
});

test('target key binding is waived only for revoke in both challenge phases',()=>{
  assert.match(correction,/p_purpose='SYSTEM_OWNER_DEVICE_REVOKE' or exists\([\s\S]*platform\.device_key_bindings binding/);
  assert.match(correction,/p_action='revoke' or exists\([\s\S]*platform\.device_key_bindings binding/);
  assert.match(correction,/device_authorization\.status=\(case when p_purpose='SYSTEM_OWNER_DEVICE_REVOKE'[\s\S]*then 'approved' else 'pending' end\)/);
  assert.match(correction,/device_authorization\.status=target_initial_status/);
  assert.match(correction,/ACTOR_DEVICE_REVOCATION_FORBIDDEN/);
  assert.match(correction,/OWNER_LAST_APPROVED_DEVICE_REVOCATION_FORBIDDEN/);
  assert.match(correction,/p_verification_context->'userVerified' is distinct from 'true'/);
});

test('canonical revocation atomically retires target credentials, challenges, sessions, bindings and authorization',()=>{
  assert.match(lifecycle,/else 'device_revoked' end/);
  assert.doesNotMatch(lifecycle,/approved_device_revoked/);
  assert.match(lifecycle,/update public\.device_security_credentials set lifecycle_status='revoked'/);
  assert.match(lifecycle,/update platform_private\.device_session_challenges set failed_at=operation_at/);
  assert.match(lifecycle,/update platform_private\.device_sessions set revoked_at=operation_at/);
  assert.match(lifecycle,/update platform\.device_key_bindings set lifecycle_status='revoked'/);
  assert.match(lifecycle,/update platform\.user_device_authorizations set/);
  assert.match(lifecycle,/insert into public\.system_owner_device_authorization_operations/);
  assert.match(lifecycle,/insert into public\.privileged_device_authorization_audit_log/);
  assert.match(lifecycle,/write_audit_event/);
});

test('privileged mutation RPCs remain server-only and expose no direct authenticated fallback',()=>{
  for(const signature of ['begin_system_owner_device_possession_challenge','complete_system_owner_pending_device_operation','get_system_owner_device_operation_result']){
    assert.match(migration,new RegExp('revoke all on function public\\.'+signature+'[\\s\\S]*?from public,anon,authenticated'));
    assert.match(migration,new RegExp('grant execute on function public\\.'+signature+'[\\s\\S]*?to service_role'));
  }
  assert.doesNotMatch(migration,/grant execute[\s\S]*to (?:anon|authenticated)/i);
  assert.doesNotMatch(edge,/revoke_member_device|list_pending_device_authorizations|approve_pending_device_authorization/);
});

test('stored operation recovery remains exact and cannot turn a committed result into UI failure',()=>{
  const service=fs.readFileSync('js/supabase/device-authorization-administration-service.js','utf8');
  assert.match(migration,/return pg_catalog\.jsonb_build_object\('status','completed','result',stored\.stored_result\)/);
  assert.match(migration,/PLATFORM_DEVICE_OPERATION_MISMATCH/);
  assert.match(service,/if\(recovered\.status==='completed'\)return out\(true,'applied'/);
  assert.match(service,/return out\(false,'unknown'/);
});

test('all protected module entry points reject a revoked authorization on the next request',()=>{
  for(const module of ['platform','conference','reservations','warehouse'])assert.match(dispatcher,new RegExp("p_module not in\\('platform','conference','reservations','warehouse'\\)"));
  assert.match(dispatcher,/join platform\.user_device_authorizations device_auth/);
  assert.match(dispatcher,/device_auth\.status='approved' and device_auth\.revoked_at is null/);
  assert.match(dispatcher,/if not found then raise exception 'DEVICE_SESSION_INVALID'/);
  assert.match(sessionGuard,/uda\.status='approved' and uda\.revoked_at is null/);
});

test('runtime and Service Worker use only the canonical in-app administration assets',()=>{
  const revisions={'js/supabase/device-authorization-administration-service.js':'canonical-owner-session-list-v1','js/sync/user-management-ui.js':'canonical-device-revocation-v1'};
  for(const asset of Object.keys(revisions)){
    assert.ok(index.includes(asset+'?rev='+revisions[asset]));
    assert.ok(worker.includes('./'+asset+'?rev='+revisions[asset]));
  }
  assert.equal(fs.existsSync('platform-device-admin.html'),false);
  assert.equal(fs.existsSync('js/platform-device-admin.js'),false);
});
