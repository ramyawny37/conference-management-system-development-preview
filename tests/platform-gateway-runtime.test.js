"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  createGatewayHandler,
  createApiHandler,
  moduleAccessFor,
  issueDevice,
} = require("../server/platform-gateway.cjs");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function origin(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function context(authenticated, available = []) {
  return async () => ({
    authenticated,
    modules: ["conference", "warehouse", "reservations", "custody"].map((id) => ({ id, available: available.includes(id) })),
  });
}

test("local shell, Conference route, static asset, context, adoption, and logout contracts", async () => {
  const handler = createGatewayHandler();
  const server = await listen(handler);
  try {
    const root = await fetch(`${origin(server)}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /data-platform-module="warehouse"/);

    const conference = await fetch(`${origin(server)}/conference`);
    assert.equal(conference.status, 200);

    const asset = await fetch(`${origin(server)}/shared-design-tokens.css`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /text\/css/);

    const platformContext = await fetch(`${origin(server)}/api/platform/context`);
    assert.deepEqual(await platformContext.json(), { configured: false, authenticated: false, modules: [] });

    const adoption = await fetch(`${origin(server)}/api/platform/session/adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "invalid", refreshToken: "invalid" }),
    });
    assert.equal(adoption.status, 503);

    const logout = await fetch(`${origin(server)}/api/platform/session/logout`, { method: "POST" });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { authenticated: false });
  } finally {
    await close(server);
  }
});

test("root remains the launcher and an authorized direct Conference route serves the workspace runtime", async () => {
  const server = await listen(createGatewayHandler({
    sessionContext: context(true, ["conference"]),
  }));
  try {
    const root = await fetch(`${origin(server)}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /id="platformLauncherTitle"/);
    const conference = await fetch(`${origin(server)}/conference`, { redirect: "manual" });
    assert.equal(conference.status, 200);
    assert.match(await conference.text(), /id="conferenceWorkspace"/);
  } finally {
    await close(server);
  }
});

test("protected Development HTML omits the manifest request while ordinary and Production-compatible HTML retain it", async () => {
  const server = await listen(createGatewayHandler());
  try {
    const development = await fetch(`${origin(server)}/`, { headers: { "x-forwarded-host": "integrated-platform-development-git-develop-ramyawny37-3662.vercel.app" } });
    assert.equal(development.status, 200);
    assert.doesNotMatch(await development.text(), /rel="manifest"/);
    const ordinary = await fetch(`${origin(server)}/`);
    assert.match(await ordinary.text(), /rel="manifest" href="\.\/manifest\.json"/);
  } finally { await close(server); }
});

test("device issuance uses host-only HttpOnly platform cookies", () => {
  const headers = {};
  const response = {
    getHeader: (name) => headers[name],
    setHeader: (name, value) => { headers[name] = value; },
  };
  const device = issueDevice(response);
  assert.match(device.id, /^[0-9a-f-]{36}$/i);
  assert.match(device.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(headers["set-cookie"].length, 2);
  for (const cookie of headers["set-cookie"]) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Domain=/i);
  }
});

test("module access uses the public Platform context and never calls the internal permission function", async () => {
  const device = { id: "f9306733-612d-433f-a38e-5d72855c2fe3" };
  const calls = [];
  const ownerClient = {
    schema: () => ({ rpc: async (name) => { calls.push(name); return { data: {
      accountStatus: "approved", deviceStatus: "approved", deviceLifecycle: "active", roles: ["platform_owner"],
    }, error: null }; } }),
    rpc: async () => { throw new Error("owner must not need a public grant lookup"); },
  };
  assert.equal((await moduleAccessFor(ownerClient, device, "conference", "module.access")).allowed, true);
  assert.deepEqual(calls, ["get_my_access_context"]);

  const pendingClient = { schema: () => ({ rpc: async () => ({ data: {
    accountStatus: "approved", deviceStatus: "pending", deviceLifecycle: "active", roles: ["platform_owner"],
  }, error: null }) }) };
  assert.equal((await moduleAccessFor(pendingClient, device, "conference", "module.access")).allowed, false);
});

test("Conference guarded RPC uses the proven Platform device and rechecks module access", async () => {
  const calls = [];
  const device = { id: "f9306733-612d-433f-a38e-5d72855c2fe3", secret: "s".repeat(43) };
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "require_module_permission") return { data: { status: "allowed" }, error: null };
      return { data: { status: "success", organizations: [] }, error: null };
    },
  };
  const api = createApiHandler({
    platformAdministrationClient: async () => ({ device, supabase, user: { id: "user-1" } }),
    moduleAccessFor: async () => ({ allowed: true, context: { deviceStatus: "approved" } }),
    readJson: async () => ({ name: "device_guarded_list_my_organizations", args: {} }),
  });
  const server = await listen(createGatewayHandler({ handleApi: api }));
  try {
    const result = await fetch(`${origin(server)}/api/platform/conference-rpc`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { data: { status: "success", organizations: [] }, error: null });
    assert.deepEqual(calls.map((call) => call.name), ["device_guarded_list_my_organizations"]);
    assert.equal(calls[0].args.p_actor_device_id, device.id);
  } finally {
    await close(server);
  }
});

test("metadata-classified allowlisted RPC without a device argument is accepted without a synthetic argument", async () => {
  const device = { id: "f9306733-612d-433f-a38e-5d72855c2fe3", secret: "s".repeat(43) };
  let executedArgs;
  const supabase = { rpc: async (name, args) => { executedArgs = args; return { data: { status: "ok" }, error: null }; } };
  const api = createApiHandler({
    platformAdministrationClient: async () => ({ device, supabase, user: { id: "user-1" } }),
    moduleAccessFor: async () => ({ allowed: true, context: { deviceStatus: "approved" } }),
    rpcMetadata: new Map([["signature_verified_without_device", { actorDeviceArgument: null }]]),
    readJson: async () => ({ name: "signature_verified_without_device", args: { p_limit: 10 } }),
  });
  const server = await listen(createGatewayHandler({ handleApi: api }));
  try {
    const result = await fetch(`${origin(server)}/api/platform/conference-rpc`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.deepEqual(executedArgs, { p_limit: 10 });
  } finally { await close(server); }
});

test("Conference RPC gateway rejects a mismatched browser device and non-allowlisted function", async () => {
  const device = { id: "f9306733-612d-433f-a38e-5d72855c2fe3", secret: "s".repeat(43) };
  for (const body of [
    { name: "device_guarded_list_my_organizations", args: { p_actor_device_id: "9bce8898-0000-4000-8000-000000000000" } },
    { name: "register_current_device", args: { p_actor_device_id: device.id } },
  ]) {
    const api = createApiHandler({
      platformAdministrationClient: async () => ({ device, supabase: { rpc: async () => { throw new Error("must not execute"); } } }),
      readJson: async () => body,
    });
    const server = await listen(createGatewayHandler({ handleApi: api }));
    try {
      const result = await fetch(`${origin(server)}/api/platform/conference-rpc`, { method: "POST" });
      assert.equal(result.status, 400);
      assert.equal((await result.json()).error.code, "CONFERENCE_RPC_REQUEST_INVALID");
    } finally {
      await close(server);
    }
  }
});

test("module authorization happens before proxying", async () => {
  let proxyCalls = 0;
  const proxyRequest = async () => { proxyCalls += 1; };
  const unauthenticated = await listen(createGatewayHandler({ sessionContext: context(false), proxyRequest }));
  const unauthorized = await listen(createGatewayHandler({ sessionContext: context(true), proxyRequest }));
  try {
    const login = await fetch(`${origin(unauthenticated)}/warehouse`, { redirect: "manual" });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), "/?platformLogin=required");

    const denied = await fetch(`${origin(unauthorized)}/warehouse`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, "PLATFORM_MODULE_ACCESS_DENIED");
    assert.equal(proxyCalls, 0);
  } finally {
    await close(unauthenticated);
    await close(unauthorized);
  }
});

test("module targets and bypass credentials are selected independently without stripping prefixes", async () => {
  const keys = ["WAREHOUSE", "RESERVATIONS", "CUSTODY"].flatMap((id) => [
    `PLATFORM_${id}_TARGET`,
    `PLATFORM_${id}_PROTECTION_BYPASS`,
  ]);
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const calls = [];
  const proxyRequest = async (request, response, module, target) => {
    calls.push({ module: module.id, target, url: request.url });
    response.writeHead(204).end();
  };
  for (const id of ["WAREHOUSE", "RESERVATIONS", "CUSTODY"]) {
    process.env[`PLATFORM_${id}_TARGET`] = `https://${id.toLowerCase()}.example.test`;
    process.env[`PLATFORM_${id}_PROTECTION_BYPASS`] = `${id.toLowerCase()}-secret`;
  }
  const server = await listen(createGatewayHandler({
    sessionContext: context(true, ["warehouse", "reservations", "custody"]),
    proxyRequest,
  }));
  try {
    for (const path of ["/warehouse/items", "/reservations/events", "/custody/employees"])
      assert.equal((await fetch(`${origin(server)}${path}`)).status, 204);
    assert.deepEqual(calls, [
      { module: "warehouse", target: "https://warehouse.example.test", url: "/warehouse/items" },
      { module: "reservations", target: "https://reservations.example.test", url: "/reservations/events" },
      { module: "custody", target: "https://custody.example.test", url: "/custody/employees" },
    ]);
  } finally {
    await close(server);
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("proxy replaces malicious bypass, streams POST bodies, and normalizes backing headers", async () => {
  const originalTarget = process.env.PLATFORM_WAREHOUSE_TARGET;
  const originalBypass = process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS;
  let received;
  const upstream = await listen(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received = { method: request.method, url: request.url, headers: request.headers, body };
    response.writeHead(307, {
      location: `${origin(upstream)}/warehouse/login?next=%2Fwarehouse`,
      "set-cookie": "warehouse-session=1; Domain=127.0.0.1; Path=/; HttpOnly; Secure; SameSite=Lax",
      "x-vercel-protection-bypass": "must-not-leak",
      "content-type": "text/plain",
    });
    response.end("redirected");
  });
  process.env.PLATFORM_WAREHOUSE_TARGET = origin(upstream);
  process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS = "server-only-secret";
  const gateway = await listen(createGatewayHandler({ sessionContext: context(true, ["warehouse"]) }));
  try {
    const result = await fetch(`${origin(gateway)}/warehouse/submit?draft=1`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: "platform-device-id=device; platform-session=session",
        "content-type": "application/json",
        "x-vercel-protection-bypass": "browser-attacker-value",
      },
      body: JSON.stringify({ value: 7 }),
    });
    assert.equal(result.status, 307);
    assert.equal(result.headers.get("location"), "/warehouse/login?next=%2Fwarehouse");
    assert.equal(result.headers.get("x-vercel-protection-bypass"), null);
    assert.doesNotMatch(result.headers.get("set-cookie"), /Domain=/i);
    assert.match(result.headers.get("set-cookie"), /HttpOnly/);
    assert.deepEqual(received, {
      method: "POST",
      url: "/warehouse/submit?draft=1",
      headers: received.headers,
      body: JSON.stringify({ value: 7 }),
    });
    assert.equal(received.headers["x-vercel-protection-bypass"], "server-only-secret");
    assert.equal(received.headers.cookie, "platform-device-id=device; platform-session=session");
    assert.equal(await result.text(), "redirected");
  } finally {
    await close(gateway);
    await close(upstream);
    if (originalTarget === undefined) delete process.env.PLATFORM_WAREHOUSE_TARGET;
    else process.env.PLATFORM_WAREHOUSE_TARGET = originalTarget;
    if (originalBypass === undefined) delete process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS;
    else process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS = originalBypass;
  }
});

test("missing target and missing bypass both fail closed", async () => {
  const originalTarget = process.env.PLATFORM_WAREHOUSE_TARGET;
  const originalBypass = process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS;
  delete process.env.PLATFORM_WAREHOUSE_TARGET;
  delete process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS;
  const server = await listen(createGatewayHandler({ sessionContext: context(true, ["warehouse"]) }));
  try {
    let result = await fetch(`${origin(server)}/warehouse`);
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error, "PLATFORM_MODULE_TARGET_NOT_CONFIGURED");

    process.env.PLATFORM_WAREHOUSE_TARGET = "https://warehouse.example.test";
    result = await fetch(`${origin(server)}/warehouse`);
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error, "PLATFORM_MODULE_PROTECTION_BYPASS_NOT_CONFIGURED");
  } finally {
    await close(server);
    if (originalTarget === undefined) delete process.env.PLATFORM_WAREHOUSE_TARGET;
    else process.env.PLATFORM_WAREHOUSE_TARGET = originalTarget;
    if (originalBypass === undefined) delete process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS;
    else process.env.PLATFORM_WAREHOUSE_PROTECTION_BYPASS = originalBypass;
  }
});

test("Vercel adapter and routing delegate every public path to the canonical handler", () => {
  const adapter = fs.readFileSync("api/gateway.js", "utf8");
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.match(adapter, /gatewayHandler/);
  assert.match(adapter, /__platform_path/);
  assert.deepEqual(config.rewrites, [
    { source: "/", destination: "/api/gateway?__platform_path=/" },
    { source: "/:path*", destination: "/api/gateway?__platform_path=/:path*" },
  ]);
  assert.equal(config.outputDirectory, "vercel-public");
  assert.match(config.functions["api/gateway.js"].includeFiles, /js\/\*\*/);
});

test("Development Supabase guard rejects every non-Development project URL", () => {
  const result = spawnSync(process.execPath, ["-e", "require('./server/platform-gateway.cjs')"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "https://not-development.supabase.co",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /PLATFORM_DEVELOPMENT_SUPABASE_REQUIRED/);
});
