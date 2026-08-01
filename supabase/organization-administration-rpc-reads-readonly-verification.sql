-- P0.2D read-only verification. Run after applying
-- 20260801_5_3_2_organization_administration_rpc_reads.sql.
select
  pg_get_function_identity_arguments(functions.oid) as signature,
  pg_get_userbyid(functions.proowner) as function_owner,
  functions.prosecdef as security_definer,
  functions.proconfig as function_settings,
  has_function_privilege('public', functions.oid, 'execute') as public_execute,
  has_function_privilege('anon', functions.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', functions.oid, 'execute') as authenticated_execute,
  pg_get_functiondef(functions.oid) as definition
from pg_proc as functions
join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public'
  and functions.oid in (
    to_regprocedure('public.get_my_organization_access(uuid)'),
    to_regprocedure('public.list_organization_members(uuid)'),
    to_regprocedure('public.lookup_organization_candidate_by_email(uuid,text)')
  )
order by signature;

select
  count(*) as protected_table_count,
  count(distinct classes.relowner) as protected_table_owner_count,
  count(*) filter (where classes.relforcerowsecurity) as protected_table_force_rls_count,
  array_agg(classes.relname order by classes.relname) as protected_tables,
  array_agg(pg_get_userbyid(classes.relowner) order by classes.relname) as table_owners
from pg_class as classes
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public' and classes.relkind = 'r'
  and classes.relname in (
    'organizations', 'organization_members', 'system_user_access', 'profiles'
  );

select
  pg_get_function_identity_arguments(functions.oid) as signature,
  functions.prosecdef as security_definer,
  functions.proconfig @> array['search_path=pg_catalog, public']::text[]
    as search_path_valid,
  pg_get_userbyid(functions.proowner) as function_owner,
  pg_get_userbyid((
    select min(classes.relowner::text)::oid
    from pg_class as classes
    join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public' and classes.relkind = 'r'
      and classes.relname in (
        'organizations', 'organization_members', 'system_user_access', 'profiles'
      )
  )) as protected_table_owner,
  functions.proowner = (
    select min(classes.relowner::text)::oid
    from pg_class as classes
    join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
    where namespaces.nspname = 'public' and classes.relkind = 'r'
      and classes.relname in (
        'organizations', 'organization_members', 'system_user_access', 'profiles'
      )
  ) as owner_matches_protected_tables,
  has_function_privilege('public', functions.oid, 'execute') as public_execute,
  has_function_privilege('anon', functions.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', functions.oid, 'execute') as authenticated_execute
from pg_proc as functions
join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public' and functions.oid in (
  to_regprocedure('public.get_my_organization_access(uuid)'),
  to_regprocedure('public.list_organization_members(uuid)'),
  to_regprocedure('public.lookup_organization_candidate_by_email(uuid,text)')
)
order by signature;

with function_definition as (
  select functions.proname, pg_get_functiondef(functions.oid) as definition
  from pg_proc as functions
  join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.oid in (
      to_regprocedure('public.get_my_organization_access(uuid)'),
      to_regprocedure('public.list_organization_members(uuid)'),
      to_regprocedure('public.lookup_organization_candidate_by_email(uuid,text)')
    )
)
select
  proname,
  strpos(definition, 'security definer') > 0 as security_definer_present,
  strpos(definition, 'search_path = pg_catalog, public') > 0 as search_path_present,
  strpos(definition, 'public.organization_members') > 0 as organization_members_access_present,
  strpos(definition, 'auth.uid()') > 0 as current_user_binding_present,
  strpos(definition, 'auth.users') > 0 as auth_user_lookup_present,
  strpos(definition, 'account_status = ''approved''') > 0 as approved_candidate_only_present
from function_definition
order by proname;
