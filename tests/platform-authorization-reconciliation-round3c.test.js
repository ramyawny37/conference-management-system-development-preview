'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

function read(path){return fs.readFileSync(path,'utf8');}

const systemAccess=read('js/supabase/system-access-service.js');
const accountAdministration=read('js/supabase/account-administration-service.js');
const legacyFoundation=read('supabase/migrations/20260730_5_0_0_system_access_foundation.sql');
const accountAdministrationSql=read('supabase/migrations/20260808_6_3_0_account_administration.sql');
const platformFoundation=read('supabase/migrations/20260831023000_platform_foundation_reconciliation.sql');
const phase1c=read('supabase/migrations/20260903150000_phase1c_server_device_context_reconciliation.sql');
const dispatcher=read('supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql');
const moduleAdapter=read('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql');
const warehouseGuarded=read('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql');
const warehouseContract=read('js/supabase/warehouse-device-operation-contract.js');
const warehouseTransport=read('js/supabase/warehouse-transport.js');
const deviceSession=read('js/supabase/device-session.js');
const currentStore=read('js/warehouse/current-store-context.js');
const edge=read('supabase/functions/platform-device-operation/index.ts');
const warehouseRuntime=[warehouseGuarded,warehouseContract,warehouseTransport,currentStore].join('\n');

test('current System Access client reads the public access and role foundations',()=>{
  assert.match(systemAccess,/\.from\('system_user_access'\)[\s\S]*\.select\('user_id,account_status,can_create_conferences,updated_at'\)/);
  assert.match(systemAccess,/\.from\('system_user_roles'\)[\s\S]*\.select\('user_id,role,granted_at'\)/);
  assert.match(systemAccess,/\['system_owner','system_admin'\]\.indexOf\(row\.role\)/);
  assert.match(legacyFoundation,/create table public\.system_user_access/i);
  assert.match(legacyFoundation,/create table public\.system_user_roles/i);
});

test('current account administration remains legacy System Access administration',()=>{
  assert.match(accountAdministration,/invokeProtected\('device_guarded_manage_system_user'/);
  assert.doesNotMatch(accountAdministration,/\.rpc\s*\(/);
  assert.match(accountAdministration,/setConferenceCreationPermission:function/);
  assert.match(accountAdministration,/mutate\('set_conference_creation_permission'/);
  assert.match(accountAdministrationSql,/create or replace function public\.device_guarded_manage_system_user/i);
  assert.match(accountAdministrationSql,/public\.is_system_owner\(actor_id\)/i);
  assert.match(accountAdministrationSql,/public\.set_user_conference_creation_permission/i);
});

test('Conference creation capability is currently coupled to System Access only',()=>{
  assert.match(legacyFoundation,/can_create_conferences boolean not null default false/i);
  assert.match(systemAccess,/access\.can_create_conferences===true/);
  assert.doesNotMatch(platformFoundation,/can_create_conferences/i);
  assert.doesNotMatch(warehouseRuntime,/can_create_conferences|set_conference_creation_permission|setConferenceCreationPermission/i);
});

test('platform account, role, permission, and inventory foundations remain parallel',()=>{
  for(const relation of ['profiles','permissions','roles','role_permissions','user_roles'])
    assert.match(platformFoundation,new RegExp('create table platform\\.'+relation,'i'));
  for(const role of ['platform_owner','platform_admin','inventory_manager','inventory_operator','viewer'])
    assert.match(platformFoundation,new RegExp("'"+role+"'"));
  assert.match(platformFoundation,/'inventory\.access'/);
  assert.match(platformFoundation,/create or replace function platform\.set_account_status/i);
  assert.doesNotMatch(systemAccess,/platform\.profiles|platform\.user_roles|platform\.set_account_status/i);
});

test('system_owner remains the current Conference and Warehouse authority concept',()=>{
  assert.match(legacyFoundation,/create or replace function public\.is_system_owner/i);
  assert.match(legacyFoundation,/roles\.role = 'system_owner'/i);
  assert.match(moduleAdapter,/public\.is_system_owner\(actor_id\)/i);
  assert.match(moduleAdapter,/'authoritySource', 'system_owner'/i);
  assert.doesNotMatch(moduleAdapter,/platform_owner|platform\.user_roles/i);
  assert.doesNotMatch(warehouseRuntime,/platform_owner|platform_admin/i);
});

test('Warehouse remains on warehouse permissions and the public module grant adapter',()=>{
  assert.match(warehouseGuarded,/public\.require_effective_module_permission\(\s*p_device_id,'warehouse',p_permission/i);
  assert.match(warehouseGuarded,/case when p_store_id is null then null else 'store' end/i);
  assert.match(warehouseRuntime,/'warehouse\.stock\.(?:receive|issue|transfer|adjust|approve|post)'/i);
  assert.doesNotMatch(warehouseRuntime,/inventory\.[a-z]|platform\.permissions|platform\.role_permissions|platform\.user_roles|inventory_manager|inventory_operator/i);
  assert.doesNotMatch(warehouseRuntime,/organization_id|organizationId|organization_members|organization_owner|organization_admin|organization membership/i);
});

test('unified device-session dispatch is a parallel Platform approval gate',()=>{
  assert.match(warehouseTransport,/invokeModuleProtected\('warehouse',operation,args\)/);
  assert.match(deviceSession,/functions\.invoke\('platform-device-operation'/);
  assert.match(edge,/schema\('platform'\)\.rpc\('execute_device_operation'/);
  assert.match(dispatcher,/create or replace function platform\.execute_device_operation/i);
  assert.match(dispatcher,/profile\.account_status='approved'/i);
  assert.match(dispatcher,/item\.purpose='PLATFORM_DEVICE_SESSION'/i);
  assert.match(dispatcher,/p_args \? 'p_actor_device_id'.*p_args \? 'p_device_id'/i);
  assert.match(phase1c,/public\.is_account_approved\(current_user_id\)/i);
  assert.match(phase1c,/platform_private\.validated_phase1c_device_authorization/i);
});
