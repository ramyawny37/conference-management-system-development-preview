-- P0.3E-1 database-only verification. This file performs no writes.
select c.relname as table_name,pg_get_userbyid(c.relowner) as table_owner,
 c.relrowsecurity as rls_enabled,c.relforcerowsecurity as force_rls_enabled,
 has_table_privilege('public',c.oid,'select') as public_select,
 has_table_privilege('anon',c.oid,'select') as anon_select,
 has_table_privilege('authenticated',c.oid,'select') as authenticated_select,
 has_table_privilege('authenticated',c.oid,'insert,update,delete') as authenticated_write
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='device_authorization_admin_operations';

with expected(boundary,signature) as (values
 ('internal','public.require_device_authorization_manager(uuid,uuid,uuid)'),
 ('authenticated','public.list_member_device_authorizations(uuid,uuid,uuid)'),
 ('authenticated','public.approve_member_device(uuid,uuid,uuid,uuid,uuid)'),
 ('authenticated','public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid)'),
 ('authenticated','public.revoke_member_device(uuid,uuid,uuid,uuid,uuid)'),
 ('authenticated','public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid)')
), inspected as (select expected.*,to_regprocedure(signature) as oid from expected)
select inspected.boundary,inspected.signature,p.proname,
 pg_get_function_identity_arguments(p.oid) as exact_identity_arguments,
 pg_get_userbyid(p.proowner) as function_owner,p.prosecdef as security_definer,
 case p.provolatile when 's' then 'stable' when 'v' then 'volatile' else p.provolatile::text end as function_mode,
 p.proconfig @> array['search_path=pg_catalog, public']::text[] as search_path_valid,
 has_function_privilege('public',p.oid,'execute') as public_execute,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
 p.oid is not null as exact_signature_exists
from inspected left join pg_proc p on p.oid=inspected.oid
order by inspected.boundary,inspected.signature;

select conname,pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid='public.device_authorization_admin_operations'::regclass
order by conname;

select action,outcome,count(*) as operation_count
from public.device_authorization_admin_operations group by action,outcome order by action,outcome;

select action,count(*) as audit_count
from public.device_authorization_audit_log
where action in ('device_authorization_approved','device_authorization_rejected','device_authorization_revoked')
group by action order by action;

select count(*) filter(where singleton_id=1) as enforcement_singleton_count,
 count(*) filter(where enforcement_enabled) as enforcement_enabled_count,
 bool_and(not enforcement_enabled) as enforcement_remains_disabled
from public.device_authorization_enforcement;

select count(*) filter(where p.proname like 'device_guarded_%'
  or p.proname='get_my_device_aware_system_access') as guarded_function_count,
 count(*) filter(where p.proname='require_current_approved_device'
  and not has_function_privilege('public',p.oid,'execute')
  and not has_function_privilege('anon',p.oid,'execute')
  and not has_function_privilege('authenticated',p.oid,'execute')) as approved_device_helper_isolation_count
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
select 27 as expected_guarded_function_count,(select count(*) from actual) as actual_guarded_function_count,
 (select count(*) from resolved where oid is null) as missing_exact_signature_count,
 (select count(*) from actual left join resolved on resolved.oid=actual.oid where resolved.oid is null)
   as unexpected_guarded_function_count;

select t.tgname as trigger_name,pg_get_triggerdef(t.oid) as definition
from pg_trigger t where t.tgrelid='public.device_authorization_audit_log'::regclass
 and t.tgname='device_authorization_audit_immutable' and not t.tgisinternal;

-- Exact reviewed P0.3C legacy grant baseline. Six lock/snapshot/conflict
-- signatures retain anon EXECUTE; the remaining thirteen do not.
with expected(signature,expected_public_execute,expected_anon_execute,
 expected_authenticated_execute) as (values
 ('public.list_my_organizations()',false,false,true),
 ('public.get_my_organization_access(uuid)',false,false,true),
 ('public.list_organization_members(uuid)',false,false,true),
 ('public.lookup_organization_candidate_by_email(uuid,text)',false,false,true),
 ('public.get_my_conference_access(uuid)',false,false,true),
 ('public.list_conference_members(uuid)',false,false,true),
 ('public.lookup_conference_user_by_email(uuid,text)',false,false,true),
 ('public.get_conference_lock(uuid,uuid)',false,true,true),
 ('public.add_organization_member(uuid,uuid,uuid)',false,false,true),
 ('public.remove_organization_member(uuid,uuid,uuid)',false,false,true),
 ('public.change_organization_role(uuid,uuid,text,uuid)',false,false,true),
 ('public.add_conference_manager(uuid,uuid,uuid)',false,false,true),
 ('public.remove_conference_manager(uuid,uuid,uuid)',false,false,true),
 ('public.create_conference_idempotent(uuid,uuid,text,jsonb)',false,false,true),
 ('public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)',false,true,true),
 ('public.acquire_conference_lock(uuid,uuid,uuid,integer)',false,true,true),
 ('public.renew_conference_lock(uuid,uuid,uuid,integer)',false,true,true),
 ('public.release_conference_lock(uuid,uuid,uuid)',false,true,true),
 ('public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)',false,true,true)
), resolved as (select expected.*,to_regprocedure(signature) as routine_oid from expected),
actual as (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('list_my_organizations','get_my_organization_access',
 'list_organization_members','lookup_organization_candidate_by_email','get_my_conference_access',
 'list_conference_members','lookup_conference_user_by_email','get_conference_lock',
 'add_organization_member','remove_organization_member','change_organization_role',
 'add_conference_manager','remove_conference_manager','create_conference_idempotent',
 'apply_conference_snapshot','acquire_conference_lock','renew_conference_lock',
 'release_conference_lock','resolve_sync_conflict'))
select resolved.signature,resolved.routine_oid is not null as exact_signature_exists,
 resolved.expected_public_execute,has_function_privilege('public',resolved.routine_oid,'execute') as actual_public_execute,
 resolved.expected_anon_execute,has_function_privilege('anon',resolved.routine_oid,'execute') as actual_anon_execute,
 resolved.expected_authenticated_execute,has_function_privilege('authenticated',resolved.routine_oid,'execute') as actual_authenticated_execute,
 resolved.routine_oid is not null
  and has_function_privilege('public',resolved.routine_oid,'execute') is not distinct from resolved.expected_public_execute
  and has_function_privilege('anon',resolved.routine_oid,'execute') is not distinct from resolved.expected_anon_execute
  and has_function_privilege('authenticated',resolved.routine_oid,'execute') is not distinct from resolved.expected_authenticated_execute
  as exact_grant_match,
 (select count(*) from actual left join resolved expected_routine on expected_routine.routine_oid=actual.oid
   where expected_routine.routine_oid is null) as unexpected_protected_legacy_signature_count
from resolved order by resolved.signature;
