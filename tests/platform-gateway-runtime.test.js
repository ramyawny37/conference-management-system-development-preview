"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  createGatewayHandler,
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
