'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync('supabase/migrations/20261018132246_canonical_platform_device_revocation.sql','utf8');
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

test('privileged mutation RPCs remain server-only and expose no direct authenticated fallback',()=>{
  for(const signature of ['begin_system_owner_device_possession_challenge','complete_system_owner_pending_device_operation','get_system_owner_device_operation_result']){
    assert.match(migration,new RegExp('revoke all on function public\\.'+signature+'[\\s\\S]*?from public,anon,authenticated'));
    assert.match(migration,new RegExp('grant execute on function public\\.'+signature+'[\\s\\S]*?to service_role'));
  }
  assert.doesNotMatch(migration,/grant execute[\s\S]*to (?:anon|authenticated)/i);
  assert.doesNotMatch(edge,/revoke_member_device|list_pending_device_authorizations|approve_pending_device_authorization/);
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
