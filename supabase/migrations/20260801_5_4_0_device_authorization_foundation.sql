begin;

-- P0.3B foundation only. Existing public.devices remains the technical
-- registration record used by P0.2. Authorization is deliberately separate.
create table public.user_device_authorizations (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  authorization_status text not null default 'registered'
    check (authorization_status in ('registered', 'pending', 'approved', 'revoked')),
  requested_at timestamptz null,
  approved_at timestamptz null,
  approved_by uuid null references auth.users(id) on delete set null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete set null,
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id),
  unique (device_id)
);

create table public.device_authorization_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  action text not null check (action = 'request_current_device_authorization'),
  result_status text not null check (
    result_status in ('pending', 'unchanged', 'denied', 'invalid_request', 'operation_mismatch')
  ),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  constraint device_authorization_operations_actor_operation_unique
    unique (actor_user_id, operation_id),
  constraint device_authorization_operations_device_owner_fk
    foreign key (actor_user_id, device_id)
    references public.user_device_authorizations (user_id, device_id)
    on delete restrict
);

create table public.device_authorization_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  target_user_id uuid not null,
  device_id uuid not null,
  action text not null check (
    action in ('device_authorization_requested', 'device_authorization_bootstrapped',
      'device_authorization_approved', 'device_authorization_rejected',
      'device_authorization_revoked')
  ),
  operation_id uuid null,
  old_values jsonb not null default '{}'::jsonb check (jsonb_typeof(old_values) = 'object'),
  new_values jsonb not null default '{}'::jsonb check (jsonb_typeof(new_values) = 'object'),
  created_at timestamptz not null default now(),
  constraint device_authorization_audit_device_owner_fk
    foreign key (target_user_id, device_id)
    references public.user_device_authorizations (user_id, device_id)
    on delete restrict
);

create table public.device_authorization_enforcement (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  enforcement_enabled boolean not null default false,
  enabled_at timestamptz null,
  enabled_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (not enforcement_enabled and enabled_at is null and enabled_by is null)
    or (enforcement_enabled and enabled_at is not null and enabled_by is not null)
  )
);

insert into public.device_authorization_enforcement (singleton_id, enforcement_enabled)
values (1, false)
on conflict (singleton_id) do nothing;

create unique index user_device_authorizations_one_approved_per_user_idx
  on public.user_device_authorizations (user_id)
  where authorization_status = 'approved' and revoked_at is null;
create index device_authorization_operations_actor_created_idx
  on public.device_authorization_operations (actor_user_id, created_at desc);
create index device_authorization_audit_target_created_idx
  on public.device_authorization_audit_log (target_user_id, created_at desc);
create index device_authorization_audit_device_created_idx
  on public.device_authorization_audit_log (device_id, created_at desc);

alter table public.user_device_authorizations enable row level security;
alter table public.device_authorization_operations enable row level security;
alter table public.device_authorization_audit_log enable row level security;
alter table public.device_authorization_enforcement enable row level security;

create trigger user_device_authorizations_set_updated_at
before update on public.user_device_authorizations
for each row execute function public.set_updated_at();

revoke all on table public.user_device_authorizations from public, anon, authenticated;
revoke all on table public.device_authorization_operations from public, anon, authenticated;
revoke all on table public.device_authorization_audit_log from public, anon, authenticated;
revoke all on table public.device_authorization_enforcement from public, anon, authenticated;

create or replace function public.prevent_device_authorization_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'DEVICE_AUTHORIZATION_AUDIT_IMMUTABLE' using errcode = '42501';
end;
$$;

create trigger device_authorization_audit_immutable
before update or delete on public.device_authorization_audit_log
for each row execute function public.prevent_device_authorization_audit_mutation();

-- Sole common validation implementation for every future device_guarded_* RPC.
-- It is internal: no PUBLIC, anon, or authenticated EXECUTE grant exists.
create or replace function public.require_current_approved_device(
  p_actor_device_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_actor_device_id is null then
    raise exception 'DEVICE_REQUIRED' using errcode = '22023';
  end if;
  if not public.is_account_approved(current_user_id) then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.user_device_authorizations as authorizations
     where authorizations.user_id = current_user_id
       and authorizations.device_id = p_actor_device_id
       and authorizations.authorization_status = 'approved'
       and authorizations.revoked_at is null
  ) then
    raise exception 'APPROVED_DEVICE_REQUIRED' using errcode = '42501';
  end if;
  return current_user_id;
end;
$$;

-- Restricted technical registration. It creates or refreshes only a
-- registered authorization record; it never requests or approves a device.
create or replace function public.register_or_refresh_current_device(
  p_device_id uuid,
  p_device_label text,
  p_platform text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  access_status text;
  normalized_label text := nullif(btrim(coalesce(p_device_label, '')), '');
  normalized_platform text := nullif(btrim(coalesce(p_platform, '')), '');
  stored_status text;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select access.account_status into access_status
    from public.system_user_access as access
   where access.user_id = current_user_id;
  if access_status is distinct from 'approved' then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'DEVICE_REQUIRED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('device-registration:' || current_user_id::text, 0)
  );

  insert into public.devices (id, user_id, device_name, platform, last_seen_at)
  values (p_device_id, current_user_id, normalized_label, normalized_platform, now())
  on conflict (id) do update
    set device_name = excluded.device_name,
        platform = excluded.platform,
        last_seen_at = excluded.last_seen_at
    where public.devices.user_id = current_user_id;

  if not found then
    raise exception 'DEVICE_OWNERSHIP_REQUIRED' using errcode = '42501';
  end if;

  insert into public.user_device_authorizations (
    user_id, device_id, authorization_status, last_registered_at
  ) values (
    current_user_id, p_device_id, 'registered', now()
  ) on conflict (user_id, device_id) do update
    set last_registered_at = excluded.last_registered_at
  returning authorization_status into stored_status;

  return jsonb_build_object(
    'status', 'registered',
    'deviceId', p_device_id,
    'authorizationStatus', stored_status
  );
end;
$$;

-- Explicit request only. No pending or approved state is created by technical
-- registration. Auth, System Access, and locks precede idempotency replay.
create or replace function public.request_current_device_authorization(
  p_device_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  access_status text;
  existing_operation public.device_authorization_operations%rowtype;
  authorization_row public.user_device_authorizations%rowtype;
  request_result jsonb;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select access.account_status into access_status
    from public.system_user_access as access
   where access.user_id = current_user_id;
  if access_status is distinct from 'approved' then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode = '42501';
  end if;
  if p_device_id is null or p_operation_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('device-authorization-user:' || current_user_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('device-authorization-device:' || p_device_id::text, 0)
  );

  select * into existing_operation
    from public.device_authorization_operations as operations
   where operations.operation_id = p_operation_id;
  if found then
    if existing_operation.actor_user_id = current_user_id
       and existing_operation.device_id = p_device_id
       and existing_operation.action = 'request_current_device_authorization' then
      return existing_operation.result;
    end if;
    return jsonb_build_object('status', 'operation_mismatch');
  end if;

  select * into authorization_row
    from public.user_device_authorizations as authorizations
   where authorizations.user_id = current_user_id
     and authorizations.device_id = p_device_id
   for update;
  if not found then
    request_result := jsonb_build_object('status', 'denied');
  elsif authorization_row.authorization_status = 'registered' then
    update public.user_device_authorizations
       set authorization_status = 'pending', requested_at = now()
     where user_id = current_user_id and device_id = p_device_id;
    request_result := jsonb_build_object('status', 'pending');
    insert into public.device_authorization_audit_log (
      actor_user_id, target_user_id, device_id, action, operation_id,
      old_values, new_values
    ) values (
      current_user_id, current_user_id, p_device_id,
      'device_authorization_requested', p_operation_id,
      jsonb_build_object('authorizationStatus', 'registered'),
      jsonb_build_object('authorizationStatus', 'pending')
    );
  elsif authorization_row.authorization_status = 'pending' then
    request_result := jsonb_build_object('status', 'unchanged');
  else
    request_result := jsonb_build_object('status', 'denied');
  end if;

  insert into public.device_authorization_operations (
    operation_id, actor_user_id, device_id, action, result_status, result
  ) values (
    p_operation_id, current_user_id, p_device_id,
    'request_current_device_authorization',
    request_result ->> 'status', request_result
  );
  return request_result;
end;
$$;

-- Restricted own-device status read. A device UUID is client supplied and not
-- cryptographic proof of physical-device possession.
create or replace function public.get_my_device_authorization(
  p_device_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  access_status text;
  device_status text;
  enforcement_state boolean;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select access.account_status into access_status
    from public.system_user_access as access
   where access.user_id = current_user_id;
  select authorizations.authorization_status into device_status
    from public.user_device_authorizations as authorizations
   where authorizations.user_id = current_user_id
     and authorizations.device_id = p_device_id;
  select enforcement.enforcement_enabled into enforcement_state
    from public.device_authorization_enforcement as enforcement
   where enforcement.singleton_id = 1;

  return jsonb_build_object(
    'systemAccessStatus', coalesce(access_status, 'missing'),
    'deviceAuthorizationStatus', coalesce(device_status, 'not_registered'),
    'enforcementEnabled', coalesce(enforcement_state, false)
  );
end;
$$;

revoke all on function public.prevent_device_authorization_audit_mutation()
  from public, anon, authenticated;
revoke all on function public.require_current_approved_device(uuid)
  from public, anon, authenticated;
revoke all on function public.register_or_refresh_current_device(uuid, text, text)
  from public, anon;
revoke all on function public.request_current_device_authorization(uuid, uuid)
  from public, anon;
revoke all on function public.get_my_device_authorization(uuid)
  from public, anon;
grant execute on function public.register_or_refresh_current_device(uuid, text, text)
  to authenticated;
grant execute on function public.request_current_device_authorization(uuid, uuid)
  to authenticated;
grant execute on function public.get_my_device_authorization(uuid)
  to authenticated;

-- Fail closed against any deviation from the reviewed P0.3B ownership/RLS/RPC
-- boundary. Enforcement must remain disabled in this foundation migration.
do $$
declare
  protected_owner oid;
  protected_table_count integer;
  protected_owner_count integer;
  forced_rls_count integer;
  missing_rls_count integer;
  enabled_enforcement_count integer;
  expected_function_count integer := 5;
  existing_function_count integer;
  mismatched_function_count integer;
  non_security_definer_count integer;
  invalid_search_path_count integer;
  invalid_browser_grant_count integer;
  invalid_internal_grant_count integer;
begin
  select min(classes.relowner::text)::oid,
         count(*), count(distinct classes.relowner),
         count(*) filter (where classes.relforcerowsecurity),
         count(*) filter (where not classes.relrowsecurity)
    into protected_owner, protected_table_count, protected_owner_count,
         forced_rls_count, missing_rls_count
    from pg_class as classes
    join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
   where namespaces.nspname = 'public' and classes.relkind = 'r'
     and classes.relname in (
       'devices', 'user_device_authorizations',
       'device_authorization_operations', 'device_authorization_audit_log',
       'device_authorization_enforcement', 'system_user_access'
     );
  if protected_table_count <> 6 then raise exception 'P0_3B_PROTECTED_TABLE_MISSING'; end if;
  if protected_owner_count <> 1 then raise exception 'P0_3B_PROTECTED_TABLE_OWNER_INVALID'; end if;
  if forced_rls_count <> 0 then raise exception 'P0_3B_PROTECTED_TABLE_FORCE_RLS_INVALID'; end if;
  if missing_rls_count <> 0 then raise exception 'P0_3B_PROTECTED_TABLE_RLS_INVALID'; end if;
  select count(*) into enabled_enforcement_count
    from public.device_authorization_enforcement
   where singleton_id = 1 and enforcement_enabled;
  if enabled_enforcement_count <> 0 then raise exception 'P0_3B_ENFORCEMENT_MUST_REMAIN_DISABLED'; end if;

  select count(*),
         count(*) filter (where functions.proowner <> protected_owner),
         count(*) filter (where not functions.prosecdef),
         count(*) filter (where not (functions.proconfig @> array['search_path=pg_catalog, public']::text[])),
         count(*) filter (
           where functions.oid in (
             to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
             to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
             to_regprocedure('public.get_my_device_authorization(uuid)')
           ) and (
             not has_function_privilege('authenticated', functions.oid, 'execute')
             or has_function_privilege('anon', functions.oid, 'execute')
             or has_function_privilege('public', functions.oid, 'execute')
           )
         ),
         count(*) filter (
           where functions.oid not in (
             to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
             to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
             to_regprocedure('public.get_my_device_authorization(uuid)')
           ) and (
             has_function_privilege('authenticated', functions.oid, 'execute')
             or has_function_privilege('anon', functions.oid, 'execute')
             or has_function_privilege('public', functions.oid, 'execute')
           )
         )
    into existing_function_count, mismatched_function_count,
         non_security_definer_count, invalid_search_path_count,
         invalid_browser_grant_count, invalid_internal_grant_count
    from pg_proc as functions
    join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
   where namespaces.nspname = 'public' and functions.oid in (
     to_regprocedure('public.prevent_device_authorization_audit_mutation()'),
     to_regprocedure('public.require_current_approved_device(uuid)'),
     to_regprocedure('public.register_or_refresh_current_device(uuid,text,text)'),
     to_regprocedure('public.request_current_device_authorization(uuid,uuid)'),
     to_regprocedure('public.get_my_device_authorization(uuid)')
   );
  if existing_function_count <> expected_function_count then raise exception 'P0_3B_FUNCTION_MISSING'; end if;
  if mismatched_function_count <> 0 then raise exception 'P0_3B_FUNCTION_OWNER_INVALID'; end if;
  if non_security_definer_count <> 0 then raise exception 'P0_3B_FUNCTION_SECURITY_DEFINER_INVALID'; end if;
  if invalid_search_path_count <> 0 then raise exception 'P0_3B_FUNCTION_SEARCH_PATH_INVALID'; end if;
  if invalid_browser_grant_count <> 0 then raise exception 'P0_3B_RESTRICTED_RPC_GRANT_INVALID'; end if;
  if invalid_internal_grant_count <> 0 then raise exception 'P0_3B_INTERNAL_FUNCTION_GRANT_INVALID'; end if;
end;
$$;

commit;
