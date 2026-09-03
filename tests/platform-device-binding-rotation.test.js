"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { createApiHandler, issueHandoffAssertion } = require("../server/platform-gateway.cjs");

const DEVICE = "f9306733-612d-433f-a38e-5d72855c2fe3";
const USER = "916c0d83-4c5a-4a9e-89bb-4faa671166f7";
const AUTHORIZATION = "11111111-1111-4111-8111-111111111111";
const CHALLENGE = "22222222-2222-4222-8222-222222222222";
const REPLACEMENT = "33333333-3333-4333-8333-333333333333";
const THUMBPRINT = "a".repeat(64);
const migration = fs.readFileSync("supabase/migrations/20260903120000_device_key_binding_lost_private_key_rotation.sql", "utf8");
const browser = fs.readFileSync("js/platform-device-ownership-handoff.js", "utf8");
const edge = fs.readFileSync("supabase/functions/platform-device-ownership-handoff/index.ts", "utf8");

function responsePromise() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const response = { headers: {}, getHeader(name) { return this.headers[name]; }, setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers || {}); return this; },
    end(body) { resolve({ status: this.status, headers: this.headers, body }); } };
  return { response, promise };
}

test("normal initial handoff remains one-time while recovery requires and captures the exact active binding", () => {
  assert.match(migration, /if v_mode='initial'[\s\S]*DEVICE_HANDOFF_BINDING_ALREADY_ACTIVE/);
  assert.match(migration, /v_mode='binding_recovery'/);
  assert.match(migration, /select binding\.id into strict v_replacement_binding[\s\S]*lifecycle_status='active'/);
  assert.match(migration, /DEVICE_HANDOFF_ACTIVE_BINDING_REQUIRED/);
  assert.match(migration, /replacement_binding_id<>p_replacement_binding_id/);
  assert.match(migration, /DEVICE_HANDOFF_REPLACEMENT_STALE/);
});

test("recovery finalization revalidates every authority dimension and rotates before inserting", () => {
  for (const fragment of ["binding.user_id=p_user_id", "binding.device_id=p_device_id",
    "binding.device_authorization_id=p_authorization_id", "device_authorization.status='approved'",
    "device_authorization.revoked_at is null", "device.lifecycle_status='active'", "profile.account_status='approved'"])
    assert.ok(migration.includes(fragment), fragment);
  const rotation = migration.indexOf("set lifecycle_status='rotated',rotated_at=v_now");
  const insertion = migration.indexOf("'ECDSA_P256_SHA256','active','bound_key_rotation'");
  assert.ok(rotation >= 0 && insertion > rotation);
  assert.match(migration, /set replaced_by_binding_id=v_binding/);
  assert.match(migration, /device_key_binding\.rotated/);
  assert.match(migration, /device_key_binding\.recovery_activated/);
  assert.doesNotMatch(migration, /drop\s+index\s+[^;]*device_key_bindings_one_active_device_idx/i);
});

test("recovery assertion binds mode, replacement binding, reason, and new-key possession", () => {
  const old = { ...process.env };
  process.env.PLATFORM_HANDOFF_ASSERTION_SECRET = "s".repeat(32);
  process.env.PLATFORM_HANDOFF_ASSERTION_ISSUER = "development-migration-bridge";
  process.env.PLATFORM_HANDOFF_ASSERTION_AUDIENCE = "development-edge-handoff";
  try {
    const jwt = issueHandoffAssertion({ userId: USER, deviceId: DEVICE, authorizationId: AUTHORIZATION,
      publicKeyThumbprint: THUMBPRINT, challengeId: CHALLENGE, signingPayload: "recovery",
      handoffMode: "binding_recovery", replacementBindingId: REPLACEMENT, recoveryReason: "lost_private_key" });
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url"));
    assert.equal(claims.handoff_mode, "binding_recovery");
    assert.equal(claims.replacement_binding_id, REPLACEMENT);
    assert.equal(claims.recovery_reason, "lost_private_key");
    assert.match(edge, /body\.action === 'finalize-recovery'/);
    assert.match(edge, /NEW_KEY_POSSESSION_INVALID/);
    assert.match(edge, /complete_device_binding_recovery/);
  } finally { process.env = old; }
});

test("trusted-cookie bridge starts only the explicit recovery request and returns its captured binding", async () => {
  const calls = [];
  const claims = { userId: USER, deviceId: DEVICE, authorizationId: AUTHORIZATION, challengeId: CHALLENGE,
    publicKeyThumbprint: THUMBPRINT, signingPayload: "recovery", handoffMode: "binding_recovery",
    replacementBindingId: REPLACEMENT, recoveryReason: "lost_private_key" };
  const supabase = { schema: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: claims, error: null }; } }) };
  const old = { ...process.env };
  process.env.PLATFORM_HANDOFF_ASSERTION_SECRET = "s".repeat(32);
  process.env.PLATFORM_HANDOFF_ASSERTION_ISSUER = "development-migration-bridge";
  process.env.PLATFORM_HANDOFF_ASSERTION_AUDIENCE = "development-edge-handoff";
  try {
    const api = createApiHandler({ platformAdministrationClient: async () => ({ device: { id: DEVICE }, supabase, user: { id: USER } }) });
    const target = responsePromise();
    await api({ method: "GET", url: `/api/platform/device-ownership-handoff/authorize?thumbprint=${THUMBPRINT}&mode=binding_recovery&reason=lost_private_key`, headers: { host: "test" } }, target.response, "/api/platform/device-ownership-handoff/authorize");
    const result = await target.promise;
    assert.equal(result.status, 302);
    assert.match(result.headers.location, /\?mode=binding_recovery#handoff=/);
    assert.deepEqual(calls, [{ name: "begin_current_device_ownership_handoff", args: { p_public_key_thumbprint: `recovery:lost_private_key:${THUMBPRINT}` } }]);
  } finally { process.env = old; }
});

test("recovery pending key never overwrites the active slot and failure deletes only pending state", () => {
  assert.match(browser, /ACTIVE_RECORD='f930-active',RECOVERY_RECORD='f930-recovery-pending'/);
  assert.match(browser, /target=recovery\?RECOVERY_RECORD:ACTIVE_RECORD/);
  assert.match(browser, /state:recovery\?'recovery_pending':'handoff_pending'/);
  assert.match(browser, /store\.put\(value,ACTIVE_RECORD\);store\.delete\(RECOVERY_RECORD\)/);
  assert.match(browser, /isRecovery\?removeAt\(RECOVERY_RECORD\):Promise\.resolve\(\)/);
  assert.match(browser, /generateKey\(\{name:'ECDSA',namedCurve:'P-256'\},false/);
  assert.match(browser, /bindingId:result\.data\.bindingId,state:'active'/);
});

test("startup exposes an explicit recovery action only for the missing bound private key", () => {
  const startup = fs.readFileSync("js/sync/startup-access-gate.js", "utf8");
  assert.match(startup, /error\.message==='BOUND_PRIVATE_KEY_REQUIRED'/);
  assert.match(startup, /show\('binding_recovery'\)/);
  assert.match(startup, /إعادة ربط مفتاح هذا الجهاز/);
  assert.match(startup, /platform-device-ownership-handoff\.html\?mode=binding_recovery/);
  assert.doesNotMatch(startup, /BOUND_PRIVATE_KEY_REQUIRED[^\n]*recoverDeviceBinding\(\)/);
});

test("Phase 1C operation contract remains 57 and recovery does not restore protected direct grants", () => {
  const contractSource = fs.readFileSync("js/supabase/conference-device-operation-contract.js", "utf8");
  const sandbox = { window: {} }; vm.runInNewContext(contractSource, sandbox);
  assert.equal(sandbox.window.ConferenceDeviceOperationContract.EDGE_ONLY_PROTECTED.length, 57);
  assert.doesNotMatch(migration, /grant execute on function (public|platform)\.(create_conference|update_conference|delete_conference)/i);
  assert.match(migration, /grant execute on function platform\.complete_device_binding_recovery[^;]+to service_role/);
  assert.doesNotMatch(migration, /grant execute on function platform\.complete_device_binding_recovery[^;]+to (anon|authenticated)/);
});
