'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');

var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(root,
  'supabase/migrations/20260829130000_module_permission_catalog_and_grant_adapter.sql'
),'utf8');
var foundation=fs.readFileSync(path.join(root,
  'supabase/migrations/20260829120000_module_authorization_foundation.sql'
),'utf8');
var runtime=fs.readFileSync(path.join(root,
  'supabase/module-permission-catalog-grant-adapter-deferred-runtime-verification.sql'
),'utf8');
var disable=fs.readFileSync(path.join(root,
  'supabase/module-permission-catalog-grant-adapter-nondestructive-disable.sql'
),'utf8');
var concurrency=fs.readFileSync(path.join(root,
  'tools/run-module-permission-catalog-concurrency-verification.cjs'
),'utf8');

function body(name){
  var match=migration.match(new RegExp(
    'create(?: or replace)? function public\\.'+name+'[\\s\\S]*?\\n\\$\\$;', 'i'
  ));
  assert.ok(match,'missing function body: '+name);
  return match[0];
}

function normalizedSignature(value){
  return value.replace(/\s+/g,'').toLowerCase();
}

function assertIntentBinding(functionBody,fields,label){
  var intentStart=functionBody.indexOf('intent := encode(extensions.digest(');
  var lockStart=functionBody.indexOf("'module-grant-operation:'");
  assert.ok(intentStart>=0 && lockStart>intentStart,label+' must build intent before locking');
  var intentBody=functionBody.slice(intentStart,lockStart);
  fields.forEach(function(field){
    assert.ok(intentBody.indexOf("'"+field+"'")>=0,
      label+' intent must bind '+field);
  });
  assert.match(intentBody,/jsonb_build_object\([\s\S]*\)::text[\s\S]*'sha256'/i,
    label+' intent must use canonical JSONB SHA-256');
}

[
  /^begin\s*;/i,
  /commit\s*;\s*$/i,
  /create table public\.module_permission_catalog/i,
  /permission_key text primary key/i,
  /module_key text not null references public\.platform_modules\(module_key\) on delete restrict/i,
  /permission_key ~ '\^\[a-z\]\[a-z0-9_\]\*\(\\\.\[a-z\]\[a-z0-9_\]\*\)\{2,\}\$'/i,
  /permission_key not like 'module\.%'/i,
  /allowed_scope_mode in \('module', 'resource', 'both'\)/i,
  /status in \('active', 'retired'\)/i,
  /catalog_version integer not null/i,
  /create trigger module_permission_catalog_protect_history/i,
  /MODULE_PERMISSION_CATALOG_DELETE_PROHIBITED/i,
  /MODULE_PERMISSION_CATALOG_REACTIVATION_PROHIBITED/i,
  /MODULE_PERMISSION_CATALOG_VERSION_INCREMENT_REQUIRED/i,
  /alter table public\.module_permission_catalog enable row level security/i,
  /revoke all on table public\.module_permission_catalog from public, anon, authenticated/i,
  /create function public\.validate_module_permission_catalog/i,
  /create function public\.require_effective_module_permission/i,
  /create function public\.manage_catalog_module_grant/i,
  /create or replace function public\.manage_foundation_module_grant/i,
  /create function public\.recover_revoke_final_module_manager/i,
  /final_manager_recovery_revoked/i,
  /recover_revoke_final_manager/i,
  /recoveryReason/i
].forEach(function(pattern){assert.match(migration,pattern);});

assert.doesNotMatch(migration,/insert\s+into\s+public\.platform_modules/i,
  'Foundation must not register modules');
assert.doesNotMatch(migration,/insert\s+into\s+public\.module_permission_catalog/i,
  'Foundation must not seed module permissions');
assert.doesNotMatch(migration,/grant execute[\s\S]*manage_catalog_module_grant[\s\S]*to authenticated/i,
  'internal catalog manager must not be directly executable');
assert.doesNotMatch(migration,/grant execute[\s\S]*require_effective_module_permission[\s\S]*to authenticated/i,
  'internal authorization helper must not be directly executable');
assert.doesNotMatch(migration,/grant\s+(insert|update|delete|all)\s+on table public\.module_permission_catalog\s+to authenticated/i);
assert.strictEqual((migration.match(/set search_path = pg_catalog, public/gi)||[]).length,6,
  'every new or replaced SECURITY DEFINER function must have a fixed search path');
assert.match(foundation,/REVOKED_MODULE_GRANT_IMMUTABLE/i);
assert.match(foundation,/MODULE_AUTHORIZATION_HISTORY_IMMUTABLE/i);
assert.match(foundation,/create trigger module_permission_grants_protect_history/i);
assert.match(foundation,/create trigger module_grant_audit_log_protect_history/i);
assert.match(migration,/MODULE_AUTHORIZATION_FOUNDATION_CONTRACT_MISMATCH/i);

var authenticatedExec=[];
var executePattern=/grant execute on function\s+(public\.[a-z_]+\s*\([\s\S]*?\))\s+to authenticated\s*;/gi;
var executeMatch;
while((executeMatch=executePattern.exec(migration))!==null){
  authenticatedExec.push(normalizedSignature(executeMatch[1]));
}
assert.deepStrictEqual(authenticatedExec.sort(),[
  'public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)',
  'public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)'
].sort(),'only reviewed public RPC signatures may be authenticated-executable');

var validator=body('validate_module_permission_catalog');
assert.match(validator,/modules\.status = 'active'/i);
assert.match(validator,/catalog_row\.status <> 'active'/i);
assert.match(validator,/p_validation_purpose in \('authorize', 'grant'\)/i,
  'retired catalog permissions must remain revocable');
assert.match(validator,/MODULE_PERMISSION_SCOPE_NOT_ALLOWED/i);
assert.match(validator,/MODULE_PERMISSION_RESOURCE_TYPE_INVALID/i);
assert.match(validator,/MODULE_PERMISSION_CATALOG_REQUIRED/i);
assert.match(validator,/ACTIVE_MODULE_REQUIRED/i);
var revokeScopeBypass=validator.match(
  /if p_validation_purpose <> 'revoke' then([\s\S]*?)\n  end if;/i
);
assert.ok(revokeScopeBypass,'current catalog scope enforcement must be purpose-gated');
assert.match(revokeScopeBypass[1],/catalog_row\.allowed_scope_mode/i);
assert.match(revokeScopeBypass[1],/catalog_row\.allowed_resource_type/i);
assert.strictEqual(
  validator.slice(0,revokeScopeBypass.index).indexOf('catalog_row.allowed_scope_mode'),-1,
  'revoke must not be rejected by evolved current scope metadata'
);

var effective=body('require_effective_module_permission');
assert.ok(effective.indexOf('grants.resource_type = p_resource_type')<
  effective.indexOf('grants.resource_type is null'),
  'resource-exact authorization must precede module-wide fallback');
assert.match(effective,/matching_grant := null/i);
assert.ok((effective.match(/matching_grant\.grant_id is null/gi)||[]).length>=2,
  'grant fallback must not depend on stale PL/pgSQL FOUND state');
assert.match(effective,/public\.is_system_owner\(actor_id\)/i);
assert.doesNotMatch(effective,/module\.(?:manage|access)/i,
  'reserved grants must not become business authority');
assert.doesNotMatch(effective,/\b(?:like|similar to)\b/i,
  'business authorization must not contain wildcard matching');
assert.ok((effective.match(/grants\.permission_key = p_permission_key/gi)||[]).length===2,
  'resource and module fallback must require the exact same permission');
assert.match(effective,
  /grants\.resource_type = p_resource_type[\s\S]*grants\.resource_id = p_resource_id/i,
  'resource authorization must match the exact requested resource');
assert.match(effective,
  /grants\.resource_type is null[\s\S]*grants\.resource_id is null/i,
  'module fallback must be module-scoped, not an unrelated resource grant');

var catalogManager=body('manage_catalog_module_grant');
var catalogOperationLock=catalogManager.indexOf("'module-grant-operation:'");
var catalogManagerLock=catalogManager.indexOf("'module-managers:'");
var catalogRevalidation=catalogManager.indexOf('revalidated_actor_id :=');
var catalogTargetLock=catalogManager.indexOf("'module-grant:'");
assert.ok(catalogOperationLock>=0 && catalogOperationLock<catalogManagerLock &&
  catalogManagerLock<catalogRevalidation && catalogRevalidation<catalogTargetLock,
  'catalog grant lock order must be operation -> manager -> authority -> target');
assert.match(catalogManager,/target_status is distinct from 'approved'/i);
assert.match(catalogManager,/MODULE_GRANT_SELF_GRANT_PROHIBITED/i);
assert.match(catalogManager,/extensions\.digest\([\s\S]*jsonb_build_object/i);
assert.match(catalogManager,/'actorUserId', actor_id[\s\S]*'actorDeviceId', p_actor_device_id/i);
assert.match(catalogManager,/prior_operation\.intent_hash = intent[\s\S]*return prior_operation\.stored_result/i);
assert.match(catalogManager,/MODULE_GRANT_OPERATION_MISMATCH/i);
assert.ok(catalogManager.indexOf("if p_action = 'grant' then")<
  catalogManager.indexOf("target_status is distinct from 'approved'"),
  'target approval must gate grants without blocking revocation');
assert.match(catalogManager,/grants\.permission_key = p_permission_key/i,
  'business grant lookup must use exact permission identity');
assertIntentBinding(catalogManager,[
  'action','actorUserId','actorDeviceId','targetUserId','moduleKey',
  'permissionKey','resourceType','resourceId','grantId','revocationReason'
],'catalog grant');
var catalogRevokeValidation=catalogManager.indexOf(
  "case when p_action = 'grant' then 'grant' else 'revoke' end"
);
var catalogStoredGrant=catalogManager.indexOf('where grants.grant_id = p_grant_id');
assert.ok(catalogRevokeValidation>=0 && catalogStoredGrant>catalogRevokeValidation,
  'revoke must retain catalog identity validation before stored-grant validation');
[
  'target_grant.user_id <> p_target_user_id',
  'target_grant.module_key <> p_module_key',
  'target_grant.permission_key <> p_permission_key',
  'target_grant.resource_type is distinct from p_resource_type',
  'target_grant.resource_id is distinct from p_resource_id'
].forEach(function(exactCheck){
  assert.ok(catalogManager.indexOf(exactCheck)>catalogStoredGrant,
    'historical revoke must validate stored identity: '+exactCheck);
});
assert.ok(catalogManager.indexOf("target_status is distinct from 'approved'")<
  catalogManager.indexOf('insert into public.module_permission_grants'),
  'approved target row must be locked/revalidated before a new grant succeeds');

var reservedManager=body('manage_foundation_module_grant');
var reservedOperationLock=reservedManager.indexOf("'module-grant-operation:'");
var reservedManagerLock=reservedManager.indexOf("'module-managers:'");
var reservedRevalidation=reservedManager.indexOf('revalidated_actor_id :=');
var reservedTargetLock=reservedManager.indexOf("'module-grant:'");
assert.ok(reservedOperationLock>=0 && reservedOperationLock<reservedManagerLock &&
  reservedManagerLock<reservedRevalidation && reservedRevalidation<reservedTargetLock,
  'reserved grant lock order must be operation -> manager -> authority -> target');
assert.match(reservedManager,/target_status is distinct from 'approved'/i);
assert.match(reservedManager,/LAST_MODULE_MANAGER_REVOCATION_PROHIBITED/i);
assert.match(reservedManager,/p_permission_key not in \('module\.access', 'module\.manage'\)/i);
assert.ok(reservedManagerLock<reservedManager.indexOf("if p_action = 'create' then"),
  'both reserved permission branches must share locked authority revalidation');
assertIntentBinding(reservedManager,[
  'action','actorUserId','actorDeviceId','targetUserId','moduleKey',
  'permissionKey','grantId','revocationReason'
],'reserved grant');

var recovery=body('recover_revoke_final_module_manager');
assert.match(recovery,/public\.is_system_owner\(actor_id\)/i);
assert.match(recovery,/char_length\(btrim\(coalesce\(p_recovery_reason, ''\)\)\) not between 10 and 500/i);
assert.match(recovery,/permission_key = 'module\.manage'/i);
assert.match(recovery,/not public\.is_system_owner\(grants\.user_id\)/i);
assert.match(recovery,/active_non_owner_manager_count <> 1/i);
assert.match(recovery,/outcome, stored_result[\s\S]*'recovered'/i);
var recoveryOperationLock=recovery.indexOf("'module-grant-operation:'");
var recoveryManagerLock=recovery.indexOf("'module-managers:'");
var recoveryOwnerRevalidation=recovery.indexOf('revalidated_actor_id :=');
var recoveryTargetLock=recovery.indexOf("'module-grant:'");
var recoveryGrantLock=recovery.indexOf('where grants.grant_id = p_target_grant_id');
assert.ok(recoveryOperationLock>=0 && recoveryOperationLock<recoveryManagerLock &&
  recoveryManagerLock<recoveryOwnerRevalidation &&
  recoveryOwnerRevalidation<recoveryTargetLock && recoveryTargetLock<recoveryGrantLock,
  'recovery order must be operation -> manager -> owner revalidation -> target/grant');
assert.match(recovery,
  /revalidated_actor_id <> actor_id or not public\.is_system_owner\(actor_id\)/i,
  'System Owner must be revalidated under the manager lock');
assertIntentBinding(recovery,[
  'action','actorUserId','actorDeviceId','targetUserId','moduleKey',
  'permissionKey','grantId','recoveryReason'
],'recovery');
assert.ok(recovery.indexOf('prior_operation.intent_hash = intent')>recoveryOperationLock);
assert.ok(recovery.indexOf('return prior_operation.stored_result')>
  recovery.indexOf('prior_operation.intent_hash = intent'));
assert.match(recovery,/MODULE_GRANT_OPERATION_MISMATCH/i);

[
  'validate_module_permission_catalog(text, text, text, text, text)',
  'require_effective_module_permission(uuid, text, text, text, text)',
  'manage_catalog_module_grant(\n  uuid, uuid, text, uuid, text, text, text, text, uuid, text\n)'
].forEach(function(signature){
  assert.ok(normalizedSignature(migration).indexOf(normalizedSignature(
    'revoke all on function public.'+signature+' from public, anon, authenticated'
  ))>=0,'internal helper must be revoked from browser roles: '+signature);
});

assert.doesNotMatch(migration,
  /\b(conference|organization|warehouse|reservation|custody)\b/i,
  'Foundation delta must not introduce module or product semantics');
assert.doesNotMatch(migration,/insert\s+into\s+public\.platform_modules/i);

[
  /DEFERRED/i,
  /begin\s*;/i,
  /rollback\s*;/i,
  /PHASE4G_DISPOSABLE_ENVIRONMENT_REQUIRED/i,
  /current_database\(\) <> expected_database/i,
  /to_regclass\('public\.module_permission_catalog'\)/i,
  /catalog owner mismatch/i,
  /has_function_privilege\(\s*'authenticated'/i,
  /manage_catalog_module_grant/i,
  /recover_revoke_final_module_manager/i,
  /phase4g\.record\.write/i,
  /allowed_scope_mode='module'/i,
  /retired exact grant/i,
  /LAST_MODULE_MANAGER_REVOCATION_PROHIBITED/i,
  /final_manager_recovery_revoked/i,
  /MODULE_AUTHORIZATION_HISTORY_IMMUTABLE/i,
  /exact audit attribution/i
].forEach(function(pattern){assert.match(runtime,pattern);});
assert.doesNotMatch(runtime,/(?:supabase\.co|postgres(?:ql)?:\/\/|service_role|access[_-]?token)/i,
  'runtime harness must contain no project URL or credential material');

[
  /PHASE4G_EXPECTED_ENVIRONMENT/i,
  /PHASE4G_EXPECTED_DATABASE/i,
  /PHASE4G_DISPOSABLE_ENVIRONMENT_REQUIRED/i,
  /manager revocation vs reserved administration/i,
  /manager revocation vs module-specific administration/i,
  /duplicate equivalent grant race/i,
  /same operation race/i,
  /concurrent ordinary manager revocations/i,
  /recovery vs ordinary manager administration/i,
  /Promise\.all/i,
  /childProcess\.spawn\('psql'/i
].forEach(function(pattern){assert.match(concurrency,pattern);});
assert.doesNotMatch(concurrency,/(?:supabase\.co|postgres(?:ql)?:\/\/|service_role|access[_-]?token)/i,
  'concurrency harness must contain no project URL or credential material');

[
  /begin\s*;/i,
  /commit\s*;/i,
  /revoke all on function public\.recover_revoke_final_module_manager/i,
  /revoke all on function public\.manage_catalog_module_grant/i,
  /revoke all on function public\.require_effective_module_permission/i,
  /revoke all on table public\.module_permission_catalog/i,
  /Precondition: apply only after the complete Phase 4E migration has committed/i,
  /preserves tables, catalog history, grants, operations, audit history, and hardening/i
].forEach(function(pattern){assert.match(disable,pattern);});
assert.doesNotMatch(disable,/\b(drop|truncate|delete)\b/i,
  'disable asset must be non-destructive');

console.log('module permission catalog and grant adapter contract tests: passed');
