-- P0.2B read-only verification. Run after applying
-- 20260801_5_2_0_organization_security_activation.sql.
select 'organizations_total' as check_name, count(*)::bigint as result
from public.organizations
union all
select 'default_organizations', count(*)::bigint
from public.organizations
where is_default
union all
select 'organization_members_total', count(*)::bigint
from public.organization_members
union all
select 'conference_organization_missing', count(*)::bigint
from public.conferences
where organization_id is null
union all
select 'conference_owners_missing_organization_membership', count(*)::bigint
from public.conferences as conferences
where not exists (
  select 1
    from public.organization_members as members
   where members.organization_id = conferences.organization_id
     and members.user_id = conferences.owner_id
)
union all
select 'owner_id_membership_inconsistencies', count(*)::bigint
from public.conferences as conferences
where not exists (
  select 1
    from public.conference_members as members
   where members.conference_id = conferences.id
     and members.user_id = conferences.owner_id
     and members.role = 'owner'
)
union all
select 'extra_owner_memberships', count(*)::bigint
from public.conference_members as members
join public.conferences as conferences
  on conferences.id = members.conference_id
where members.role = 'owner'
  and members.user_id <> conferences.owner_id
union all
select 'organization_members_not_approved', count(*)::bigint
from public.organization_members as members
left join public.system_user_access as access
  on access.user_id = members.user_id
where access.user_id is null
   or access.account_status <> 'approved';

select
  classes.relname as table_name,
  pg_get_userbyid(classes.relowner) as table_owner,
  classes.relrowsecurity as rls_enabled,
  classes.relforcerowsecurity as rls_forced,
  has_table_privilege('public', classes.oid, 'select') as public_select,
  has_table_privilege('public', classes.oid, 'insert') as public_insert,
  has_table_privilege('public', classes.oid, 'update') as public_update,
  has_table_privilege('public', classes.oid, 'delete') as public_delete,
  has_table_privilege('anon', classes.oid, 'select') as anon_select,
  has_table_privilege('anon', classes.oid, 'insert') as anon_insert,
  has_table_privilege('anon', classes.oid, 'update') as anon_update,
  has_table_privilege('anon', classes.oid, 'delete') as anon_delete,
  has_table_privilege('authenticated', classes.oid, 'select') as authenticated_select,
  has_table_privilege('authenticated', classes.oid, 'insert') as authenticated_insert,
  has_table_privilege('authenticated', classes.oid, 'update') as authenticated_update,
  has_table_privilege('authenticated', classes.oid, 'delete') as authenticated_delete
from pg_class as classes
join pg_namespace as namespaces
  on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and classes.relname in ('organizations', 'organization_members')
order by classes.relname;

select
  policies.tablename,
  policies.policyname,
  policies.cmd,
  policies.roles,
  policies.qual
from pg_policies as policies
where policies.schemaname = 'public'
  and policies.tablename in ('organizations', 'organization_members')
order by policies.tablename, policies.policyname;

select
  functions.proname as routine_name,
  pg_get_function_identity_arguments(functions.oid) as arguments,
  pg_get_userbyid(functions.proowner) as function_owner,
  functions.prosecdef as security_definer,
  has_function_privilege(
    'public',
    functions.oid,
    'execute'
  ) as public_execute,
  has_function_privilege(
    'anon',
    functions.oid,
    'execute'
  ) as anon_execute,
  has_function_privilege(
    'authenticated',
    functions.oid,
    'execute'
  ) as authenticated_execute,
  pg_get_functiondef(functions.oid) as definition
from pg_proc as functions
join pg_namespace as namespaces
  on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public'
  and functions.proname in (
    'is_current_user_organization_member',
    'list_my_organizations'
  )
order by functions.proname;

-- Expected baseline: one default organization, two members, ten mapped
-- conferences, and zero values for every inconsistency aggregate. Both
-- Organization tables must have RLS enabled, select=true, and all writes=false.
