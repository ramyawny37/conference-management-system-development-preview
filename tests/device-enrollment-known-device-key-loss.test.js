'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const enrollment=fs.readFileSync('js/supabase/device-enrollment.js','utf8');
const identity=fs.readFileSync('js/supabase/device-identity.js','utf8');
const gate=fs.readFileSync('js/sync/startup-access-gate.js','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-enrollment/index.ts','utf8');

test('known device without its bound private key fails closed before fresh enrollment',()=>{
  assert.match(enrollment,/getCurrent\(\{authenticatedUserId:auth\.userId\}\)/);
  assert.match(enrollment,/invoke\(\{action:'device-status',deviceId:identity\.id\}\)/);
  assert.match(enrollment,/throw \{code:'BOUND_PRIVATE_KEY_REQUIRED'/);
  const guard=enrollment.indexOf("throw {code:'BOUND_PRIVATE_KEY_REQUIRED'");
  const fresh=enrollment.indexOf('return enroll(auth);',guard);
  assert.ok(guard>=0&&fresh>guard,'known-device guard must run before fresh enrollment');
});

test('revoked known device rerequest is an explicit existing-key action, not an automatic retry',()=>{
  assert.match(enrollment,/function rerequestRevoked\(\)/);
  assert.match(enrollment,/String\(status\.status\|\|''\)!=='revoked'/);
  assert.match(enrollment,/rerequestRevoked:rerequestRevoked/);
  assert.doesNotMatch(enrollment,/resetCurrent|reEnrollRevoked/);
  assert.match(enrollment,/PLATFORM_NATIVE_DEVICE_REREQUEST/);
  assert.match(identity,/function resetCurrent\(options\)/);
  assert.match(identity,/storage\.removeItem\(key\)/);
  assert.doesNotMatch(identity,/localStorage\.clear|\.clear\(\)/);
});

test('startup gate offers explicit rerequest only after a revoked active binding is reconciled',()=>{
  assert.match(gate,/enrollment&&enrollment\.status==='revoked'/);
  assert.match(gate,/StartupAccessGate\.reEnrollCurrentDevice\(\)/);
  assert.match(gate,/enrollment\.rerequestRevoked\(\)/);
  assert.match(gate,/إعادة تسجيل هذا الجهاز/);
  assert.doesNotMatch(gate,/enrollment\.reEnrollRevoked\(\)/);
});

test('device-status lookup is authenticated and scoped to the current user and device',()=>{
  assert.match(edge,/if\(action==='device-status'\)/);
  assert.match(edge,/\.eq\('user_id',userResult\.data\.user\.id\)\.eq\('device_id',deviceId\)/);
  assert.match(edge,/data:\{known:!!row,status:row\?String\(row\.status\|\|'missing'\):'missing'/);
});

test('native enrollment remains the only server enrollment path',()=>{
  assert.equal((edge.match(/action!=='enroll'/g)||[]).length,1);
  assert.equal((edge.match(/enroll_new_device_key/g)||[]).length,1);
  assert.doesNotMatch(enrollment,/binding_recovery|ownership_handoff|lost_private_key|resetCurrent/);
});

test('device enrollment source parses and selects the account device rather than newest unrelated key',async()=>{
  const vm=require('node:vm');
  assert.doesNotThrow(()=>new Function(enrollment));
  const start=enrollment.indexOf('function active(deviceId)');
  const end=enrollment.indexOf('function verifyNonExportable',start);
  assert.ok(start>=0&&end>start);
  const rows=[
    {deviceId:'device-A',state:'active',privateKey:{},bindingId:'binding-A',createdAt:'2026-10-15T12:00:00Z'},
    {deviceId:'device-B',state:'active',privateKey:{},bindingId:'binding-B',createdAt:'2026-10-16T12:00:00Z'}
  ];
  const active=vm.runInNewContext('('+enrollment.slice(start,end).trim()+')',{rows:()=>Promise.resolve(rows),Promise});
  assert.equal((await active('device-A')).bindingId,'binding-A');
  assert.equal((await active('device-B')).bindingId,'binding-B');
  assert.equal(await active('device-C'),null);
  assert.match(enrollment,/return active\(identity&&identity\.id\)/);
  assert.match(enrollment,/return currentAuth\(\)\.then\(function\(auth\)/);
});
