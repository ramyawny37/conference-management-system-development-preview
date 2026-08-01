-- P0.2C corrective read-only verification. Run after applying
-- 20260801_5_3_1_organization_access_locking.sql.
with function_definition as (
  select pg_get_functiondef(
    'public.manage_organization_member(uuid,uuid,uuid,text,text)'::regprocedure
  ) as definition
)
select
  strpos(definition, 'order by access.user_id') > 0
    and strpos(definition, 'for update') > strpos(definition, 'order by access.user_id')
    as system_access_uuid_lock_order_present,
  strpos(definition, 'actor_access_status is distinct from ''approved''') > 0
    and strpos(definition, 'actor_access_status is distinct from ''approved''')
      < strpos(definition, 'select * into existing')
    as actor_approval_before_idempotency,
  strpos(definition, 'select * into existing') > 0
    as idempotency_lookup_present,
  strpos(definition, 'order by members.user_id') > 0
    and strpos(definition, 'for update') > strpos(definition, 'order by members.user_id')
    as organization_member_uuid_lock_order_present,
  strpos(definition, 'target_access_status is distinct from ''approved''') > 0
    as add_target_approval_check_present,
  strpos(definition, 'p_action = ''add_organization_member''') > 0
    as target_access_locked_for_add_only,
  strpos(definition, 'public.store_organization_membership_result') > 0
    as audit_and_operation_store_present
from function_definition;

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
join pg_namespace as namespaces
  on namespaces.oid = functions.pronamespace
where namespaces.nspname = 'public'
  and functions.oid =
    'public.manage_organization_member(uuid,uuid,uuid,text,text)'::regprocedure;

select
  constraints.conname,
  pg_get_constraintdef(constraints.oid) as definition
from pg_constraint as constraints
join pg_class as classes on classes.oid = constraints.conrelid
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and classes.relname in (
    'organization_members', 'organization_membership_operations',
    'organization_membership_audit_log'
  )
order by classes.relname, constraints.conname;

select
  triggers.tgname,
  classes.relname as table_name,
  pg_get_triggerdef(triggers.oid) as definition
from pg_trigger as triggers
join pg_class as classes on classes.oid = triggers.tgrelid
join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
where namespaces.nspname = 'public'
  and triggers.tgname in (
    'organization_membership_audit_immutable',
    'organization_members_prevent_final_owner_removal'
  )
order by triggers.tgname;

select
  action,
  outcome,
  count(*)::bigint as total
from public.organization_membership_audit_log
group by action, outcome
order by action, outcome;

select 'operations_without_matching_audit' as check_name, count(*)::bigint as result
from public.organization_membership_operations as operations
where not exists (
  select 1
  from public.organization_membership_audit_log as audit
  where audit.organization_id = operations.organization_id
    and audit.actor_user_id_snapshot = operations.actor_user_id_snapshot
    and audit.target_user_id_snapshot = operations.target_user_id_snapshot
    and audit.operation_id = operations.operation_id
    and audit.action = operations.action
)
union all
select 'organizations_without_organization_owner', count(*)::bigint
from public.organizations as organizations
where not exists (
  select 1 from public.organization_members as members
  where members.organization_id = organizations.id
    and members.role = 'organization_owner'
)
union all
select 'conference_organization_missing', count(*)::bigint
from public.conferences where organization_id is null
union all
select 'owner_id_membership_inconsistencies', count(*)::bigint
from public.conferences as conferences
where not exists (
  select 1 from public.conference_members as members
  where members.conference_id = conferences.id
    and members.user_id = conferences.owner_id and members.role = 'owner'
)
union all
select 'extra_owner_memberships', count(*)::bigint
from public.conference_members as members
join public.conferences as conferences on conferences.id = members.conference_id
where members.role = 'owner' and members.user_id <> conferences.owner_id;
