'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var root=path.resolve(__dirname,'..');
var migration=fs.readFileSync(path.join(root,'supabase/migrations/20260802_5_4_2_device_authorization_administration.sql'),'utf8');
var verification=fs.readFileSync(path.join(root,'supabase/device-authorization-administration-readonly-verification.sql'),'utf8');
var functions=['list_member_device_authorizations','approve_member_device','reject_member_pending_device','revoke_member_device','replace_member_active_device'];

[
 /create table public\.device_authorization_admin_operations/i,
 /alter table public\.device_authorization_admin_operations enable row level security/i,
 /revoke all on table public\.device_authorization_admin_operations[\s\S]*public,anon,authenticated/i,
 /create or replace function public\.require_device_authorization_manager/i,
 /public\.require_current_approved_device\(p_actor_device_id\)/i,
 /organization_owner','organization_admin/i,
 /actor_role='organization_admin' and target_role<>'member'/i,
 /P0_3E_1_ENFORCEMENT_MUST_REMAIN_DISABLED/i,
 /P0_3E_1_LEGACY_GRANTS_MUST_REMAIN_UNCHANGED/i,
 /organization-membership:/i,/device-authorization-user:/i,
 /least\(p_active_device_id,p_replacement_device_id\)/i,
 /greatest\(p_active_device_id,p_replacement_device_id\)/i
].forEach(function(pattern){assert.match(migration,pattern);});

functions.forEach(function(name){
  assert.match(migration,new RegExp('create or replace function public\\.'+name,'i'));
  assert.match(migration,new RegExp('grant execute on function public\\.'+name+'[^;]*to authenticated','i'));
  assert.match(verification,new RegExp('public\\.'+name+'\\('));
});
assert.doesNotMatch(migration,/grant execute[\s\S]*to (?:public|anon)\s*;/i);
assert.doesNotMatch(migration,/update public\.device_authorization_enforcement/i);
assert.doesNotMatch(migration,/revoke[^;]*on function public\.(?:list_my_organizations|get_my_organization_access|list_organization_members|lookup_organization_candidate_by_email|get_my_conference_access|list_conference_members|lookup_conference_user_by_email|get_conference_lock|add_organization_member|remove_organization_member|change_organization_role|add_conference_manager|remove_conference_manager|create_conference_idempotent|apply_conference_snapshot|acquire_conference_lock|renew_conference_lock|release_conference_lock|resolve_sync_conflict)/i);

var legacyBlock=migration.match(/with expected\(signature,expected_public_execute,expected_anon_execute,[\s\S]*?P0_3E_1_LEGACY_GRANTS_MUST_REMAIN_UNCHANGED/)[0];
var anonTrue=[
 'public.get_conference_lock(uuid,uuid)',
 'public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)',
 'public.acquire_conference_lock(uuid,uuid,uuid,integer)',
 'public.renew_conference_lock(uuid,uuid,uuid,integer)',
 'public.release_conference_lock(uuid,uuid,uuid)',
 'public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)'
];
anonTrue.forEach(function(signature){assert.ok(legacyBlock.includes("('"+signature+"',false,true,true)"),signature);});
assert.strictEqual((legacyBlock.match(/,false,true,true\)/g)||[]).length,6,'exactly six legacy signatures retain anon execute');
assert.strictEqual((legacyBlock.match(/,false,false,true\)/g)||[]).length,13,'exactly thirteen legacy signatures deny anon execute');
assert.match(legacyBlock,/routine_oid is null/);
assert.match(legacyBlock,/is distinct from expected_public_execute/);
assert.match(legacyBlock,/is distinct from expected_anon_execute/);
assert.match(legacyBlock,/is distinct from expected_authenticated_execute/);
assert.match(legacyBlock,/actual left join resolved[\s\S]*resolved\.routine_oid is null/);

var approve=migration.match(/create or replace function public\.approve_member_device[\s\S]*?\n\$\$;/i)[0];
assert.ok(approve.indexOf('organization-membership:')<approve.indexOf('for update'));
assert.ok(approve.indexOf('device-authorization-user:')<approve.indexOf('for update'));
assert.match(approve,/authorization_status<>'pending'[\s\S]*revoked_at is not null[\s\S]*revoked_by is not null/i);
assert.match(approve,/exists\(select 1 from public\.user_device_authorizations[\s\S]*authorization_status='approved'[\s\S]*revoked_at is null/i);
assert.match(approve,/set authorization_status='approved',[\s\S]*approved_at=now\(\),approved_by=actor_id/i);
assert.doesNotMatch(approve,/set[\s\S]{0,120}(?:requested_at|last_registered_at|revoked_at|revoked_by)\s*=/i);

var replace=migration.match(/create or replace function public\.replace_member_active_device[\s\S]*?\n\$\$;/i)[0];
assert.ok(replace.indexOf("set authorization_status='revoked'")<replace.indexOf("set authorization_status='approved'"));
assert.strictEqual((replace.match(/insert into public\.device_authorization_audit_log/gi)||[]).length,2);
assert.match(replace,/existing\.action='replace_member_active_device' then return existing\.stored_result/i);
assert.match(replace,/authorization_status='approved' and revoked_at is null\)<>1/i);

var reject=migration.match(/create or replace function public\.reject_member_pending_device[\s\S]*?\n\$\$;/i)[0];
assert.match(reject,/device_authorization_rejected/);
var revoke=migration.match(/create or replace function public\.revoke_member_device[\s\S]*?\n\$\$;/i)[0];
assert.match(revoke,/target_role='organization_owner'/);
assert.match(revoke,/actor_id=p_target_user_id/);

['table_owner','rls_enabled','force_rls_enabled','exact_identity_arguments','function_owner',
 'security_definer','search_path_valid','public_execute','anon_execute','authenticated_execute',
 'enforcement_remains_disabled','guarded_function_count','approved_device_helper_isolation_count',
 'missing_exact_signature_count','unexpected_guarded_function_count',
 'device_authorization_audit_immutable','expected_anon_execute','actual_anon_execute',
 'exact_grant_match','unexpected_protected_legacy_signature_count'].forEach(function(term){assert.ok(verification.includes(term),term);});
assert.doesNotMatch(verification,/^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im);

console.log('device authorization administration contract tests: passed (5 RPCs; locked idempotent mutations; legacy/enforcement unchanged)');
