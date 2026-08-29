begin;

create table public.platform_modules (
  module_key text primary key,
  display_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_modules_key_check check (
    char_length(module_key) between 1 and 63
    and module_key ~ '^[a-z][a-z0-9_]{0,62}$'
  ),
  constraint platform_modules_display_name_check check (
    char_length(btrim(display_name)) between 1 and 120
    and display_name = btrim(display_name)
  ),
  constraint platform_modules_status_check check (status in ('active', 'disabled')),
  constraint platform_modules_timestamps_check check (updated_at >= created_at)
);

create table public.module_permission_grants (
  grant_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  module_key text not null references public.platform_modules(module_key) on delete restrict,
  permission_key text not null,
  resource_type text,
  resource_id text,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_by_device_id uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_by_device_id uuid,
  revocation_reason text,
  constraint module_permission_grants_grantor_device_fkey
    foreign key (granted_by, granted_by_device_id)
    references public.user_device_authorizations(user_id, device_id) on delete restrict,
  constraint module_permission_grants_revoker_device_fkey
    foreign key (revoked_by, revoked_by_device_id)
    references public.user_device_authorizations(user_id, device_id) on delete restrict,
  constraint module_permission_grants_permission_check check (
    char_length(permission_key) between 1 and 127
    and permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  constraint module_permission_grants_scope_pair_check check (
    (resource_type is null and resource_id is null)
    or (resource_type is not null and resource_id is not null)
  ),
  constraint module_permission_grants_resource_type_check check (
    resource_type is null
    or (
      char_length(resource_type) between 1 and 63
      and resource_type ~ '^[a-z][a-z0-9_]{0,62}$'
    )
  ),
  constraint module_permission_grants_resource_id_check check (
    resource_id is null
    or (
      char_length(resource_id) between 1 and 255
      and resource_id = btrim(resource_id)
    )
  ),
  constraint module_permission_grants_module_manage_scope_check check (
    permission_key <> 'module.manage'
    or (resource_type is null and resource_id is null)
  ),
  constraint module_permission_grants_module_access_scope_check check (
    permission_key <> 'module.access'
    or (resource_type is null and resource_id is null)
  ),
  constraint module_permission_grants_revocation_state_check check (
    (
      revoked_at is null and revoked_by is null
      and revoked_by_device_id is null and revocation_reason is null
    )
    or (
      revoked_at is not null and revoked_by is not null
      and revoked_by_device_id is not null
      and revoked_at >= granted_at
      and (
        revocation_reason is null
        or (
          char_length(btrim(revocation_reason)) between 1 and 500
          and revocation_reason = btrim(revocation_reason)
        )
      )
    )
  )
);

create unique index module_permission_grants_active_module_scope_uidx
  on public.module_permission_grants(user_id, module_key, permission_key)
  where revoked_at is null and resource_type is null and resource_id is null;

create unique index module_permission_grants_active_resource_scope_uidx
  on public.module_permission_grants(
    user_id, module_key, permission_key, resource_type, resource_id
  )
  where revoked_at is null and resource_type is not null and resource_id is not null;

create index module_permission_grants_module_target_idx
  on public.module_permission_grants(module_key, user_id, granted_at desc);

create table public.module_grant_operations (
  operation_id uuid primary key,
  action text not null check (action in ('create', 'revoke')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_device_id uuid not null,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  module_key text not null references public.platform_modules(module_key) on delete restrict,
  permission_key text not null,
  resource_type text,
  resource_id text,
  requested_grant_id uuid,
  resulting_grant_id uuid not null references public.module_permission_grants(grant_id) on delete restrict,
  revocation_reason text,
  authority_source text not null check (authority_source in ('system_owner', 'module_grant')),
  authority_grant_id uuid references public.module_permission_grants(grant_id) on delete restrict,
  intent_hash text not null,
  outcome text not null check (outcome in ('created', 'existing', 'revoked', 'already_revoked')),
  stored_result jsonb not null check (jsonb_typeof(stored_result) = 'object'),
  created_at timestamptz not null default now(),
  constraint module_grant_operations_actor_device_fkey
    foreign key (actor_user_id, actor_device_id)
    references public.user_device_authorizations(user_id, device_id) on delete restrict,
  constraint module_grant_operations_scope_pair_check check (
    (resource_type is null and resource_id is null)
    or (resource_type is not null and resource_id is not null)
  ),
  constraint module_grant_operations_action_grant_check check (
    (action = 'create' and requested_grant_id is null)
    or (action = 'revoke' and requested_grant_id is not null)
  ),
  constraint module_grant_operations_authority_check check (
    (authority_source = 'system_owner' and authority_grant_id is null)
    or (authority_source = 'module_grant' and authority_grant_id is not null)
  ),
  constraint module_grant_operations_intent_hash_check check (char_length(intent_hash) = 64)
);

create index module_grant_operations_target_idx
  on public.module_grant_operations(module_key, target_user_id, created_at desc);

create table public.module_grant_audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('grant_created', 'grant_revoked')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_device_id uuid not null,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  module_key text not null references public.platform_modules(module_key) on delete restrict,
  permission_key text not null,
  resource_type text,
  resource_id text,
  grant_id uuid not null references public.module_permission_grants(grant_id) on delete restrict,
  authority_source text not null check (authority_source in ('system_owner', 'module_grant')),
  authority_grant_id uuid references public.module_permission_grants(grant_id) on delete restrict,
  operation_id uuid not null unique references public.module_grant_operations(operation_id) on delete restrict,
  old_values jsonb not null check (jsonb_typeof(old_values) = 'object'),
  new_values jsonb not null check (jsonb_typeof(new_values) = 'object'),
  created_at timestamptz not null default now(),
  constraint module_grant_audit_log_actor_device_fkey
    foreign key (actor_user_id, actor_device_id)
    references public.user_device_authorizations(user_id, device_id) on delete restrict,
  constraint module_grant_audit_log_scope_pair_check check (
    (resource_type is null and resource_id is null)
    or (resource_type is not null and resource_id is not null)
  ),
  constraint module_grant_audit_log_authority_check check (
    (authority_source = 'system_owner' and authority_grant_id is null)
    or (authority_source = 'module_grant' and authority_grant_id is not null)
  )
);

create index module_grant_audit_log_module_idx
  on public.module_grant_audit_log(module_key, created_at desc);
create index module_grant_audit_log_target_idx
  on public.module_grant_audit_log(target_user_id, created_at desc);
create index module_grant_audit_log_grant_idx
  on public.module_grant_audit_log(grant_id, created_at desc);

create function public.protect_platform_module_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.module_key is distinct from old.module_key
     or new.created_at is distinct from old.created_at then
    raise exception 'PLATFORM_MODULE_IDENTITY_IMMUTABLE' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger platform_modules_protect_identity
before update on public.platform_modules
for each row execute function public.protect_platform_module_identity();

create function public.protect_module_permission_grant_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MODULE_GRANT_DELETE_PROHIBITED' using errcode = '55000';
  end if;

  if old.revoked_at is not null then
    raise exception 'REVOKED_MODULE_GRANT_IMMUTABLE' using errcode = '55000';
  end if;

  if new.grant_id is distinct from old.grant_id
     or new.user_id is distinct from old.user_id
     or new.module_key is distinct from old.module_key
     or new.permission_key is distinct from old.permission_key
     or new.resource_type is distinct from old.resource_type
     or new.resource_id is distinct from old.resource_id
     or new.granted_by is distinct from old.granted_by
     or new.granted_by_device_id is distinct from old.granted_by_device_id
     or new.granted_at is distinct from old.granted_at
     or new.revoked_at is null
     or new.revoked_by is null
     or new.revoked_by_device_id is null then
    raise exception 'MODULE_GRANT_UPDATE_PROHIBITED' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger module_permission_grants_protect_history
before update or delete on public.module_permission_grants
for each row execute function public.protect_module_permission_grant_history();

create function public.prevent_module_authorization_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'MODULE_AUTHORIZATION_HISTORY_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger module_grant_operations_protect_history
before update or delete on public.module_grant_operations
for each row execute function public.prevent_module_authorization_history_mutation();

create trigger module_grant_audit_log_protect_history
before update or delete on public.module_grant_audit_log
for each row execute function public.prevent_module_authorization_history_mutation();

create function public.require_module_permission(
  p_actor_device_id uuid,
  p_module_key text,
  p_permission_key text,
  p_resource_type text default null,
  p_resource_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  matching_grant public.module_permission_grants%rowtype;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);

  if p_module_key is null
     or char_length(p_module_key) not between 1 and 63
     or p_module_key !~ '^[a-z][a-z0-9_]{0,62}$'
     or p_permission_key is null
     or char_length(p_permission_key) not between 1 and 127
     or p_permission_key !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
     or ((p_resource_type is null) <> (p_resource_id is null)) then
    raise exception 'INVALID_MODULE_AUTHORIZATION_REQUEST' using errcode = '22023';
  end if;

  if p_resource_type is not null and (
    char_length(p_resource_type) not between 1 and 63
    or p_resource_type !~ '^[a-z][a-z0-9_]{0,62}$'
    or char_length(p_resource_id) not between 1 and 255
    or p_resource_id <> btrim(p_resource_id)
  ) then
    raise exception 'INVALID_MODULE_RESOURCE_SCOPE' using errcode = '22023';
  end if;

  if p_permission_key in ('module.access', 'module.manage')
     and p_resource_type is not null then
    raise exception 'FOUNDATION_PERMISSION_REQUIRES_MODULE_SCOPE' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.platform_modules as modules
     where modules.module_key = p_module_key and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;

  if public.is_system_owner(actor_id) then
    return jsonb_build_object(
      'actorUserId', actor_id,
      'actorDeviceId', p_actor_device_id,
      'moduleKey', p_module_key,
      'permissionKey', p_permission_key,
      'resourceType', p_resource_type,
      'resourceId', p_resource_id,
      'authoritySource', 'system_owner',
      'grantId', null
    );
  end if;

  select grants.* into matching_grant
    from public.module_permission_grants as grants
   where grants.user_id = actor_id
     and grants.module_key = p_module_key
     and grants.revoked_at is null
     and (
       grants.permission_key = p_permission_key
       or (
         p_permission_key = 'module.access'
         and grants.permission_key = 'module.manage'
       )
     )
     and grants.resource_type is not distinct from p_resource_type
     and grants.resource_id is not distinct from p_resource_id
   order by case when grants.permission_key = p_permission_key then 0 else 1 end
   limit 1;

  if not found then
    raise exception 'MODULE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'actorUserId', actor_id,
    'actorDeviceId', p_actor_device_id,
    'moduleKey', p_module_key,
    'permissionKey', p_permission_key,
    'resourceType', p_resource_type,
    'resourceId', p_resource_id,
    'authoritySource', case
      when p_resource_type is null then 'module_grant'
      else 'resource_grant'
    end,
    'grantId', matching_grant.grant_id
  );
end;
$$;

create function public.manage_foundation_module_grant(
  p_actor_device_id uuid,
  p_operation_id uuid,
  p_action text,
  p_target_user_id uuid,
  p_module_key text,
  p_permission_key text,
  p_grant_id uuid default null,
  p_revocation_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  authority_context jsonb;
  authority_source text;
  authority_grant_id uuid;
  intent text;
  prior_operation public.module_grant_operations%rowtype;
  target_grant public.module_permission_grants%rowtype;
  existing_grant public.module_permission_grants%rowtype;
  result_grant_id uuid;
  result_status text;
  result jsonb;
  old_values jsonb;
  new_values jsonb;
  active_manager_count bigint;
begin
  if p_operation_id is null or p_target_user_id is null
     or p_module_key is null
     or p_permission_key not in ('module.access', 'module.manage')
     or p_action not in ('create', 'revoke')
     or (p_action = 'create' and (p_grant_id is not null or p_revocation_reason is not null))
     or (p_action = 'revoke' and p_grant_id is null)
     or (
       p_revocation_reason is not null
       and (
         char_length(btrim(p_revocation_reason)) not between 1 and 500
         or p_revocation_reason <> btrim(p_revocation_reason)
       )
     ) then
    raise exception 'INVALID_FOUNDATION_GRANT_OPERATION' using errcode = '22023';
  end if;

  actor_id := public.require_current_approved_device(p_actor_device_id);

  if not exists (
    select 1 from public.platform_modules as modules
     where modules.module_key = p_module_key and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;

  if public.is_system_owner(actor_id) then
    authority_source := 'system_owner';
    authority_grant_id := null;
  else
    authority_context := public.require_module_permission(
      p_actor_device_id, p_module_key, 'module.manage', null, null
    );
    authority_source := 'module_grant';
    authority_grant_id := (authority_context ->> 'grantId')::uuid;
  end if;

  if p_action = 'create' and actor_id = p_target_user_id then
    raise exception 'MODULE_GRANT_SELF_GRANT_PROHIBITED' using errcode = '42501';
  end if;

  intent := encode(extensions.digest(
    jsonb_build_object(
      'action', p_action,
      'actorUserId', actor_id,
      'actorDeviceId', p_actor_device_id,
      'targetUserId', p_target_user_id,
      'moduleKey', p_module_key,
      'permissionKey', p_permission_key,
      'resourceType', null,
      'resourceId', null,
      'grantId', p_grant_id,
      'revocationReason', p_revocation_reason
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('module-grant-operation:' || p_operation_id::text, 0)
  );

  select * into prior_operation
    from public.module_grant_operations as operations
   where operations.operation_id = p_operation_id;

  if found then
    if prior_operation.intent_hash = intent then
      return prior_operation.stored_result;
    end if;
    raise exception 'MODULE_GRANT_OPERATION_MISMATCH' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('module-grant:' || p_module_key || ':' || p_target_user_id::text, 0)
  );

  if p_permission_key = 'module.manage' then
    perform pg_advisory_xact_lock(
      hashtextextended('module-managers:' || p_module_key, 0)
    );
    if authority_source = 'module_grant' and not exists (
      select 1 from public.module_permission_grants as grants
       where grants.grant_id = authority_grant_id
         and grants.user_id = actor_id
         and grants.module_key = p_module_key
         and grants.permission_key = 'module.manage'
         and grants.resource_type is null
         and grants.resource_id is null
         and grants.revoked_at is null
    ) then
      raise exception 'MODULE_PERMISSION_REQUIRED' using errcode = '42501';
    end if;
  end if;

  if p_action = 'create' then
    select * into existing_grant
      from public.module_permission_grants as grants
     where grants.user_id = p_target_user_id
       and grants.module_key = p_module_key
       and grants.permission_key = p_permission_key
       and grants.resource_type is null
       and grants.resource_id is null
       and grants.revoked_at is null
     for update;

    if found then
      result_grant_id := existing_grant.grant_id;
      result_status := 'existing';
      result := jsonb_build_object(
        'status', result_status,
        'grantId', result_grant_id,
        'targetUserId', p_target_user_id,
        'moduleKey', p_module_key,
        'permissionKey', p_permission_key,
        'resourceType', null,
        'resourceId', null
      );
    else
      insert into public.module_permission_grants (
        user_id, module_key, permission_key,
        granted_by, granted_by_device_id
      ) values (
        p_target_user_id, p_module_key, p_permission_key,
        actor_id, p_actor_device_id
      ) returning grant_id into result_grant_id;

      result_status := 'created';
      old_values := '{}'::jsonb;
      new_values := jsonb_build_object(
        'active', true,
        'permissionKey', p_permission_key,
        'resourceType', null,
        'resourceId', null
      );
      result := jsonb_build_object(
        'status', result_status,
        'grantId', result_grant_id,
        'targetUserId', p_target_user_id,
        'moduleKey', p_module_key,
        'permissionKey', p_permission_key,
        'resourceType', null,
        'resourceId', null
      );
    end if;
  else
    select * into target_grant
      from public.module_permission_grants as grants
     where grants.grant_id = p_grant_id
     for update;

    if not found
       or target_grant.user_id <> p_target_user_id
       or target_grant.module_key <> p_module_key
       or target_grant.permission_key <> p_permission_key
       or target_grant.resource_type is not null
       or target_grant.resource_id is not null then
      raise exception 'MODULE_GRANT_NOT_FOUND_OR_STALE' using errcode = 'P0002';
    end if;

    result_grant_id := target_grant.grant_id;

    if target_grant.revoked_at is not null then
      result_status := 'already_revoked';
      result := jsonb_build_object(
        'status', result_status,
        'grantId', result_grant_id,
        'targetUserId', p_target_user_id,
        'moduleKey', p_module_key,
        'permissionKey', p_permission_key,
        'resourceType', null,
        'resourceId', null
      );
    else
      if authority_source = 'module_grant'
         and actor_id = p_target_user_id
         and p_permission_key = 'module.manage' then
        raise exception 'MODULE_MANAGER_SELF_REVOCATION_PROHIBITED' using errcode = '42501';
      end if;

      if p_permission_key = 'module.manage' and authority_source = 'module_grant' then
        select count(*) into active_manager_count
          from public.module_permission_grants as grants
         where grants.module_key = p_module_key
           and grants.permission_key = 'module.manage'
           and grants.resource_type is null
           and grants.resource_id is null
           and grants.revoked_at is null;
        if active_manager_count <= 1 then
          raise exception 'LAST_MODULE_MANAGER_REVOCATION_PROHIBITED' using errcode = '42501';
        end if;
      end if;

      old_values := jsonb_build_object(
        'active', true,
        'permissionKey', target_grant.permission_key,
        'resourceType', target_grant.resource_type,
        'resourceId', target_grant.resource_id
      );

      update public.module_permission_grants
         set revoked_at = now(),
             revoked_by = actor_id,
             revoked_by_device_id = p_actor_device_id,
             revocation_reason = p_revocation_reason
       where grant_id = result_grant_id;

      result_status := 'revoked';
      new_values := jsonb_build_object(
        'active', false,
        'permissionKey', target_grant.permission_key,
        'resourceType', target_grant.resource_type,
        'resourceId', target_grant.resource_id,
        'revocationReason', p_revocation_reason
      );
      result := jsonb_build_object(
        'status', result_status,
        'grantId', result_grant_id,
        'targetUserId', p_target_user_id,
        'moduleKey', p_module_key,
        'permissionKey', p_permission_key,
        'resourceType', null,
        'resourceId', null
      );
    end if;
  end if;

  insert into public.module_grant_operations (
    operation_id, action, actor_user_id, actor_device_id,
    target_user_id, module_key, permission_key,
    resource_type, resource_id, requested_grant_id, resulting_grant_id,
    revocation_reason, authority_source, authority_grant_id,
    intent_hash, outcome, stored_result
  ) values (
    p_operation_id, p_action, actor_id, p_actor_device_id,
    p_target_user_id, p_module_key, p_permission_key,
    null, null, p_grant_id, result_grant_id,
    p_revocation_reason, authority_source, authority_grant_id,
    intent, result_status, result
  );

  if result_status in ('created', 'revoked') then
    insert into public.module_grant_audit_log (
      event_type, actor_user_id, actor_device_id, target_user_id,
      module_key, permission_key, resource_type, resource_id,
      grant_id, authority_source, authority_grant_id, operation_id,
      old_values, new_values
    ) values (
      case when result_status = 'created' then 'grant_created' else 'grant_revoked' end,
      actor_id, p_actor_device_id, p_target_user_id,
      p_module_key, p_permission_key, null, null,
      result_grant_id, authority_source, authority_grant_id, p_operation_id,
      old_values, new_values
    );
  end if;

  return result;
end;
$$;

create function public.list_module_permission_grants(
  p_actor_device_id uuid,
  p_module_key text,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  target_id uuid;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);
  target_id := coalesce(p_target_user_id, actor_id);

  if not exists (
    select 1 from public.platform_modules as modules
     where modules.module_key = p_module_key and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;

  if target_id <> actor_id and not public.is_system_owner(actor_id) then
    perform public.require_module_permission(
      p_actor_device_id, p_module_key, 'module.manage', null, null
    );
  end if;

  return jsonb_build_object(
    'status', 'success',
    'targetUserId', target_id,
    'moduleKey', p_module_key,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantId', grants.grant_id,
        'permissionKey', grants.permission_key,
        'resourceType', grants.resource_type,
        'resourceId', grants.resource_id,
        'grantedAt', grants.granted_at,
        'revokedAt', grants.revoked_at
      ) order by grants.granted_at, grants.grant_id)
        from public.module_permission_grants as grants
       where grants.user_id = target_id
         and grants.module_key = p_module_key
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.platform_modules enable row level security;
alter table public.module_permission_grants enable row level security;
alter table public.module_grant_operations enable row level security;
alter table public.module_grant_audit_log enable row level security;

create policy platform_modules_select_active
on public.platform_modules
for select
to authenticated
using (status = 'active');

revoke all on table public.platform_modules from public, anon, authenticated;
revoke all on table public.module_permission_grants from public, anon, authenticated;
revoke all on table public.module_grant_operations from public, anon, authenticated;
revoke all on table public.module_grant_audit_log from public, anon, authenticated;
grant select (module_key, display_name, status) on public.platform_modules to authenticated;

revoke all on function public.protect_platform_module_identity()
  from public, anon, authenticated;
revoke all on function public.protect_module_permission_grant_history()
  from public, anon, authenticated;
revoke all on function public.prevent_module_authorization_history_mutation()
  from public, anon, authenticated;
revoke all on function public.require_module_permission(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.manage_foundation_module_grant(
  uuid, uuid, text, uuid, text, text, uuid, text
) from public, anon;
revoke all on function public.list_module_permission_grants(uuid, text, uuid)
  from public, anon;

grant execute on function public.manage_foundation_module_grant(
  uuid, uuid, text, uuid, text, text, uuid, text
) to authenticated;
grant execute on function public.list_module_permission_grants(uuid, text, uuid)
  to authenticated;

commit;
