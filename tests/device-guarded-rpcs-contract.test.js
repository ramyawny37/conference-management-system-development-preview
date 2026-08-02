'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(root,'supabase/migrations/20260801_5_4_1_device_guarded_rpc_foundation.sql'),'utf8');
var verification=fs.readFileSync(path.join(root,'supabase/device-guarded-rpcs-readonly-verification.sql'),'utf8');

var guarded={
  device_guarded_list_my_organizations:'uuid',
  device_guarded_get_my_organization_access:'uuid,uuid',
  device_guarded_list_organization_members:'uuid,uuid',
  device_guarded_lookup_organization_candidate_by_email:'uuid,uuid,text',
  device_guarded_get_my_conference_access:'uuid,uuid',
  device_guarded_list_conference_members:'uuid,uuid',
  device_guarded_lookup_conference_user_by_email:'uuid,uuid,text',
  device_guarded_get_conference_lock:'uuid,uuid',
  device_guarded_get_my_conference_membership:'uuid,uuid',
  device_guarded_list_available_conferences:'uuid',
  device_guarded_get_conference_snapshot_metadata:'uuid,uuid',
  device_guarded_download_conference_snapshot:'uuid,uuid',
  device_guarded_get_conference_creation_operation:'uuid,uuid',
  device_guarded_get_sync_conflict:'uuid,uuid',
  device_guarded_list_sync_conflicts:'uuid,uuid,text,integer',
  device_guarded_add_organization_member:'uuid,uuid,uuid,uuid',
  device_guarded_remove_organization_member:'uuid,uuid,uuid,uuid',
  device_guarded_change_organization_role:'uuid,uuid,uuid,text,uuid',
  device_guarded_add_conference_manager:'uuid,uuid,uuid,uuid',
  device_guarded_remove_conference_manager:'uuid,uuid,uuid,uuid',
  device_guarded_create_conference_idempotent:'uuid,uuid,uuid,text,jsonb',
  device_guarded_apply_conference_snapshot:'uuid,uuid,uuid,bigint,jsonb,text,text',
  device_guarded_acquire_conference_lock:'uuid,uuid,uuid,integer',
  device_guarded_renew_conference_lock:'uuid,uuid,uuid,integer',
  device_guarded_release_conference_lock:'uuid,uuid,uuid',
  device_guarded_resolve_sync_conflict:'uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text'
};
var mutationLegacy={
  device_guarded_add_organization_member:'add_organization_member',
  device_guarded_remove_organization_member:'remove_organization_member',
  device_guarded_change_organization_role:'change_organization_role',
  device_guarded_add_conference_manager:'add_conference_manager',
  device_guarded_remove_conference_manager:'remove_conference_manager',
  device_guarded_create_conference_idempotent:'create_conference_idempotent',
  device_guarded_apply_conference_snapshot:'apply_conference_snapshot',
  device_guarded_acquire_conference_lock:'acquire_conference_lock',
  device_guarded_renew_conference_lock:'renew_conference_lock',
  device_guarded_release_conference_lock:'release_conference_lock',
  device_guarded_resolve_sync_conflict:'resolve_sync_conflict'
};
function escapeRegex(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function body(name){
  var match=migration.match(new RegExp('create or replace function public\\.'+escapeRegex(name)+'\\s*\\(([\\s\\S]*?)\\)\\s*returns[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;','i'));
  assert.ok(match,'missing exact definition for '+name);
  return {parameters:match[1],sql:match[2]};
}
function normalized(value){return value.replace(/\s+/g,'').toLowerCase();}
function privilegeStatement(verb,signature,role){
  return migration.split(';').some(function(statement){
    var compact=normalized(statement);
    return compact.indexOf(normalized(verb+' on function '))>=0&&
      compact.indexOf(normalized(signature))>=0&&compact.endsWith(normalized(role));
  });
}

assert.strictEqual(Object.keys(guarded).length,26);
Object.keys(guarded).forEach(function(name){
  var definition=body(name);
  assert.match(definition.parameters,/^\s*p_actor_device_id\s+uuid\b/i,name+' device argument must be first');
  assert.strictEqual((definition.sql.match(/require_current_approved_device/gi)||[]).length,1,name+' must invoke only the common helper');
  assert.doesNotMatch(definition.sql,/user_device_authorizations|device_authorization_enforcement|authorization_status\s*=|auth\.uid\s*\(\s*\)[\s\S]*approved/i,name+' must not implement an independent device/System Access guard');
  var signature='public.'+name+'('+guarded[name]+')';
  assert.ok(privilegeStatement('revoke all',signature,'from public,anon'),name+' exact revoke missing');
  assert.ok(privilegeStatement('grant execute',signature,'to authenticated'),name+' authenticated grant missing');
});

Object.keys(mutationLegacy).forEach(function(name){
  var sql=body(name).sql;
  var helper=sql.indexOf('require_current_approved_device');
  var lock=sql.indexOf('pg_advisory_xact_lock');
  var legacy=sql.indexOf('public.'+mutationLegacy[name]+'(');
  assert.ok(helper>=0&&helper<lock&&lock<legacy,name+' order must be helper -> lock -> legacy idempotency/mutation');
});

var expectedWrapperLocks={
  device_guarded_add_organization_member:"'organization-membership:'||p_organization_id::text",
  device_guarded_remove_organization_member:"'organization-membership:'||p_organization_id::text",
  device_guarded_change_organization_role:"'organization-membership:'||p_organization_id::text",
  device_guarded_add_conference_manager:'p_operation_id::text',
  device_guarded_remove_conference_manager:'p_operation_id::text',
  device_guarded_create_conference_idempotent:"auth.uid()::text||':conference-create:'||p_operation_id::text",
  device_guarded_apply_conference_snapshot:"'conference-snapshot:'||p_conference_id::text",
  device_guarded_acquire_conference_lock:"'conference-lock:'||p_conference_id::text",
  device_guarded_renew_conference_lock:"'conference-lock:'||p_conference_id::text",
  device_guarded_release_conference_lock:"'conference-lock:'||p_conference_id::text",
  device_guarded_resolve_sync_conflict:"'conference-snapshot:'||p_conference_id::text"
};
Object.keys(expectedWrapperLocks).forEach(function(name){
  assert.ok(normalized(body(name).sql).includes(normalized('hashtextextended('+expectedWrapperLocks[name]+',0)')),name+' wrapper lock key mismatch');
});

function migrationSource(file){return fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');}
function legacyBody(source,name){
  var match=source.match(new RegExp('create or replace function public\\.'+escapeRegex(name)+'\\s*\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;','i'));
  assert.ok(match,'missing legacy body '+name);return match[1];
}
function ordered(sql,markers,label){
  var cursor=-1;
  markers.forEach(function(marker){var next=sql.indexOf(marker,cursor+1);assert.ok(next>cursor,label+' missing/reversed marker: '+marker);cursor=next;});
}
var organizationLegacy=legacyBody(migrationSource('20260801_5_3_1_organization_access_locking.sql'),'manage_organization_member');
ordered(organizationLegacy,["'organization-membership:'",'from public.system_user_access','for update','from public.organization_membership_operations','from public.organization_members','for update'], 'organization nested lock order');
var membershipSource=migrationSource('20260729_4_0_0_conference_membership.sql');
['add_conference_manager','remove_conference_manager'].forEach(function(name){
  var sql=legacyBody(membershipSource,name);
  ordered(sql,['is_conference_owner','pg_advisory_xact_lock','p_operation_id::text','from public.conference_membership_operations','from public.conferences','for update'],name+' nested order');
});
ordered(legacyBody(membershipSource,'add_conference_manager'),['from public.conferences','for update','from public.conference_members','for update'],'add manager row-lock order');
var creationLegacy=legacyBody(migrationSource('20260730_5_0_0_system_access_foundation.sql'),'create_conference_idempotent');
ordered(creationLegacy,['can_user_create_conferences','pg_advisory_xact_lock','conference-create:','from public.conference_creation_operations','pg_advisory_xact_lock',"'conference-id:'",'from public.conferences'],'creation nested order');
var snapshotLegacy=legacyBody(migrationSource('20260728_3_3_0_online_schema.sql'),'apply_conference_snapshot');
ordered(snapshotLegacy,['has_conference_role','from public.conferences','for update','from public.sync_operations','from public.conference_snapshots','for update'],'snapshot row-lock/idempotency order');
var lockSource=migrationSource('20260728_3_3_0_conference_locks.sql');
['acquire_conference_lock','renew_conference_lock','release_conference_lock'].forEach(function(name){
  ordered(legacyBody(lockSource,name),['is_conference_member','from public.conferences','for update','from public.conference_locks','for update'],name+' row-lock order');
});
var conflictLegacy=legacyBody(migrationSource('20260728_3_3_0_conflict_resolution.sql'),'resolve_sync_conflict');
ordered(conflictLegacy,['has_conference_role','from public.conferences','for update','from public.sync_conflicts','for update','from public.sync_operations','from public.conference_snapshots','for update'],'conflict row-lock/idempotency order');

var membership=body('device_guarded_get_my_conference_membership').sql;
['success','access_denied','available','canManageMembers','canSync','canResolveConflicts','canAcquireLock'].forEach(function(key){assert.ok(membership.includes("'"+key+"'"),'membership contract missing '+key);});
var conferences=body('device_guarded_list_available_conferences').sql;
assert.match(conferences,/members\.user_id\s*=\s*current_user_id/i);
assert.match(conferences,/conferences\.deleted_at/i,'deleted conferences must remain represented with deleted_at metadata');
assert.doesNotMatch(conferences,/deleted_at\s+is\s+null/i,'must not silently filter deleted conferences');
var metadata=body('device_guarded_get_conference_snapshot_metadata').sql;
['not_found','found','conferenceId','revision','schemaVersion','appVersion','updatedAt'].forEach(function(key){assert.ok(metadata.includes("'"+key+"'"),'metadata contract missing '+key);});
assert.match(metadata,/is_conference_member/i);
var snapshot=body('device_guarded_download_conference_snapshot').sql;
['downloaded','snapshot','revision','schemaVersion','appVersion','updatedAt','updatedByDeviceId'].forEach(function(key){assert.ok(snapshot.includes("'"+key+"'"),'snapshot contract missing '+key);});
assert.match(snapshot,/is_conference_member/i);
var creation=body('device_guarded_get_conference_creation_operation').sql;
['not_found','created','userId','operationId','conferenceId','createdAt','updatedAt'].forEach(function(key){assert.ok(creation.includes("'"+key+"'"),'creation-operation contract missing '+key);});
assert.match(creation,/operations\.user_id\s*=\s*current_user_id/i);
var conflict=body('device_guarded_get_sync_conflict').sql+body('device_guarded_list_sync_conflicts').sql;
['pending','ignored','resolved','localSnapshot','serverSnapshot','expectedRevision','actualRevision','resolvedAt'].forEach(function(key){assert.ok(conflict.includes("'"+key+"'"),'conflict contract missing '+key);});
assert.match(conflict,/normalized_status/i);
assert.match(conflict,/p_limit\s*<\s*1[\s\S]*p_limit\s*>\s*100/i);

assert.match(migration,/P0_3C_GUARDED_FUNCTION_COUNT_INVALID/);
assert.match(migration,/P0_3C_APPROVED_SIGNATURE_MISSING/);
assert.match(migration,/P0_3C_FUNCTION_OWNER_INVALID/);
assert.match(migration,/P0_3C_FUNCTION_SECURITY_INVALID/);
assert.match(migration,/P0_3C_FUNCTION_MODE_INVALID/);
assert.match(migration,/P0_3C_HELPER_ISOLATION_INVALID/);
assert.match(migration,/P0_3C_ENFORCEMENT_MUST_REMAIN_DISABLED/);
assert.doesNotMatch(migration,/revoke[^;]*on function public\.(?!device_guarded_|get_my_device_aware_system_access)/i,'P0.3C must leave legacy grants unchanged');

['expected_function_count','exact_identity_arguments','common_protected_owner','security_definer','search_path_valid','public_execute','anon_execute','authenticated_execute','internal_only','enforcement_remains_disabled','P0.3E legacy grants unchanged baseline'].forEach(function(term){assert.ok(verification.includes(term),'verification missing '+term);});
Object.keys(guarded).forEach(function(name){assert.ok(verification.includes('public.'+name+'('+guarded[name]+')'),'verification allowlist missing '+name);});

console.log('device guarded RPC contract tests: passed (26 exact guarded signatures; 11 ordered mutations; direct-read compatibility; exact grants)');
