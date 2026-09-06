'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

function read(path){return fs.readFileSync(path,'utf8');}
function functionBody(source,qualifiedName){
  const escaped=qualifiedName.replaceAll('.','\\.');
  const match=source.match(new RegExp(
    'create(?: or replace)? function '+escaped+'[\\s\\S]*?\\$\\$;',
    'i'
  ));
  assert.ok(match,'missing function: '+qualifiedName);
  return match[0];
}
function tableDefinition(source,qualifiedName){
  const escaped=qualifiedName.replaceAll('.','\\.');
  const match=source.match(new RegExp(
    'create table '+escaped+'\\s*\\([\\s\\S]*?\\n\\);',
    'i'
  ));
  assert.ok(match,'missing table: '+qualifiedName);
  return match[0];
}

const systemAccess=read('supabase/migrations/20260730_5_0_0_system_access_foundation.sql');
const launchMembership=read('supabase/migrations/20260815_6_11_0_launch_membership_integrity.sql');
const accountAdministration=read('supabase/migrations/20260808_6_3_0_account_administration.sql');
const conferenceSession=read('supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql');
const phase1cReconciliation=read('supabase/migrations/20260903150000_phase1c_server_device_context_reconciliation.sql');
const unifiedDispatcher=read('supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql');
const platformFoundation=read('supabase/migrations/20260831023000_platform_foundation_reconciliation.sql');
const ownerProjection=read('supabase/migrations/20260907120000_system_owner_platform_owner_reconciliation.sql');
const accountProjection=read('supabase/migrations/20260906120000_system_access_platform_profile_reconciliation.sql');
const moduleAdapter=read('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql');
const warehouseGuarded=read('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql');
const warehouseContract=read('js/supabase/warehouse-device-operation-contract.js');

const canCreate=functionBody(systemAccess,'public.can_user_create_conferences');
const systemAccessTable=tableDefinition(systemAccess,'public.system_user_access');
const isSystemOwner=functionBody(systemAccess,'public.is_system_owner');
const grantSystemRole=functionBody(systemAccess,'public.grant_system_role');
const revokeSystemRole=functionBody(systemAccess,'public.revoke_system_role');
const setCapability=functionBody(systemAccess,'public.set_user_conference_creation_permission');
const createConference=functionBody(launchMembership,'public.create_organization_conference_idempotent');
const guardedCreate=functionBody(launchMembership,'public.device_guarded_create_organization_conference_idempotent');
const guardedManage=functionBody(accountAdministration,'public.device_guarded_manage_system_user');
const executeDeviceOperation=functionBody(unifiedDispatcher,'platform.execute_device_operation');
const conferenceCore=functionBody(conferenceSession,'platform.execute_conference_device_operation');
const phase1cBridge=functionBody(phase1cReconciliation,'platform.execute_conference_device_operation');
const conferenceEntry=functionBody(unifiedDispatcher,'platform.execute_conference_device_operation');
const requireModulePermission=functionBody(moduleAdapter,'public.require_effective_module_permission');

const architecture=Object.freeze({
  canonicalSource:'public.system_user_access.can_create_conferences',
  domain:'conference',
  systemOwnerBypass:true,
  projectionToPlatform:'forbidden',
  projectionFromPlatform:'forbidden',
  warehouseDependency:'forbidden',
  organizationRequiredForCreation:true,
  migrationRequired:false
});

test('canonical Conference capability is an approved System Access flag with owner bypass',()=>{
  assert.match(systemAccessTable,/can_create_conferences\s+boolean\s+not null\s+default false/i);
  assert.match(canCreate,/from public\.system_user_access as access/i);
  assert.match(canCreate,/access\.account_status = 'approved'/i);
  assert.match(canCreate,/access\.can_create_conferences\s+or public\.is_system_owner\(can_user_create_conferences\.user_id\)/i);
  assert.equal(architecture.canonicalSource,'public.system_user_access.can_create_conferences');
  assert.equal(architecture.domain,'conference');
  assert.equal(architecture.systemOwnerBypass,true);
});

test('System Owner bypass resolves only canonical System Owner role state',()=>{
  assert.match(canCreate,/public\.is_system_owner\(can_user_create_conferences\.user_id\)/i);
  assert.match(isSystemOwner,/from\s+public\.system_user_roles\s+as\s+roles/i);
  assert.match(isSystemOwner,/roles\.user_id\s*=\s*is_system_owner\.user_id/i);
  assert.match(isSystemOwner,/roles\.role\s*=\s*'system_owner'/i);
  assert.doesNotMatch(isSystemOwner,
    /platform_owner|platform\.roles|platform\.user_roles|platform\.permissions|role_permissions|can_create_conferences/i);
});

test('System Owner bypass and the explicit stored capability remain independent',()=>{
  assert.match(canCreate,/access\.can_create_conferences\s+or public\.is_system_owner/i);
  assert.doesNotMatch(grantSystemRole,/can_create_conferences|set_user_conference_creation_permission/i);
  assert.doesNotMatch(revokeSystemRole,/can_create_conferences|set_user_conference_creation_permission/i);
  assert.match(setCapability,/set can_create_conferences = allowed/i);
  assert.doesNotMatch(setCapability,/system_user_roles[\s\S]*(insert|delete|update)/i);
});

test('approved non-owner explicit capability is eligible and account approval fails closed',()=>{
  assert.match(canCreate,/access\.account_status = 'approved'[\s\S]*access\.can_create_conferences\s+or public\.is_system_owner/i);
  assert.doesNotMatch(canCreate,/access\.can_create_conferences\s+and public\.is_system_owner/i);
  const approval=canCreate.indexOf("access.account_status = 'approved'");
  const capability=canCreate.indexOf('access.can_create_conferences');
  assert.ok(approval>=0&&capability>approval,'approval must guard the capability disjunction');
});

test('unified device/session validation precedes Conference creation dispatch',()=>{
  assert.match(executeDeviceOperation,/p_module\s+not in\s*\(\s*'conference'\s*,\s*'warehouse'\s*\)/i);
  const sessionValidation=executeDeviceOperation.indexOf("item.purpose='PLATFORM_DEVICE_SESSION'");
  const sessionFailure=executeDeviceOperation.indexOf("raise exception 'DEVICE_SESSION_INVALID'");
  const conferenceDispatch=executeDeviceOperation.indexOf("if p_module='conference'");
  assert.ok(sessionValidation>=0&&sessionFailure>sessionValidation&&conferenceDispatch>sessionFailure);
  assert.match(executeDeviceOperation,/profile\.account_status='approved'/i);
  assert.doesNotMatch(executeDeviceOperation,/can_create_conferences/i);
});

test('current Conference entry and unified dispatch retain the Phase1C core lineage',()=>{
  assert.match(phase1cReconciliation,
    /alter function\s+platform\.execute_conference_device_operation\(uuid\s*,\s*uuid\s*,\s*bytea\s*,\s*text\s*,\s*jsonb\)\s+rename to\s+execute_conference_device_operation_phase1c_core/i);
  assert.match(phase1cBridge,
    /return\s+platform\.execute_conference_device_operation_phase1c_core\(p_user_id\s*,\s*p_session_id\s*,\s*p_token_hash\s*,\s*p_operation\s*,\s*p_args\)/i);
  assert.match(conferenceEntry,
    /select\s+platform\.execute_device_operation\(p_user_id\s*,\s*p_session_id\s*,\s*p_token_hash\s*,\s*'conference'\s*,\s*p_operation\s*,\s*p_args\)/i);
  assert.match(executeDeviceOperation,
    /if\s+p_module\s*=\s*'conference'\s+then\s+return\s+platform\.execute_conference_device_operation_phase1c_core\(p_user_id\s*,\s*p_session_id\s*,\s*p_token_hash\s*,\s*p_operation\s*,\s*p_args\)/i);
});

test('Conference dispatch reaches both guarded and internal idempotent creation functions',()=>{
  assert.match(conferenceCore,/when 'device_guarded_create_organization_conference_idempotent'[\s\S]*public\.device_guarded_create_organization_conference_idempotent/i);
  assert.match(guardedCreate,/perform public\.require_current_approved_device\(p_actor_device_id\)/i);
  assert.match(guardedCreate,/return public\.create_organization_conference_idempotent/i);
  assert.match(createConference,/from public\.system_user_access where user_id=actor_id/i);
  assert.match(createConference,/not public\.can_user_create_conferences\(actor_id\)/i);
});

test('Conference creation requires an active Organization and actor membership',()=>{
  assert.match(createConference,/from public\.organizations o where o\.id=p_organization_id and o\.status='active'/i);
  assert.match(createConference,/from public\.organization_members m where m\.organization_id=p_organization_id and m\.user_id=actor_id/i);
  assert.match(createConference,/ACTIVE_ORGANIZATION_MEMBERSHIP_REQUIRED/i);
  assert.equal(architecture.organizationRequiredForCreation,true);
});

test('Platform role and owner/account projections remain separate from Conference creation',()=>{
  assert.doesNotMatch(platformFoundation,/can_create_conferences/i);
  assert.doesNotMatch(ownerProjection,/can_create_conferences/i);
  assert.doesNotMatch(accountProjection,/can_create_conferences/i);
  assert.doesNotMatch(canCreate,/platform_owner|platform\.permissions|platform\.user_roles/i);
  assert.equal(architecture.projectionToPlatform,'forbidden');
  assert.equal(architecture.projectionFromPlatform,'forbidden');
  assert.equal(architecture.migrationRequired,false);
});

test('Warehouse authorization stays independent of Conference capability and Organizations',()=>{
  for(const source of [moduleAdapter,warehouseGuarded,warehouseContract]){
    assert.doesNotMatch(source,/can_create_conferences/i);
  }
  assert.doesNotMatch([warehouseGuarded,warehouseContract].join('\n'),/organization_members|organizations/i);
  assert.match(requireModulePermission,/if public\.is_system_owner\(actor_id\) then/i);
  assert.doesNotMatch(requireModulePermission,/can_create_conferences|platform_owner|organization/i);
  assert.equal(architecture.warehouseDependency,'forbidden');
});

test('Conference capability is not a global device-session admission rule',()=>{
  assert.match(executeDeviceOperation,/device_key_bindings[\s\S]*user_device_authorizations[\s\S]*devices[\s\S]*profiles/i);
  assert.match(executeDeviceOperation,/profile\.account_status='approved'/i);
  assert.doesNotMatch(executeDeviceOperation,/can_user_create_conferences|can_create_conferences/i);
  assert.match(createConference,/can_user_create_conferences\(actor_id\)/i);
});

test('guarded System User administration explicitly controls the capability',()=>{
  const deviceCheck=guardedManage.indexOf('public.require_current_approved_device');
  const ownerCheck=guardedManage.indexOf('public.is_system_owner');
  const action=guardedManage.indexOf("p_action='approve'");
  const setter=guardedManage.indexOf('public.set_user_conference_creation_permission');
  assert.ok(deviceCheck>=0&&ownerCheck>deviceCheck&&setter>action&&setter>ownerCheck);
  assert.match(guardedManage,
    /p_action\s+in\s*\(\s*'approve'\s*,\s*'set_conference_creation_permission'\s*\)\s+and\s+p_requested_value\s+is null/i);
  assert.match(guardedManage,
    /result\s*:=\s*public\.set_user_conference_creation_permission\(\s*p_target_user_id\s*,\s*p_requested_value\s*\)/i);
  assert.match(setCapability,/target_user_id\s+uuid\s*,\s*allowed\s+boolean/i);
  assert.match(setCapability,/if\s+allowed\s+is null\s+then[\s\S]*INVALID_PERMISSION_VALUE/i);
  assert.match(conferenceCore,
    /when\s+'device_guarded_manage_system_user'\s+then[\s\S]*require_exact_jsonb_keys\(p_args\s*,\s*array\['p_target_user_id'\s*,\s*'p_operation_id'\s*,\s*'p_action'\]\s*,\s*array\['p_requested_value'\]\)[\s\S]*public\.device_guarded_manage_system_user\([\s\S]*\(p_args->>'p_requested_value'\)::boolean/i);
  assert.match(setCapability,/if actor_id is null or not public\.is_system_owner\(actor_id\)/i);
});

test('architecture contract is backed by the inspected repository implementation',()=>{
  assert.deepEqual(architecture,{
    canonicalSource:'public.system_user_access.can_create_conferences',
    domain:'conference',
    systemOwnerBypass:true,
    projectionToPlatform:'forbidden',
    projectionFromPlatform:'forbidden',
    warehouseDependency:'forbidden',
    organizationRequiredForCreation:true,
    migrationRequired:false
  });
  assert.match(canCreate,/public\.is_system_owner/);
  assert.match(createConference,/public\.organization_members/);
  assert.doesNotMatch([ownerProjection,accountProjection,warehouseGuarded].join('\n'),/can_create_conferences/i);
});
