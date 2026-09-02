"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const test=require("node:test");

const migration=fs.readFileSync("supabase/migrations/20260902122033_platform_device_session_foundation_1b.sql","utf8");
const edge=fs.readFileSync("supabase/functions/platform-device-session/index.ts","utf8");
const browser=fs.readFileSync("js/supabase/device-session.js","utf8");
const page=fs.readFileSync("platform-device-session.html","utf8");

test("Phase 1B database contract binds every authority dimension and keeps private state closed",()=>{
  for(const value of ["PLATFORM_DEVICE_SESSION_ESTABLISH","PLATFORM_DEVICE_SESSION","device_session_challenges","device_sessions","device_session_audit","user_id","device_id","device_authorization_id","binding_id","public_key_thumbprint","signing_payload_hash","consumed_at","expires_at","profile.account_status='approved'","device_authorization.status='approved'","binding.lifecycle_status='active'","device.lifecycle_status='active'","force row level security","DEVICE_SESSION_CHALLENGE_INVALID","DEVICE_SESSION_INVALID"])
    assert.ok(migration.includes(value),value);
  assert.match(migration,/expires_at<=created_at\+interval '5 minutes'/);
  assert.match(migration,/revoke all on platform_private\.device_sessions from public,anon,authenticated,service_role/i);
  assert.doesNotMatch(migration,/grant\s+(select|insert|update|delete)\s+on\s+platform_private/i);
  assert.doesNotMatch(migration,/grant\s+execute[^;]+to\s+(anon|public)/i);
  assert.doesNotMatch(migration,/insert into platform\.devices|update platform\.user_device_authorizations\s+set\s+status/i);
});

test("entrypoint grants are least privilege and schema usage is explicit",()=>{
  assert.match(migration,/grant execute on function platform\.begin_device_session_challenge\(uuid\) to authenticated/i);
  for(const name of ["get_device_session_challenge_context","complete_device_session","verify_device_session"])
    assert.match(migration,new RegExp("grant execute on function platform\\."+name+"[^;]+to service_role","i"));
  assert.doesNotMatch(migration,/grant usage on schema platform_private/i);
  assert.doesNotMatch(migration,/grant usage on schema platform to (anon|authenticated)/i);
});

test("Edge is Supabase-only and verifies authoritative P-256 possession",()=>{
  for(const value of ["auth.getUser()","get_device_session_challenge_context","complete_device_session","verify_device_session","crypto.subtle.verify","ECDSA","P-256","SHA-256","crypto.getRandomValues(new Uint8Array(32))","DEVICE_SESSION_SIGNATURE_INVALID"])
    assert.ok(edge.includes(value),value);
  assert.doesNotMatch(edge,/vercel|device.secret|x-platform-device-secret|cookie/i);
  assert.match(edge,/signature\.length !== 64/);
});

test("browser reuses only the non-exportable Phase 1A key and keeps the bearer in memory",()=>{
  assert.match(browser,/indexedDB\.open/);
  assert.match(browser,/PRIVATE_KEY_EXPORT_SUCCEEDED/);
  assert.match(browser,/record\.state!=='active'/);
  assert.doesNotMatch(browser,/generateKey|localStorage|sessionStorage/);
  assert.doesNotMatch(browser,/objectStore\([^)]*\)\.put/);
  assert.match(browser,/var memorySession=null/);
  assert.match(browser,/challenge\.userId!==userId/);
  assert.match(browser,/value!==\'DEVICE_SESSION_CHALLENGE_INVALID\'/);
  assert.match(page,/js\/supabase\/device-session\.js/);
});

test("WebCrypto browser and Edge signature encoding is raw 64-byte P-256",async()=>{
  const keys=await crypto.webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
  const payload=new TextEncoder().encode("PLATFORM_DEVICE_SESSION_ESTABLISH\nv1\ncanonical");
  const signature=new Uint8Array(await crypto.webcrypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},keys.privateKey,payload));
  assert.equal(signature.length,64);
  assert.equal(await crypto.webcrypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},keys.publicKey,signature,payload),true);
  assert.equal(await crypto.webcrypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},keys.publicKey,signature,new TextEncoder().encode("modified")),false);
});

test("negative security cases are represented at both verification boundaries",()=>{
  const cases={
    wrongUser:["challenge.user_id=p_user_id","session.user_id=p_user_id"],
    wrongDevice:["v_challenge.device_id<>p_device_id","binding.device_id=p_device_id"],
    wrongAuthorization:["v_challenge.device_authorization_id<>p_authorization_id","device_authorization.status='approved'"],
    wrongBinding:["v_challenge.binding_id<>p_binding_id","binding.id=p_binding_id"],
    revokedBinding:["binding.revoked_at is null","binding.retired_at is null"],
    blockedAccount:["profile.account_status='approved'"],
    expiredChallenge:["v_challenge.expires_at<=v_now"],
    consumedChallenge:["v_challenge.consumed_at is not null"],
    replay:["pg_advisory_xact_lock","consumed_at is not null"],
    expiredSession:["session.expires_at>statement_timestamp()"],
    invalidToken:["session.token_hash=p_token_hash"],
    directMutation:["revoke all on platform_private.device_sessions"]
  };
  for(const [name,fragments] of Object.entries(cases))for(const fragment of fragments)assert.ok(migration.includes(fragment),name+":"+fragment);
  for(const value of ["DEVICE_SESSION_CHALLENGE_MISMATCH","crypto.subtle.sign","signature:encoded(signature)"])
    assert.ok(browser.includes(value),value);
});
