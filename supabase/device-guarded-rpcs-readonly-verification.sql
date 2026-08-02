-- P0.3C exact read-only verification. Run after 5.4.0 and 5.4.1.
-- Every result is diagnostic only; this file performs no writes.

with expected(boundary, signature, expected_mode) as (values
  ('restricted','public.get_my_device_aware_system_access(uuid)','stable'),
  ('guarded','public.device_guarded_list_my_organizations(uuid)','stable'),
  ('guarded','public.device_guarded_get_my_organization_access(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_list_organization_members(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)','stable'),
  ('guarded','public.device_guarded_get_my_conference_access(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_list_conference_members(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)','stable'),
  ('guarded','public.device_guarded_get_conference_lock(uuid,uuid)','volatile'),
  ('guarded','public.device_guarded_get_my_conference_membership(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_list_available_conferences(uuid)','stable'),
  ('guarded','public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_download_conference_snapshot(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_get_conference_creation_operation(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_get_sync_conflict(uuid,uuid)','stable'),
  ('guarded','public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)','stable'),
  ('guarded','public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)','volatile'),
  ('guarded','public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)','volatile'),
  ('guarded','public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)','volatile'),
  ('guarded','public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)','volatile'),
  ('guarded','public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)','volatile'),
  ('guarded','public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)','volatile'),
  ('guarded','public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)','volatile'),
  ('guarded','public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)','volatile'),
  ('guarded','public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)','volatile'),
  ('guarded','public.device_guarded_release_conference_lock(uuid,uuid,uuid)','volatile'),
  ('guarded','public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)','volatile')
), inspected as (
  select expected.*,to_regprocedure(expected.signature) as routine_oid
  from expected
)
select inspected.boundary,inspected.signature,
  functions.proname as exact_name,
  pg_get_function_identity_arguments(functions.oid) as exact_identity_arguments,
  pg_get_userbyid(functions.proowner) as function_owner,
  inspected.expected_mode,
  case functions.provolatile when 's' then 'stable' when 'v' then 'volatile' else functions.provolatile::text end as actual_mode,
  functions.prosecdef as security_definer,
  functions.proconfig @> array['search_path=pg_catalog, public']::text[] as search_path_valid,
  has_function_privilege('public',functions.oid,'execute') as public_execute,
  has_function_privilege('anon',functions.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',functions.oid,'execute') as authenticated_execute,
  functions.oid is not null as exact_signature_exists
from inspected left join pg_proc as functions on functions.oid=inspected.routine_oid
order by inspected.boundary,inspected.signature;

with expected(signature) as (values
  ('public.get_my_device_aware_system_access(uuid)'),
  ('public.device_guarded_list_my_organizations(uuid)'),('public.device_guarded_get_my_organization_access(uuid,uuid)'),
  ('public.device_guarded_list_organization_members(uuid,uuid)'),('public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)'),
  ('public.device_guarded_get_my_conference_access(uuid,uuid)'),('public.device_guarded_list_conference_members(uuid,uuid)'),
  ('public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)'),('public.device_guarded_get_conference_lock(uuid,uuid)'),
  ('public.device_guarded_get_my_conference_membership(uuid,uuid)'),('public.device_guarded_list_available_conferences(uuid)'),
  ('public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)'),('public.device_guarded_download_conference_snapshot(uuid,uuid)'),
  ('public.device_guarded_get_conference_creation_operation(uuid,uuid)'),('public.device_guarded_get_sync_conflict(uuid,uuid)'),
  ('public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)'),('public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'),
  ('public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'),('public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'),
  ('public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'),('public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)'),
  ('public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)'),('public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'),
  ('public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)'),('public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)'),
  ('public.device_guarded_release_conference_lock(uuid,uuid,uuid)'),('public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)')
), expected_resolved as (
  select expected.signature,to_regprocedure(expected.signature) as routine_oid
  from expected
), actual as (
  select functions.oid
  from pg_proc as functions join pg_namespace as namespaces on namespaces.oid=functions.pronamespace
  where namespaces.nspname='public' and (functions.proname like 'device_guarded_%' or functions.proname='get_my_device_aware_system_access')
)
select 27 as expected_function_count,
  (select count(*) from actual) as actual_function_count,
  (select count(*) from actual
    left join expected_resolved on expected_resolved.routine_oid=actual.oid
    where expected_resolved.routine_oid is null) as unexpected_function_count,
  (select count(*) from expected_resolved
    where routine_oid is null) as missing_function_count;

select pg_get_userbyid(classes.relowner) as protected_table_owner,
  pg_get_userbyid(helper.proowner) as helper_owner,
  count(distinct approved.proowner) as approved_function_owner_count,
  bool_and(approved.proowner=classes.relowner and helper.proowner=classes.relowner) as common_protected_owner
from pg_class as classes join pg_namespace as table_namespace on table_namespace.oid=classes.relnamespace
cross join pg_proc as helper
join pg_namespace as helper_namespace on helper_namespace.oid=helper.pronamespace
cross join pg_proc as approved
join pg_namespace as approved_namespace on approved_namespace.oid=approved.pronamespace
where table_namespace.nspname='public' and classes.relname='device_authorization_enforcement'
  and helper_namespace.nspname='public' and helper.oid=to_regprocedure('public.require_current_approved_device(uuid)')
  and approved_namespace.nspname='public'
  and (approved.proname like 'device_guarded_%' or approved.proname='get_my_device_aware_system_access')
group by classes.relowner,helper.proowner;

select 'internal_only' as boundary,'public.require_current_approved_device(uuid)' as signature,
  pg_get_userbyid(functions.proowner) as function_owner,functions.prosecdef as security_definer,
  functions.proconfig @> array['search_path=pg_catalog, public']::text[] as search_path_valid,
  has_function_privilege('public',functions.oid,'execute') as public_execute,
  has_function_privilege('anon',functions.oid,'execute') as anon_execute,
  has_function_privilege('authenticated',functions.oid,'execute') as authenticated_execute
from pg_proc as functions where functions.oid=to_regprocedure('public.require_current_approved_device(uuid)');

select count(*) filter(where singleton_id=1) as enforcement_singleton_count,
  count(*) filter(where enforcement_enabled) as enforcement_enabled_count,
  bool_and(not enforcement_enabled) as enforcement_remains_disabled
from public.device_authorization_enforcement;

-- P0.3E baseline: record the still-current legacy EXECUTE grants. P0.3C does
-- not revoke or grant any legacy routine; compare this report during P0.3E.
with legacy(signature) as (values
  ('public.list_my_organizations()'),('public.get_my_organization_access(uuid)'),
  ('public.list_organization_members(uuid)'),('public.lookup_organization_candidate_by_email(uuid,text)'),
  ('public.get_my_conference_access(uuid)'),('public.list_conference_members(uuid)'),
  ('public.lookup_conference_user_by_email(uuid,text)'),('public.get_conference_lock(uuid,uuid)'),
  ('public.add_organization_member(uuid,uuid,uuid)'),('public.remove_organization_member(uuid,uuid,uuid)'),
  ('public.change_organization_role(uuid,uuid,text,uuid)'),('public.add_conference_manager(uuid,uuid,uuid)'),
  ('public.remove_conference_manager(uuid,uuid,uuid)'),('public.create_conference_idempotent(uuid,uuid,text,jsonb)'),
  ('public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)'),('public.acquire_conference_lock(uuid,uuid,uuid,integer)'),
  ('public.renew_conference_lock(uuid,uuid,uuid,integer)'),('public.release_conference_lock(uuid,uuid,uuid)'),
  ('public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)')
)
select 'P0.3E legacy grants unchanged baseline' as report,legacy.signature,
  has_function_privilege('public',to_regprocedure(legacy.signature),'execute') as public_execute,
  has_function_privilege('anon',to_regprocedure(legacy.signature),'execute') as anon_execute,
  has_function_privilege('authenticated',to_regprocedure(legacy.signature),'execute') as authenticated_execute
from legacy order by legacy.signature;
