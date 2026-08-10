with routines as (
  select
    functions.oid,
    functions.prosecdef,
    functions.proconfig,
    pg_get_functiondef(functions.oid) as definition
  from pg_proc as functions
  join pg_namespace as namespaces
    on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.oid = to_regprocedure(
      'public.approve_member_device(uuid,uuid,uuid,uuid,uuid)'
    )
)
select
  to_regclass(
    'public.user_device_authorizations_one_approved_per_user_idx'
  ) is null as legacy_single_approved_index_removed,
  to_regclass(
    'public.user_device_authorizations_approved_user_idx'
  ) is not null as multi_device_approved_lookup_index_exists,
  coalesce((select routines.prosecdef from routines), false)
    as approve_rpc_security_definer,
  coalesce((
    select routines.proconfig
      @> array['search_path=pg_catalog, public']::text[]
    from routines
  ), false) as approve_rpc_search_path_valid,
  coalesce((
    select not (
      regexp_replace(routines.definition, '\s+', '', 'g') like
      '%orexists(select1frompublic.user_device_authorizationswhereuser_id=p_target_user_idandauthorization_status=''approved''andrevoked_atisnull)%'
    )
    from routines
  ), false) as legacy_existing_approved_rejection_removed,
  coalesce((
    select routines.definition like
      '%require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id)%'
    from routines
  ), false) as organization_manager_guard_present,
  has_function_privilege(
    'authenticated',
    'public.approve_member_device(uuid,uuid,uuid,uuid,uuid)',
    'execute'
  ) as authenticated_execute,
  not has_function_privilege(
    'anon',
    'public.approve_member_device(uuid,uuid,uuid,uuid,uuid)',
    'execute'
  ) as anon_execute_denied;

select
  authorization_status,
  count(*)::bigint as device_count
from public.user_device_authorizations
group by authorization_status
order by authorization_status;
