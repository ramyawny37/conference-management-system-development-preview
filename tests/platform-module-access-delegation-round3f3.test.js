'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync('supabase/migrations/20260907140000_module_access_delegation_enforcement.sql','utf8');
const foundation=fs.readFileSync('supabase/migrations/20260829120000_module_authorization_foundation.sql','utf8');
const systemAccess=fs.readFileSync('supabase/migrations/20260730_5_0_0_system_access_foundation.sql','utf8');
const catalog=fs.readFileSync('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql','utf8');
const warehouse=fs.readFileSync('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql','utf8');
const warehouseCatalog=fs.readFileSync('supabase/migrations/20260829140000_warehouse_module_permission_catalog.sql','utf8');
const contract=fs.readFileSync('js/supabase/warehouse-device-operation-contract.js','utf8');

function body(name){
  const escaped=name.replaceAll('.','\\.');
  const match=migration.match(new RegExp('create or replace function '+escaped+'[\\s\\S]*?\\$\\$;','i'));
  assert.ok(match,'missing function '+name);
  return match[0];
}
const effective=body('public.require_effective_module_permission');
const manage=body('public.manage_foundation_module_grant');
function before(source,a,b){assert.ok(source.indexOf(a)>=0,a);assert.ok(source.indexOf(b)>source.indexOf(a),b+' must follow '+a);}

test('1 effective resolver retains approved-device admission',()=>assert.match(effective,/actor_id := public\.require_current_approved_device\(p_actor_device_id\)/));
test('2 business catalog validation remains before authority resolution',()=>before(effective,'public.validate_module_permission_catalog(','if public.is_system_owner(actor_id)'));
test('3 System Owner returns before module-access and business-grant lookup',()=>{before(effective,"authoritySource', 'system_owner'","perform public.require_module_permission(");assert.match(effective,/'grantId', null/);});
test('4 non-owner business authority requires module access first',()=>before(effective,"'module.access', null, null",'matching_grant := null'));
test('5 module access and an active exact business grant authorize',()=>{assert.match(effective,/perform public\.require_module_permission[\s\S]*grants\.permission_key = p_permission_key/);assert.match(effective,/grants\.revoked_at is null/);});
test('6 module.manage continues to satisfy module.access',()=>assert.match(foundation,/p_permission_key = 'module\.access'[\s\S]*grants\.permission_key = 'module\.manage'/));
test('7 revoked foundation grants cannot satisfy access',()=>assert.match(foundation,/grants\.revoked_at is null[\s\S]*p_permission_key = 'module\.access'/));
test('8 revoked business grants cannot satisfy authority',()=>assert.equal((effective.match(/grants\.revoked_at is null/g)||[]).length,2));
test('9 exact Store grant requires exact resource type and id',()=>assert.match(effective,/grants\.resource_type = p_resource_type[\s\S]*grants\.resource_id = p_resource_id/));
test('10 module-wide business fallback remains available',()=>assert.match(effective,/matching_grant\.grant_id is null[\s\S]*grants\.resource_type is null[\s\S]*grants\.resource_id is null/));
test('11 effective resolver has no Organization dependency',()=>assert.doesNotMatch(effective,/organization/i));
test('12 effective resolver has no inventory authority dependency',()=>assert.doesNotMatch(effective,/inventory\./i));
test('13 effective resolver has no Platform-role authority dependency',()=>assert.doesNotMatch(effective,/platform\.(?:roles|user_roles|role_permissions|permissions)/i));

test('14 System Owner may create module.manage',()=>{assert.match(manage,/p_permission_key = 'module\.manage'[\s\S]*public\.is_system_owner\(actor_id\)[\s\S]*insert into public\.module_permission_grants/);});
test('15 System Owner may revoke module.manage subject to last-manager safety',()=>assert.match(manage,/p_permission_key = 'module\.manage'[\s\S]*LAST_MODULE_MANAGER_REVOCATION_PROHIBITED[\s\S]*set revoked_at = now\(\)/));
test('16 Module Manager cannot create module.manage',()=>assert.match(manage,/if p_permission_key = 'module\.manage' then[\s\S]*if not public\.is_system_owner\(actor_id\)[\s\S]*SYSTEM_OWNER_REQUIRED/));
test('17 Module Manager cannot revoke another module.manage',()=>assert.equal((manage.match(/if p_permission_key = 'module\.manage' then/g)||[]).length,2));
test('18 Module Manager may create module.access',()=>assert.match(manage,/elsif public\.is_system_owner[\s\S]*public\.require_module_permission\([\s\S]*'module\.manage'[\s\S]*if p_action = 'create'/));
test('19 Module Manager may revoke module.access',()=>assert.match(manage,/authority_grant_id[\s\S]*permission_key = 'module\.manage'[\s\S]*else[\s\S]*set revoked_at = now\(\)/));
test('20 System Owner may create and revoke module.access',()=>assert.match(manage,/elsif public\.is_system_owner\(actor_id\)[\s\S]*authority_source := 'system_owner'/));
test('21 self-grant prohibition remains',()=>assert.match(manage,/p_action = 'create' and actor_id = p_target_user_id[\s\S]*MODULE_GRANT_SELF_GRANT_PROHIBITED/));
test('22 unapproved target remains rejected',()=>assert.match(manage,/target_status is distinct from 'approved'[\s\S]*TARGET_ACCOUNT_APPROVED_REQUIRED/));
test('23 authority grant is bound to the same module',()=>assert.match(manage,/grants\.module_key = p_module_key[\s\S]*grants\.permission_key = 'module\.manage'/));
test('24 revoked module.manage cannot administer access',()=>assert.match(manage,/grants\.permission_key = 'module\.manage'[\s\S]*grants\.revoked_at is null/));
test('25 operation idempotency and intent mismatch remain',()=>assert.match(manage,/prior_operation\.intent_hash = intent[\s\S]*return prior_operation\.stored_result[\s\S]*MODULE_GRANT_OPERATION_MISMATCH/));
test('26 audit and operation ledger remain',()=>{assert.match(manage,/insert into public\.module_grant_operations/);assert.match(manage,/insert into public\.module_grant_audit_log/);});
test('27 final-manager recovery remains System Owner-only and separate',()=>{assert.match(catalog,/create function public\.recover_revoke_final_module_manager[\s\S]*public\.is_system_owner\(actor_id\)[\s\S]*SYSTEM_OWNER_REQUIRED/i);assert.doesNotMatch(migration,/create or replace function public\.recover_revoke_final_module_manager/i);});

test('28 Warehouse business permissions remain warehouse.*',()=>{assert.match(warehouseCatalog,/'warehouse\.[a-z_.]+'/);assert.doesNotMatch(warehouseCatalog,/'inventory\.[a-z_.]+'/);});
test('29 Warehouse Store scope stays exact UUID text',()=>assert.match(warehouse,/case when p_store_id is null then null else 'store' end[\s\S]*p_store_id::text/i));
test('30 Warehouse private guard still delegates to effective resolver',()=>assert.match(warehouse,/public\.require_effective_module_permission\(\s*p_device_id,'warehouse',p_permission/i));
test('31 foundation permissions stay outside business catalog',()=>{assert.doesNotMatch(warehouseCatalog,/'module\.(?:access|manage)'/);assert.match(manage,/p_permission_key not in \('module\.access', 'module\.manage'\)/);});
test('32 Warehouse gains no Organization dependency',()=>assert.doesNotMatch(warehouse+'\n'+contract,/organization_members|organizations|organization_id|organizationId/i));
test('33 no Inventory-to-Warehouse mapping exists',()=>assert.doesNotMatch(warehouse+'\n'+contract,/inventory\.[a-z]/i));
test('34 System Owner authority remains canonical system_user_roles',()=>{assert.match(systemAccess,/public\.system_user_roles[\s\S]*role\s*=\s*'system_owner'/i);assert.doesNotMatch(effective,/platform_owner|platform_admin|organization_owner|conference_owner/i);});

test('replacement functions preserve SECURITY DEFINER search paths and ACLs',()=>{for(const value of [effective,manage])assert.match(value,/security definer[\s\S]*set search_path = pg_catalog, public/i);assert.doesNotMatch(migration,/grant execute|revoke all/i);});
test('foundation resolver remains independent and recursion-free',()=>{const match=foundation.match(/create function public\.require_module_permission[\s\S]*?\$\$;/i);assert.ok(match);assert.doesNotMatch(match[0],/require_effective_module_permission/i);});
