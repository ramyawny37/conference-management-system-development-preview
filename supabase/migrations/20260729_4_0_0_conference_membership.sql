begin;

create table public.conference_membership_operations (
  operation_id uuid primary key,
  conference_id uuid not null
    references public.conferences(id) on delete cascade,
  actor_user_id uuid not null
    references auth.users(id) on delete cascade,
  target_user_id uuid not null,
  operation_type text not null
    check (operation_type in ('add_manager', 'remove_manager')),
  resulting_role text
    check (resulting_role is null or resulting_role = 'manager'),
  result_status text not null
    check (
      result_status in (
        'added',
        'already_manager',
        'removed',
        'already_removed'
      )
    ),
  created_at timestamptz not null default now()
);

create index conference_membership_operations_conference_idx
  on public.conference_membership_operations(conference_id, created_at);
create index conference_membership_operations_actor_idx
  on public.conference_membership_operations(actor_user_id, created_at);

alter table public.conference_membership_operations
  enable row level security;

revoke all on table public.conference_membership_operations
  from public, anon, authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      ''
    )), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_users_create_profile on auth.users;
create trigger auth_users_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, display_name)
select
  users.id,
  nullif(btrim(coalesce(
    users.raw_user_meta_data ->> 'display_name',
    users.raw_user_meta_data ->> 'name',
    ''
  )), '')
from auth.users as users
on conflict (id) do nothing;

create or replace function public.get_my_conference_access(
  p_conference_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  membership public.conference_members%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null then
    raise exception 'conference id is required';
  end if;

  select *
    into membership
    from public.conference_members as cm
   where cm.conference_id = p_conference_id
     and cm.user_id = current_user_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 'access_denied',
      'conferenceId', p_conference_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'available',
    'conferenceId', p_conference_id,
    'userId', current_user_id,
    'role', membership.role,
    'canManageMembers', membership.role = 'owner',
    'canSync', membership.role in ('owner', 'manager'),
    'canResolveConflicts', membership.role in ('owner', 'manager'),
    'canAcquireLock', membership.role in ('owner', 'manager')
  );
end;
$$;

create or replace function public.list_conference_members(
  p_conference_id uuid
)
returns table (
  user_id uuid,
  display_name text,
  role text,
  created_at timestamptz,
  is_current_user boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null then
    raise exception 'conference id is required';
  end if;
  if not public.is_conference_member(p_conference_id) then
    raise exception 'conference membership required';
  end if;

  return query
  select
    cm.user_id,
    profile.display_name,
    cm.role,
    cm.created_at,
    cm.user_id = current_user_id
  from public.conference_members as cm
  left join public.profiles as profile
    on profile.id = cm.user_id
  where cm.conference_id = p_conference_id
  order by
    case when cm.role = 'owner' then 0 else 1 end,
    cm.created_at,
    cm.user_id;
end;
$$;

create or replace function public.lookup_conference_user_by_email(
  p_conference_id uuid,
  p_email text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  target_user_id uuid;
  target_display_name text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null
    or nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'invalid user lookup arguments';
  end if;
  if not public.is_conference_owner(p_conference_id) then
    raise exception 'conference owner access required';
  end if;

  select users.id, profile.display_name
    into target_user_id, target_display_name
    from auth.users as users
    left join public.profiles as profile on profile.id = users.id
   where lower(users.email) = lower(btrim(p_email))
   order by users.created_at
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 'not_found',
      'conferenceId', p_conference_id
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'found',
    'conferenceId', p_conference_id,
    'targetUserId', target_user_id,
    'displayName', target_display_name
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
  current_user_id uuid := auth.uid();
  conference_owner_id uuid;
  existing_operation public.conference_membership_operations%rowtype;
  existing_role text;
  operation_result_status text;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null
    or p_target_user_id is null
    or p_operation_id is null then
    raise exception 'invalid membership operation arguments';
  end if;
  if not public.is_conference_owner(p_conference_id) then
    raise exception 'conference owner access required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_operation_id::text, 0)
  );

  select *
    into existing_operation
    from public.conference_membership_operations as operation
   where operation.operation_id = p_operation_id;
  if found then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.actor_user_id <> current_user_id
      or existing_operation.target_user_id <> p_target_user_id
      or existing_operation.operation_type <> 'add_manager' then
      raise exception 'membership operation id belongs to another operation';
    end if;
    return jsonb_build_object(
      'success', true,
      'status', existing_operation.result_status,
      'conferenceId', p_conference_id,
      'targetUserId', p_target_user_id,
      'role', existing_operation.resulting_role,
      'operationId', p_operation_id,
      'replayed', true
    );
  end if;

  if not exists (
    select 1 from auth.users as users
     where users.id = p_target_user_id
  ) then
    raise exception 'target user not found';
  end if;

  select conferences.owner_id
    into conference_owner_id
    from public.conferences as conferences
   where conferences.id = p_conference_id
   for update;
  if not found then
    raise exception 'conference not found';
  end if;
  if p_target_user_id = conference_owner_id then
    raise exception 'conference owner is already a member';
  end if;

  select members.role
    into existing_role
    from public.conference_members as members
   where members.conference_id = p_conference_id
     and members.user_id = p_target_user_id
   for update;

  if found and existing_role <> 'manager' then
    raise exception 'target user has a different conference role';
  end if;

  if not found then
    insert into public.conference_members (
      conference_id,
      user_id,
      role
    ) values (
      p_conference_id,
      p_target_user_id,
      'manager'
    );
  end if;
  operation_result_status := case
    when existing_role = 'manager' then 'already_manager'
    else 'added'
  end;

  insert into public.conference_membership_operations (
    operation_id,
    conference_id,
    actor_user_id,
    target_user_id,
    operation_type,
    resulting_role,
    result_status
  ) values (
    p_operation_id,
    p_conference_id,
    current_user_id,
    p_target_user_id,
    'add_manager',
    'manager',
    operation_result_status
  );

  return jsonb_build_object(
    'success', true,
    'status', operation_result_status,
    'conferenceId', p_conference_id,
    'targetUserId', p_target_user_id,
    'role', 'manager',
    'operationId', p_operation_id
  );
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
  current_user_id uuid := auth.uid();
  conference_owner_id uuid;
  existing_operation public.conference_membership_operations%rowtype;
  removed_count integer := 0;
  operation_result_status text;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null
    or p_target_user_id is null
    or p_operation_id is null then
    raise exception 'invalid membership operation arguments';
  end if;
  if not public.is_conference_owner(p_conference_id) then
    raise exception 'conference owner access required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_operation_id::text, 0)
  );

  select *
    into existing_operation
    from public.conference_membership_operations as operation
   where operation.operation_id = p_operation_id;
  if found then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.actor_user_id <> current_user_id
      or existing_operation.target_user_id <> p_target_user_id
      or existing_operation.operation_type <> 'remove_manager' then
      raise exception 'membership operation id belongs to another operation';
    end if;
    return jsonb_build_object(
      'success', true,
      'status', existing_operation.result_status,
      'conferenceId', p_conference_id,
      'targetUserId', p_target_user_id,
      'role', existing_operation.resulting_role,
      'operationId', p_operation_id,
      'replayed', true
    );
  end if;

  select conferences.owner_id
    into conference_owner_id
    from public.conferences as conferences
   where conferences.id = p_conference_id
   for update;
  if not found then
    raise exception 'conference not found';
  end if;
  if p_target_user_id = conference_owner_id then
    raise exception 'conference owner membership cannot be removed';
  end if;

  delete from public.conference_members as members
   where members.conference_id = p_conference_id
     and members.user_id = p_target_user_id
     and members.role = 'manager';
  get diagnostics removed_count = row_count;
  operation_result_status := case
    when removed_count = 1 then 'removed'
    else 'already_removed'
  end;

  delete from public.conference_locks as locks
   where locks.conference_id = p_conference_id
     and locks.user_id = p_target_user_id;

  insert into public.conference_membership_operations (
    operation_id,
    conference_id,
    actor_user_id,
    target_user_id,
    operation_type,
    resulting_role,
    result_status
  ) values (
    p_operation_id,
    p_conference_id,
    current_user_id,
    p_target_user_id,
    'remove_manager',
    null,
    operation_result_status
  );

  return jsonb_build_object(
    'success', true,
    'status', operation_result_status,
    'conferenceId', p_conference_id,
    'targetUserId', p_target_user_id,
    'role', null,
    'operationId', p_operation_id
  );
end;
$$;

create or replace function public.enforce_conference_lock_manager()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_conference_id uuid;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  target_conference_id := case
    when tg_op = 'DELETE' then old.conference_id
    else new.conference_id
  end;
  if not public.has_conference_role(
    target_conference_id,
    array['owner', 'manager']
  ) then
    raise exception 'conference lock write access denied';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists conference_locks_require_manager
  on public.conference_locks;
create trigger conference_locks_require_manager
before insert or update or delete on public.conference_locks
for each row execute function public.enforce_conference_lock_manager();

revoke all on function public.handle_new_user_profile()
  from public, anon, authenticated;
revoke all on function public.get_my_conference_access(uuid)
  from public, anon, authenticated;
revoke all on function public.list_conference_members(uuid)
  from public, anon, authenticated;
revoke all on function public.lookup_conference_user_by_email(
  uuid, text
) from public, anon, authenticated;
revoke all on function public.add_conference_manager(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.remove_conference_manager(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.enforce_conference_lock_manager()
  from public, anon, authenticated;

grant execute on function public.get_my_conference_access(uuid)
  to authenticated;
grant execute on function public.list_conference_members(uuid)
  to authenticated;
grant execute on function public.lookup_conference_user_by_email(
  uuid, text
) to authenticated;
grant execute on function public.add_conference_manager(
  uuid, uuid, uuid
) to authenticated;
grant execute on function public.remove_conference_manager(
  uuid, uuid, uuid
) to authenticated;

commit;
