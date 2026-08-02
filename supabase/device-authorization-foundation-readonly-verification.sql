-- P0.3B read-only verification. Run after applying
-- 20260801_5_4_0_device_authorization_foundation.sql.

select
  classes.relname as table_name,
  pg_get_userbyid(classes.relowner) as table_owner,
  classes.relrowsecurity as rls_enabled,
  classes.relforcerowsecurity as force_rls_enabled,
  has_table_privilege('public', classes.oid, 'select') as public_select,
  has_table_privilege('anon', classes.oid, 'select') as anon_select,
  has_table_privilege('authenticated', classes.oid, 'select') as authenticated_select,
  has_table_privilege('authenticated', classes.oid, 'insert') as authenticated_insert,
  has_table_privilege('authenticated', classes.oid, 'update') as authenticated_update,
  has_table_privilege('authenticated', classes.oid, 'delete') as authenticated_delete
from pg_class as classes
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and classes.relname in (
    'devices', 'user_device_authorizations',
    'device_authorization_operations', 'device_authorization_audit_log',
    'device_authorization_enforcement', 'system_user_access'
  )
order by classes.relname;

select
  count(*) as protected_table_count,
  count(distinct classes.relowner) as protected_table_owner_count,
  count(*) filter (where classes.relforcerowsecurity) as protected_table_force_rls_count,
  count(*) filter (where not classes.relrowsecurity) as protected_table_rls_disabled_count,
  array_agg(classes.relname order by classes.relname) as protected_tables,
  array_agg(pg_get_userbyid(classes.relowner) order by classes.relname) as table_owners
from pg_class as classes
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public' and classes.relkind = 'r'
  and classes.relname in (
    'devices', 'user_device_authorizations',
    'device_authorization_operations', 'device_authorization_audit_log',
    'device_authorization_enforcement', 'system_user_access'
  );

select
  functions.proname as routine_name,
  pg_get_function_identity_arguments(functions.oid) as identity_arguments,
  case when functions.oid in (
    to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
    to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
    to_regprocedure('public.get_my_device_authorization(uuid)')
  ) then 'restricted_browser_rpc' else 'internal' end as boundary,
  pg_get_userbyid(functions.proowner) as function_owner,
  functions.prosecdef as security_definer,
  functions.proconfig @> array['search_path=pg_catalog, public']::text[] as search_path_valid,
  has_function_privilege('public', functions.oid, 'execute') as public_execute,
  has_function_privilege('anon', functions.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', functions.oid, 'execute') as authenticated_execute,
  pg_get_functiondef(functions.oid) as definition
from pg_proc as functions
join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public' and functions.oid in (
  to_regprocedure('public.prevent_device_authorization_audit_mutation()'),
  to_regprocedure('public.require_current_approved_device(uuid)'),
  to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
  to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
  to_regprocedure('public.get_my_device_authorization(uuid)')
)
order by boundary, routine_name, identity_arguments;

select triggers.tgname as trigger_name, classes.relname as table_name,
  pg_get_triggerdef(triggers.oid) as definition
from pg_trigger as triggers
join pg_class as classes on classes.oid = triggers.tgrelid
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and triggers.tgname in (
    'device_authorization_audit_immutable',
    'user_device_authorizations_set_updated_at'
  )
order by triggers.tgname;

select indexes.indexname, indexes.indexdef
from pg_indexes as indexes
where indexes.schemaname = 'public'
  and indexes.indexname = 'user_device_authorizations_one_approved_per_user_idx';

select
  count(*) filter (where singleton_id = 1) as enforcement_singleton_count,
  count(*) filter (where enforcement_enabled) as enforcement_enabled_count,
  bool_and(not enforcement_enabled) as enforcement_disabled
from public.device_authorization_enforcement;

select authorization_status, count(*)::bigint as authorization_count
from public.user_device_authorizations
group by authorization_status
order by authorization_status;

select result_status, count(*)::bigint as operation_count
from public.device_authorization_operations
group by result_status
order by result_status;
