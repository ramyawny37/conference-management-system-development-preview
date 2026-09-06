'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

function read(path){return fs.readFileSync(path,'utf8');}
function functionBody(source,qualifiedName){
  const escaped=qualifiedName.replaceAll('.','\\.');
  const match=source.match(new RegExp('create(?: or replace)? function '+escaped+'[\\s\\S]*?\\$\\$;','i'));
  assert.ok(match,'missing function: '+qualifiedName);
  return match[0];
}

const retirement=read('supabase/migrations/20260907130000_inventory_authority_retirement.sql');
const platformFoundation=read('supabase/migrations/20260831023000_platform_foundation_reconciliation.sql');
const phase1c=read('supabase/migrations/20260903150000_phase1c_server_device_context_reconciliation.sql');
const ownerReconciliation=read('supabase/migrations/20260907120000_system_owner_platform_owner_reconciliation.sql');
const accountReconciliation=read('supabase/migrations/20260906120000_system_access_platform_profile_reconciliation.sql');
const conferenceAuthority=read('tests/platform-conference-creation-authority-round3d5.test.js');
const moduleAdapter=read('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql');
const warehouseGuarded=read('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql');
const warehouseContract=read('js/supabase/warehouse-device-operation-contract.js');
const browserContract=read('js/supabase/conference-device-operation-contract.js');
const autoSync=read('tests/automatic-sync-orchestrator.test.js');

const seed=functionBody(retirement,'platform_private.seed_access_reference_data');
const hasPermissionFor=functionBody(retirement,'platform_private.has_permission_for');
const hasPermission=functionBody(retirement,'platform.has_permission');
const accessContext=functionBody(retirement,'platform.get_my_access_context');
const grantUserRole=functionBody(retirement,'platform.grant_user_role');
const requireModulePermission=functionBody(moduleAdapter,'public.require_effective_module_permission');
const warehouseRuntime=[warehouseGuarded,warehouseContract].join('\n');

test('exact legacy Inventory roles are frozen without deletion',()=>{
  assert.match(retirement,/update platform\.roles[\s\S]*is_assignable\s*=\s*false[\s\S]*domain\s*=\s*'inventory'[\s\S]*code in \('inventory_manager', 'inventory_operator', 'viewer'\)/i);
  assert.doesNotMatch(retirement,/delete\s+from\s+platform\.(?:roles|role_permissions|user_roles)/i);
});

test('future Inventory grants fail explicitly while Platform grants remain intact',()=>{
  assert.match(grantUserRole,/p_role_domain\s*=\s*'inventory'\s+or\s+p_scope_type\s*=\s*'inventory'[\s\S]*INVENTORY_AUTHORITY_RETIRED/i);
  assert.match(grantUserRole,/p_scope_type\s*<>\s*'platform'[\s\S]*UNSUPPORTED_ROLE_SCOPE/i);
  assert.match(grantUserRole,/from platform\.roles where domain=p_role_domain and code=p_role_code/i);
  assert.match(grantUserRole,/if not v_role\.is_assignable[\s\S]*ROLE_NOT_ASSIGNABLE/i);
  assert.match(grantUserRole,/insert into platform\.user_roles/i);
});

test('private permission resolution is Platform-only and keeps account and device checks',()=>{
  assert.match(hasPermissionFor,/platform_private\.is_account_approved\(p_user_id\)/i);
  assert.match(hasPermissionFor,/validated_phase1c_device_authorization[\s\S]*current_device_authorization_id/i);
  assert.match(hasPermissionFor,/p_scope_type\s*=\s*'platform'\s+and\s+p_scope_id is null/i);
  assert.match(hasPermissionFor,/assignment\.revoked_at is null[\s\S]*assignment\.expires_at/i);
  assert.match(hasPermissionFor,/role\.domain='platform'[\s\S]*permission\.domain='platform'/i);
  assert.doesNotMatch(hasPermissionFor,/'inventory'/i);
});

test('public policy helper defaults to Platform and cannot resolve Inventory',()=>{
  assert.match(hasPermission,/p_scope_type text default 'platform'/i);
  assert.match(hasPermission,/p_scope_type\s*=\s*'platform'/i);
  assert.doesNotMatch(hasPermission,/default 'inventory'/i);
});

test('Platform RLS retains explicit valid Platform permission checks',()=>{
  for(const code of ['platform.users.view','platform.roles.view','platform.devices.view','platform.audit.view'])
    assert.match(platformFoundation,new RegExp("platform\\.has_permission\\('"+code.replaceAll('.','\\.')+"','platform',null\\)",'i'));
});

test('access context defaults to Platform and Inventory produces no authority arrays',()=>{
  assert.match(accessContext,/p_domain text default 'platform',p_scope_type text default 'platform'/i);
  assert.match(accessContext,/'roles'[\s\S]*p_domain='platform'[\s\S]*p_scope_type='platform'/i);
  assert.match(accessContext,/'permissions'[\s\S]*p_domain='platform'[\s\S]*p_scope_type='platform'/i);
  assert.match(accessContext,/role\.domain='platform'[\s\S]*permission\.domain='platform'/i);
  assert.doesNotMatch(browserContract,/platform\.get_my_access_context\(text,text,uuid\)/i);
  assert.match(retirement,/revoke all on function platform\.get_my_access_context\(text,text,uuid\)[\s\S]*authenticated/i);
});

test('seed preserves dormant history but cannot reactivate Inventory roles',()=>{
  for(const role of ['inventory_manager','inventory_operator','viewer'])
    assert.match(seed,new RegExp("\\('"+role+"','inventory'[\\s\\S]{0,180}true,false\\)"));
  assert.match(seed,/platform_owner'[\s\S]{0,180}true,false/i);
  assert.match(seed,/platform_admin'[\s\S]{0,180}true,true/i);
  assert.match(seed,/insert into platform\.role_permissions/i);
});

test('Warehouse remains module-grant authority with exact Store scope',()=>{
  assert.match(moduleAdapter,/to_regclass\('public\.module_permission_grants'\)/i);
  assert.match(requireModulePermission,/from public\.module_permission_grants/i);
  assert.match(warehouseGuarded,/public\.require_effective_module_permission\(\s*p_device_id,'warehouse',p_permission/i);
  assert.match(warehouseGuarded,/case when p_store_id is null then null else 'store' end/i);
  assert.doesNotMatch(warehouseRuntime,/platform\.permissions|platform\.role_permissions|platform\.user_roles|inventory\.[a-z]/i);
});

test('Warehouse gains neither Organization dependency nor Inventory projection',()=>{
  assert.doesNotMatch(warehouseRuntime,/organization_members|organizations|organization_id|organizationId/i);
  assert.doesNotMatch(retirement,/module_permission_grants[\s\S]*(inventory|platform\.user_roles)|(inventory|platform\.user_roles)[\s\S]*module_permission_grants/i);
  assert.doesNotMatch(retirement,/warehouse\.[a-z_]+/i);
});

test('platform_owner remains separate and System Owner remains Warehouse bypass source',()=>{
  assert.match(ownerReconciliation,/public\.system_user_roles[\s\S]*system_owner[\s\S]*platform_owner/i);
  assert.match(requireModulePermission,/if public\.is_system_owner\(actor_id\) then/i);
  assert.doesNotMatch(requireModulePermission,/platform_owner|platform\.user_roles/i);
  assert.doesNotMatch(retirement,/system_user_roles|warehouse\.[a-z_]+|module_permission_(?:catalog|grants)/i);
});

test('prior account, owner, and Conference authority reconciliations stay independent',()=>{
  assert.match(accountReconciliation,/public\.system_user_access/i);
  assert.match(ownerReconciliation,/public\.system_user_roles/i);
  assert.match(conferenceAuthority,/can_create_conferences/i);
  assert.doesNotMatch(retirement,/can_create_conferences|organization_members|system_user_access/i);
});

test('device/session and SECURITY DEFINER boundaries remain closed',()=>{
  assert.match(hasPermissionFor,/validated_phase1c_device_authorization/i);
  assert.match(hasPermissionFor,/current_device_authorization_id/i);
  for(const body of [hasPermissionFor,hasPermission,accessContext,grantUserRole]){
    assert.match(body,/security definer set search_path\s*=\s*''/i);
  }
  assert.match(retirement,/revoke all on function platform_private\.seed_access_reference_data\(\)[\s\S]*service_role/i);
  assert.match(retirement,/revoke all on function platform_private\.has_permission_for\(uuid,text,text,uuid\)[\s\S]*service_role/i);
});

test('automatic-sync blocker remains event/state based and untouched',()=>{
  assert.match(autoSync,/async function waitForEvaluationToFinish[\s\S]*while\s*\([\s\S]*await new Promise/i);
  assert.doesNotMatch(retirement,/automatic.?sync|setTimeout|sleep/i);
  assert.doesNotMatch([platformFoundation,phase1c].join('\n'),/inventory\.[a-z][\s\S]{0,100}warehouse\.[a-z]|warehouse\.[a-z][\s\S]{0,100}inventory\.[a-z]/i);
});
