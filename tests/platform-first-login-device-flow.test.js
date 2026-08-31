"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync("js/sync/startup-access-gate.js", "utf8");
const integrationSource = fs.readFileSync("js/platform-integration.js", "utf8");

function harness({ authenticated = true, deviceStatus = "registered", accountStatus = "approved", publicDeviceStatus = deviceStatus, publicAccountStatus = "approved", deferAdoption = false, managedOrigin = true } = {}) {
  const ids = ["startupAccessGate", "applicationTopbar", "applicationBody", "startupScreen", "globalConferenceHeader", "device_authorization_administration_root", "tab0", "tab1", "tab2", "tab3", "tab4", "tab5", "tab6"];
  const nodes = Object.fromEntries(ids.map((id) => [id, { style: {}, innerHTML: "" }]));
  const order = [];
  const queued = [];
  let authListener = null;
  let authenticatedState = authenticated;
  let adoptionCount = 0;
  let requestCount = 0;
  let deviceRpcCount = 0;
  let systemAccessReads = 0;
  let localFallbackReads = 0;
  let currentDeviceStatus = publicDeviceStatus;
  let releaseAdoption;
  const adoptionWait = deferAdoption ? new Promise((resolve) => { releaseAdoption = resolve; }) : Promise.resolve();
  const window = {
    document: {
      visibilityState: "visible",
      getElementById: (id) => nodes[id] || null,
      addEventListener: () => {},
    },
    setTimeout: (fn) => { queued.push(fn); return queued.length; },
    clearTimeout: () => {},
    SupabaseAuth: {
      initialize: async () => { order.push("auth_initialized"); },
      getState: () => ({ authenticated: authenticatedState }),
      getAccountIdentity: () => ({ authenticated: authenticatedState }),
    },
    SupabaseClientLayer: {
      getClient: () => ({ auth: { onAuthStateChange: (listener) => { authListener = listener; return { data: { subscription: {} } }; } } }),
    },
    PlatformIntegration: {
      awaitAuthorizationReady: async () => {
        adoptionCount += 1;
        order.push("platform_adopting");
        await adoptionWait;
        order.push("platform_ready");
        return { ready: true, platform: true };
      },
      recordCanonicalState: (state) => order.push("state:" + state),
      isManagedOrigin: () => managedOrigin,
      getContext: () => managedOrigin ? { accountStatus, deviceStatus, deviceId: "11111111-1111-4111-8111-111111111111" } : null,
      getDeviceIdentity: () => ({ id: "11111111-1111-4111-8111-111111111111", deviceName: "Integrated Platform browser", platform: "MacIntel" }),
    },
    FirstSystemBootstrapService: { getStatus: async () => ({ ok: true, status: "completed" }) },
    SystemAccessService: {
      initialize: async () => { systemAccessReads += 1; order.push("account_initialize"); },
      refresh: async () => { systemAccessReads += 1; order.push("account_approved"); },
      getState: () => ({ accountStatus: publicAccountStatus, fresh: true }),
    },
    CurrentDeviceAuthorizationUI: {
      initialize: async () => { deviceRpcCount += 1; order.push("device_read:" + currentDeviceStatus); },
      ensurePendingAuthorization: async () => {
        requestCount += 1;
        order.push("authorization_request");
        currentDeviceStatus = "pending";
        order.push("device_pending");
        return { ok: true, status: "pending" };
      },
      getState: () => ({ status: currentDeviceStatus }),
    },
    SupabaseDeviceIdentity: { getOrCreate: () => { localFallbackReads += 1; return { id: "22222222-2222-4222-8222-222222222222", platform: "MacIntel" }; } },
    AccessDiagnosticsUI: { render: () => "" },
    CurrentDeviceAuthorizationService: { getLastDiagnostic: () => ({}) },
    SyncSettingsUI: { signOut: () => {} },
  };
  window.window = window;
  vm.runInNewContext(source, { window, Promise, Date, String, Array, Object, setTimeout: window.setTimeout });
  return {
    window, nodes, order,
    run: () => window.StartupAccessGate.run({ completeApplicationStartup: async () => { nodes.applicationBody.style.display = "block"; order.push("application_allowed"); } }),
    signalSignedIn: () => authListener && authListener("SIGNED_IN", { user: { id: "33333333-3333-4333-8333-333333333333" } }),
    signalSignedOut: () => { authenticatedState = false; if (authListener) authListener("SIGNED_OUT", null); },
    drainSignals: () => { while (queued.length) queued.shift()(); },
    releaseAdoption: () => releaseAdoption && releaseAdoption(),
    counts: () => ({ adoptionCount, requestCount, deviceRpcCount, localFallbackReads, systemAccessReads }),
  };
}

test("managed first-login flow serializes adoption and uses Platform pending state without Conference device work", async () => {
  const flow = harness({ deferAdoption: true, deviceStatus: "pending" });
  const run = flow.run();
  await Promise.resolve();await Promise.resolve();
  flow.signalSignedIn();flow.signalSignedIn();flow.drainSignals();
  assert.deepEqual(flow.counts(), { adoptionCount: 1, requestCount: 0, deviceRpcCount: 0, localFallbackReads: 0, systemAccessReads: 0 });
  flow.releaseAdoption();
  const result = await run;
  assert.equal(result.status, "device");
  assert.deepEqual(flow.counts(), { adoptionCount: 1, requestCount: 0, deviceRpcCount: 0, localFallbackReads: 0, systemAccessReads: 0 });
  assert.equal(flow.window.StartupAccessGate.getState().canonicalState, "DEVICE_PENDING");
  assert.equal(flow.window.StartupAccessGate.getState().canonicalState === "DEVICE_APPROVED", false);
  assert.ok(flow.nodes.startupAccessGate.innerHTML.includes("Integrated Platform browser"));
});

test("logout returns to unauthenticated login without device work", async () => {
  const flow = harness({ deviceStatus: "approved" });
  assert.equal((await flow.run()).status, "allowed");
  flow.signalSignedOut();
  flow.drainSignals();
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(flow.window.StartupAccessGate.getState().canonicalState, "UNAUTHENTICATED");
  assert.equal(flow.nodes.startupAccessGate.innerHTML.includes("Device ID"), false);
  assert.deepEqual(flow.counts(), { adoptionCount: 1, requestCount: 0, deviceRpcCount: 0, localFallbackReads: 0, systemAccessReads: 0 });
});

test("legacy origin retains local identity rendering and frontend state excludes device secret", async () => {
  const legacy = harness({ deviceStatus: "pending", managedOrigin: false });
  assert.equal((await legacy.run()).status, "device");
  assert.equal(legacy.counts().localFallbackReads, 1);
  assert.equal(legacy.counts().deviceRpcCount, 1);
  assert.equal(legacy.counts().systemAccessReads, 2);
  assert.ok(legacy.nodes.startupAccessGate.innerHTML.includes("MacIntel"));
  assert.equal(/deviceSecret|device_secret/.test(integrationSource), false);
});

test("unauthenticated startup never adopts, calls device RPC, or renders a device gate", async () => {
  const flow = harness({ authenticated: false });
  const result = await flow.run();
  assert.equal(result.status, "auth");
  assert.equal(flow.window.StartupAccessGate.getState().canonicalState, "UNAUTHENTICATED");
  assert.deepEqual(flow.counts(), { adoptionCount: 0, requestCount: 0, deviceRpcCount: 0, localFallbackReads: 0, systemAccessReads: 0 });
  assert.equal(flow.nodes.startupAccessGate.innerHTML.includes("Device ID"), false);
});

test("Platform approved overrides Conference pending; revoked remains blocked", async () => {
  const approved = harness({ deviceStatus: "approved", publicDeviceStatus: "pending", publicAccountStatus: "pending" });
  assert.equal((await approved.run()).status, "allowed");
  assert.equal(approved.window.StartupAccessGate.getState().canonicalState, "DEVICE_APPROVED");
  assert.deepEqual(approved.counts(), { adoptionCount: 1, requestCount: 0, deviceRpcCount: 0, localFallbackReads: 0, systemAccessReads: 0 });

  const revoked = harness({ deviceStatus: "revoked" });
  assert.equal((await revoked.run()).status, "device");
  assert.equal(revoked.window.StartupAccessGate.getState().canonicalState, "DEVICE_REVOKED");
  assert.deepEqual(revoked.counts(), { adoptionCount: 1, requestCount: 0, deviceRpcCount: 0, localFallbackReads: 0, systemAccessReads: 0 });
});

test("Platform pending and account-not-approved states remain blocked", async () => {
  const pending = harness({ deviceStatus: "pending" });
  assert.equal((await pending.run()).status, "device");
  assert.equal(pending.window.StartupAccessGate.getState().canonicalState, "DEVICE_PENDING");

  const accountPending = harness({ deviceStatus: "approved", accountStatus: "pending" });
  assert.equal((await accountPending.run()).status, "pending");
  assert.equal(accountPending.window.StartupAccessGate.getState().canonicalState, "ACCOUNT_NOT_APPROVED");
  assert.equal(accountPending.counts().deviceRpcCount, 0);
});
