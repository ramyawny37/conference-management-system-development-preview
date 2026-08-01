-- P0.2D corrective read-only verification. Run after applying
-- 20260801_5_3_4_organization_member_list_role_variable_fix.sql.
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
), member_list_function as (
  select functions.oid, functions.proowner, functions.prosecdef, functions.proconfig,
    pg_get_functiondef(functions.oid) as definition,
    pg_get_function_result(functions.oid) as result_columns
  from pg_proc as functions
  join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.oid = to_regprocedure('public.list_organization_members(uuid)')
)
select
  'list_organization_members(uuid)'::text as signature,
  member_list_function.result_columns,
  pg_get_userbyid(member_list_function.proowner) as function_owner,
  member_list_function.prosecdef as security_definer,
  member_list_function.proconfig @> array['search_path=pg_catalog, public']::text[]
    as search_path_valid,
  has_function_privilege('public', member_list_function.oid, 'execute') as public_execute,
  has_function_privilege('anon', member_list_function.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', member_list_function.oid, 'execute') as authenticated_execute,
  protected_tables.protected_table_count,
  protected_tables.protected_table_owner_count,
  protected_tables.protected_table_force_rls_count,
  member_list_function.proowner = protected_tables.protected_owner
    as owner_matches_protected_tables,
  member_list_function.definition ~ $pattern$caller_organization_role[[:space:]]+text$pattern$
    as caller_organization_role_declared,
  not (member_list_function.definition ~ $pattern$\mcurrent_role\M$pattern$)
    as ambiguous_current_role_absent,
  member_list_function.definition ~
    $pattern$select[[:space:]]+members\.role[[:space:]]+into[[:space:]]+caller_organization_role$pattern$
    as membership_role_selected,
  member_list_function.definition ~
    $pattern$caller_organization_role[[:space:]]+not[[:space:]]+in[[:space:]]*\([[:space:]]*'organization_owner'[[:space:]]*,[[:space:]]*'organization_admin'\)$pattern$
    as owner_admin_authorization_uses_membership_role,
  member_list_function.definition ~
    $pattern$order[[:space:]]+by[[:space:]]+case[[:space:]]+members\.role[[:space:]]+when[[:space:]]+'organization_owner'$pattern$
    as owner_first_ordering_present
from member_list_function
cross join protected_tables;
