begin;

alter table public.conference_membership_operations
  drop constraint if exists conference_membership_operations_operation_type_check,
  drop constraint if exists conference_membership_operations_resulting_role_check,
  drop constraint if exists conference_membership_operations_result_status_check;

alter table public.conference_membership_operations
  add column if not exists requested_role text null,
  add column if not exists previous_role text null,
  add column if not exists stored_result jsonb null;

alter table public.conference_membership_operations
  add constraint conference_membership_operations_operation_type_check
    check (operation_type in (
      'add_manager', 'remove_manager',
      'add_member', 'change_member_role', 'remove_member'
    )),
  add constraint conference_membership_operations_requested_role_check
    check (requested_role is null or requested_role in (
      'manager', 'viewer', 'accommodation_viewer', 'transport_viewer'
    )),
  add constraint conference_membership_operations_previous_role_check
    check (previous_role is null or previous_role in (
      'manager', 'viewer', 'accommodation_viewer', 'transport_viewer'
    )),
  add constraint conference_membership_operations_resulting_role_check
    check (resulting_role is null or resulting_role in (
      'manager', 'viewer', 'accommodation_viewer', 'transport_viewer'
    )),
  add constraint conference_membership_operations_result_status_check
    check (result_status in (
      'added', 'already_manager', 'removed', 'already_removed',
      'role_changed', 'unchanged', 'role_conflict', 'not_member'
    )),
  add constraint conference_membership_operations_stored_result_check
    check (stored_result is null or jsonb_typeof(stored_result) = 'object'),
  add constraint conference_membership_operations_general_intent_check
    check (
      operation_type in ('add_manager', 'remove_manager')
      or (
        operation_type in ('add_member', 'change_member_role')
        and requested_role is not null
      )
      or (
        operation_type = 'remove_member'
        and requested_role is null
      )
    );

create or replace function public.manage_conference_member(
  p_conference_id uuid,
  p_target_user_id uuid,
  p_operation_id uuid,
  p_action text,
  p_requested_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  conference_owner_id uuid;
  expected_operation_type text;
  existing_operation public.conference_membership_operations%rowtype;
  existing_role text;
  previous_role text;
  resulting_role text;
  result_status text;
  result_success boolean := true;
  result jsonb;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null or p_target_user_id is null
    or p_operation_id is null or p_action is null then
    raise exception 'invalid membership operation arguments';
  end if;
  if p_action not in ('add', 'change_role', 'remove') then
    raise exception 'invalid conference membership action';
  end if;
  if p_action in ('add', 'change_role') then
    if p_requested_role is null or p_requested_role not in (
      'manager', 'viewer', 'accommodation_viewer', 'transport_viewer'
    ) then
      raise exception 'invalid conference membership role';
    end if;
  elsif p_requested_role is not null then
    raise exception 'remove membership role must be null';
  end if;
  if not public.is_conference_owner(p_conference_id) then
    raise exception 'conference owner access required';
  end if;

  expected_operation_type := case p_action
    when 'add' then 'add_member'
    when 'change_role' then 'change_member_role'
    else 'remove_member'
  end;

  perform pg_advisory_xact_lock(hashtextextended(
    'conference-membership-operation:' || p_operation_id::text, 0
  ));

  select * into existing_operation
    from public.conference_membership_operations as operations
   where operations.operation_id = p_operation_id;
  if found then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.actor_user_id <> actor_id
      or existing_operation.target_user_id <> p_target_user_id
      or existing_operation.operation_type <> expected_operation_type
      or existing_operation.requested_role is distinct from p_requested_role then
      raise exception 'membership operation id belongs to another operation';
    end if;
    if existing_operation.stored_result is null then
      raise exception 'membership operation result is unavailable';
    end if;
    return existing_operation.stored_result
      || jsonb_build_object('replayed', true);
  end if;

  select conferences.owner_id into conference_owner_id
    from public.conferences as conferences
   where conferences.id = p_conference_id
   for update;
  if not found then
    raise exception 'conference not found';
  end if;
  if p_target_user_id = conference_owner_id then
    raise exception 'conference owner membership cannot be managed';
  end if;
  if p_action in ('add', 'change_role') and not exists (
    select 1 from auth.users as users where users.id = p_target_user_id
  ) then
    raise exception 'target user not found';
  end if;

  select members.role into existing_role
    from public.conference_members as members
   where members.conference_id = p_conference_id
     and members.user_id = p_target_user_id
   for update;

  if found and existing_role = 'owner' then
    raise exception 'conference owner membership cannot be managed';
  end if;
  previous_role := case when found then existing_role else null end;

  if p_action = 'add' then
    if existing_role is null then
      insert into public.conference_members (conference_id, user_id, role)
      values (p_conference_id, p_target_user_id, p_requested_role);
      resulting_role := p_requested_role;
      result_status := 'added';
    elsif existing_role = p_requested_role then
      resulting_role := existing_role;
      result_status := 'unchanged';
    else
      resulting_role := existing_role;
      result_status := 'role_conflict';
      result_success := false;
    end if;
  elsif p_action = 'change_role' then
    if existing_role is null then
      resulting_role := null;
      result_status := 'not_member';
      result_success := false;
    elsif existing_role = p_requested_role then
      resulting_role := existing_role;
      result_status := 'unchanged';
    else
      update public.conference_members as members
         set role = p_requested_role
       where members.conference_id = p_conference_id
         and members.user_id = p_target_user_id;
      resulting_role := p_requested_role;
      result_status := 'role_changed';
      if existing_role = 'manager' and p_requested_role <> 'manager' then
        delete from public.conference_locks as locks
         where locks.conference_id = p_conference_id
           and locks.user_id = p_target_user_id;
      end if;
    end if;
  else
    if existing_role is null then
      resulting_role := null;
      result_status := 'already_removed';
    else
      delete from public.conference_members as members
       where members.conference_id = p_conference_id
         and members.user_id = p_target_user_id;
      delete from public.conference_locks as locks
       where locks.conference_id = p_conference_id
         and locks.user_id = p_target_user_id;
      resulting_role := null;
      result_status := 'removed';
    end if;
  end if;

  result := jsonb_build_object(
    'success', result_success,
    'status', result_status,
    'conferenceId', p_conference_id,
    'targetUserId', p_target_user_id,
    'previousRole', previous_role,
    'role', resulting_role,
    'action', p_action,
    'operationId', p_operation_id,
    'replayed', false
  );

  insert into public.conference_membership_operations (
    operation_id, conference_id, actor_user_id, target_user_id,
    operation_type, requested_role, previous_role, resulting_role,
    result_status, stored_result
  ) values (
    p_operation_id, p_conference_id, actor_id, p_target_user_id,
    expected_operation_type, p_requested_role, previous_role, resulting_role,
    result_status, result
  );

  return result;
end;
$$;

create or replace function public.device_guarded_manage_conference_member(
  p_actor_device_id uuid,
  p_conference_id uuid,
  p_target_user_id uuid,
  p_operation_id uuid,
  p_action text,
  p_requested_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.manage_conference_member(
    p_conference_id, p_target_user_id, p_operation_id,
    p_action, p_requested_role
  );
end;
$$;

create or replace function public.add_conference_manager(
  p_conference_id uuid,
  p_target_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  existing_operation public.conference_membership_operations%rowtype;
  existing_role text;
  general_result jsonb;
  legacy_status text;
  legacy_result jsonb;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  if p_conference_id is null or p_target_user_id is null or p_operation_id is null then
    raise exception 'invalid membership operation arguments';
  end if;
  if not public.is_conference_owner(p_conference_id) then
    raise exception 'conference owner access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'conference-membership-operation:' || p_operation_id::text, 0
  ));
  select * into existing_operation from public.conference_membership_operations as operations
   where operations.operation_id = p_operation_id;
  if found and existing_operation.operation_type = 'add_manager' then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.actor_user_id <> actor_id
      or existing_operation.target_user_id <> p_target_user_id then
      raise exception 'membership operation id belongs to another operation';
    end if;
    return jsonb_build_object('success', true, 'status', existing_operation.result_status,
      'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
      'role', existing_operation.resulting_role, 'operationId', p_operation_id,
      'replayed', true);
  end if;
  if found then
    general_result := public.manage_conference_member(
      p_conference_id, p_target_user_id, p_operation_id, 'add', 'manager'
    );
    if not coalesce((general_result ->> 'success')::boolean, false) then
      raise exception 'target user has a different conference role';
    end if;
    legacy_status := case general_result ->> 'status'
      when 'unchanged' then 'already_manager'
      else general_result ->> 'status'
    end;
    legacy_result := jsonb_build_object('success', true, 'status', legacy_status,
      'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
      'role', 'manager', 'operationId', p_operation_id,
      'replayed', true);
    return legacy_result;
  end if;
  select members.role into existing_role from public.conference_members as members
   where members.conference_id = p_conference_id and members.user_id = p_target_user_id;
  if found and existing_role <> 'manager' then
    raise exception 'target user has a different conference role';
  end if;
  general_result := public.manage_conference_member(
    p_conference_id, p_target_user_id, p_operation_id, 'add', 'manager'
  );
  legacy_status := case general_result ->> 'status'
    when 'unchanged' then 'already_manager'
    else general_result ->> 'status'
  end;
  legacy_result := jsonb_build_object('success', true, 'status', legacy_status,
    'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
    'role', 'manager', 'operationId', p_operation_id);
  if coalesce((general_result ->> 'replayed')::boolean, false) then
    legacy_result := legacy_result || jsonb_build_object('replayed', true);
  end if;
  return legacy_result;
end;
$$;

create or replace function public.remove_conference_manager(
  p_conference_id uuid,
  p_target_user_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  existing_operation public.conference_membership_operations%rowtype;
  existing_role text;
  general_result jsonb;
  legacy_result jsonb;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  if p_conference_id is null or p_target_user_id is null or p_operation_id is null then
    raise exception 'invalid membership operation arguments';
  end if;
  if not public.is_conference_owner(p_conference_id) then
    raise exception 'conference owner access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'conference-membership-operation:' || p_operation_id::text, 0
  ));
  select * into existing_operation from public.conference_membership_operations as operations
   where operations.operation_id = p_operation_id;
  if found and existing_operation.operation_type = 'remove_manager' then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.actor_user_id <> actor_id
      or existing_operation.target_user_id <> p_target_user_id then
      raise exception 'membership operation id belongs to another operation';
    end if;
    return jsonb_build_object('success', true, 'status', existing_operation.result_status,
      'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
      'role', existing_operation.resulting_role, 'operationId', p_operation_id,
      'replayed', true);
  end if;
  if found then
    general_result := public.manage_conference_member(
      p_conference_id, p_target_user_id, p_operation_id, 'remove', null
    );
    return jsonb_build_object('success', true,
      'status', general_result ->> 'status',
      'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
      'role', null, 'operationId', p_operation_id, 'replayed', true);
  end if;
  select members.role into existing_role from public.conference_members as members
   where members.conference_id = p_conference_id and members.user_id = p_target_user_id;
  if found and existing_role <> 'manager' then
    insert into public.conference_membership_operations (
      operation_id, conference_id, actor_user_id, target_user_id,
      operation_type, resulting_role, result_status
    ) values (
      p_operation_id, p_conference_id, actor_id, p_target_user_id,
      'remove_manager', null, 'already_removed'
    );
    return jsonb_build_object('success', true, 'status', 'already_removed',
      'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
      'role', null, 'operationId', p_operation_id);
  end if;
  general_result := public.manage_conference_member(
    p_conference_id, p_target_user_id, p_operation_id, 'remove', null
  );
  legacy_result := jsonb_build_object(
    'success', true, 'status', general_result ->> 'status',
    'conferenceId', p_conference_id, 'targetUserId', p_target_user_id,
    'role', null, 'operationId', p_operation_id);
  if coalesce((general_result ->> 'replayed')::boolean, false) then
    legacy_result := legacy_result || jsonb_build_object('replayed', true);
  end if;
  return legacy_result;
end;
$$;

create or replace function public.device_guarded_add_conference_manager(
  p_actor_device_id uuid, p_conference_id uuid,
  p_target_user_id uuid, p_operation_id uuid
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.add_conference_manager(
    p_conference_id, p_target_user_id, p_operation_id
  );
end;
$$;

create or replace function public.device_guarded_remove_conference_manager(
  p_actor_device_id uuid, p_conference_id uuid,
  p_target_user_id uuid, p_operation_id uuid
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.remove_conference_manager(
    p_conference_id, p_target_user_id, p_operation_id
  );
end;
$$;

revoke all on function public.manage_conference_member(uuid, uuid, uuid, text, text)
  from public, anon;
revoke all on function public.device_guarded_manage_conference_member(
  uuid, uuid, uuid, uuid, text, text
) from public, anon;
revoke all on function public.add_conference_manager(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.remove_conference_manager(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.device_guarded_add_conference_manager(
  uuid, uuid, uuid, uuid
) from public, anon;
revoke all on function public.device_guarded_remove_conference_manager(
  uuid, uuid, uuid, uuid
) from public, anon;

grant execute on function public.manage_conference_member(uuid, uuid, uuid, text, text)
  to authenticated;
grant execute on function public.device_guarded_manage_conference_member(
  uuid, uuid, uuid, uuid, text, text
) to authenticated;
grant execute on function public.add_conference_manager(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.remove_conference_manager(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.device_guarded_add_conference_manager(
  uuid, uuid, uuid, uuid
) to authenticated;
grant execute on function public.device_guarded_remove_conference_manager(
  uuid, uuid, uuid, uuid
) to authenticated;

commit;
