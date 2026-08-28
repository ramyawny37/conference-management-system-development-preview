begin;

-- Conference membership administration is an authorization-plane operation.
-- Existing section locks protect synchronized conference content sections; they
-- are not part of the membership-management contract. Membership mutations must
-- instead pass the approved-account/device guard, Conference-owner check,
-- idempotent operation ledger, and Organization-parent invariant below.

-- Never harden over inconsistent parent/child authorization data. Diagnosis and
-- repair are separate reviewed operations; this migration never rewrites rows.
do $$
begin
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
    raise exception 'EXISTING_CONFERENCE_ORGANIZATION_MEMBERSHIP_GAP';
  end if;
end;
$$;

-- Fail closed if an unknown browser-applicable Conference-members write policy
-- appears. The known policies are removed below; a new policy requires review.
do $$
declare
  unexpected_policy text;
begin
  select policies.policyname
    into unexpected_policy
    from pg_policies as policies
   where policies.schemaname = 'public'
     and policies.tablename = 'conference_members'
     and policies.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and policies.roles && array['public', 'anon', 'authenticated']::name[]
     and policies.policyname not in (
       'conference_members_insert_owner',
       'conference_members_update_owner',
       'conference_members_delete_owner'
     )
   order by policies.policyname
   limit 1;

  if unexpected_policy is not null then
    raise exception 'UNREVIEWED_CONFERENCE_MEMBERS_WRITE_POLICY: %',
      unexpected_policy;
  end if;
end;
$$;

-- Validate each present browser-executable legacy RPC has its exact guarded
-- replacement before changing privileges. Internal roles are intentionally not
-- modified.
do $$
declare
  mapping record;
  legacy_function regprocedure;
  guarded_function regprocedure;
begin
  for mapping in
    select * from (values
      ('public.manage_organization_member(uuid,uuid,uuid,text,text)', null),
      ('public.add_organization_member(uuid,uuid,uuid)',
       'public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)'),
      ('public.remove_organization_member(uuid,uuid,uuid)',
       'public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)'),
      ('public.change_organization_role(uuid,uuid,text,uuid)',
       'public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)'),
      ('public.manage_conference_member(uuid,uuid,uuid,text,text)',
       'public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)'),
      ('public.add_conference_manager(uuid,uuid,uuid)',
       'public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)'),
      ('public.remove_conference_manager(uuid,uuid,uuid)',
       'public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)')
    ) as mappings(legacy_signature, guarded_signature)
  loop
    legacy_function := to_regprocedure(mapping.legacy_signature);
    if legacy_function is null then
      continue;
    end if;

    if has_function_privilege('authenticated', legacy_function, 'execute') then
      if mapping.guarded_signature is null then
        raise exception
          'BROWSER_EXECUTABLE_LEGACY_FUNCTION_HAS_NO_GUARDED_PATH: %',
          mapping.legacy_signature;
      end if;
      guarded_function := to_regprocedure(mapping.guarded_signature);
      if guarded_function is null or not has_function_privilege(
        'authenticated', guarded_function, 'execute'
      ) then
        raise exception 'REQUIRED_GUARDED_MEMBERSHIP_RPC_UNAVAILABLE: %',
          mapping.guarded_signature;
      end if;
      if position(
        'require_current_approved_device' in
        pg_get_functiondef(guarded_function)
      ) = 0 then
        raise exception 'REQUIRED_GUARDED_MEMBERSHIP_RPC_IS_NOT_DEVICE_GUARDED: %',
          mapping.guarded_signature;
      end if;
    end if;
  end loop;
end;
$$;

-- Browser roles may read Conference memberships through RLS, but may not write
-- the table directly. This also removes privileges inherited through PUBLIC;
-- table ownership and internal service roles are unchanged.
revoke insert, update, delete, truncate, references, trigger
  on table public.conference_members
  from public, anon, authenticated;

-- Remove the browser write-policy surface as defense in depth. Controlled
-- SECURITY DEFINER mutation functions execute as their owner and remain usable.
drop policy if exists conference_members_insert_owner
  on public.conference_members;
drop policy if exists conference_members_update_owner
  on public.conference_members;
drop policy if exists conference_members_delete_owner
  on public.conference_members;

-- Enforce Conference -> Organization membership at the table boundary. This
-- covers every RPC, trigger, or future internal writer, including changes to the
-- effective Conference/user relationship. Historical operation rows are not
-- changed or deleted.
create or replace function
  public.require_conference_member_organization_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
      from public.conferences as conferences
      join public.organization_members as organization_members
        on organization_members.organization_id = conferences.organization_id
       and organization_members.user_id = new.user_id
     where conferences.id = new.conference_id
       and conferences.organization_id is not null
  ) then
    raise exception 'CONFERENCE_MEMBER_REQUIRES_ORGANIZATION_MEMBERSHIP'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists conference_members_require_organization_membership
  on public.conference_members;
create trigger conference_members_require_organization_membership
before insert or update of conference_id, user_id
on public.conference_members
for each row execute function
  public.require_conference_member_organization_membership();

revoke all on function
  public.require_conference_member_organization_membership()
  from public, anon, authenticated;

-- Preserve both parent and child records: the child Conference membership must
-- be resolved before its parent Organization membership can be removed.
create or replace function
  public.prevent_conference_member_organization_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
      from public.conferences as conferences
      join public.conference_members as conference_members
        on conference_members.conference_id = conferences.id
     where conferences.organization_id = old.organization_id
       and conference_members.user_id = old.user_id
  ) then
    raise exception 'ORGANIZATION_MEMBER_HAS_CONFERENCE_MEMBERSHIPS'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists organization_members_protect_conference_memberships
  on public.organization_members;
create trigger organization_members_protect_conference_memberships
before delete on public.organization_members
for each row execute function
  public.prevent_conference_member_organization_removal();

revoke all on function
  public.prevent_conference_member_organization_removal()
  from public, anon, authenticated;

-- Revoke only the reviewed legacy signatures from browser roles. Their owning
-- SECURITY DEFINER guarded wrappers can continue to call them internally.
do $$
declare
  legacy_signature text;
  legacy_function regprocedure;
begin
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
    if legacy_function is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        legacy_function::text
      );
    end if;
  end loop;
end;
$$;

-- Transactional postconditions. Any remaining browser bypass rolls back the
-- entire migration.
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
    select 1
      from pg_policies as policies
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
       and tgenabled <> 'D'
       and not tgisinternal
       and (tgtype::integer & 1) <> 0
       and (tgtype::integer & 2) <> 0
       and (tgtype::integer & 4) <> 0
       and (tgtype::integer & 16) <> 0
       and tgfoid = to_regprocedure(
         'public.require_conference_member_organization_membership()'
       )
  ) then
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
       and tgenabled <> 'D'
       and not tgisinternal
       and (tgtype::integer & 1) <> 0
       and (tgtype::integer & 2) <> 0
       and (tgtype::integer & 8) <> 0
       and tgfoid = to_regprocedure(
         'public.prevent_conference_member_organization_removal()'
       )
  ) then
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

commit;
