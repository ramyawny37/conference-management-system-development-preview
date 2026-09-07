'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const migration=fs.readFileSync('supabase/migrations/20260907150000_module_permission_administration_backend_surface.sql','utf8');
const foundation=fs.readFileSync('supabase/migrations/20260829120000_module_authorization_foundation.sql','utf8');
const catalogGrant=fs.readFileSync('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql','utf8');
const delegation=fs.readFileSync('supabase/migrations/20260907140000_module_access_delegation_enforcement.sql','utf8');
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');
const conferenceContractSource=fs.readFileSync('js/supabase/conference-device-operation-contract.js','utf8');
const warehouseContractSource=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');
const sandbox={window:{}};
vm.runInNewContext(conferenceContractSource,sandbox);
vm.runInNewContext(warehouseContractSource,sandbox);

function body(name){
  const match=migration.match(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'[\\s\\S]*?\\$\\$;','i'));
  assert.ok(match,'missing '+name);
  return match[0];
}
const candidates=body('public.search_module_permission_candidates');
const catalog=body('public.list_module_permission_catalog_for_administration');
const stores=body('warehouse.list_permission_administration_stores');
const dispatcher=body('platform.execute_device_operation');

test('1 candidate search requires an approved device',()=>assert.match(candidates,/require_current_approved_device\(p_actor_device_id\)/));
test('2 candidate search requires owner or same-module manager',()=>assert.match(candidates,/is_system_owner\(actor_id\)[\s\S]*require_module_permission\([\s\S]*p_module_key, 'module\.manage'/));
test('3 candidate search returns approved accounts only',()=>assert.match(candidates,/access\.account_status = 'approved'/));
test('4 candidate response is privacy-minimal',()=>{for(const key of ['userId','displayName','email','accountStatus'])assert.match(candidates,new RegExp("'"+key+"'"));for(const key of ['organizations','conferenceMemberships','conferenceRoles','deviceIds','systemRoles','canCreateConferences'])assert.doesNotMatch(candidates,new RegExp("'"+key+"'",'i'));});
test('5 catalog requires approved owner or same-module manager',()=>assert.match(catalog,/require_current_approved_device[\s\S]*is_system_owner[\s\S]*p_module_key, 'module\.manage'/));
test('6 catalog excludes foundation and generic module permissions',()=>assert.match(catalog,/not in \('module\.access', 'module\.manage'\)[\s\S]*not like 'module\.%'/));
test('7 catalog reads the canonical module catalog',()=>assert.match(catalog,/from public\.module_permission_catalog catalog/));
test('8 wrong-module manager is rejected by exact module key',()=>assert.match(candidates,/require_module_permission\([\s\S]*p_module_key, 'module\.manage'/));
test('9 revoked manager cannot authorize',()=>assert.match(foundation,/permission_key = 'module\.manage'[\s\S]*revoked_at is null/));
test('10 administration store discovery does not require store view',()=>assert.doesNotMatch(stores,/warehouse\.store\.view|require_effective_module_permission/));
test('11 stores require owner or Warehouse manager',()=>assert.match(stores,/is_system_owner[\s\S]*'warehouse', 'module\.manage'/));
test('12 store response is minimal',()=>{for(const key of ['storeId','code','name','status'])assert.match(stores,new RegExp("'"+key+"'"));assert.doesNotMatch(stores,/address|notes|organization/i);});
test('13 catalog mutation is protected-dispatcher routed',()=>{assert.match(dispatcher,/p_operation = 'manage_catalog_module_grant'/);assert.ok(sandbox.window.ConferenceDeviceOperationContract.isProtectedOperation('manage_catalog_module_grant'));assert.ok(edge.includes("'manage_catalog_module_grant'"));});
test('14 browser actor-device overrides are rejected',()=>assert.match(dispatcher,/p_args \? 'p_actor_device_id' or p_args \? 'p_device_id'/));
test('15 exact mutation arguments are enforced',()=>{for(const key of ['p_operation_id','p_action','p_target_user_id','p_module_key','p_permission_key','p_resource_type','p_resource_id','p_grant_id','p_revocation_reason'])assert.match(dispatcher,new RegExp("'"+key+"'"));});
test('16 System Owner can manage business catalog grants',()=>assert.match(catalogGrant,/manage_catalog_module_grant[\s\S]*if public\.is_system_owner\(actor_id\)/));
test('17 same-module manager can manage business catalog grants',()=>assert.match(catalogGrant,/manage_catalog_module_grant[\s\S]*p_module_key, 'module\.manage'/));
test('18 Module Manager cannot manage module.manage',()=>assert.match(delegation,/p_permission_key = 'module\.manage'[\s\S]*SYSTEM_OWNER_REQUIRED/));
test('19 Organization role is not Warehouse administration authority',()=>assert.doesNotMatch(stores,/organization/i));
test('20 Conference role is not Warehouse administration authority',()=>assert.doesNotMatch(stores,/conference/i));
test('21 Platform role is not Warehouse administration authority',()=>assert.doesNotMatch(stores,/platform\.(roles|user_roles|role_permissions|permissions)/i));
test('22 inventory authority is absent',()=>assert.doesNotMatch(migration,/inventory\./i));
test('23 Warehouse administration has no Organization dependency',()=>assert.doesNotMatch(stores,/organization_members|organizations|organization_id/i));
test('24 module access revocation does not cascade business grants',()=>assert.doesNotMatch(delegation,/update public\.module_permission_grants[\s\S]*permission_key (?:like|not in).*warehouse|delete from public\.module_permission_grants/i));
test('25 existing grant list remains canonical',()=>{assert.doesNotMatch(migration,/create (?:or replace )?function public\.list_module_permission_grants/i);assert.match(foundation,/create function public\.list_module_permission_grants/);});
test('26 migration creates or seeds no active grants',()=>assert.doesNotMatch(migration,/(?:insert into|update|delete from) public\.module_permission_grants/i));
test('27 all new RPCs are service-only and browser execute is revoked',()=>{for(const signature of ['public.search_module_permission_candidates(uuid,text,text,integer)','public.list_module_permission_catalog_for_administration(uuid,text)','warehouse.list_permission_administration_stores(uuid,boolean)','public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)']){assert.ok(migration.includes(signature));}assert.match(migration,/from public, anon, authenticated/);assert.match(migration,/to service_role/);});
test('28 store discovery is a Warehouse protected operation',()=>{const entry=sandbox.window.WarehouseDeviceOperationContract.get('list_permission_administration_stores');assert.equal(entry.signature,'warehouse.list_permission_administration_stores(uuid,boolean)');assert.equal(entry.dispatchable,true);assert.ok(edge.includes("'list_permission_administration_stores'"));});
test('29 dispatcher injects the validated session device',()=>{assert.match(dispatcher,/search_module_permission_candidates\(session\.device_id/);assert.match(dispatcher,/manage_catalog_module_grant\([\s\S]*session\.device_id/);assert.match(dispatcher,/list_permission_administration_stores\([\s\S]*session\.device_id/);});
test('30 store scope remains canonical text UUID',()=>assert.match(delegation,/grants\.resource_type = p_resource_type[\s\S]*grants\.resource_id = p_resource_id/));
