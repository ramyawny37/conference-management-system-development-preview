"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const test = require("node:test");
const { createApiHandler, createGatewayHandler } = require("../server/platform-gateway.cjs");

const migration = fs.readFileSync("supabase/migrations/20260831040000_platform_device_administration_contract.sql", "utf8");
const gateway = fs.readFileSync("server/platform-gateway.cjs", "utf8");
const page = fs.readFileSync("platform-device-admin.html", "utf8");
const client = fs.readFileSync("js/platform-device-admin.js", "utf8");

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

test("Platform SQL administration remains actor-device, permission, pending, and audit guarded", () => {
  assert.match(migration, /platform_private\.has_permission_for\([\s\S]*'platform\.devices\.view'/);
  assert.match(migration, /platform_private\.has_permission_for\([\s\S]*'platform\.devices\.approve'/);
  assert.match(migration, /device_authorization\.id\s*=\s*p_authorization_id[\s\S]*device_authorization\.device_id\s*=\s*p_device_id/);
  assert.match(migration, /target\.status\s*<>\s*'pending'[\s\S]*DEVICE_AUTHORIZATION_NOT_PENDING/);
  assert.match(migration, /platform_private\.change_device_authorization\(/);
  assert.doesNotMatch(migration, /public\.user_device_authorizations/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*\b(?:anon|public)\b/i);
});

test("approved Platform administrator lists and approves exactly one immutable pending target", async () => {
  const authorizationId = "11111111-1111-4111-8111-111111111111";
  const deviceId = "22222222-2222-4222-8222-222222222222";
  const secret = "server-only-device-secret";
  const calls = [];
  const supabase = {
    schema(name) {
      assert.equal(name, "platform");
      return { rpc: async (rpcName, args) => {
        calls.push({ rpcName, args });
        if (rpcName === "list_pending_device_authorizations") return { data: { status: "success", devices: [{ authorizationId, deviceId, deviceName: "Stable", authorizationStatus: "pending" }] }, error: null };
        return { data: { status: "applied", authorizationId, deviceId, authorizationStatus: "approved" }, error: null };
      } };
    },
  };
  const handleApi = createApiHandler({ platformAdministrationClient: async () => ({ supabase, device: { id: "actor", secret } }) });
  const server = await listen(createGatewayHandler({ handleApi }));
  try {
    let response = await fetch(`${origin(server)}/api/platform/device-authorizations/pending`);
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.devices.length, 1);
    assert.equal(JSON.stringify(body).includes(secret), false);

    response = await fetch(`${origin(server)}/api/platform/device-authorizations/approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ authorizationId, deviceId }),
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.authorizationStatus, "approved");
    assert.deepEqual(calls, [
      { rpcName: "list_pending_device_authorizations", args: undefined },
      { rpcName: "approve_pending_device_authorization", args: { p_authorization_id: authorizationId, p_device_id: deviceId, p_reason: "Approved through Platform device administration" } },
    ]);
    assert.equal(calls.some((call) => JSON.stringify(call).includes("b23ece81")), false);
  } finally {
    await close(server);
  }
});

test("unauthenticated, pending-device, and unauthorized administrators fail closed", async () => {
  for (const denial of [
    { error: "PLATFORM_AUTHENTICATION_REQUIRED", status: 401 },
    { error: "PLATFORM_APPROVED_DEVICE_REQUIRED", status: 403 },
    { error: "PLATFORM_DEVICE_ADMINISTRATION_DENIED", status: 403 },
  ]) {
    const handleApi = createApiHandler({ platformAdministrationClient: async () => denial });
    const server = await listen(createGatewayHandler({ handleApi }));
    try {
      const response = await fetch(`${origin(server)}/api/platform/device-authorizations/pending`);
      assert.equal(response.status, denial.status);
      assert.deepEqual(await response.json(), { error: denial.error });
    } finally {
      await close(server);
    }
  }
});

test("duplicate approval safely returns conflict", async () => {
  const supabase = { schema: () => ({ rpc: async () => ({ data: null, error: { code: "55000", message: "DEVICE_AUTHORIZATION_NOT_PENDING" } }) }) };
  const handleApi = createApiHandler({ platformAdministrationClient: async () => ({ supabase }) });
  const server = await listen(createGatewayHandler({ handleApi }));
  try {
    const response = await fetch(`${origin(server)}/api/platform/device-authorizations/approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        authorizationId: "11111111-1111-4111-8111-111111111111",
        deviceId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "PLATFORM_DEVICE_NOT_PENDING" });
  } finally {
    await close(server);
  }
});

test("independent admin route is minimal, protected by API, and excludes the application shell", async () => {
  const server = await listen(createGatewayHandler());
  try {
    const response = await fetch(`${origin(server)}/platform/device-admin`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /js\/platform-device-admin\.js/);
    assert.doesNotMatch(html, /applicationBody|data-platform-module|StartupAccessGate/);
  } finally {
    await close(server);
  }
  assert.match(client, /\/api\/platform\/device-authorizations\/pending/);
  assert.match(client, /\/api\/platform\/device-authorizations\/approve/);
  assert.doesNotMatch(client, /deviceSecret|device_secret|refreshToken|refresh_token/);
  assert.doesNotMatch(client, /CurrentDeviceAuthorization|public\.user_device_authorizations/);
  assert.match(gateway, /platformAdministrationClient[\s\S]*getDevice/);
});
