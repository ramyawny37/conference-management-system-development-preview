begin;

create table public.system_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_status text not null default 'pending'
    check (account_status in ('pending', 'approved', 'blocked')),
  can_create_conferences boolean not null default false,
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz null,
  blocked_by uuid null references auth.users(id) on delete set null,
  blocked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.system_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system_owner', 'system_admin')),
  granted_by uuid null references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.system_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  target_user_id uuid null references auth.users(id) on delete set null,
  action text not null check (btrim(action) <> ''),
  old_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(old_values) = 'object'),
  new_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(new_values) = 'object'),
  created_at timestamptz not null default now()
);

create index system_user_access_status_idx
  on public.system_user_access(account_status);
create index system_user_roles_role_idx
  on public.system_user_roles(role, user_id);
create index system_access_audit_created_idx
  on public.system_access_audit_log(created_at desc);
create index system_access_audit_target_idx
  on public.system_access_audit_log(target_user_id, created_at desc);

create trigger system_user_access_set_updated_at
before update on public.system_user_access
for each row execute function public.set_updated_at();

create or replace function public.is_system_owner(
  user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select user_id is not null and exists (
    select 1
      from public.system_user_roles as roles
     where roles.user_id = is_system_owner.user_id
       and roles.role = 'system_owner'
  );
$$;

create or replace function public.is_system_admin(
  user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select user_id is not null and exists (
    select 1
      from public.system_user_roles as roles
     where roles.user_id = is_system_admin.user_id
       and roles.role = 'system_admin'
  );
$$;

create or replace function public.is_account_approved(
  user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select user_id is not null and exists (
    select 1
      from public.system_user_access as access
     where access.user_id = is_account_approved.user_id
       and access.account_status = 'approved'
  );
$$;

create or replace function public.can_user_create_conferences(
  user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select user_id is not null and exists (
    select 1
      from public.system_user_access as access
     where access.user_id = can_user_create_conferences.user_id
       and access.account_status = 'approved'
       and (
         access.can_create_conferences
         or public.is_system_owner(can_user_create_conferences.user_id)
       )
  );
$$;

alter table public.system_user_access enable row level security;
alter table public.system_user_roles enable row level security;
alter table public.system_access_audit_log enable row level security;

create policy system_user_access_select_self_or_owner
on public.system_user_access for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_system_owner(auth.uid())
);

create policy system_user_roles_select_self_or_owner
on public.system_user_roles for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_system_owner(auth.uid())
);

create policy system_access_audit_select_owner
on public.system_access_audit_log for select
to authenticated
using (public.is_system_owner(auth.uid()));

revoke all on table public.system_user_access from public, anon, authenticated;
revoke all on table public.system_user_roles from public, anon, authenticated;
revoke all on table public.system_access_audit_log from public, anon, authenticated;
grant select on table public.system_user_access to authenticated;
grant select on table public.system_user_roles to authenticated;
grant select on table public.system_access_audit_log to authenticated;

revoke all on function public.is_system_owner(uuid) from public, anon;
revoke all on function public.is_system_admin(uuid) from public, anon;
revoke all on function public.is_account_approved(uuid) from public, anon;
revoke all on function public.can_user_create_conferences(uuid) from public, anon;
grant execute on function public.is_system_owner(uuid) to authenticated;
grant execute on function public.is_system_admin(uuid) to authenticated;
grant execute on function public.is_account_approved(uuid) to authenticated;
grant execute on function public.can_user_create_conferences(uuid) to authenticated;

-- Existing users are classified from authoritative ownership/membership data.
-- Owners take precedence over membership-only users.
insert into public.system_user_access (
  user_id,
  account_status,
  can_create_conferences,
  approved_at
)
select
  users.id,
  case
    when exists (
      select 1 from public.conferences as conferences
       where conferences.owner_id = users.id
    ) then 'approved'
    when exists (
      select 1 from public.conference_members as members
       where members.user_id = users.id
    ) then 'approved'
    else 'pending'
  end,
  exists (
    select 1 from public.conferences as conferences
     where conferences.owner_id = users.id
  ),
  case
    when exists (
      select 1 from public.conferences as conferences
       where conferences.owner_id = users.id
    ) or exists (
      select 1 from public.conference_members as members
       where members.user_id = users.id
    ) then now()
    else null
  end
from auth.users as users
on conflict (user_id) do nothing;

-- Preserve profile creation and add pending System Access for future users.
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

  insert into public.system_user_access (
    user_id,
    account_status,
    can_create_conferences
  )
  values (new.id, 'pending', false)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Close the migration/trigger replacement window with an idempotent second
-- classification pass. This must leave no auth user without System Access.
insert into public.system_user_access (
  user_id,
  account_status,
  can_create_conferences,
  approved_at
)
select
  users.id,
  case
    when exists (
      select 1 from public.conferences as conferences
       where conferences.owner_id = users.id
    ) then 'approved'
    when exists (
      select 1 from public.conference_members as members
       where members.user_id = users.id
    ) then 'approved'
    else 'pending'
  end,
  exists (
    select 1 from public.conferences as conferences
     where conferences.owner_id = users.id
  ),
  case
    when exists (
      select 1 from public.conferences as conferences
       where conferences.owner_id = users.id
    ) or exists (
      select 1 from public.conference_members as members
       where members.user_id = users.id
    ) then now()
    else null
  end
from auth.users as users
on conflict (user_id) do nothing;

create or replace function public.approve_system_user(
  target_user_id uuid,
  allow_create_conferences boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  previous_row public.system_user_access%rowtype;
  updated_row public.system_user_access%rowtype;
begin
  if actor_id is null or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  select * into previous_row from public.system_user_access
   where user_id = target_user_id for update;
  if not found then
    raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.system_user_access
     set account_status = 'approved',
         can_create_conferences = coalesce(allow_create_conferences, false),
         approved_by = actor_id,
         approved_at = now(),
         blocked_by = null,
         blocked_at = null
   where user_id = target_user_id
   returning * into updated_row;
  insert into public.system_access_audit_log (
    actor_user_id, target_user_id, action, old_values, new_values
  ) values (
    actor_id, target_user_id, 'approve_system_user',
    to_jsonb(previous_row), to_jsonb(updated_row)
  );
  return jsonb_build_object('status', 'approved', 'userId', target_user_id);
end;
$$;

create or replace function public.block_system_user(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  previous_row public.system_user_access%rowtype;
  updated_row public.system_user_access%rowtype;
begin
  if actor_id is null or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if public.is_system_owner(target_user_id) then
    raise exception 'SYSTEM_OWNER_CANNOT_BE_BLOCKED' using errcode = '42501';
  end if;
  select * into previous_row from public.system_user_access
   where user_id = target_user_id for update;
  if not found then
    raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.system_user_access
     set account_status = 'blocked',
         can_create_conferences = false,
         blocked_by = actor_id,
         blocked_at = now()
   where user_id = target_user_id
   returning * into updated_row;
  insert into public.system_access_audit_log (
    actor_user_id, target_user_id, action, old_values, new_values
  ) values (
    actor_id, target_user_id, 'block_system_user',
    to_jsonb(previous_row), to_jsonb(updated_row)
  );
  return jsonb_build_object('status', 'blocked', 'userId', target_user_id);
end;
$$;

create or replace function public.unblock_system_user(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  previous_row public.system_user_access%rowtype;
  updated_row public.system_user_access%rowtype;
begin
  if actor_id is null or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  select * into previous_row from public.system_user_access
   where user_id = target_user_id for update;
  if not found then
    raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.system_user_access
     set account_status = 'approved',
         blocked_by = null,
         blocked_at = null,
         approved_by = actor_id,
         approved_at = now()
   where user_id = target_user_id
   returning * into updated_row;
  insert into public.system_access_audit_log (
    actor_user_id, target_user_id, action, old_values, new_values
  ) values (
    actor_id, target_user_id, 'unblock_system_user',
    to_jsonb(previous_row), to_jsonb(updated_row)
  );
  return jsonb_build_object('status', 'approved', 'userId', target_user_id);
end;
$$;

create or replace function public.set_user_conference_creation_permission(
  target_user_id uuid,
  allowed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  previous_row public.system_user_access%rowtype;
  updated_row public.system_user_access%rowtype;
begin
  if actor_id is null or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if allowed is null then
    raise exception 'INVALID_PERMISSION_VALUE' using errcode = '22023';
  end if;
  select * into previous_row from public.system_user_access
   where user_id = target_user_id for update;
  if not found then
    raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode = 'P0002';
  end if;
  if previous_row.account_status <> 'approved' and allowed then
    raise exception 'ACCOUNT_NOT_APPROVED' using errcode = '42501';
  end if;
  update public.system_user_access
     set can_create_conferences = allowed
   where user_id = target_user_id
   returning * into updated_row;
  insert into public.system_access_audit_log (
    actor_user_id, target_user_id, action, old_values, new_values
  ) values (
    actor_id, target_user_id, 'set_conference_creation_permission',
    to_jsonb(previous_row), to_jsonb(updated_row)
  );
  return jsonb_build_object(
    'status', 'updated',
    'userId', target_user_id,
    'canCreateConferences', allowed
  );
end;
$$;

create or replace function public.grant_system_role(
  target_user_id uuid,
  target_role text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  inserted boolean := false;
begin
  if actor_id is null or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if target_role not in ('system_owner', 'system_admin') then
    raise exception 'INVALID_SYSTEM_ROLE' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.system_user_access
     where user_id = target_user_id and account_status = 'approved'
  ) then
    raise exception 'ACCOUNT_NOT_APPROVED' using errcode = '42501';
  end if;
  insert into public.system_user_roles (user_id, role, granted_by)
  values (target_user_id, target_role, actor_id)
  on conflict (user_id, role) do nothing;
  inserted := found;
  if inserted then
    insert into public.system_access_audit_log (
      actor_user_id, target_user_id, action, old_values, new_values
    ) values (
      actor_id, target_user_id, 'grant_system_role',
      '{}'::jsonb, jsonb_build_object('role', target_role)
    );
  end if;
  return jsonb_build_object(
    'status', case when inserted then 'granted' else 'unchanged' end,
    'userId', target_user_id,
    'role', target_role
  );
end;
$$;

create or replace function public.revoke_system_role(
  target_user_id uuid,
  target_role text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  removed boolean := false;
  owner_count bigint;
begin
  if actor_id is null or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if target_role not in ('system_owner', 'system_admin') then
    raise exception 'INVALID_SYSTEM_ROLE' using errcode = '22023';
  end if;
  if target_role = 'system_owner' then
    perform pg_advisory_xact_lock(
      hashtextextended('system-owner-role-change', 0)
    );
    select count(*) into owner_count
      from public.system_user_roles
     where role = 'system_owner';
    if owner_count <= 1 and public.is_system_owner(target_user_id) then
      raise exception 'LAST_SYSTEM_OWNER_REQUIRED' using errcode = '42501';
    end if;
  end if;
  delete from public.system_user_roles
   where user_id = target_user_id and role = target_role;
  removed := found;
  if removed then
    insert into public.system_access_audit_log (
      actor_user_id, target_user_id, action, old_values, new_values
    ) values (
      actor_id, target_user_id, 'revoke_system_role',
      jsonb_build_object('role', target_role), '{}'::jsonb
    );
  end if;
  return jsonb_build_object(
    'status', case when removed then 'revoked' else 'unchanged' end,
    'userId', target_user_id,
    'role', target_role
  );
end;
$$;

revoke all on function public.approve_system_user(uuid, boolean)
  from public, anon;
revoke all on function public.block_system_user(uuid)
  from public, anon;
revoke all on function public.unblock_system_user(uuid)
  from public, anon;
revoke all on function public.set_user_conference_creation_permission(uuid, boolean)
  from public, anon;
revoke all on function public.grant_system_role(uuid, text)
  from public, anon;
revoke all on function public.revoke_system_role(uuid, text)
  from public, anon;
grant execute on function public.approve_system_user(uuid, boolean)
  to authenticated;
grant execute on function public.block_system_user(uuid)
  to authenticated;
grant execute on function public.unblock_system_user(uuid)
  to authenticated;
grant execute on function public.set_user_conference_creation_permission(uuid, boolean)
  to authenticated;
grant execute on function public.grant_system_role(uuid, text)
  to authenticated;
grant execute on function public.revoke_system_role(uuid, text)
  to authenticated;

-- Direct inserts must enforce the same creation permission as the RPC.
drop policy if exists conferences_insert_own on public.conferences;
create policy conferences_insert_own
on public.conferences for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.can_user_create_conferences(auth.uid())
);

-- Preserve the existing idempotent contract and add a fail-closed access gate.
create or replace function public.create_conference_idempotent(
  p_operation_id uuid,
  p_requested_conference_id uuid,
  p_name text,
  p_initial_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_metadata jsonb := coalesce(p_initial_metadata, '{}'::jsonb);
  existing_operation public.conference_creation_operations%rowtype;
  existing_conference_owner uuid;
  violated_constraint text;
  access_status text;
begin
  if current_user_id is null then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'AUTH_REQUIRED',
      'operationId', p_operation_id
    );
  end if;

  select account_status into access_status
    from public.system_user_access
   where user_id = current_user_id;
  if access_status is null then
    return jsonb_build_object(
      'status', 'access_denied',
      'errorCode', 'SYSTEM_ACCESS_REQUIRED',
      'operationId', p_operation_id
    );
  end if;
  if access_status = 'blocked' then
    return jsonb_build_object(
      'status', 'access_denied',
      'errorCode', 'ACCOUNT_BLOCKED',
      'operationId', p_operation_id
    );
  end if;
  if access_status <> 'approved' then
    return jsonb_build_object(
      'status', 'access_denied',
      'errorCode', 'ACCOUNT_PENDING',
      'operationId', p_operation_id
    );
  end if;
  if not public.can_user_create_conferences(current_user_id) then
    return jsonb_build_object(
      'status', 'access_denied',
      'errorCode', 'CONFERENCE_CREATION_NOT_ALLOWED',
      'operationId', p_operation_id
    );
  end if;

  if p_operation_id is null then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'INVALID_OPERATION_ID',
      'operationId', p_operation_id
    );
  end if;
  if p_requested_conference_id is null then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'INVALID_CONFERENCE_ID',
      'operationId', p_operation_id
    );
  end if;
  if normalized_name = '' or length(normalized_name) > 500
    or jsonb_typeof(normalized_metadata) <> 'object' then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'INVALID_REQUEST',
      'operationId', p_operation_id
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      current_user_id::text || ':conference-create:' || p_operation_id::text,
      0
    )
  );

  select *
    into existing_operation
    from public.conference_creation_operations as creation_operation
   where creation_operation.user_id = current_user_id
     and creation_operation.operation_id = p_operation_id;

  if found then
    if existing_operation.conference_id <> p_requested_conference_id then
      return jsonb_build_object(
        'status', 'operation_mismatch',
        'errorCode', 'OPERATION_RESULT_MISMATCH',
        'operationId', p_operation_id,
        'conferenceId', existing_operation.conference_id,
        'created', false
      );
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'operationId', existing_operation.operation_id,
      'conferenceId', existing_operation.conference_id,
      'created', false
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('conference-id:' || p_requested_conference_id::text, 0)
  );

  select conference.owner_id
    into existing_conference_owner
    from public.conferences as conference
   where conference.id = p_requested_conference_id;

  if found then
    return jsonb_build_object(
      'status', 'invalid_request',
      'errorCode', 'CONFERENCE_ID_ALREADY_USED',
      'operationId', p_operation_id,
      'created', false
    );
  end if;

  insert into public.conferences (id, name, owner_id)
  values (p_requested_conference_id, normalized_name, current_user_id);

  insert into public.conference_creation_operations (
    user_id, operation_id, conference_id, initial_metadata
  ) values (
    current_user_id, p_operation_id, p_requested_conference_id,
    normalized_metadata
  );

  return jsonb_build_object(
    'status', 'created',
    'operationId', p_operation_id,
    'conferenceId', p_requested_conference_id,
    'created', true
  );
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    select *
      into existing_operation
      from public.conference_creation_operations as creation_operation
     where creation_operation.user_id = current_user_id
       and creation_operation.operation_id = p_operation_id;
    if found and existing_operation.conference_id = p_requested_conference_id then
      return jsonb_build_object(
        'status', 'duplicate',
        'operationId', existing_operation.operation_id,
        'conferenceId', existing_operation.conference_id,
        'created', false
      );
    end if;
    if found then
      return jsonb_build_object(
        'status', 'operation_mismatch',
        'errorCode', 'OPERATION_RESULT_MISMATCH',
        'operationId', p_operation_id,
        'conferenceId', existing_operation.conference_id,
        'created', false
      );
    end if;
    if violated_constraint in (
      'conference_creation_operations_conference_key',
      'conferences_pkey'
    ) then
      return jsonb_build_object(
        'status', 'invalid_request',
        'errorCode', 'CONFERENCE_ID_ALREADY_USED',
        'operationId', p_operation_id,
        'created', false
      );
    end if;
    raise;
end;
$$;

revoke all on function public.create_conference_idempotent(
  uuid, uuid, text, jsonb
) from public, anon;
grant execute on function public.create_conference_idempotent(
  uuid, uuid, text, jsonb
) to authenticated;

commit;
