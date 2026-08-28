-- Fail-closed read-only post-migration verification for Migration 6.17.0.
begin transaction read only;

do $$
declare
  legacy_signature text;
  legacy_function regprocedure;
  guarded_signature text;
  guarded_function regprocedure;
  bypass_function text;
begin
  if exists (
    select 1
      from unnest(array['anon', 'authenticated']) as roles(browser_role)
      cross join unnest(array[
        'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
      ]) as privileges(table_privilege)
     where has_table_privilege(
       roles.browser_role,
       'public.conference_members',
       privileges.table_privilege
     )
  ) then
    raise exception 'BROWSER_CONFERENCE_MEMBERS_WRITE_PRIVILEGE_REMAINS';
  end if;

  if exists (
    select 1 from pg_policies as policies
     where policies.schemaname = 'public'
       and policies.tablename = 'conference_members'
       and policies.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and policies.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'BROWSER_CONFERENCE_MEMBERS_WRITE_POLICY_REMAINS';
  end if;

  foreach legacy_signature in array array[
    'public.manage_organization_member(uuid,uuid,uuid,text,text)',
    'public.add_organization_member(uuid,uuid,uuid)',
    'public.remove_organization_member(uuid,uuid,uuid)',
    'public.change_organization_role(uuid,uuid,text,uuid)',
    'public.manage_conference_member(uuid,uuid,uuid,text,text)',
    'public.add_conference_manager(uuid,uuid,uuid)',
    'public.remove_conference_manager(uuid,uuid,uuid)'
  ] loop
    legacy_function := to_regprocedure(legacy_signature);
    if legacy_function is not null and (
      has_function_privilege('public', legacy_function, 'execute')
      or has_function_privilege('anon', legacy_function, 'execute')
      or has_function_privilege('authenticated', legacy_function, 'execute')
    ) then
      raise exception 'LEGACY_MEMBERSHIP_MUTATION_EXECUTE_REMAINS: %',
        legacy_signature;
    end if;
  end loop;

  foreach guarded_signature in array array[
    'public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)',
    'public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)',
    'public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)',
    'public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)',
    'public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)',
    'public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)'
  ] loop
    guarded_function := to_regprocedure(guarded_signature);
    if guarded_function is null or not has_function_privilege(
      'authenticated', guarded_function, 'execute'
    ) then
      raise exception 'DEVICE_GUARDED_MEMBERSHIP_ENTRY_POINT_MISSING: %',
        guarded_signature;
    end if;
    if position(
      'require_current_approved_device' in
      pg_get_functiondef(guarded_function)
    ) = 0 then
      raise exception 'MEMBERSHIP_ENTRY_POINT_IS_NOT_DEVICE_GUARDED: %',
        guarded_signature;
    end if;
  end loop;

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
         '(insert[[:space:][:print:]]*into|update|delete[[:space:]]+from)[[:space:]]+public[.]conference_members'
       or pg_get_functiondef(functions.oid) ~*
         'public[.](manage_conference_member|add_conference_manager|remove_conference_manager)[(]'
     )
     and has_function_privilege('authenticated', functions.oid, 'execute')
     and functions.proname not like 'device_guarded_%'
   order by functions.proname limit 1;
  if bypass_function is not null then
    raise exception 'UNGUARDED_CONFERENCE_MEMBERS_MUTATOR_EXECUTABLE: %',
      bypass_function;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.conference_members'::regclass
       and tgname = 'conference_members_require_organization_membership'
       and tgenabled <> 'D' and not tgisinternal
       and (tgtype::integer & 1) <> 0
       and (tgtype::integer & 2) <> 0
       and (tgtype::integer & 4) <> 0
       and (tgtype::integer & 16) <> 0
       and tgfoid = to_regprocedure(
         'public.require_conference_member_organization_membership()'
       )
  ) or to_regprocedure(
    'public.require_conference_member_organization_membership()'
  ) is null then
    raise exception 'CONFERENCE_ORGANIZATION_MEMBERSHIP_TRIGGER_MISSING';
  end if;
  if position(
      'join public.organization_members' in lower(pg_get_functiondef(
        to_regprocedure(
          'public.require_conference_member_organization_membership()'
        )
      ))
    ) = 0
    or position(
      'organization_members.user_id = new.user_id' in lower(pg_get_functiondef(
        to_regprocedure(
          'public.require_conference_member_organization_membership()'
        )
      ))
    ) = 0 then
    raise exception 'CONFERENCE_ORGANIZATION_MEMBERSHIP_GUARD_INVALID';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.organization_members'::regclass
       and tgname = 'organization_members_protect_conference_memberships'
       and tgenabled <> 'D' and not tgisinternal
       and (tgtype::integer & 1) <> 0
       and (tgtype::integer & 2) <> 0
       and (tgtype::integer & 8) <> 0
       and tgfoid = to_regprocedure(
         'public.prevent_conference_member_organization_removal()'
       )
  ) or to_regprocedure(
    'public.prevent_conference_member_organization_removal()'
  ) is null then
    raise exception 'ORGANIZATION_CONFERENCE_MEMBERSHIP_TRIGGER_MISSING';
  end if;
  if position(
      'conference_members.user_id = old.user_id' in lower(pg_get_functiondef(
        to_regprocedure(
          'public.prevent_conference_member_organization_removal()'
        )
      ))
    ) = 0 then
    raise exception 'ORGANIZATION_CONFERENCE_MEMBERSHIP_GUARD_INVALID';
  end if;

  if exists (
    select 1
      from public.conference_members as conference_members
      join public.conferences as conferences
        on conferences.id = conference_members.conference_id
      left join public.organization_members as organization_members
        on organization_members.organization_id = conferences.organization_id
       and organization_members.user_id = conference_members.user_id
     where conferences.organization_id is null
        or organization_members.user_id is null
  ) then
    raise exception 'CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP_REMAINS';
  end if;
end;
$$;

select
  has_table_privilege('anon', 'public.conference_members', 'select')
    as anon_select,
  has_table_privilege('authenticated', 'public.conference_members', 'select')
    as authenticated_select,
  has_table_privilege('anon', 'public.conference_members',
    'insert')
    or has_table_privilege('anon', 'public.conference_members', 'update')
    or has_table_privilege('anon', 'public.conference_members', 'delete')
    or has_table_privilege('anon', 'public.conference_members', 'truncate')
    or has_table_privilege('anon', 'public.conference_members', 'references')
    or has_table_privilege('anon', 'public.conference_members', 'trigger')
    as anon_any_write,
  has_table_privilege('authenticated', 'public.conference_members',
    'insert')
    or has_table_privilege('authenticated', 'public.conference_members', 'update')
    or has_table_privilege('authenticated', 'public.conference_members', 'delete')
    or has_table_privilege('authenticated', 'public.conference_members', 'truncate')
    or has_table_privilege('authenticated', 'public.conference_members', 'references')
    or has_table_privilege('authenticated', 'public.conference_members', 'trigger')
    as authenticated_any_write;

select count(*)::bigint as organization_conference_membership_gap_count
from public.conference_members as conference_members
join public.conferences as conferences
  on conferences.id = conference_members.conference_id
left join public.organization_members as organization_members
  on organization_members.organization_id = conferences.organization_id
 and organization_members.user_id = conference_members.user_id
where conferences.organization_id is null
   or organization_members.user_id is null;

select
  count(*)::bigint as organization_member_count,
  md5(coalesce(string_agg(
    organization_id::text||'|'||user_id::text||'|'||role,
    E'\n' order by organization_id,user_id
  ),'')) as organization_member_fingerprint
from public.organization_members;

select
  count(*)::bigint as conference_member_count,
  md5(coalesce(string_agg(
    conference_id::text||'|'||user_id::text||'|'||role,
    E'\n' order by conference_id,user_id
  ),'')) as conference_member_fingerprint
from public.conference_members;

select
  current_database() as database_name,
  current_user as current_user_name,
  session_user as session_user_name,
  current_setting('server_version') as server_version,
  md5(coalesce(string_agg(
    roleid::text||'|'||member::text||'|'||grantor::text||'|'||
    admin_option::text||'|'||inherit_option::text||'|'||set_option::text,
    E'\n' order by roleid,member,grantor
  ),'')) as role_membership_fingerprint
from pg_auth_members;

commit;
