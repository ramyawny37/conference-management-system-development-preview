begin;

create table public.conference_locks (
  conference_id uuid primary key
    references public.conferences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  lock_token uuid not null unique,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  last_renewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint conference_locks_expiry_check
    check (expires_at > acquired_at)
);

create index conference_locks_user_id_idx
  on public.conference_locks(user_id);
create index conference_locks_device_id_idx
  on public.conference_locks(device_id);
create index conference_locks_expires_at_idx
  on public.conference_locks(expires_at);

alter table public.conference_locks enable row level security;

create or replace function public.acquire_conference_lock(
  p_conference_id uuid,
  p_device_id uuid,
  p_lock_token uuid,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  effective_ttl integer := coalesce(p_ttl_seconds, 120);
  current_lock public.conference_locks%rowtype;
  current_time timestamptz := clock_timestamp();
  new_expiry timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null
    or p_device_id is null
    or p_lock_token is null
    or effective_ttl < 30
    or effective_ttl > 300 then
    raise exception 'invalid conference lock arguments';
  end if;
  if not public.is_conference_member(p_conference_id) then
    raise exception 'conference membership required';
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
    into current_lock
    from public.conference_locks as cl
   where cl.conference_id = p_conference_id
   for update;

  new_expiry := current_time + make_interval(secs => effective_ttl);

  if not found then
    insert into public.conference_locks (
      conference_id,
      user_id,
      device_id,
      lock_token,
      acquired_at,
      expires_at,
      last_renewed_at,
      created_at
    ) values (
      p_conference_id,
      current_user_id,
      p_device_id,
      p_lock_token,
      current_time,
      new_expiry,
      current_time,
      current_time
    );
    return jsonb_build_object(
      'success', true,
      'status', 'acquired',
      'conferenceId', p_conference_id,
      'lockToken', p_lock_token,
      'owned', true,
      'userId', current_user_id,
      'deviceId', p_device_id,
      'acquiredAt', current_time,
      'expiresAt', new_expiry,
      'lastRenewedAt', current_time
    );
  end if;

  if current_lock.expires_at <= current_time then
    update public.conference_locks
       set user_id = current_user_id,
           device_id = p_device_id,
           lock_token = p_lock_token,
           acquired_at = current_time,
           expires_at = new_expiry,
           last_renewed_at = current_time,
           created_at = current_time
     where conference_id = p_conference_id;
    return jsonb_build_object(
      'success', true,
      'status', 'acquired',
      'conferenceId', p_conference_id,
      'lockToken', p_lock_token,
      'owned', true,
      'userId', current_user_id,
      'deviceId', p_device_id,
      'acquiredAt', current_time,
      'expiresAt', new_expiry,
      'lastRenewedAt', current_time
    );
  end if;

  if current_lock.user_id = current_user_id
    and current_lock.device_id = p_device_id
    and current_lock.lock_token = p_lock_token then
    return jsonb_build_object(
      'success', true,
      'status', 'acquired',
      'conferenceId', p_conference_id,
      'lockToken', current_lock.lock_token,
      'owned', true,
      'userId', current_lock.user_id,
      'deviceId', current_lock.device_id,
      'acquiredAt', current_lock.acquired_at,
      'expiresAt', current_lock.expires_at,
      'lastRenewedAt', current_lock.last_renewed_at
    );
  end if;

  if current_lock.user_id = current_user_id
    and current_lock.device_id = p_device_id then
    return jsonb_build_object(
      'success', true,
      'status', 'already_owned',
      'conferenceId', p_conference_id,
      'lockToken', current_lock.lock_token,
      'owned', true,
      'userId', current_lock.user_id,
      'deviceId', current_lock.device_id,
      'acquiredAt', current_lock.acquired_at,
      'expiresAt', current_lock.expires_at,
      'lastRenewedAt', current_lock.last_renewed_at
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'locked',
    'conferenceId', p_conference_id,
    'owned', false,
    'userId', current_lock.user_id,
    'deviceId', current_lock.device_id,
    'acquiredAt', current_lock.acquired_at,
    'expiresAt', current_lock.expires_at,
    'lastRenewedAt', current_lock.last_renewed_at
  );
end;
$$;

create or replace function public.renew_conference_lock(
  p_conference_id uuid,
  p_device_id uuid,
  p_lock_token uuid,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  effective_ttl integer := coalesce(p_ttl_seconds, 120);
  current_lock public.conference_locks%rowtype;
  current_time timestamptz := clock_timestamp();
  new_expiry timestamptz;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null
    or p_device_id is null
    or p_lock_token is null
    or effective_ttl < 30
    or effective_ttl > 300 then
    raise exception 'invalid conference lock arguments';
  end if;
  if not public.is_conference_member(p_conference_id) then
    raise exception 'conference membership required';
  end if;
  if not exists (
    select 1 from public.devices as d
     where d.id = p_device_id and d.user_id = current_user_id
  ) then
    raise exception 'device does not belong to authenticated user';
  end if;

  perform 1 from public.conferences as c
   where c.id = p_conference_id for update;
  if not found then
    raise exception 'conference not found';
  end if;

  select * into current_lock
    from public.conference_locks as cl
   where cl.conference_id = p_conference_id
   for update;
  if not found then
    return jsonb_build_object(
      'success', true,
      'status', 'not_found',
      'conferenceId', p_conference_id,
      'owned', false
    );
  end if;
  if current_lock.expires_at <= current_time then
    return jsonb_build_object(
      'success', true,
      'status', 'expired',
      'conferenceId', p_conference_id,
      'owned', false,
      'expiresAt', current_lock.expires_at
    );
  end if;
  if current_lock.user_id <> current_user_id
    or current_lock.device_id <> p_device_id
    or current_lock.lock_token <> p_lock_token then
    return jsonb_build_object(
      'success', true,
      'status', 'not_owner',
      'conferenceId', p_conference_id,
      'owned', false,
      'expiresAt', current_lock.expires_at
    );
  end if;

  new_expiry := current_time + make_interval(secs => effective_ttl);
  update public.conference_locks
     set expires_at = new_expiry,
         last_renewed_at = current_time
   where conference_id = p_conference_id;
  return jsonb_build_object(
    'success', true,
    'status', 'renewed',
    'conferenceId', p_conference_id,
    'lockToken', p_lock_token,
    'owned', true,
    'userId', current_user_id,
    'deviceId', p_device_id,
    'acquiredAt', current_lock.acquired_at,
    'expiresAt', new_expiry,
    'lastRenewedAt', current_time
  );
end;
$$;

create or replace function public.release_conference_lock(
  p_conference_id uuid,
  p_device_id uuid,
  p_lock_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  current_lock public.conference_locks%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null
    or p_device_id is null
    or p_lock_token is null then
    raise exception 'invalid conference lock arguments';
  end if;
  if not public.is_conference_member(p_conference_id) then
    raise exception 'conference membership required';
  end if;
  if not exists (
    select 1 from public.devices as d
     where d.id = p_device_id and d.user_id = current_user_id
  ) then
    raise exception 'device does not belong to authenticated user';
  end if;

  perform 1 from public.conferences as c
   where c.id = p_conference_id for update;
  if not found then
    raise exception 'conference not found';
  end if;

  select * into current_lock
    from public.conference_locks as cl
   where cl.conference_id = p_conference_id
   for update;
  if not found then
    return jsonb_build_object(
      'success', true,
      'status', 'not_found',
      'conferenceId', p_conference_id,
      'owned', false
    );
  end if;
  if current_lock.user_id <> current_user_id
    or current_lock.device_id <> p_device_id
    or current_lock.lock_token <> p_lock_token then
    return jsonb_build_object(
      'success', true,
      'status', 'not_owner',
      'conferenceId', p_conference_id,
      'owned', false
    );
  end if;

  delete from public.conference_locks
   where conference_id = p_conference_id;
  return jsonb_build_object(
    'success', true,
    'status', 'released',
    'conferenceId', p_conference_id,
    'lockToken', p_lock_token,
    'owned', false
  );
end;
$$;

create or replace function public.get_conference_lock(
  p_conference_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  current_lock public.conference_locks%rowtype;
  owned_by_requester boolean;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_conference_id is null or p_device_id is null then
    raise exception 'invalid conference lock arguments';
  end if;
  if not public.is_conference_member(p_conference_id) then
    raise exception 'conference membership required';
  end if;
  if not exists (
    select 1 from public.devices as d
     where d.id = p_device_id and d.user_id = current_user_id
  ) then
    raise exception 'device does not belong to authenticated user';
  end if;

  select * into current_lock
    from public.conference_locks as cl
   where cl.conference_id = p_conference_id;
  if not found or current_lock.expires_at <= clock_timestamp() then
    return jsonb_build_object(
      'success', true,
      'status', 'not_found',
      'conferenceId', p_conference_id,
      'locked', false,
      'owned', false
    );
  end if;

  owned_by_requester := current_lock.user_id = current_user_id
    and current_lock.device_id = p_device_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'success', true,
    'status', 'locked',
    'conferenceId', p_conference_id,
    'locked', true,
    'owned', owned_by_requester,
    'lockToken', case
      when owned_by_requester then current_lock.lock_token
      else null
    end,
    'userId', current_lock.user_id,
    'deviceId', current_lock.device_id,
    'acquiredAt', current_lock.acquired_at,
    'expiresAt', current_lock.expires_at,
    'lastRenewedAt', current_lock.last_renewed_at
  ));
end;
$$;

revoke all on table public.conference_locks
  from public, anon, authenticated;

revoke all on function public.acquire_conference_lock(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.renew_conference_lock(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.release_conference_lock(
  uuid, uuid, uuid
) from public;
revoke all on function public.get_conference_lock(
  uuid, uuid
) from public;

grant execute on function public.acquire_conference_lock(
  uuid, uuid, uuid, integer
) to authenticated;
grant execute on function public.renew_conference_lock(
  uuid, uuid, uuid, integer
) to authenticated;
grant execute on function public.release_conference_lock(
  uuid, uuid, uuid
) to authenticated;
grant execute on function public.get_conference_lock(
  uuid, uuid
) to authenticated;

commit;
