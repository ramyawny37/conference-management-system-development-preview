"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const test=require("node:test");

const sql=fs.readFileSync("supabase/migrations/20260913141000_platform_private_recovery_rls_hardening.sql","utf8");

const tables=[
  "stable_device_recovery_authorizations",
  "stable_device_recovery_challenges",
  "stable_device_recovery_audit",
  "device_ownership_handoff_challenges",
  "device_ownership_handoff_audit",
  "zero_approved_owner_device_recovery_operations"
];

test("private recovery tables use the established FORCE RLS deny-by-default posture",()=>{
  for(const table of tables){
    const escaped=table.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    assert.match(sql,new RegExp(`alter table platform_private\\.${escaped} enable row level security;`,`i`),table+": enable RLS");
    assert.match(sql,new RegExp(`alter table platform_private\\.${escaped} force row level security;`,`i`),table+": force RLS");
    assert.match(sql,new RegExp(`revoke all on platform_private\\.${escaped} from public, anon, authenticated, service_role;`,`i`),table+": revoke direct access");
  }
});

test("hardening adds no direct grants or row policies",()=>{
  assert.doesNotMatch(sql,/\bgrant\b/i);
  assert.doesNotMatch(sql,/\bcreate\s+policy\b/i);
});

test("hardening is atomic and does not redefine recovery entrypoints",()=>{
  assert.match(sql,/^--[\s\S]*\bbegin;[\s\S]*\bcommit;\s*$/i);
  assert.doesNotMatch(sql,/create\s+(or\s+replace\s+)?function/i);
  assert.doesNotMatch(sql,/drop\s+(table|function|trigger|policy)/i);
});
