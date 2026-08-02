-- P0.3D read-only deployment verification template. Populate only an
-- untracked local copy. This verifies database state, not runtime inactivity.
with reviewed as (
  select 'TRUSTED_OWNER_USER_UUID_HERE'::text as user_text,
    'EXPECTED_TRUSTED_OWNER_EMAIL_HERE'::text as expected_email,
    'ORGANIZATION_UUID_HERE'::text as organization_text,
    'TRUSTED_DEVICE_UUID_HERE'::text as device_text
)
select user_text<>'TRUSTED_OWNER_USER_UUID_HERE' and btrim(user_text)<>''
    and expected_email<>'EXPECTED_TRUSTED_OWNER_EMAIL_HERE' and btrim(expected_email)<>''
    and organization_text<>'ORGANIZATION_UUID_HERE' and btrim(organization_text)<>''
    and device_text<>'TRUSTED_DEVICE_UUID_HERE' and btrim(device_text)<>''
  as reviewed_literals_populated
from reviewed;

-- Run the remaining statements only after the first result is true and replace
-- the same four placeholders in this untracked copy.
select u.id as trusted_user_id,u.email,u.email='EXPECTED_TRUSTED_OWNER_EMAIL_HERE' as exact_email_match,
  a.account_status,m.organization_id,m.role
from auth.users u
left join public.system_user_access a on a.user_id=u.id
left join public.organization_members m on m.user_id=u.id
  and m.organization_id='ORGANIZATION_UUID_HERE'::uuid
where u.id='TRUSTED_OWNER_USER_UUID_HERE'::uuid;

select d.id as device_id,d.user_id,
  d.user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid as exact_device_owner,
  uda.authorization_status,uda.approved_at,uda.approved_by,uda.revoked_at,uda.revoked_by,
  uda.requested_at,uda.last_registered_at,uda.created_at,uda.updated_at
from public.devices d
left join public.user_device_authorizations uda
  on uda.user_id=d.user_id and uda.device_id=d.id
where d.id='TRUSTED_DEVICE_UUID_HERE'::uuid;

select count(*) filter(where authorization_status='approved' and revoked_at is null)
    as approved_non_revoked_device_count
from public.user_device_authorizations
where user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid;

select count(*) filter(where action='device_authorization_bootstrapped'
    and actor_user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
    and target_user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
    and device_id='TRUSTED_DEVICE_UUID_HERE'::uuid
    and operation_id is null
    and old_values->>'authorizationStatus' in ('registered','pending')
    and new_values=jsonb_build_object('authorizationStatus','approved',
      'approvedBy','TRUSTED_OWNER_USER_UUID_HERE'::uuid,
      'trustedOwnerEmail','EXPECTED_TRUSTED_OWNER_EMAIL_HERE',
      'organizationId','ORGANIZATION_UUID_HERE'::uuid,
      'deviceId','TRUSTED_DEVICE_UUID_HERE'::uuid,
      'source','manual_trusted_owner_bootstrap')) as matching_bootstrap_audit_count,
  count(*) filter(where action='device_authorization_bootstrapped'
    and (target_user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
      or device_id='TRUSTED_DEVICE_UUID_HERE'::uuid)) as related_bootstrap_audit_count
from public.device_authorization_audit_log;

select count(*) filter(where singleton_id=1) as enforcement_singleton_count,
  count(*) filter(where enforcement_enabled) as enforcement_enabled_count,
  bool_and(not enforcement_enabled) as enforcement_remains_disabled
from public.device_authorization_enforcement;

select c.relname as protected_table,pg_get_userbyid(c.relowner) as table_owner,
  c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls_enabled,
  has_table_privilege('public',c.oid,'select') as public_select,
  has_table_privilege('anon',c.oid,'select') as anon_select,
  has_table_privilege('authenticated',c.oid,'select') as authenticated_select,
  has_table_privilege('authenticated',c.oid,'insert,update,delete') as authenticated_write
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('devices','user_device_authorizations',
 'device_authorization_operations','device_authorization_audit_log',
 'device_authorization_enforcement','system_user_access') order by c.relname;

select p.proname,pg_get_function_identity_arguments(p.oid) as identity_arguments,
 pg_get_userbyid(p.proowner) as function_owner,p.prosecdef as security_definer,
 p.proconfig @> array['search_path=pg_catalog, public']::text[] as search_path_valid,
 has_function_privilege('public',p.oid,'execute') as public_execute,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname in ('prevent_device_authorization_audit_mutation',
 'require_current_approved_device','register_or_refresh_current_device',
 'request_current_device_authorization','get_my_device_authorization')
 or p.proname like 'device_guarded_%' or p.proname='get_my_device_aware_system_access')
order by p.proname,identity_arguments;

select count(*) filter(where p.proname like 'device_guarded_%'
    or p.proname='get_my_device_aware_system_access') as p0_3c_guarded_function_count,
  count(*) filter(where p.proname='require_current_approved_device'
    and not has_function_privilege('public',p.oid,'execute')
    and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')) as p0_3b_helper_isolation_count
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';

with expected(signature) as (values
 ('public.get_my_device_aware_system_access(uuid)'),
 ('public.device_guarded_list_my_organizations(uuid)'),
 ('public.device_guarded_get_my_organization_access(uuid,uuid)'),
 ('public.device_guarded_list_organization_members(uuid,uuid)'),
 ('public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)'),
 ('public.device_guarded_get_my_conference_access(uuid,uuid)'),
 ('public.device_guarded_list_conference_members(uuid,uuid)'),
 ('public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)'),
 ('public.device_guarded_get_conference_lock(uuid,uuid)'),
 ('public.device_guarded_get_my_conference_membership(uuid,uuid)'),
 ('public.device_guarded_list_available_conferences(uuid)'),
 ('public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)'),
 ('public.device_guarded_download_conference_snapshot(uuid,uuid)'),
 ('public.device_guarded_get_conference_creation_operation(uuid,uuid)'),
 ('public.device_guarded_get_sync_conflict(uuid,uuid)'),
 ('public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)'),
 ('public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'),
 ('public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'),
 ('public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'),
 ('public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'),
 ('public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)'),
 ('public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)'),
 ('public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'),
 ('public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)'),
 ('public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)'),
 ('public.device_guarded_release_conference_lock(uuid,uuid,uuid)'),
 ('public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)')
), resolved as (select signature,to_regprocedure(signature) as oid from expected),
actual as (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'device_guarded_%'
    or p.proname='get_my_device_aware_system_access'))
select 27 as expected_guarded_function_count,
 (select count(*) from actual) as actual_guarded_function_count,
 (select count(*) from resolved where oid is null) as missing_exact_signature_count,
 (select count(*) from actual left join resolved on resolved.oid=actual.oid
   where resolved.oid is null) as unexpected_guarded_function_count;

-- P0.3E baseline: these legacy grants must still be present and unchanged.
with legacy(signature) as (values
 ('public.list_my_organizations()'),('public.get_my_organization_access(uuid)'),
 ('public.list_organization_members(uuid)'),('public.lookup_organization_candidate_by_email(uuid,text)'),
 ('public.get_my_conference_access(uuid)'),('public.list_conference_members(uuid)'),
 ('public.lookup_conference_user_by_email(uuid,text)'),('public.get_conference_lock(uuid,uuid)'),
 ('public.add_organization_member(uuid,uuid,uuid)'),('public.remove_organization_member(uuid,uuid,uuid)'),
 ('public.change_organization_role(uuid,uuid,text,uuid)'),('public.add_conference_manager(uuid,uuid,uuid)'),
 ('public.remove_conference_manager(uuid,uuid,uuid)'),('public.create_conference_idempotent(uuid,uuid,text,jsonb)'),
 ('public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'),
 ('public.acquire_conference_lock(uuid,uuid,uuid,integer)'),('public.renew_conference_lock(uuid,uuid,uuid,integer)'),
 ('public.release_conference_lock(uuid,uuid,uuid)'),
 ('public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)'))
select signature,has_function_privilege('public',to_regprocedure(signature),'execute') as public_execute,
 has_function_privilege('anon',to_regprocedure(signature),'execute') as anon_execute,
 has_function_privilege('authenticated',to_regprocedure(signature),'execute') as authenticated_execute
from legacy order by signature;

-- Final database-only success summary.
select
 exists(select 1 from auth.users where id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
   and email='EXPECTED_TRUSTED_OWNER_EMAIL_HERE') as exact_user_and_email,
 exists(select 1 from public.organization_members where organization_id='ORGANIZATION_UUID_HERE'::uuid
   and user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid and role='organization_owner') as exact_organization_owner,
 exists(select 1 from public.system_user_access where user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
   and account_status='approved') as system_access_approved,
 exists(select 1 from public.devices where id='TRUSTED_DEVICE_UUID_HERE'::uuid
   and user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid) as exact_device_owned,
 exists(select 1 from public.user_device_authorizations where user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
   and device_id='TRUSTED_DEVICE_UUID_HERE'::uuid and authorization_status='approved'
   and revoked_at is null and revoked_by is null) as exact_device_approved,
 (select count(*) from public.user_device_authorizations where user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
   and authorization_status='approved' and revoked_at is null)=1 as exactly_one_approved_device,
 (select count(*) from public.device_authorization_audit_log where action='device_authorization_bootstrapped'
   and target_user_id='TRUSTED_OWNER_USER_UUID_HERE'::uuid
   and device_id='TRUSTED_DEVICE_UUID_HERE'::uuid)=1 as exactly_one_bootstrap_event,
 (select count(*) from public.device_authorization_enforcement where singleton_id=1)=1
   and (select count(*) from public.device_authorization_enforcement where enforcement_enabled)=0
   as enforcement_disabled;
