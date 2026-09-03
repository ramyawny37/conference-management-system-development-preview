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

test("gateway device-administration endpoints are retired without executing RPCs", async () => {
  const server = await listen(createGatewayHandler());
  try {
    for (const request of [
      [`${origin(server)}/api/platform/device-authorizations/pending`, {}],
      [`${origin(server)}/api/platform/device-authorizations/approve`, { method: "POST" }],
    ]) {
      const response = await fetch(request[0], request[1]);
      assert.equal(response.status, 410);
      assert.deepEqual(await response.json(), { error: "PLATFORM_PRIVILEGED_GATEWAY_RETIRED" });
    }
  } finally { await close(server); }
});

test("independent admin route is minimal, protected by API, and excludes the application shell", async () => {
  const server = await listen(createGatewayHandler());
  try {
    const response = await fetch(`${origin(server)}/platform/device-admin`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /js\/platform-device-admin\.js/);
    assert.doesNotMatch(html, /applicationBody|data-platform-module|StartupAccessGate/);
    assert.match(html, /ramyawny37\.github\.io\/conference-management-system-v1/);
  } finally {
    await close(server);
  }
  assert.doesNotMatch(client, /deviceSecret|device_secret|refreshToken|refresh_token/);
  assert.doesNotMatch(client, /CurrentDeviceAuthorization|public\.user_device_authorizations/);
  assert.match(gateway, /PLATFORM_PRIVILEGED_GATEWAY_RETIRED/);
});
