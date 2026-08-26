-- Read-only readiness check for Conference lifecycle hardening.
begin transaction read only;

do $$
declare
  guarded_create regprocedure := to_regprocedure(
    'public.device_guarded_create_organization_conference_idempotent(uuid,uuid,uuid,uuid,text,jsonb)'
  );
  internal_create regprocedure := to_regprocedure(
    'public.create_organization_conference_idempotent(uuid,uuid,uuid,text,jsonb)'
  );
  guarded_assignment regprocedure := to_regprocedure(
    'public.device_guarded_assign_legacy_conference_organization(uuid,uuid,uuid,uuid)'
  );
  unexpected_policy text;
  unexpected_mutator text;
begin
  if exists (
    select 1
      from public.conferences as conferences
      left join public.organizations as organizations
        on organizations.id = conferences.organization_id
     where conferences.organization_id is null
        or organizations.id is null
        or organizations.status <> 'active'
  ) then
    raise exception 'INVALID_EXISTING_CONFERENCE_PARENT_ORGANIZATION';
  end if;

  if exists (
    select 1
      from public.conference_members as conference_members
      join public.conferences as conferences
        on conferences.id = conference_members.conference_id
      left join public.organization_members as organization_members
        on organization_members.organization_id = conferences.organization_id
       and organization_members.user_id = conference_members.user_id
     where organization_members.user_id is null
  ) then
    raise exception 'EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP';
  end if;

  if guarded_create is null
    or not has_function_privilege('authenticated', guarded_create, 'execute')
    or position(
      'require_current_approved_device' in pg_get_functiondef(guarded_create)
    ) = 0
    or position(
      'create_organization_conference_idempotent' in
      pg_get_functiondef(guarded_create)
    ) = 0 then
    raise exception 'GUARDED_ORGANIZATION_CONFERENCE_CREATE_UNAVAILABLE';
  end if;

  if internal_create is null
    or position('conference_creation_operations' in
      pg_get_functiondef(internal_create)) = 0
    or position('system_user_access' in
      pg_get_functiondef(internal_create)) = 0
    or position('can_user_create_conferences' in
      pg_get_functiondef(internal_create)) = 0
    or position('organizations o where o.id=p_organization_id and o.status=''active''' in
      pg_get_functiondef(internal_create)) = 0
    or position('organization_members' in
      pg_get_functiondef(internal_create)) = 0
    or position('organization_id' in
      pg_get_functiondef(internal_create)) = 0 then
    raise exception 'INTERNAL_ORGANIZATION_CONFERENCE_CREATE_INVALID';
  end if;

  if guarded_assignment is null
    or not has_function_privilege(
      'authenticated', guarded_assignment, 'execute'
    )
    or position('require_current_approved_device' in
      pg_get_functiondef(guarded_assignment)) = 0
    or position('conference_members' in
      pg_get_functiondef(guarded_assignment)) = 0
    or position('conference_row.organization_id is not null' in
      pg_get_functiondef(guarded_assignment)) = 0
    or position(
      'organizations o where o.id=p_organization_id and o.status=''active''' in
      pg_get_functiondef(guarded_assignment)) = 0 then
    raise exception 'GUARDED_LEGACY_CONFERENCE_ASSIGNMENT_INVALID';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.conferences'::regclass
       and tgname = 'conferences_add_owner_membership'
       and tgenabled <> 'D' and not tgisinternal
       and tgfoid = to_regprocedure(
         'public.add_conference_owner_membership()'
       )
  ) then
    raise exception 'OWNER_MEMBERSHIP_BOOTSTRAP_TRIGGER_MISSING';
  end if;

  select policies.policyname into unexpected_policy
    from pg_policies as policies
   where policies.schemaname = 'public'
     and policies.tablename = 'conferences'
     and policies.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and policies.roles && array['public', 'anon', 'authenticated']::name[]
     and policies.policyname not in (
       'conferences_insert_own',
       'conferences_update_manager',
       'conferences_delete_owner'
     )
   order by policies.policyname limit 1;
  if unexpected_policy is not null then
    raise exception 'UNREVIEWED_CONFERENCE_WRITE_POLICY: %', unexpected_policy;
  end if;

  select format('%I.%I(%s)', namespaces.nspname, functions.proname,
      pg_get_function_identity_arguments(functions.oid))
    into unexpected_mutator
    from pg_proc as functions
    join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
   where namespaces.nspname = 'public'
     and functions.prokind = 'f'
     and pg_get_function_result(functions.oid) <> 'trigger'
     and (
       pg_get_functiondef(functions.oid) ~*
         '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+(public[.])?conferences'
       or pg_get_functiondef(functions.oid) ~*
         'public[.](create_conference_idempotent|create_organization_conference_idempotent)[(]'
     )
     and (
       has_function_privilege('anon', functions.oid, 'execute')
       or has_function_privilege('authenticated', functions.oid, 'execute')
     )
     and functions.proname not in (
       'create_conference_idempotent',
       'device_guarded_create_conference_idempotent',
       'device_guarded_create_organization_conference_idempotent',
       'device_guarded_assign_legacy_conference_organization'
     )
   order by functions.proname limit 1;
  if unexpected_mutator is not null then
    raise exception 'UNREVIEWED_CONFERENCE_LIFECYCLE_MUTATOR: %',
      unexpected_mutator;
  end if;
end;
$$;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'conferences'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by grantee, privilege_type;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'conferences'
order by policyname;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute')
    as authenticated_execute,
  position('require_current_approved_device' in
    pg_get_functiondef(p.oid)) > 0 as device_guarded
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and p.proname in (
    'create_conference_idempotent',
    'device_guarded_create_conference_idempotent',
    'create_organization_conference_idempotent',
    'device_guarded_create_organization_conference_idempotent',
    'device_guarded_assign_legacy_conference_organization'
  )
order by p.proname, arguments;

select count(*)::bigint as organization_conference_membership_gap_count
from public.conference_members as conference_members
join public.conferences as conferences
  on conferences.id = conference_members.conference_id
left join public.organization_members as organization_members
  on organization_members.organization_id = conferences.organization_id
 and organization_members.user_id = conference_members.user_id
where organization_members.user_id is null;

select 'conferences' as relation, count(*)::bigint as row_count,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n' order by rows.id),''))
    as fingerprint
from public.conferences as rows
union all
select 'conference_members', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
    order by rows.conference_id, rows.user_id),''))
from public.conference_members as rows
union all
select 'conference_creation_operations', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
    order by rows.user_id, rows.operation_id),''))
from public.conference_creation_operations as rows
union all
select 'conference_membership_operations', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
    order by rows.operation_id),''))
from public.conference_membership_operations as rows
union all
select 'conference_snapshot_guard_intents', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
    order by rows.operation_id),''))
from public.conference_snapshot_guard_intents as rows
union all
select 'sync_operations', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
    order by rows.operation_id),''))
from public.sync_operations as rows
union all
select 'sync_conflicts', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
    order by rows.id),''))
from public.sync_conflicts as rows
order by relation;

select md5(coalesce(string_agg(
  roleid::text||'|'||member::text||'|'||grantor::text||'|'||
  admin_option::text||'|'||inherit_option::text||'|'||set_option::text,
  E'\n' order by roleid, member, grantor
),'')) as role_membership_fingerprint
from pg_auth_members;

commit;
