'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

function read(path){return fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';}

const platform=read('js/platform-integration.js');
const permissionService=read('js/sync/module-permission-administration-service.js');
const permissionUi=read('js/sync/module-permission-administration-ui.js');
const warehouse=read('js/warehouse/workspace.js');
const reservations=read('modules/reservations/reservations-module.js');
const moduleGate=read('supabase/migrations/20260912192000_platform_module_entry_access_gate.sql');

test('temporary Reservations shell shims stay rejected',()=>{
  assert.equal(fs.existsSync('js/platform-integration-core.js'),false);
  assert.equal(fs.existsSync('js/reservations-reconciliation-bootstrap.js'),false);
  assert.doesNotMatch(platform,/document\.write\s*\(/);
});

test('Inventory authority mapping stays rejected',()=>{
  assert.doesNotMatch(permissionService+permissionUi+warehouse+reservations,/inventory\.(?:roles|permissions|grants|authority)|inventory_to_warehouse|warehouse_from_inventory/i);
});

test('Warehouse and Reservations module access remain independent of Organization and Conference roles',()=>{
  assert.doesNotMatch(moduleGate,/organization_members|conference_members|organization_role|conference_role/i);
  assert.match(moduleGate,/module\.access/);
  assert.match(moduleGate,/module\.manage/);
});

test('module administration never trusts browser actor-device overrides or direct database bypasses',()=>{
  assert.match(permissionService,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.doesNotMatch(permissionService+permissionUi,/\.rpc\s*\(|\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
});

test('module gate does not seed active grants as a shortcut',()=>{
  assert.doesNotMatch(moduleGate,/insert\s+into\s+platform\.module_permission_grants|insert\s+into\s+public\.module_permission_grants/i);
});
