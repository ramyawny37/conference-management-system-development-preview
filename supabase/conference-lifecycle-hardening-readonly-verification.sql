-- Fail-closed read-only post-verification for Conference lifecycle hardening.
begin transaction read only;

do $$
declare
  obsolete_signature text;
  obsolete_function regprocedure;
  guarded_create regprocedure := to_regprocedure(
    'public.device_guarded_create_organization_conference_idempotent(uuid,uuid,uuid,uuid,text,jsonb)'
  );
  internal_create regprocedure := to_regprocedure(
    'public.create_organization_conference_idempotent(uuid,uuid,uuid,text,jsonb)'
  );
  bypass_function text;
begin
  if exists (
    select 1
      from unnest(array['anon', 'authenticated']) as roles(browser_role)
      cross join unnest(array[
        'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
      ]) as privileges(table_privilege)
     where has_table_privilege(
       roles.browser_role, 'public.conferences', privileges.table_privilege
     )
  ) then
    raise exception 'BROWSER_CONFERENCE_WRITE_PRIVILEGE_REMAINS';
  end if;

  if exists (
    select 1 from pg_policies as policies
     where policies.schemaname = 'public'
       and policies.tablename = 'conferences'
       and policies.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and policies.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'BROWSER_CONFERENCE_WRITE_POLICY_REMAINS';
  end if;

  foreach obsolete_signature in array array[
    'public.create_conference_idempotent(uuid,uuid,text,jsonb)',
    'public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)',
    'public.create_organization_conference_idempotent(uuid,uuid,uuid,text,jsonb)'
  ] loop
    obsolete_function := to_regprocedure(obsolete_signature);
    if obsolete_function is not null and (
      has_function_privilege('public', obsolete_function, 'execute')
      or has_function_privilege('anon', obsolete_function, 'execute')
      or has_function_privilege('authenticated', obsolete_function, 'execute')
    ) then
      raise exception 'OBSOLETE_CONFERENCE_CREATE_EXECUTE_REMAINS: %',
        obsolete_signature;
    end if;
  end loop;

  if guarded_create is null
    or not has_function_privilege('authenticated', guarded_create, 'execute')
    or position('require_current_approved_device' in
      pg_get_functiondef(guarded_create)) = 0
    or position('create_organization_conference_idempotent' in
      pg_get_functiondef(guarded_create)) = 0 then
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
      pg_get_functiondef(internal_create)) = 0 then
    raise exception 'INTERNAL_ORGANIZATION_CONFERENCE_CREATE_INVALID';
  end if;

  if position(
      'conference_row.organization_id is not null' in pg_get_functiondef(
        to_regprocedure(
          'public.device_guarded_assign_legacy_conference_organization(uuid,uuid,uuid,uuid)'
        )
      )
    ) = 0 then
    raise exception 'LEGACY_ASSIGNMENT_IS_NOT_NULL_TO_ORGANIZATION_ONLY';
  end if;

  select format('%I.%I(%s)', namespaces.nspname, functions.proname,
      pg_get_function_identity_arguments(functions.oid))
    into bypass_function
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
       'device_guarded_create_organization_conference_idempotent',
       'device_guarded_assign_legacy_conference_organization'
     )
   order by functions.proname limit 1;
  if bypass_function is not null then
    raise exception 'UNGUARDED_CONFERENCE_LIFECYCLE_MUTATOR: %', bypass_function;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.conferences'::regclass
       and tgname = 'conferences_prevent_invalid_organization_change'
       and tgenabled <> 'D' and not tgisinternal
       and (tgtype::integer & 1) <> 0
       and (tgtype::integer & 2) <> 0
       and (tgtype::integer & 16) <> 0
       and tgfoid = to_regprocedure(
         'public.prevent_invalid_conference_organization_change()'
       )
  ) then
    raise exception 'CONFERENCE_ORGANIZATION_CHANGE_GUARD_MISSING';
  end if;

  if position('old.organization_id is not null' in lower(pg_get_functiondef(
      to_regprocedure(
        'public.prevent_invalid_conference_organization_change()'
      )
    ))) = 0
    or position('organizations.status = ''active''' in lower(pg_get_functiondef(
      to_regprocedure(
        'public.prevent_invalid_conference_organization_change()'
      )
    ))) = 0
    or position('conference_members' in lower(pg_get_functiondef(
      to_regprocedure(
        'public.prevent_invalid_conference_organization_change()'
      )
    ))) = 0 then
    raise exception 'CONFERENCE_ORGANIZATION_CHANGE_GUARD_INVALID';
  end if;

  if has_function_privilege(
      'anon', 'public.add_conference_owner_membership()', 'execute'
    ) or has_function_privilege(
      'authenticated', 'public.add_conference_owner_membership()', 'execute'
    ) then
    raise exception 'OWNER_BOOTSTRAP_BROWSER_EXECUTE_REMAINS';
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

  if exists (
    select 1
      from public.conferences as conferences
      left join public.organizations as organizations
        on organizations.id = conferences.organization_id
     where conferences.organization_id is null
        or organizations.id is null
        or organizations.status <> 'active'
  ) then
    raise exception 'INVALID_CONFERENCE_PARENT_ORGANIZATION_REMAINS';
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
    raise exception 'CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP_REMAINS';
  end if;
end;
$$;

select
  has_table_privilege('anon', 'public.conferences', 'select') as anon_select,
  has_table_privilege('authenticated', 'public.conferences', 'select')
    as authenticated_select,
  has_table_privilege('anon', 'public.conferences', 'insert')
    or has_table_privilege('anon', 'public.conferences', 'update')
    or has_table_privilege('anon', 'public.conferences', 'delete')
    or has_table_privilege('anon', 'public.conferences', 'truncate')
    or has_table_privilege('anon', 'public.conferences', 'references')
    or has_table_privilege('anon', 'public.conferences', 'trigger')
    as anon_any_write,
  has_table_privilege('authenticated', 'public.conferences', 'insert')
    or has_table_privilege('authenticated', 'public.conferences', 'update')
    or has_table_privilege('authenticated', 'public.conferences', 'delete')
    or has_table_privilege('authenticated', 'public.conferences', 'truncate')
    or has_table_privilege('authenticated', 'public.conferences', 'references')
    or has_table_privilege('authenticated', 'public.conferences', 'trigger')
    as authenticated_any_write;

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
