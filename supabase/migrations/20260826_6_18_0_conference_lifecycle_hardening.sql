begin;

-- Hold the audited relations stable and capture an in-transaction baseline.
-- The temporary INSERT below never touches application data and is discarded
-- automatically at commit. It lets the final postcondition prove that this DDL
-- migration did not rewrite Conference state or historical ledgers.
lock table public.conferences, public.conference_members,
  public.conference_creation_operations,
  public.conference_membership_operations,
  public.conference_snapshot_guard_intents,
  public.sync_operations, public.sync_conflicts in share mode;

create temporary table migration_6_18_0_data_baseline (
  relation text primary key,
  row_count bigint not null,
  fingerprint text not null
) on commit drop;

insert into migration_6_18_0_data_baseline
  (relation, row_count, fingerprint)
select 'conferences', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n' order by rows.id),''))
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
union all
select 'pg_auth_members', count(*)::bigint,
  md5(coalesce(string_agg(
    roleid::text||'|'||member::text||'|'||grantor::text||'|'||
    admin_option::text||'|'||inherit_option::text||'|'||set_option::text,
    E'\n' order by roleid, member, grantor
  ),''))
from pg_auth_members;

-- Conference lifecycle mutations are authorization-plane operations. Content
-- section locks do not authorize Conference-row or membership administration.
-- Browser mutation is limited to the approved-account/current-device guarded,
-- Organization-aware creation and reviewed legacy null-Organization assignment
-- contracts.

-- Never harden over inconsistent live authorization state.
do $$
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
end;
$$;

-- Validate the exact supported creation and legacy-assignment dependencies before
-- changing privileges. A catalog difference requires a reviewed migration.
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
begin
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
    or position(
      'require_current_approved_device' in
      pg_get_functiondef(guarded_assignment)
    ) = 0
    or position(
      'conference_members' in pg_get_functiondef(guarded_assignment)
    ) = 0
    or position(
      'conference_row.organization_id is not null' in
      pg_get_functiondef(guarded_assignment)
    ) = 0
    or position(
      'organizations o where o.id=p_organization_id and o.status=''active''' in
      pg_get_functiondef(guarded_assignment)
    ) = 0 then
    raise exception 'GUARDED_LEGACY_CONFERENCE_ASSIGNMENT_INVALID';
  end if;
end;
$$;

-- Fail closed on an unreviewed browser Conference write policy.
do $$
declare
  unexpected_policy text;
begin
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
   order by policies.policyname
   limit 1;
  if unexpected_policy is not null then
    raise exception 'UNREVIEWED_CONFERENCE_WRITE_POLICY: %',
      unexpected_policy;
  end if;
end;
$$;

-- Browser roles retain intended RLS-filtered read access only. Ownership and
-- internal service-role privileges are unchanged.
revoke insert, update, delete, truncate, references, trigger
  on table public.conferences
  from public, anon, authenticated;

drop policy if exists conferences_insert_own on public.conferences;
drop policy if exists conferences_update_manager on public.conferences;
drop policy if exists conferences_delete_owner on public.conferences;

-- Remove obsolete Organization-less creation surfaces. Keep the Organization-
-- aware inner function internal and its guarded wrapper browser-executable.
do $$
declare
  signature text;
  target_function regprocedure;
begin
  foreach signature in array array[
    'public.create_conference_idempotent(uuid,uuid,text,jsonb)',
    'public.device_guarded_create_conference_idempotent(uuid,uuid,uuid,text,jsonb)',
    'public.create_organization_conference_idempotent(uuid,uuid,uuid,text,jsonb)'
  ] loop
    target_function := to_regprocedure(signature);
    if target_function is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        target_function::text
      );
    end if;
  end loop;
end;
$$;

-- The owner-membership bootstrap remains an internal trigger step inside the
-- guarded creation transaction; it is not a browser RPC.
revoke all on function public.add_conference_owner_membership()
  from public, anon, authenticated;

-- General reparenting is denied. Preserve only the existing legacy null ->
-- Organization assignment, and enforce the complete destination membership
-- invariant at the table boundary so internal paths cannot bypass it.
create or replace function public.prevent_invalid_conference_organization_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.organization_id is not distinct from old.organization_id then
    return new;
  end if;

  if old.organization_id is not null then
    raise exception 'GENERAL_CONFERENCE_REPARENTING_NOT_ALLOWED'
      using errcode = '55000';
  end if;

  if new.organization_id is null or not exists (
    select 1
      from public.organizations as organizations
     where organizations.id = new.organization_id
       and organizations.status = 'active'
  ) then
    raise exception 'ACTIVE_CONFERENCE_ORGANIZATION_REQUIRED'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
      from public.organization_members as organization_members
     where organization_members.organization_id = new.organization_id
       and organization_members.user_id = new.owner_id
  ) then
    raise exception 'CONFERENCE_OWNER_ORGANIZATION_MEMBERSHIP_REQUIRED'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from public.conference_members as conference_members
     where conference_members.conference_id = old.id
       and not exists (
         select 1
           from public.organization_members as organization_members
          where organization_members.organization_id = new.organization_id
            and organization_members.user_id = conference_members.user_id
       )
  ) then
    raise exception 'CONFERENCE_MEMBERS_ORGANIZATION_MEMBERSHIP_REQUIRED'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists conferences_prevent_invalid_organization_change
  on public.conferences;
create trigger conferences_prevent_invalid_organization_change
before update of organization_id on public.conferences
for each row execute function
  public.prevent_invalid_conference_organization_change();

revoke all on function public.prevent_invalid_conference_organization_change()
  from public, anon, authenticated;

-- Transactional postconditions: any surviving browser lifecycle bypass rolls
-- back the complete migration.
do $$
declare
  obsolete_signature text;
  obsolete_function regprocedure;
  guarded_create regprocedure := to_regprocedure(
    'public.device_guarded_create_organization_conference_idempotent(uuid,uuid,uuid,uuid,text,jsonb)'
  );
  bypass_function text;
  changed_relation text;
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
    or position(
      'require_current_approved_device' in pg_get_functiondef(guarded_create)
    ) = 0 then
    raise exception 'GUARDED_ORGANIZATION_CONFERENCE_CREATE_UNAVAILABLE';
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

  if has_function_privilege(
      'anon', 'public.add_conference_owner_membership()', 'execute'
    ) or has_function_privilege(
      'authenticated', 'public.add_conference_owner_membership()', 'execute'
    ) then
    raise exception 'OWNER_BOOTSTRAP_BROWSER_EXECUTE_REMAINS';
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

  with current_fingerprints as (
    select 'conferences' relation, count(*)::bigint row_count,
      md5(coalesce(string_agg(to_jsonb(rows)::text, E'\n'
        order by rows.id),'')) fingerprint
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
    union all
    select 'pg_auth_members', count(*)::bigint,
      md5(coalesce(string_agg(
        roleid::text||'|'||member::text||'|'||grantor::text||'|'||
        admin_option::text||'|'||inherit_option::text||'|'||set_option::text,
        E'\n' order by roleid, member, grantor
      ),''))
    from pg_auth_members
  )
  select baseline.relation into changed_relation
    from migration_6_18_0_data_baseline as baseline
    join current_fingerprints as current
      using (relation)
   where baseline.row_count <> current.row_count
      or baseline.fingerprint <> current.fingerprint
   order by baseline.relation
   limit 1;
  if changed_relation is not null then
    raise exception 'MIGRATION_CHANGED_DATA_OR_HISTORY: %', changed_relation;
  end if;
end;
$$;

commit;
