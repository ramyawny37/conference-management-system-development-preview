'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const executor=require('../tools/production-release/controlled-production-executor.cjs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');

const version='20260907150000';
const canonical='supabase/migrations/20260907150000_module_permission_administration_backend_surface.sql';
const canonicalSha='25c93aba3eb25f8136f446490983b165150559e0c30c85e5753d38f0690515c5';
const predecessorDispatcherSha='6c402ba6208dc8517b9f33382c465d1fe15da7996d540e40248f1ff979f3eba4';
const finalDispatcherSha='a878c59a41e17ca9e60e0540b2bf425675c929c497832b4694e651424a9dbe50';
const entry=()=>manifest.entries.find(item=>item.version===version);

test('Step 57 canonical body and SHA remain unchanged',()=>{
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(canonical)).digest('hex'),canonicalSha);
  assert.equal(entry().sha256,canonicalSha);
});

test('Step 57 precondition accepts the exact service-role-enabled Step 56 predecessor',()=>{
  const sql=entry().preconditionSql;
  assert.match(sql,new RegExp(predecessorDispatcherSha));
  assert.match(sql,/has_function_privilege\('service_role'.*manage_catalog_module_grant/s);
  assert.doesNotMatch(sql,/not has_function_privilege\('service_role'/);
  for(const signature of [
    'search_module_permission_candidates',
    'list_module_permission_catalog_for_administration',
    'list_permission_administration_stores',
    'execute_device_operation_pre_module_permission_administration'
  ]) assert.match(sql,new RegExp(`${signature}[^)]*\\)'[^]*is null`));
  assert.equal(executor.classifyInterrupted(true,false),'NOT_APPLIED');
});

test('Step 57 postcondition identifies the complete final surface',()=>{
  const sql=entry().verificationSql;
  assert.match(sql,new RegExp(finalDispatcherSha));
  assert.match(sql,new RegExp(predecessorDispatcherSha));
  for(const signature of [
    'search_module_permission_candidates',
    'list_module_permission_catalog_for_administration',
    'list_permission_administration_stores',
    'execute_device_operation_pre_module_permission_administration'
  ]) assert.match(sql,new RegExp(signature));
  assert.equal(executor.classifyInterrupted(false,true),'EFFECTIVELY_APPLIED_HISTORY_MISSING');
});

test('Step 57 exclusive partial and wrong-dispatcher fixtures remain rejected',()=>{
  for(const fixture of [
    {name:'wrong dispatcher',pre:false,post:false},
    {name:'renamed predecessor without replacement',pre:false,post:false},
    {name:'one exclusive admin function',pre:false,post:false},
    {name:'wrong ACL',pre:false,post:false}
  ]) assert.equal(executor.classifyInterrupted(fixture.pre,fixture.post),'PARTIAL_OR_DRIFTED',fixture.name);
});

test('Step 57 history contract remains the 57th controlled entry',()=>{
  assert.equal(manifest.entries.length,57);
  assert.equal(manifest.entries[56].version,version);
  const expected=executor.expectedHistory(entry());
  assert.equal(expected.idempotency_key,'cms-production-applied:20260907150000');
  assert.equal(expected.statements.length,2);
});
