begin;

create or replace function platform_private.reconcile_system_owner_platform_owner(
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_role_count integer;
  v_assignment_id uuid;
  v_canonical_owner boolean;
  v_outcome text;
  v_changed integer;
begin
  if p_user_id is null then
    raise exception 'SYSTEM_OWNER_PLATFORM_OWNER_RECONCILIATION_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'system-owner-platform-owner-reconciliation:' || p_user_id::text,
      0
    )
  );

  select count(*)
    into v_role_count
    from platform.roles as role
   where role.domain = 'platform'
     and role.code = 'platform_owner'
     and role.scope_type = 'platform'
     and role.is_system = true
     and role.is_assignable = false;

  if v_role_count <> 1 then
    raise exception 'PLATFORM_OWNER_COMPATIBILITY_ROLE_INVALID'
      using errcode = '55000';
  end if;

  select role.id
    into v_role_id
    from platform.roles as role
   where role.domain = 'platform'
     and role.code = 'platform_owner'
     and role.scope_type = 'platform'
     and role.is_system = true
     and role.is_assignable = false;

  select exists(
    select 1
      from public.system_user_roles as system_role
     where system_role.user_id = p_user_id
       and system_role.role = 'system_owner'
  ) into v_canonical_owner;

  if v_canonical_owner then
    if not exists(
      select 1
        from platform.profiles as profile
       where profile.user_id = p_user_id
         and profile.account_status = 'approved'
    ) then
      raise exception 'APPROVED_PLATFORM_PROFILE_REQUIRED'
        using errcode = '55000';
    end if;

    select assignment.id
      into v_assignment_id
      from platform.user_roles as assignment
     where assignment.user_id = p_user_id
       and assignment.role_id = v_role_id
       and assignment.scope_type = 'platform'
       and assignment.scope_id is null
       and assignment.revoked_at is null
     for update;

    if v_assignment_id is null then
      insert into platform.user_roles (
        user_id, role_id, scope_type, scope_id, granted_by, expires_at, metadata
      ) values (
        p_user_id, v_role_id, 'platform', null, null, null,
        pg_catalog.jsonb_build_object(
          'authoritySource', 'system_owner',
          'compatibilityProjection', true
        )
      )
      returning id into v_assignment_id;
      v_outcome := 'compatibility_granted';
    else
      update platform.user_roles
         set expires_at = null
       where id = v_assignment_id
         and expires_at is not null;
      get diagnostics v_changed = row_count;
      if v_changed > 0 then
        v_outcome := 'compatibility_reactivated';
      end if;
    end if;
  else
    select assignment.id
      into v_assignment_id
      from platform.user_roles as assignment
     where assignment.user_id = p_user_id
       and assignment.role_id = v_role_id
       and assignment.scope_type = 'platform'
       and assignment.scope_id is null
       and assignment.revoked_at is null
     limit 1;

    update platform.user_roles as assignment
       set revoked_at = pg_catalog.now(),
           revoked_by = null
     where assignment.user_id = p_user_id
       and assignment.role_id = v_role_id
       and assignment.scope_type = 'platform'
       and assignment.scope_id is null
       and assignment.revoked_at is null;
    get diagnostics v_changed = row_count;
    if v_changed > 0 then
      v_outcome := 'compatibility_revoked';
    end if;
  end if;

  if v_outcome is not null then
    insert into platform.audit_events (
      actor_user_id, actor_device_authorization_id, subject_user_id,
      domain, module, action, entity_type, entity_id,
      scope_type, scope_id, old_values, new_values, metadata, source
    ) values (
      null, null, p_user_id,
      'platform', 'roles', 'owner_projection.' || v_outcome,
      'user_role', v_assignment_id,
      'platform', null,
      case when v_outcome = 'compatibility_revoked'
        then pg_catalog.jsonb_build_object('effective', true)
        else null end,
      case when v_outcome = 'compatibility_revoked'
        then pg_catalog.jsonb_build_object('effective', false)
        else pg_catalog.jsonb_build_object(
          'effective', true,
          'role', 'platform_owner'
        ) end,
      pg_catalog.jsonb_build_object(
        'authoritySource', 'system_owner',
        'outcome', v_outcome
      ),
      'system'
    );
  end if;
end;
$$;

revoke all on function platform_private.reconcile_system_owner_platform_owner(uuid)
  from public, anon, authenticated, service_role;

create or replace function platform_private.reconcile_system_owner_platform_owner_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'system_owner' then
      perform platform_private.reconcile_system_owner_platform_owner(new.user_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.role = 'system_owner' then
      perform platform_private.reconcile_system_owner_platform_owner(old.user_id);
    end if;
  elsif old.role = 'system_owner'
        and new.role = 'system_owner'
        and old.user_id is distinct from new.user_id then
    if old.user_id::text < new.user_id::text then
      perform platform_private.reconcile_system_owner_platform_owner(old.user_id);
      perform platform_private.reconcile_system_owner_platform_owner(new.user_id);
    else
      perform platform_private.reconcile_system_owner_platform_owner(new.user_id);
      perform platform_private.reconcile_system_owner_platform_owner(old.user_id);
    end if;
  elsif old.role = 'system_owner' then
    perform platform_private.reconcile_system_owner_platform_owner(old.user_id);
  elsif new.role = 'system_owner' then
    perform platform_private.reconcile_system_owner_platform_owner(new.user_id);
  end if;

  return null;
end;
$$;

revoke all on function platform_private.reconcile_system_owner_platform_owner_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists system_owner_reconcile_platform_owner
  on public.system_user_roles;
create trigger system_owner_reconcile_platform_owner
after insert or delete or update of user_id, role
on public.system_user_roles
for each row execute function
  platform_private.reconcile_system_owner_platform_owner_trigger();

do $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select candidates.user_id
      from (
        select system_role.user_id
          from public.system_user_roles as system_role
         where system_role.role = 'system_owner'
        union
        select assignment.user_id
          from platform.user_roles as assignment
          join platform.roles as role on role.id = assignment.role_id
         where role.domain = 'platform'
           and role.code = 'platform_owner'
           and role.scope_type = 'platform'
           and role.is_system = true
           and role.is_assignable = false
           and assignment.scope_type = 'platform'
           and assignment.scope_id is null
           and assignment.revoked_at is null
      ) as candidates
     order by candidates.user_id
  loop
    perform platform_private.reconcile_system_owner_platform_owner(v_user_id);
  end loop;
end;
$$;

commit;
