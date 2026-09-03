"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),test=require("node:test"),vm=require("node:vm");
const migration=fs.readFileSync("supabase/migrations/20260903150000_phase1c_server_device_context_reconciliation.sql","utf8");
const dispatcher=fs.readFileSync("supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql","utf8");
const initialHandoff=fs.readFileSync("supabase/migrations/20260902020000_platform_device_ownership_handoff_1a.sql","utf8");
const recoveryHandoff=fs.readFileSync("supabase/migrations/20260903120000_device_key_binding_lost_private_key_rotation.sql","utf8");
const contractSource=fs.readFileSync("js/supabase/conference-device-operation-contract.js","utf8");
const sandbox={window:{}};vm.runInNewContext(contractSource,sandbox);const contract=sandbox.window.ConferenceDeviceOperationContract;
const platformAdmin=new Set(["list_pending_device_authorizations","approve_pending_device_authorization"]);

test("Phase 1C context revalidates every session and canonical authority dimension",()=>{
  for(const fragment of ["session.id=v_session_id","session.user_id=p_user_id","session.device_id=p_device_id",
    "session.device_authorization_id=v_authorization_id","session.binding_id=v_binding_id","session.token_hash=v_token_hash",
    "session.revoked_at is null","session.expires_at>pg_catalog.statement_timestamp()","binding.lifecycle_status='active'",
    "binding.revoked_at is null","binding.retired_at is null","uda.status='approved'",
    "uda.revoked_at is null","device.lifecycle_status='active'","device.retired_at is null",
    "device.compromised_at is null","profile.account_status='approved'"])assert.ok(migration.includes(fragment),fragment);
});

test("custom context alone cannot authorize and the browser fallback remains header-bound",()=>{
  assert.match(migration,/session\.token_hash=v_token_hash/);
  assert.match(migration,/purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH'/);
  assert.match(migration,/platform_private\.current_device_authorization_id\(current_user_id\)/);
  assert.match(migration,/platform_private\.request_device_id\(\) is distinct from p_actor_device_id/);
  assert.match(migration,/public\.user_device_authorizations/);
});

test("dispatcher alone establishes context and denies actor-device overrides",()=>{
  assert.match(migration,/auth\.role\(\) is distinct from 'service_role'/);
  assert.match(migration,/set_config\('platform\.phase1c_context'/);
  assert.match(dispatcher,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.match(dispatcher,/v_session\.device_id/);
  assert.doesNotMatch(migration,/grant execute[^;]+validated_phase1c_device_authorization[^;]+to/i);
});

test("55 guarded and 2 Platform-admin operations retain the 57-operation boundary",()=>{
  assert.equal(contract.EDGE_ONLY_PROTECTED.length,57);
  assert.equal(contract.EDGE_ONLY_PROTECTED.filter(x=>platformAdmin.has(x.operation)).length,2);
  assert.equal(contract.EDGE_ONLY_PROTECTED.filter(x=>!platformAdmin.has(x.operation)).length,55);
  assert.match(migration,/validated_phase1c_device_authorization\(current_user_id,p_actor_device_id\)/);
  assert.match(migration,/validated_phase1c_device_authorization\([\s\S]*p_user_id/);
  assert.match(migration,/grant execute on function platform\.execute_conference_device_operation[^;]+to service_role/i);
  assert.doesNotMatch(migration,/grant execute on function platform\.execute_conference_device_operation[^;]+to (public|anon|authenticated)/i);
});

test("handoff live definitions are generalized without weakening exact-device joins",()=>{
  for(const signature of ["begin_current_device_ownership_handoff(text)","get_current_device_handoff_assertion_claims(uuid,text)",
    "complete_device_ownership_handoff(uuid,uuid,uuid,uuid,text,jsonb,uuid,bytea,timestamptz,timestamptz)",
    "complete_device_binding_recovery(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid,bytea,timestamptz,timestamptz)"])
    assert.ok(migration.includes(signature),signature);
  assert.match(migration,/current_device_authorization_id/);
  assert.match(migration,/challenge\.device_id IS DISTINCT FROM platform_private\.request_device_id/);
  assert.match(initialHandoff,/challenge\.device_id<>p_device_id|challenge\.device_id <> p_device_id/);
  assert.match(recoveryHandoff,/challenge\.replacement_binding_id<>p_replacement_binding_id|challenge\.replacement_binding_id <> p_replacement_binding_id/);
  assert.doesNotMatch(migration,/f9306733-612d-433f-a38e-5d72855c2fe3/i);
});

test("runtime handoff sources are removed and native enrollment contains no device-specific UUID",()=>{
  for(const file of ["server/platform-gateway.cjs","supabase/functions/platform-device-ownership-handoff/index.ts","js/platform-device-ownership-handoff.js"])
    assert.equal(fs.existsSync(file),false,file);
  for(const file of ["supabase/functions/platform-device-enrollment/index.ts","js/supabase/device-enrollment.js"])
    assert.doesNotMatch(fs.readFileSync(file,"utf8"),/f9306733-612d-433f-a38e-5d72855c2fe3/i,file);
});

test("DIRECT EDGE INTERNAL POLICY cardinalities remain 11/57/16/9 with 10 legacy mutation internals",()=>{
  assert.deepEqual([contract.DIRECT_BROWSER_REQUIRED.length,contract.EDGE_ONLY_PROTECTED.length,contract.INTERNAL_ONLY.length,contract.POLICY_HELPER_BROWSER_READ.length],[11,57,16,9]);
  assert.equal(contract.INTERNAL_ONLY.filter(x=>!/device_session|device_ownership_handoff|execute_(?:conference_)?device_operation|require_exact_jsonb_keys/.test(x)).length,10);
});
