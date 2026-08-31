"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const { createApiHandler, createGatewayHandler } = require("../server/platform-gateway.cjs");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test("Platform context uses server-managed device credentials and the Platform access RPC", async () => {
  const device = { id: "11111111-1111-4111-8111-111111111111", secret: "s".repeat(43) };
  const calls = [];
  const supabaseFor = (request, response, suppliedDevice) => {
    assert.deepEqual(suppliedDevice, device);
    return {
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "owner@example.test" } } }) },
      schema: (name) => {
        calls.push({ type: "schema", name });
        return { rpc: async (rpcName, args) => {
          calls.push({ type: "rpc", rpcName, args });
          return { data: { accountStatus: "approved", deviceStatus: "approved" }, error: null };
        } };
      },
      rpc: async (rpcName, args) => {
        calls.push({ type: "module", rpcName, args });
        return { error: { code: "DENIED" } };
      },
    };
  };
  const handleApi = createApiHandler({ supabaseFor, getDevice: () => device });
  const server = await listen(createGatewayHandler({ handleApi }));
  try {
    const response = await fetch(`${origin(server)}/api/platform/context`, { headers: { cookie: "browser-visible=value" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.accountStatus, "approved");
    assert.equal(body.deviceStatus, "approved");
    assert.equal(body.deviceId, device.id);
    assert.equal(JSON.stringify(body).includes(device.secret), false);
    assert.deepEqual(calls.slice(0, 2), [
      { type: "schema", name: "platform" },
      { type: "rpc", rpcName: "get_my_access_context", args: { p_domain: "platform", p_scope_type: "platform", p_scope_id: null } },
    ]);
    assert.equal(calls.some((call) => call.rpcName === "get_my_device_authorization"), false);
  } finally {
    await close(server);
  }
});

async function adoptionScenario({ currentSession, firstError = null, deviceError = null, registrationError = null } = {}) {
  const supplied = { accessToken: "original-access", refreshToken: "original-refresh" };
  const calls = [];
  let signOuts = 0;
  let commits = 0;
  let registrationCalls = 0;
  let clientNumber = 0;
  const supabaseFor = (request, response, device, writeCookies) => {
    const number = ++clientNumber;
    return {
      auth: {
        setSession: async (tokens) => {
          calls.push({ number, tokens });
          writeCookies([{ name: `sb-session-${number}`, value: `session-${number}`, options: { httpOnly: true } }]);
          if (number === 1) return firstError
            ? { error: firstError, data: { user: null, session: null } }
            : { error: null, data: { user: { id: "user-1" }, session: currentSession } };
          return deviceError
            ? { error: deviceError, data: { user: null, session: null } }
            : { error: null, data: { user: { id: "user-1" }, session: currentSession } };
        },
        signOut: async () => { signOuts += 1; },
      },
      schema: (name) => {
        assert.equal(name, "platform");
        return { rpc: async (rpcName) => {
          registrationCalls += 1;
          assert.equal(rpcName, "register_current_device");
          return { error: registrationError };
        } };
      },
    };
  };
  const handleApi = createApiHandler({
    supabaseFor,
    getDevice: () => null,
    createDevice: () => ({ id: "11111111-1111-4111-8111-111111111111", secret: "x".repeat(43) }),
    commitDevice: (response, device) => {
      commits += 1;
      const current = response.getHeader("set-cookie") || [];
      response.setHeader("set-cookie", [...current, `platform-device-id=${device.id}; HttpOnly`]);
    },
  });
  const server = await listen(createGatewayHandler({ handleApi }));
  try {
    const response = await fetch(`${origin(server)}/api/platform/session/adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(supplied),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookies: response.headers.get("set-cookie"),
      calls,
      signOuts,
      commits,
      registrationCalls,
      supplied,
    };
  } finally {
    await close(server);
  }
}

test("session adoption uses the current successful session for device registration", async () => {
  for (const currentSession of [
    { access_token: "original-access", refresh_token: "original-refresh" },
    { access_token: "refreshed-access", refresh_token: "refreshed-refresh" },
  ]) {
    const result = await adoptionScenario({ currentSession });
    assert.equal(result.status, 200);
    assert.equal(result.body.authenticated, true);
    assert.deepEqual(result.calls[0].tokens, { access_token: result.supplied.accessToken, refresh_token: result.supplied.refreshToken });
    assert.deepEqual(result.calls[1].tokens, currentSession);
    if (currentSession.refresh_token !== result.supplied.refreshToken)
      assert.equal(result.calls.slice(1).some((call) => call.tokens.refresh_token === result.supplied.refreshToken), false);
    assert.equal(result.registrationCalls, 1);
    assert.equal(result.commits, 1);
    assert.match(result.cookies, /sb-session-1=session-1/);
    assert.match(result.cookies, /sb-session-2=session-2/);
    assert.match(result.cookies, /platform-device-id=/);
  }
});

test("invalid adoption is authentication-classified and never reaches registration", async () => {
  const result = await adoptionScenario({ firstError: { message: "sensitive token original-refresh" } });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { error: "PLATFORM_SESSION_INVALID", category: "authentication" });
  assert.equal(result.registrationCalls, 0);
  assert.equal(result.signOuts, 0);
  assert.equal(result.cookies, null);
  assert.doesNotMatch(JSON.stringify(result.body), /original-refresh|sensitive token/);
});

test("device authentication failure does not register or retain partial Platform state", async () => {
  const result = await adoptionScenario({
    currentSession: { access_token: "refreshed-access", refresh_token: "refreshed-refresh" },
    deviceError: { message: "sensitive device auth error" },
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.category, "authentication");
  assert.equal(result.registrationCalls, 0);
  assert.equal(result.signOuts, 0);
  assert.equal(result.commits, 0);
  assert.equal(result.cookies, null);
});

test("device registration failure is device-classified without global signout or partial cookies", async () => {
  const result = await adoptionScenario({
    currentSession: { access_token: "refreshed-access", refresh_token: "refreshed-refresh" },
    registrationError: { message: "sensitive device secret xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  });
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "PLATFORM_DEVICE_REGISTRATION_FAILED", category: "device" });
  assert.equal(result.registrationCalls, 1);
  assert.equal(result.signOuts, 0);
  assert.equal(result.commits, 0);
  assert.equal(result.cookies, null);
  assert.doesNotMatch(JSON.stringify(result.body), /sensitive|xxxxxxxx/);
});

test("Platform integration exposes only allowlisted adoption failure metadata", async () => {
  const source = fs.readFileSync("js/platform-integration.js", "utf8");
  const window = {
    fetch: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "PLATFORM_DEVICE_REGISTRATION_FAILED", category: "device", secret: "must-not-propagate" }),
    }),
    SupabaseAuth: { getSession: () => ({ access_token: "access", refresh_token: "refresh" }) },
  };
  vm.runInNewContext(source, { window, Promise, JSON, Object, String, Array, Error });
  await assert.rejects(window.PlatformIntegration.synchronizeSession(), (error) => {
    assert.equal(error.code, "PLATFORM_DEVICE_REGISTRATION_FAILED");
    assert.equal(error.category, "device");
    assert.equal(error.status, 403);
    assert.equal(error.secret, undefined);
    return true;
  });
});

test("successful adoption hydrates the Platform identity before context refresh fallback", async () => {
  const integrationSource = fs.readFileSync("js/platform-integration.js", "utf8");
  const identitySource = fs.readFileSync("js/supabase/device-identity.js", "utf8");
  const platformDeviceId = "11111111-1111-4111-8111-111111111111";
  const localDeviceId = "22222222-2222-4222-8222-222222222222";
  let requestNumber = 0;
  const storage = new Map([["device-identity:33333333-3333-4333-8333-333333333333", JSON.stringify({
    id: localDeviceId, deviceName: "", platform: "MacIntel", createdAt: "earlier",
  })]]);
  const window = {
    navigator: { platform: "MacIntel" },
    fetch: async () => {
      requestNumber += 1;
      if (requestNumber === 1) return {
        ok: true, status: 200,
        json: async () => ({ authenticated: true, deviceId: platformDeviceId, deviceSecret: "must-not-enter-frontend-state" }),
      };
      throw new Error("context unavailable");
    },
    SupabaseAuth: { getSession: () => ({ access_token: "access", refresh_token: "refresh", user: { id: "33333333-3333-4333-8333-333333333333" } }) },
    BrowserStorageNamespace: { key: (value) => value },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => localDeviceId },
  };
  window.window = window;
  const sandbox = { window, Promise, JSON, Object, String, Array, Error, Date, Uint8Array };
  vm.runInNewContext(integrationSource, sandbox);
  vm.runInNewContext(identitySource, sandbox);
  await window.PlatformIntegration.synchronizeSession();
  const platformIdentity = window.PlatformIntegration.getDeviceIdentity();
  const selectedIdentity = window.SupabaseDeviceIdentity.getOrCreate();
  assert.equal(platformIdentity.id, platformDeviceId);
  assert.equal(platformIdentity.deviceName, "Integrated Platform browser");
  assert.equal(selectedIdentity.id, platformDeviceId);
  assert.notEqual(selectedIdentity.id, localDeviceId);
  assert.equal(JSON.stringify(platformIdentity).includes("must-not-enter-frontend-state"), false);
  assert.equal(window.PlatformIntegration.getContext(), null);
  const diagnostic = window.PlatformIntegration.getSafeDiagnostic();
  assert.equal(diagnostic.platformAdoptionSucceeded, true);
  assert.equal(diagnostic.adoptionDeviceIdPrefix, platformDeviceId.slice(0, 8));
  assert.equal(diagnostic.activeIdentitySource, "platform_adoption");
  assert.equal(diagnostic.adoptionRequestCount, 1);
  assert.equal(JSON.stringify(diagnostic).includes("must-not-enter-frontend-state"), false);
});

test("authorization readiness deduplicates adoption and blocks fallback resolution", async () => {
  const integrationSource = fs.readFileSync("js/platform-integration.js", "utf8");
  const identitySource = fs.readFileSync("js/supabase/device-identity.js", "utf8");
  const serviceSource = fs.readFileSync("js/supabase/current-device-authorization-service.js", "utf8");
  const userId = "33333333-3333-4333-8333-333333333333";
  const platformDeviceId = "11111111-1111-4111-8111-111111111111";
  const localDeviceId = "22222222-2222-4222-8222-222222222222";
  let adoptionResolve, adoptionRequests = 0, identityReads = 0;
  const rpcCalls = [];
  const session = { access_token: "access-secret", refresh_token: "refresh-secret", user: { id: userId } };
  const storage = new Map([["device-identity:" + userId, JSON.stringify({ id: localDeviceId, deviceName: "", platform: "MacIntel", createdAt: "earlier" })]]);
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const window = {
    navigator: { platform: "MacIntel" },
    fetch: async (path, options) => {
      if (path === "/api/platform/session/adopt") {
        adoptionRequests += 1;
        return new Promise((resolve) => { adoptionResolve = () => resolve(response({ authenticated: true, deviceId: platformDeviceId })); });
      }
      return response({ configured: true, authenticated: true, deviceId: adoptionRequests ? platformDeviceId : undefined, modules: [] });
    },
    SupabaseAuth: { getSession: () => session },
    BrowserStorageNamespace: { key: (value) => value },
    localStorage: { getItem: (key) => { identityReads += 1; return storage.get(key) || null; }, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => localDeviceId },
    OrganizationAdministrationUtils: { isUuid: (value) => /^[0-9a-f-]{36}$/i.test(String(value || "")) },
    SupabaseClientLayer: { getClient: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: { accountStatus: "approved", deviceAuthorizationStatus: "registered" }, error: null }; } }) },
    SystemAccessService: { getState: () => ({ accountStatus: "approved" }) },
  };
  window.window = window;
  const sandbox = { window, Promise, JSON, Object, String, Array, Error, Date, Number, Uint8Array };
  vm.runInNewContext(integrationSource, sandbox);
  vm.runInNewContext(identitySource, sandbox);
  vm.runInNewContext(serviceSource, sandbox);
  await window.PlatformIntegration.initialize();
  identityReads = 0;
  const first = window.CurrentDeviceAuthorizationService.getStatus();
  const second = window.CurrentDeviceAuthorizationService.getDeviceAwareAccess();
  await Promise.resolve();await Promise.resolve();
  assert.equal(adoptionRequests, 1);
  assert.equal(identityReads, 0);
  assert.equal(rpcCalls.length, 0);
  adoptionResolve();
  await Promise.all([first, second]);
  assert.equal(adoptionRequests, 1);
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0].args.p_device_id, platformDeviceId);
  assert.equal(rpcCalls[1].args.p_device_id, platformDeviceId);
  const diagnostic = window.PlatformIntegration.getSafeDiagnostic();
  assert.equal(diagnostic.resolverDeviceIdPrefix, platformDeviceId.slice(0, 8));
  assert.equal(diagnostic.rpcDeviceIdPrefix, platformDeviceId.slice(0, 8));
  assert.equal(diagnostic.platformReadyAtResolution, true);
  assert.equal(diagnostic.activeIdentitySource, "platform_adoption");
  assert.doesNotMatch(JSON.stringify(diagnostic), /access-secret|refresh-secret|MacIntel/);
});

test("conflicting context identity is diagnosed and never replaces adoption identity", async () => {
  const source = fs.readFileSync("js/platform-integration.js", "utf8");
  const adoptionId = "11111111-1111-4111-8111-111111111111";
  const contextId = "22222222-2222-4222-8222-222222222222";
  let contextCalls = 0;
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const window = {
    navigator: { platform: "MacIntel" },
    SupabaseAuth: { getSession: () => ({ access_token: "access", refresh_token: "refresh", user: { id: "33333333-3333-4333-8333-333333333333" } }) },
    fetch: async (path) => {
      if (path === "/api/platform/session/adopt") return response({ authenticated: true, deviceId: adoptionId });
      contextCalls += 1;
      return response(contextCalls === 1 ? { configured: true, authenticated: false, modules: [] } : { configured: true, authenticated: true, deviceId: contextId, modules: [] });
    },
  };
  window.window = window;
  vm.runInNewContext(source, { window, Promise, JSON, Object, String, Array, Error });
  await window.PlatformIntegration.initialize();
  await assert.rejects(window.PlatformIntegration.awaitAuthorizationReady(), (error) => error.code === "PLATFORM_DEVICE_IDENTITY_MISMATCH");
  assert.equal(window.PlatformIntegration.getDeviceIdentity().id, adoptionId);
  const diagnostic = window.PlatformIntegration.getSafeDiagnostic();
  assert.equal(diagnostic.platformAdoptionSucceeded, true);
  assert.equal(diagnostic.platformIdentityMismatch, true);
  assert.equal(diagnostic.adoptionDeviceIdPrefix, adoptionId.slice(0, 8));
  assert.equal(diagnostic.contextDeviceIdPrefix, contextId.slice(0, 8));
});

test("legacy origin readiness preserves browser-local fallback", async () => {
  const integrationSource = fs.readFileSync("js/platform-integration.js", "utf8");
  const identitySource = fs.readFileSync("js/supabase/device-identity.js", "utf8");
  const userId = "33333333-3333-4333-8333-333333333333";
  const localDeviceId = "22222222-2222-4222-8222-222222222222";
  const window = {
    fetch: async () => ({ ok: false, status: 404, json: async () => null }),
    SupabaseAuth: { getSession: () => ({ user: { id: userId } }) },
    BrowserStorageNamespace: { key: (value) => value },
    localStorage: { getItem: (key) => key === "device-identity:" + userId ? JSON.stringify({ id: localDeviceId, deviceName: "Legacy", platform: "MacIntel" }) : null, setItem: () => {} },
  };
  window.window = window;
  const sandbox = { window, Promise, JSON, Object, String, Array, Error, Date, Uint8Array };
  vm.runInNewContext(integrationSource, sandbox);
  vm.runInNewContext(identitySource, sandbox);
  const readiness = await window.PlatformIntegration.awaitAuthorizationReady();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.platform, false);
  assert.equal(window.SupabaseDeviceIdentity.getOrCreate().id, localDeviceId);
});

function startupScenario(adoptionResult) {
  const source = fs.readFileSync("js/sync/startup-access-gate.js", "utf8");
  const ids = ["startupAccessGate", "applicationTopbar", "applicationBody", "startupScreen", "globalConferenceHeader", "device_authorization_administration_root", "tab0", "tab1", "tab2", "tab3", "tab4", "tab5", "tab6"];
  const nodes = Object.fromEntries(ids.map((id) => [id, { style: {}, innerHTML: "" }]));
  let startupCalls = 0;
  let bootstrapCalls = 0;
  let pollingCalls = 0;
  const window = {
    document: { getElementById: (id) => nodes[id] },
    setTimeout: () => { pollingCalls += 1; return 1; },
    clearTimeout: () => {},
    SupabaseAuth: { initialize: async () => {}, getState: () => ({ authenticated: true }) },
    SupabaseClientLayer: { getClient: () => null },
    PlatformIntegration: { awaitAuthorizationReady: () => adoptionResult(), recordCanonicalState: () => {} },
    FirstSystemBootstrapService: { getStatus: async () => { bootstrapCalls += 1; return { ok: true, status: "completed" }; } },
    SystemAccessService: { initialize: async () => {}, refresh: async () => {}, getState: () => ({ accountStatus: "approved", fresh: true }) },
    SupabaseDeviceIdentity: { getOrCreate: () => ({ id: "22222222-2222-4222-8222-222222222222", deviceName: "Browser" }) },
    CurrentDeviceAuthorizationUI: { initialize: async () => {}, refresh: async () => {}, getState: () => ({ status: "approved" }) },
    SyncSettingsUI: {},
  };
  vm.runInNewContext(source, { window, Promise, Date, String, Array, Object, setTimeout: window.setTimeout });
  return window.StartupAccessGate.run({ completeApplicationStartup: async () => { startupCalls += 1; nodes.applicationBody.style.display = "block"; } })
    .then((result) => ({ result, nodes, startupCalls, bootstrapCalls, pollingCalls, state: window.StartupAccessGate.getState() }));
}

test("startup maps adoption authentication, device, unexpected, and valid results safely", async () => {
  const authentication = await startupScenario(() => Promise.reject(Object.assign(new Error("invalid"), { status: 401, category: "authentication" })));
  assert.equal(authentication.result.status, "auth");
  assert.match(authentication.nodes.startupAccessGate.innerHTML, /sync_auth_email/);
  assert.equal(authentication.bootstrapCalls, 0);

  const device = await startupScenario(() => Promise.reject(Object.assign(new Error("device"), { status: 403, category: "device" })));
  assert.equal(device.result.status, "device_error");
  assert.match(device.nodes.startupAccessGate.innerHTML, /Browser/);
  assert.equal(device.bootstrapCalls, 0);
  assert.equal(device.pollingCalls, 0);

  const unexpected = await startupScenario(() => Promise.reject(new Error("runtime")));
  assert.equal(unexpected.result.status, "denied");
  assert.equal(unexpected.bootstrapCalls, 0);

  const valid = await startupScenario(() => Promise.resolve({ authenticated: true }));
  assert.equal(valid.result.status, "allowed");
  assert.equal(valid.bootstrapCalls, 1);
  assert.equal(valid.startupCalls, 1);
  assert.equal(valid.state.allowed, true);
});
