'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

function read(path){return fs.readFileSync(path,'utf8');}

const systemAccess=read('supabase/migrations/20260730_5_0_0_system_access_foundation.sql');
const platformFoundation=read('supabase/migrations/20260831023000_platform_foundation_reconciliation.sql');
const platformBootstrap=read('supabase/migrations/20260831024500_first_platform_owner_bootstrap_reconciliation.sql');
const accountProjection=read('supabase/migrations/20260906120000_system_access_platform_profile_reconciliation.sql');
const ownerProjection=read('supabase/migrations/20260907120000_system_owner_platform_owner_reconciliation.sql');
const moduleAdapter=read('supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql');
const warehouseGuarded=read('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql');
const dispatcher=read('supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql');
const organizationFoundation=read('supabase/migrations/20260801_5_1_0_organization_foundation.sql');
const organizationAdministration=read('supabase/migrations/20260801_5_3_0_organization_administration.sql');
const conferenceContract=read('js/supabase/conference-device-operation-contract.js');
const warehouseContract=read('js/supabase/warehouse-device-operation-contract.js');

function functionBody(source,qualifiedName){
  const escaped=qualifiedName.replaceAll('.','\\.');
  const match=source.match(new RegExp(
    'create(?: or replace)? function '+escaped+'[\\s\\S]*?\\$\\$;',
    'i'
  ));
  assert.ok(match,'missing function: '+qualifiedName);
  return match[0];
}

const isSystemOwner=functionBody(systemAccess,'public.is_system_owner');
const grantSystemRole=functionBody(systemAccess,'public.grant_system_role');
const revokeSystemRole=functionBody(systemAccess,'public.revoke_system_role');
const grantPlatformRole=functionBody(platformFoundation,'platform.grant_user_role');
const revokePlatformRole=functionBody(platformFoundation,'platform.revoke_user_role');
const hasPlatformPermission=functionBody(platformFoundation,'platform_private.has_permission_for');
const requireModulePermission=functionBody(moduleAdapter,'public.require_effective_module_permission');
const executeDeviceOperation=functionBody(dispatcher,'platform.execute_device_operation');
const reconcileOwner=functionBody(ownerProjection,'platform_private.reconcile_system_owner_platform_owner');
const reconcileOwnerTrigger=functionBody(ownerProjection,'platform_private.reconcile_system_owner_platform_owner_trigger');

const expectedOwnerReconciliation=Object.freeze({
  canonicalSource:Object.freeze({
    relation:'public.system_user_roles',
    role:'system_owner'
  }),
  compatibilityTarget:Object.freeze({
    assignmentRelation:'platform.user_roles',
    roleRelation:'platform.roles',
    domain:'platform',
    role:'platform_owner',
    activePredicate:'revoked_at IS NULL',
    effectivePredicate:'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())'
  }),
  direction:'system_owner -> platform_owner',
  reverseAuthority:'forbidden',
  grant:Object.freeze({atomic:true,activeAssignments:1}),
  revoke:Object.freeze({atomic:true,effectiveAssignments:0}),
  failedLastOwnerRevocation:Object.freeze({canonicalUnchanged:true,compatibilityUnchanged:true}),
  idempotent:true,
  preserveRevokedHistory:true,
  mechanism:'private_internal',
  excluded:Object.freeze(['system_admin','platform_admin','can_create_conferences'])
});

test('System Owner is the canonical top-level authority',()=>{
  assert.match(systemAccess,/create table public\.system_user_roles/i);
  assert.match(systemAccess,/role text not null check \(role in \('system_owner', 'system_admin'\)\)/i);
  assert.match(isSystemOwner,/from public\.system_user_roles as roles/i);
  assert.match(isSystemOwner,/roles\.user_id = is_system_owner\.user_id/i);
  assert.match(isSystemOwner,/roles\.role = 'system_owner'/i);
  assert.doesNotMatch(isSystemOwner,/platform_owner|platform\.user_roles/i);
});

test('Platform Owner is one non-assignable system role in Platform scope',()=>{
  assert.match(platformFoundation,
    /\('platform_owner','platform','Platform Owner',[\s\S]*?'platform',true,false\)/i);
  assert.match(platformFoundation,/unique \(domain, code\), check \(domain = scope_type\)/i);
  assert.match(platformBootstrap,
    /where role\.domain='platform' and role\.code='platform_owner'/i);
});

test('next owner reconciliation has one explicit canonical-to-compatibility contract',()=>{
  assert.deepEqual(expectedOwnerReconciliation.canonicalSource,
    {relation:'public.system_user_roles',role:'system_owner'});
  assert.deepEqual(expectedOwnerReconciliation.compatibilityTarget,{
    assignmentRelation:'platform.user_roles',
    roleRelation:'platform.roles',
    domain:'platform',
    role:'platform_owner',
    activePredicate:'revoked_at IS NULL',
    effectivePredicate:'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())'
  });
  assert.equal(expectedOwnerReconciliation.direction,'system_owner -> platform_owner');
  assert.equal(expectedOwnerReconciliation.reverseAuthority,'forbidden');
  assert.deepEqual(expectedOwnerReconciliation.grant,{atomic:true,activeAssignments:1});
  assert.deepEqual(expectedOwnerReconciliation.revoke,{atomic:true,effectiveAssignments:0});
  assert.deepEqual(expectedOwnerReconciliation.failedLastOwnerRevocation,
    {canonicalUnchanged:true,compatibilityUnchanged:true});
  assert.equal(expectedOwnerReconciliation.idempotent,true);
  assert.equal(expectedOwnerReconciliation.preserveRevokedHistory,true);
  assert.equal(expectedOwnerReconciliation.mechanism,'private_internal');
  assert.deepEqual(expectedOwnerReconciliation.excluded,
    ['system_admin','platform_admin','can_create_conferences']);
});

test('current authority sources and protections are compatible with the next contract',()=>{
  assert.match(isSystemOwner,new RegExp(
    'from '+expectedOwnerReconciliation.canonicalSource.relation.replaceAll('.','\\.')+
    "[\\s\\S]*role = '"+expectedOwnerReconciliation.canonicalSource.role+"'",
    'i'
  ));
  assert.match(platformFoundation,new RegExp(
    "\\('"+expectedOwnerReconciliation.compatibilityTarget.role+"','"+
    expectedOwnerReconciliation.compatibilityTarget.domain+"'[\\s\\S]*?true,false\\)",
    'i'
  ));
  assert.doesNotMatch([platformFoundation,platformBootstrap].join('\n'),
    /public\.system_user_roles|public\.grant_system_role|public\.revoke_system_role/i);
  assert.doesNotMatch(systemAccess,/platform\.user_roles|platform_owner|platform_admin/i);
  assert.doesNotMatch(accountProjection,
    /system_user_roles|platform\.user_roles|system_owner|platform_owner|system_admin|platform_admin|can_create_conferences/i);
  assert.match(systemAccess,/can_create_conferences boolean not null default false/i);
  assert.match(platformFoundation,/'platform_admin','platform'/i);
});

test('current Platform assignment primitives support unique effective state and retained history',()=>{
  assert.match(platformFoundation,
    /create unique index user_roles_active_assignment_idx on platform\.user_roles \(user_id, role_id, scope_type\) where revoked_at is null/i);
  assert.match(hasPlatformPermission,
    /assignment\.revoked_at is null and \(assignment\.expires_at is null or assignment\.expires_at>pg_catalog\.now\(\)\)/i);
  assert.match(grantPlatformRole,
    /select id into v_id from platform\.user_roles[\s\S]*revoked_at is null/i);
  assert.match(grantPlatformRole,/if v_id is null then insert into platform\.user_roles/i);
  assert.match(revokePlatformRole,
    /update platform\.user_roles set revoked_at=pg_catalog\.now\(\),revoked_by=auth\.uid\(\)/i);
  assert.doesNotMatch(revokePlatformRole,/delete from platform\.user_roles/i);
});

test('canonical role mutation retains approval and last-owner transaction protections',()=>{
  assert.match(grantSystemRole,
    /from public\.system_user_access[\s\S]*user_id = target_user_id and account_status = 'approved'/i);
  assert.match(grantSystemRole,/raise exception 'ACCOUNT_NOT_APPROVED'/i);
  const lock=revokeSystemRole.indexOf('pg_advisory_xact_lock');
  const count=revokeSystemRole.indexOf('select count(*) into owner_count');
  const guard=revokeSystemRole.indexOf("raise exception 'LAST_SYSTEM_OWNER_REQUIRED'");
  const removal=revokeSystemRole.indexOf('delete from public.system_user_roles');
  assert.ok(lock>=0&&count>lock&&guard>count&&removal>guard,
    'last-owner guard must run under the transaction lock before canonical deletion');
  assert.match(revokeSystemRole,/owner_count <= 1 and public\.is_system_owner\(target_user_id\)/i);
  assert.doesNotMatch(revokeSystemRole,/platform\.user_roles|platform_owner/i);
});

test('direct Platform APIs cannot grant or revoke Platform Owner',()=>{
  assert.match(grantPlatformRole,/if not v_role\.is_assignable then raise exception 'ROLE_NOT_ASSIGNABLE'/i);
  assert.match(revokePlatformRole,
    /if v_role\.code='platform_owner' then raise exception 'PLATFORM_OWNER_ROLE_CANNOT_BE_REVOKED_BY_RPC'/i);
});

test('Organizations remain Conference-only and no third top-level owner is defined',()=>{
  assert.match(organizationFoundation,/create table public\.organizations/i);
  assert.match(organizationFoundation,/create table public\.organization_members/i);
  assert.match(organizationAdministration,
    /alter table public\.organization_members[\s\S]*add column role text not null default 'member'[\s\S]*check \(role in \('organization_owner', 'organization_admin', 'member'\)\)/i);
  assert.match(conferenceContract,/device_guarded_list_my_organizations/i);
  assert.doesNotMatch([platformFoundation,platformBootstrap,moduleAdapter].join('\n'),
    /organization_owner|organization_admin/i);
  assert.doesNotMatch(organizationFoundation,/system_owner|platform_owner/i);
});

test('Warehouse authority and device-session boundaries stay independent',()=>{
  assert.match(warehouseGuarded,
    /public\.require_effective_module_permission\(\s*p_device_id,'warehouse',p_permission/i);
  assert.match(requireModulePermission,/if public\.is_system_owner\(actor_id\) then/i);
  assert.match(requireModulePermission,/'authoritySource', 'system_owner'/i);
  assert.doesNotMatch([moduleAdapter,warehouseGuarded,warehouseContract].join('\n'),
    /platform_owner|platform\.user_roles|organization_members|organization_owner|organization_admin/i);
  assert.match(executeDeviceOperation,
    /create or replace function platform\.execute_device_operation/i);
  assert.match(executeDeviceOperation,/item\.purpose='PLATFORM_DEVICE_SESSION'/i);
  assert.match(executeDeviceOperation,/profile\.account_status='approved'/i);
  assert.match(executeDeviceOperation,/p_args \? 'p_actor_device_id'.*p_args \? 'p_device_id'/i);
});

test('owner compatibility helper derives exact one-way state from canonical System Owner',()=>{
  assert.match(reconcileOwner,/\(\s*p_user_id uuid\s*\)/i);
  assert.doesNotMatch(reconcileOwner,/p_(?:desired|owner|enabled|state)\s+(?:boolean|text)/i);
  assert.match(reconcileOwner,/from public\.system_user_roles as system_role[\s\S]*system_role\.user_id = p_user_id[\s\S]*system_role\.role = 'system_owner'/i);
  for(const predicate of [
    "role.domain = 'platform'",
    "role.code = 'platform_owner'",
    "role.scope_type = 'platform'",
    'role.is_system = true',
    'role.is_assignable = false'
  ]) assert.ok(reconcileOwner.includes(predicate),predicate);
  assert.match(reconcileOwner,/if v_role_count <> 1 then[\s\S]*PLATFORM_OWNER_COMPATIBILITY_ROLE_INVALID/i);
  assert.doesNotMatch(ownerProjection,/create trigger[\s\S]*on platform\.user_roles/i);
  assert.doesNotMatch(reconcileOwner,/insert into public\.system_user_roles|grant_system_role|revoke_system_role/i);
});

test('owner projection preserves history, repairs expiry, and converges active state',()=>{
  assert.match(reconcileOwner,/pg_advisory_xact_lock/i);
  assert.match(platformFoundation,/create unique index user_roles_active_assignment_idx[\s\S]*where revoked_at is null/i);
  assert.match(reconcileOwner,/assignment\.revoked_at is null[\s\S]*for update/i);
  assert.match(reconcileOwner,/set expires_at = null[\s\S]*expires_at is not null/i);
  assert.match(reconcileOwner,/insert into platform\.user_roles[\s\S]*'platform', null, null, null/i);
  assert.match(reconcileOwner,/set revoked_at = pg_catalog\.now\(\),[\s\S]*revoked_by = null[\s\S]*assignment\.revoked_at is null/i);
  assert.doesNotMatch(reconcileOwner,/delete from platform\.user_roles/i);
  assert.doesNotMatch(reconcileOwner,/platform\.grant_user_role|platform\.revoke_user_role/i);
});

test('AFTER canonical trigger covers owner mutations and excludes System Admin',()=>{
  assert.match(ownerProjection,/create trigger system_owner_reconcile_platform_owner\s+after insert or delete or update of user_id, role\s+on public\.system_user_roles/i);
  assert.match(reconcileOwnerTrigger,/old\.role = 'system_owner'/i);
  assert.match(reconcileOwnerTrigger,/new\.role = 'system_owner'/i);
  assert.doesNotMatch(reconcileOwnerTrigger,/system_admin|platform_admin|can_create_conferences/i);
  assert.doesNotMatch(ownerProjection,/before insert|before delete|before update/i);
});

test('owner-to-owner UPDATE reconciliation acquires per-user locks deterministically',()=>{
  assert.match(reconcileOwnerTrigger,
    /old\.role = 'system_owner'[\s\S]*new\.role = 'system_owner'[\s\S]*old\.user_id is distinct from new\.user_id/i);
  assert.match(reconcileOwnerTrigger,
    /if old\.user_id::text < new\.user_id::text then[\s\S]*reconcile_system_owner_platform_owner\(old\.user_id\)[\s\S]*reconcile_system_owner_platform_owner\(new\.user_id\)[\s\S]*else[\s\S]*reconcile_system_owner_platform_owner\(new\.user_id\)[\s\S]*reconcile_system_owner_platform_owner\(old\.user_id\)/i);
  assert.doesNotMatch(reconcileOwnerTrigger,
    /if tg_op <> 'INSERT'[\s\S]*reconcile_system_owner_platform_owner\(old\.user_id\)[\s\S]*if tg_op <> 'DELETE'[\s\S]*reconcile_system_owner_platform_owner\(new\.user_id\)/i);
});

test('initial reconciliation is the union of canonical owners and active compatibility owners',()=>{
  const initialBlock=ownerProjection.match(/do \$\$[\s\S]*?\$\$;/i)?.[0];
  assert.ok(initialBlock,'missing initial reconciliation block');
  assert.match(initialBlock,/from public\.system_user_roles as system_role[\s\S]*system_role\.role = 'system_owner'[\s\S]*union[\s\S]*from platform\.user_roles as assignment/i);
  assert.match(initialBlock,/role\.code = 'platform_owner'[\s\S]*assignment\.revoked_at is null/i);
  assert.match(initialBlock,/perform platform_private\.reconcile_system_owner_platform_owner\(v_user_id\)/i);
});

test('owner projection is private, audited internally, and leaves protected APIs unchanged',()=>{
  assert.match(reconcileOwner,/security definer[\s\S]*set search_path = ''/i);
  assert.match(reconcileOwnerTrigger,/security definer[\s\S]*set search_path = ''/i);
  assert.match(ownerProjection,/revoke all on function platform_private\.reconcile_system_owner_platform_owner\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(ownerProjection,/revoke all on function platform_private\.reconcile_system_owner_platform_owner_trigger\(\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(reconcileOwner,/insert into platform\.audit_events[\s\S]*'system'/i);
  assert.match(reconcileOwner,/compatibility_granted|compatibility_revoked|compatibility_reactivated/i);
  assert.doesNotMatch(reconcileOwner,/current_device_authorization_id|device_sessions|execute_device_operation/i);
  assert.match(grantPlatformRole,/ROLE_NOT_ASSIGNABLE/i);
  assert.match(revokePlatformRole,/PLATFORM_OWNER_ROLE_CANNOT_BE_REVOKED_BY_RPC/i);
  assert.doesNotMatch(ownerProjection,/can_create_conferences|organization_members|warehouse|inventory|platform_admin/i);
});
