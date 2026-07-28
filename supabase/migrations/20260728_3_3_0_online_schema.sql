begin;

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conferences (
  id uuid primary key,
  name text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.conference_members (
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (
    role in (
      'owner',
      'manager',
      'accommodation_viewer',
      'transport_viewer',
      'viewer'
    )
  ),
  created_at timestamptz not null default now(),
  primary key (conference_id, user_id)
);

create table public.devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text,
  platform text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.conference_snapshots (
  conference_id uuid primary key references public.conferences(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision >= 1),
  schema_version text,
  app_version text,
  updated_by uuid references auth.users(id),
  updated_by_device_id uuid references public.devices(id),
  updated_at timestamptz not null default now()
);

create table public.sync_operations (
  operation_id uuid primary key,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  device_id uuid not null references public.devices(id),
  operation_type text not null check (length(btrim(operation_type)) > 0),
  base_revision bigint check (base_revision is null or base_revision >= 0),
  resulting_revision bigint check (resulting_revision is null or resulting_revision >= 1),
  status text not null check (status in ('pending', 'applied', 'rejected', 'conflict')),
  payload jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id) on delete cascade,
  operation_id uuid references public.sync_operations(operation_id),
  expected_revision bigint,
  actual_revision bigint,
  local_payload jsonb,
  server_snapshot jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'discarded')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create index conference_members_user_id_idx
  on public.conference_members(user_id);
create index conferences_owner_id_idx
  on public.conferences(owner_id);
create index conference_snapshots_updated_at_idx
  on public.conference_snapshots(updated_at);
create index sync_operations_conference_created_at_idx
  on public.sync_operations(conference_id, created_at);
create index sync_operations_user_status_idx
  on public.sync_operations(user_id, status);
create index sync_conflicts_conference_status_idx
  on public.sync_conflicts(conference_id, status);
create index devices_user_id_idx
  on public.devices(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger conferences_set_updated_at
before update on public.conferences
for each row execute function public.set_updated_at();

create or replace function public.add_conference_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.conference_members (conference_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger conferences_add_owner_membership
after insert on public.conferences
for each row execute function public.add_conference_owner_membership();

create or replace function public.prevent_conference_owner_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'conference owner cannot be changed directly';
  end if;
  return new;
end;
$$;

create trigger conferences_prevent_owner_change
before update on public.conferences
for each row execute function public.prevent_conference_owner_change();

create or replace function public.protect_conference_owner_membership()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  conference_owner_id uuid;
begin
  select c.owner_id
    into conference_owner_id
    from public.conferences as c
   where c.id = old.conference_id;

  if old.user_id = conference_owner_id then
    if tg_op = 'DELETE' then
      raise exception 'conference owner membership cannot be deleted';
    end if;
    if new.conference_id is distinct from old.conference_id
      or new.user_id is distinct from old.user_id
      or new.role <> 'owner' then
      raise exception 'conference owner membership cannot be changed';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger conference_members_protect_owner
before update or delete on public.conference_members
for each row execute function public.protect_conference_owner_membership();

create or replace function public.is_conference_member(target_conference_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
        from public.conference_members as cm
       where cm.conference_id = target_conference_id
         and cm.user_id = auth.uid()
    );
$$;

create or replace function public.has_conference_role(
  target_conference_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
        from public.conference_members as cm
       where cm.conference_id = target_conference_id
         and cm.user_id = auth.uid()
         and cm.role = any(allowed_roles)
    );
$$;

create or replace function public.is_conference_owner(target_conference_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
        from public.conferences as c
       where c.id = target_conference_id
         and c.owner_id = auth.uid()
    );
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.add_conference_owner_membership() from public;
revoke all on function public.prevent_conference_owner_change() from public;
revoke all on function public.protect_conference_owner_membership() from public;
revoke all on function public.is_conference_member(uuid) from public;
revoke all on function public.has_conference_role(uuid, text[]) from public;
revoke all on function public.is_conference_owner(uuid) from public;

grant execute on function public.is_conference_member(uuid) to authenticated;
grant execute on function public.has_conference_role(uuid, text[]) to authenticated;
grant execute on function public.is_conference_owner(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.conferences enable row level security;
alter table public.conference_members enable row level security;
alter table public.conference_snapshots enable row level security;
alter table public.sync_operations enable row level security;
alter table public.devices enable row level security;
alter table public.sync_conflicts enable row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy profiles_insert_own
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy profiles_update_own
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy conferences_select_member
on public.conferences for select
to authenticated
using (public.is_conference_member(id));

create policy conferences_insert_own
on public.conferences for insert
to authenticated
with check (auth.uid() is not null and owner_id = auth.uid());

create policy conferences_update_manager
on public.conferences for update
to authenticated
using (public.has_conference_role(id, array['owner', 'manager']))
with check (public.has_conference_role(id, array['owner', 'manager']));

create policy conferences_delete_owner
on public.conferences for delete
to authenticated
using (public.is_conference_owner(id));

create policy conference_members_select_member
on public.conference_members for select
to authenticated
using (public.is_conference_member(conference_id));

create policy conference_members_insert_owner
on public.conference_members for insert
to authenticated
with check (
  public.is_conference_owner(conference_id)
  and (
    (
      user_id = (
        select c.owner_id from public.conferences as c
        where c.id = conference_id
      )
      and role = 'owner'
    )
    or (
      user_id <> (
        select c.owner_id from public.conferences as c
        where c.id = conference_id
      )
      and role <> 'owner'
    )
  )
);

create policy conference_members_update_owner
on public.conference_members for update
to authenticated
using (public.is_conference_owner(conference_id))
with check (
  public.is_conference_owner(conference_id)
  and (
    (
      user_id = (
        select c.owner_id from public.conferences as c
        where c.id = conference_id
      )
      and role = 'owner'
    )
    or (
      user_id <> (
        select c.owner_id from public.conferences as c
        where c.id = conference_id
      )
      and role <> 'owner'
    )
  )
);

create policy conference_members_delete_owner
on public.conference_members for delete
to authenticated
using (public.is_conference_owner(conference_id));

create policy conference_snapshots_select_member
on public.conference_snapshots for select
to authenticated
using (public.is_conference_member(conference_id));

create policy conference_snapshots_insert_manager
on public.conference_snapshots for insert
to authenticated
with check (
  public.has_conference_role(conference_id, array['owner', 'manager'])
  and updated_by = auth.uid()
  and (
    updated_by_device_id is null
    or exists (
      select 1 from public.devices as d
      where d.id = updated_by_device_id
        and d.user_id = auth.uid()
    )
  )
);

create policy conference_snapshots_update_manager
on public.conference_snapshots for update
to authenticated
using (public.has_conference_role(conference_id, array['owner', 'manager']))
with check (
  public.has_conference_role(conference_id, array['owner', 'manager'])
  and updated_by = auth.uid()
  and (
    updated_by_device_id is null
    or exists (
      select 1 from public.devices as d
      where d.id = updated_by_device_id
        and d.user_id = auth.uid()
    )
  )
);

create policy devices_select_own
on public.devices for select
to authenticated
using (user_id = auth.uid());

create policy devices_insert_own
on public.devices for insert
to authenticated
with check (user_id = auth.uid());

create policy devices_update_own
on public.devices for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy devices_delete_own
on public.devices for delete
to authenticated
using (user_id = auth.uid());

create policy sync_operations_select_member
on public.sync_operations for select
to authenticated
using (public.is_conference_member(conference_id));

create policy sync_operations_insert_manager
on public.sync_operations for insert
to authenticated
with check (
  public.has_conference_role(conference_id, array['owner', 'manager'])
  and user_id = auth.uid()
  and status = 'pending'
  and resulting_revision is null
  and processed_at is null
  and exists (
    select 1 from public.devices as d
    where d.id = device_id
      and d.user_id = auth.uid()
  )
);

create policy sync_conflicts_select_member
on public.sync_conflicts for select
to authenticated
using (public.is_conference_member(conference_id));

revoke all on table public.profiles from anon;
revoke all on table public.conferences from anon;
revoke all on table public.conference_members from anon;
revoke all on table public.conference_snapshots from anon;
revoke all on table public.sync_operations from anon;
revoke all on table public.devices from anon;
revoke all on table public.sync_conflicts from anon;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.conferences to authenticated;
grant select, insert, update, delete on table public.conference_members to authenticated;
grant select, insert, update on table public.conference_snapshots to authenticated;
grant select, insert on table public.sync_operations to authenticated;
grant select, insert, update, delete on table public.devices to authenticated;
grant select on table public.sync_conflicts to authenticated;

create or replace function public.apply_conference_snapshot(
  p_conference_id uuid,
  p_operation_id uuid,
  p_device_id uuid,
  p_base_revision bigint,
  p_snapshot jsonb,
  p_schema_version text,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  current_revision bigint;
  next_revision bigint;
  current_snapshot jsonb;
  existing_operation public.sync_operations%rowtype;
  existing_conflict public.sync_conflicts%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null or p_operation_id is null or p_device_id is null
    or p_base_revision is null or p_base_revision < 0 or p_snapshot is null then
    raise exception 'invalid snapshot operation arguments';
  end if;
  if not public.has_conference_role(
    p_conference_id,
    array['owner', 'manager']
  ) then
    raise exception 'conference write access denied';
  end if;
  if not exists (
    select 1
      from public.devices as d
     where d.id = p_device_id
       and d.user_id = current_user_id
  ) then
    raise exception 'device does not belong to authenticated user';
  end if;

  perform 1
    from public.conferences as c
   where c.id = p_conference_id
   for update;
  if not found then
    raise exception 'conference not found';
  end if;

  select *
    into existing_operation
    from public.sync_operations as so
   where so.operation_id = p_operation_id;
  if found then
    if existing_operation.conference_id <> p_conference_id
      or existing_operation.user_id <> current_user_id
      or existing_operation.device_id <> p_device_id then
      raise exception 'operation id is already used by another operation';
    end if;
    if existing_operation.status = 'applied' then
      return jsonb_build_object(
        'success', true,
        'status', 'applied',
        'revision', existing_operation.resulting_revision
      );
    end if;
    if existing_operation.status = 'conflict' then
      select *
        into existing_conflict
        from public.sync_conflicts as sc
       where sc.operation_id = p_operation_id
       order by sc.created_at desc
       limit 1;
      return jsonb_build_object(
        'success', false,
        'status', 'conflict',
        'expectedRevision', existing_conflict.expected_revision,
        'actualRevision', existing_conflict.actual_revision
      );
    end if;
    return jsonb_build_object(
      'success', false,
      'status', existing_operation.status,
      'revision', existing_operation.resulting_revision
    );
  end if;

  select cs.revision, cs.data
    into current_revision, current_snapshot
    from public.conference_snapshots as cs
   where cs.conference_id = p_conference_id
   for update;

  if not found then
    current_revision := 0;
    current_snapshot := null;
  end if;

  if p_base_revision = current_revision then
    next_revision := current_revision + 1;
    if current_revision = 0 then
      insert into public.conference_snapshots (
        conference_id,
        data,
        revision,
        schema_version,
        app_version,
        updated_by,
        updated_by_device_id,
        updated_at
      ) values (
        p_conference_id,
        p_snapshot,
        next_revision,
        p_schema_version,
        p_app_version,
        current_user_id,
        p_device_id,
        now()
      );
    else
      update public.conference_snapshots
         set data = p_snapshot,
             revision = next_revision,
             schema_version = p_schema_version,
             app_version = p_app_version,
             updated_by = current_user_id,
             updated_by_device_id = p_device_id,
             updated_at = now()
       where conference_id = p_conference_id;
    end if;

    insert into public.sync_operations (
      operation_id,
      conference_id,
      user_id,
      device_id,
      operation_type,
      base_revision,
      resulting_revision,
      status,
      payload,
      created_at,
      processed_at
    ) values (
      p_operation_id,
      p_conference_id,
      current_user_id,
      p_device_id,
      'snapshot_replace',
      p_base_revision,
      next_revision,
      'applied',
      p_snapshot,
      now(),
      now()
    );

    return jsonb_build_object(
      'success', true,
      'status', 'applied',
      'revision', next_revision
    );
  end if;

  insert into public.sync_operations (
    operation_id,
    conference_id,
    user_id,
    device_id,
    operation_type,
    base_revision,
    resulting_revision,
    status,
    payload,
    created_at,
    processed_at
  ) values (
    p_operation_id,
    p_conference_id,
    current_user_id,
    p_device_id,
    'snapshot_replace',
    p_base_revision,
    current_revision,
    'conflict',
    p_snapshot,
    now(),
    now()
  );

  insert into public.sync_conflicts (
    conference_id,
    operation_id,
    expected_revision,
    actual_revision,
    local_payload,
    server_snapshot,
    status
  ) values (
    p_conference_id,
    p_operation_id,
    p_base_revision,
    current_revision,
    p_snapshot,
    current_snapshot,
    'open'
  );

  return jsonb_build_object(
    'success', false,
    'status', 'conflict',
    'expectedRevision', p_base_revision,
    'actualRevision', current_revision
  );
end;
$$;

revoke all on function public.apply_conference_snapshot(
  uuid, uuid, uuid, bigint, jsonb, text, text
) from public;

grant execute on function public.apply_conference_snapshot(
  uuid, uuid, uuid, bigint, jsonb, text, text
) to authenticated;

commit;
