-- P0.2D corrective read-only verification. Run after applying
-- 20260801_5_3_3_organization_access_role_variable_fix.sql.
with protected_tables as (
  select min(classes.relowner::text)::oid as protected_owner,
    count(*) as protected_table_count,
    count(distinct classes.relowner) as protected_table_owner_count,
    count(*) filter (where classes.relforcerowsecurity) as protected_table_force_rls_count
  from pg_class as classes
  join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
  where namespaces.nspname = 'public' and classes.relkind = 'r'
    and classes.relname in (
      'organizations', 'organization_members', 'system_user_access', 'profiles'
    )
), access_function as (
  select functions.oid, functions.proowner, functions.prosecdef, functions.proconfig,
    pg_get_functiondef(functions.oid) as definition
  from pg_proc as functions
  join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.oid = to_regprocedure('public.get_my_organization_access(uuid)')
)
select
  'get_my_organization_access(uuid)'::text as signature,
  pg_get_userbyid(access_function.proowner) as function_owner,
  access_function.prosecdef as security_definer,
  access_function.proconfig @> array['search_path=pg_catalog, public']::text[]
    as search_path_valid,
  has_function_privilege('public', access_function.oid, 'execute') as public_execute,
  has_function_privilege('anon', access_function.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', access_function.oid, 'execute') as authenticated_execute,
  protected_tables.protected_table_count,
  protected_tables.protected_table_owner_count,
  protected_tables.protected_table_force_rls_count,
  access_function.proowner = protected_tables.protected_owner
    as owner_matches_protected_tables,
  access_function.definition ~ $pattern$caller_organization_role[[:space:]]+text$pattern$
    as caller_organization_role_declared,
  not (access_function.definition ~ $pattern$\mcurrent_role\M$pattern$)
    as ambiguous_current_role_absent,
  access_function.definition ~
    $pattern$select[[:space:]]+members\.role[[:space:]]+into[[:space:]]+caller_organization_role$pattern$
    as membership_role_selected,
  access_function.definition ~
    $pattern$'current_user_role'[[:space:]]*,[[:space:]]*caller_organization_role$pattern$
    as response_role_uses_membership_role,
  access_function.definition ~
    $pattern$'can_manage_members'[[:space:]]*,[[:space:]]*caller_organization_role$pattern$
    and access_function.definition ~
      $pattern$'can_manage_admins'[[:space:]]*,[[:space:]]*caller_organization_role$pattern$
    and access_function.definition ~
      $pattern$'can_manage_owners'[[:space:]]*,[[:space:]]*caller_organization_role$pattern$
    as capability_mapping_uses_membership_role
from access_function
cross join protected_tables;
