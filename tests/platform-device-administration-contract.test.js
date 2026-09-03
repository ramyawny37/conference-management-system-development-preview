"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const migration = fs.readFileSync("supabase/migrations/20260831040000_platform_device_administration_contract.sql", "utf8");
const page = fs.readFileSync("platform-device-admin.html", "utf8");
const client = fs.readFileSync("js/platform-device-admin.js", "utf8");

test("Platform SQL administration remains actor-device, permission, pending, and audit guarded", () => {
  assert.match(migration, /platform_private\.has_permission_for\([\s\S]*'platform\.devices\.view'/);
  assert.match(migration, /platform_private\.has_permission_for\([\s\S]*'platform\.devices\.approve'/);
  assert.match(migration, /device_authorization\.id\s*=\s*p_authorization_id[\s\S]*device_authorization\.device_id\s*=\s*p_device_id/);
  assert.match(migration, /target\.status\s*<>\s*'pending'[\s\S]*DEVICE_AUTHORIZATION_NOT_PENDING/);
  assert.match(migration, /platform_private\.change_device_authorization\(/);
  assert.doesNotMatch(migration, /public\.user_device_authorizations/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*\b(?:anon|public)\b/i);
});

test("Gateway administration is fully removed and the static admin assets retain no secret transport", () => {
  assert.equal(fs.existsSync("server/platform-gateway.cjs"), false);
  assert.equal(fs.existsSync("api/gateway.js"), false);
  assert.doesNotMatch(client, /deviceSecret|device_secret|refreshToken|refresh_token/);
  assert.doesNotMatch(client, /CurrentDeviceAuthorization|public\.user_device_authorizations/);
  assert.doesNotMatch(page, /applicationBody|data-platform-module|StartupAccessGate/);
});
