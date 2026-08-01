-- P0.2C read-only verification. Run after applying
-- 20260801_5_3_0_organization_administration.sql.
select 'organizations_total' as check_name, count(*)::bigint as result
from public.organizations
union all select 'default_organizations', count(*)::bigint
from public.organizations where is_default
union all select 'organization_members_total', count(*)::bigint
from public.organization_members
union all select 'organization_owners_total', count(*)::bigint
from public.organization_members where role = 'organization_owner'
union all select 'organization_members_not_approved', count(*)::bigint
from public.organization_members as members left join public.system_user_access as access
  on access.user_id = members.user_id
where access.user_id is null or access.account_status <> 'approved'
union all select 'conference_organization_missing', count(*)::bigint
from public.conferences where organization_id is null
union all select 'owner_id_membership_inconsistencies', count(*)::bigint
from public.conferences as conferences where not exists (
  select 1 from public.conference_members as members
  where members.conference_id = conferences.id
    and members.user_id = conferences.owner_id and members.role = 'owner'
)
union all select 'extra_owner_memberships', count(*)::bigint
from public.conference_members as members join public.conferences as conferences
  on conferences.id = members.conference_id
where members.role = 'owner' and members.user_id <> conferences.owner_id
union all select 'organizations_without_organization_owner', count(*)::bigint
from public.organizations as organizations where not exists (
  select 1 from public.organization_members as members
  where members.organization_id = organizations.id
    and members.role = 'organization_owner'
);

select organizations.id, organizations.organization_key,
  members.user_id, users.email, members.role
from public.organizations as organizations
join public.organization_members as members on members.organization_id = organizations.id
join auth.users as users on users.id = members.user_id
where organizations.is_default and members.role = 'organization_owner';

select classes.relname, pg_get_userbyid(classes.relowner) as table_owner,
  classes.relrowsecurity, classes.relforcerowsecurity,
  has_table_privilege('public', classes.oid, 'select') as public_select,
  has_table_privilege('anon', classes.oid, 'select') as anon_select,
  has_table_privilege('authenticated', classes.oid, 'select') as authenticated_select,
  has_table_privilege('authenticated', classes.oid, 'insert') as authenticated_insert,
  has_table_privilege('authenticated', classes.oid, 'update') as authenticated_update,
  has_table_privilege('authenticated', classes.oid, 'delete') as authenticated_delete
from pg_class as classes join pg_namespace as namespaces
  on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and classes.relname in (
    'organizations', 'organization_members',
    'organization_membership_operations',
    'organization_membership_audit_log', 'system_user_access'
  )
order by classes.relname;

select triggers.tgname, classes.relname, pg_get_triggerdef(triggers.oid) as definition
from pg_trigger as triggers join pg_class as classes on classes.oid = triggers.tgrelid
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and triggers.tgname in (
    'organization_membership_audit_immutable',
    'organization_members_prevent_final_owner_removal'
  );

select functions.proname, pg_get_function_identity_arguments(functions.oid) as arguments,
  case when functions.oid in (
    to_regprocedure('public.add_organization_member(uuid,uuid,uuid)'),
    to_regprocedure('public.remove_organization_member(uuid,uuid,uuid)'),
    to_regprocedure('public.change_organization_role(uuid,uuid,text,uuid)')
  ) then 'browser_rpc' else 'internal' end as function_boundary,
  pg_get_userbyid(functions.proowner) as function_owner, functions.prosecdef,
  functions.proconfig as function_settings,
  has_function_privilege('public', functions.oid, 'execute') as public_execute,
  has_function_privilege('anon', functions.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', functions.oid, 'execute') as authenticated_execute,
  pg_get_functiondef(functions.oid) as definition
from pg_proc as functions join pg_namespace as namespaces
  on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public'
  and functions.proname in (
    'add_organization_member', 'remove_organization_member',
    'change_organization_role', 'manage_organization_member',
    'store_organization_membership_result',
    'prevent_organization_audit_mutation',
    'prevent_final_organization_owner_removal'
  ) order by functions.proname;

select action, outcome, count(*)::bigint as total
from public.organization_membership_audit_log
group by action, outcome order by action, outcome;
