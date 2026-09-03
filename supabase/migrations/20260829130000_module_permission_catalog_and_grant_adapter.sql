begin;

do $$
begin
  if to_regclass('public.platform_modules') is null
     or to_regclass('public.module_permission_grants') is null
     or to_regclass('public.module_grant_operations') is null
     or to_regclass('public.module_grant_audit_log') is null
     or to_regprocedure('public.require_module_permission(uuid,text,text,text,text)') is null
     or to_regprocedure('public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)') is null
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.module_grant_operations'::regclass
          and conname = 'module_grant_operations_action_check'
     )
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.module_grant_operations'::regclass
          and conname = 'module_grant_operations_action_grant_check'
     )
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.module_grant_operations'::regclass
          and conname = 'module_grant_operations_outcome_check'
     )
     or not exists (
       select 1 from pg_constraint
        where conrelid = 'public.module_grant_audit_log'::regclass
          and conname = 'module_grant_audit_log_event_type_check'
     ) then
    raise exception 'MODULE_AUTHORIZATION_FOUNDATION_CONTRACT_MISMATCH'
      using errcode = '55000';
  end if;
end;
$$;

create table public.module_permission_catalog (
  permission_key text primary key,
  module_key text not null references public.platform_modules(module_key) on delete restrict,
  display_name text not null,
  description text not null,
  status text not null default 'active',
  allowed_scope_mode text not null,
  allowed_resource_type text,
  sensitive_mutation boolean not null default false,
  catalog_version integer not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint module_permission_catalog_key_check check (
    char_length(permission_key) between 3 and 127
    and permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$'
    and left(permission_key, char_length(module_key) + 1) = module_key || '.'
    and permission_key not like 'module.%'
    and permission_key not in ('module.access', 'module.manage')
  ),
  constraint module_permission_catalog_display_name_check check (
    char_length(btrim(display_name)) between 1 and 160
    and display_name = btrim(display_name)
  ),
  constraint module_permission_catalog_description_check check (
    char_length(btrim(description)) between 1 and 1000
    and description = btrim(description)
  ),
  constraint module_permission_catalog_status_check check (
    status in ('active', 'retired')
  ),
  constraint module_permission_catalog_scope_mode_check check (
    allowed_scope_mode in ('module', 'resource', 'both')
  ),
  constraint module_permission_catalog_resource_type_check check (
    (
      allowed_scope_mode = 'module'
      and allowed_resource_type is null
    )
    or (
      allowed_scope_mode in ('resource', 'both')
      and allowed_resource_type is not null
      and char_length(allowed_resource_type) between 1 and 63
      and allowed_resource_type ~ '^[a-z][a-z0-9_]{0,62}$'
    )
  ),
  constraint module_permission_catalog_version_check check (catalog_version > 0),
  constraint module_permission_catalog_retirement_check check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null and retired_at >= created_at)
  )
);

create index module_permission_catalog_module_status_idx
  on public.module_permission_catalog(module_key, status, permission_key);
create index module_permission_catalog_module_version_idx
  on public.module_permission_catalog(module_key, catalog_version);
create index module_permission_catalog_active_idx
  on public.module_permission_catalog(module_key, permission_key)
  where status = 'active';

create function public.protect_module_permission_catalog_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MODULE_PERMISSION_CATALOG_DELETE_PROHIBITED' using errcode = '55000';
  end if;

  if new.permission_key is distinct from old.permission_key
     or new.module_key is distinct from old.module_key
     or new.created_at is distinct from old.created_at then
    raise exception 'MODULE_PERMISSION_CATALOG_IDENTITY_IMMUTABLE' using errcode = '55000';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'MODULE_PERMISSION_CATALOG_REACTIVATION_PROHIBITED' using errcode = '55000';
  end if;

  if (
    new.display_name is distinct from old.display_name
    or new.description is distinct from old.description
    or new.status is distinct from old.status
    or new.allowed_scope_mode is distinct from old.allowed_scope_mode
    or new.allowed_resource_type is distinct from old.allowed_resource_type
    or new.sensitive_mutation is distinct from old.sensitive_mutation
    or new.retired_at is distinct from old.retired_at
  ) and new.catalog_version <= old.catalog_version then
    raise exception 'MODULE_PERMISSION_CATALOG_VERSION_INCREMENT_REQUIRED' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger module_permission_catalog_protect_history
before update or delete on public.module_permission_catalog
for each row execute function public.protect_module_permission_catalog_history();

create function public.validate_module_permission_catalog(
  p_module_key text,
  p_permission_key text,
  p_resource_type text default null,
  p_resource_id text default null,
  p_validation_purpose text default 'authorize'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  catalog_row public.module_permission_catalog%rowtype;
  requested_scope text;
begin
  if p_validation_purpose not in ('authorize', 'grant', 'revoke')
     or p_module_key is null
     or char_length(p_module_key) not between 1 and 63
     or p_module_key !~ '^[a-z][a-z0-9_]{0,62}$'
     or p_permission_key is null
     or char_length(p_permission_key) not between 3 and 127
     or p_permission_key !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$'
     or ((p_resource_type is null) <> (p_resource_id is null)) then
    raise exception 'INVALID_MODULE_PERMISSION_REQUEST' using errcode = '22023';
  end if;

  if p_permission_key in ('module.access', 'module.manage')
     or p_permission_key like 'module.%' then
    raise exception 'MODULE_SPECIFIC_PERMISSION_REQUIRED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.platform_modules as modules
     where modules.module_key = p_module_key
       and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;

  select * into catalog_row
    from public.module_permission_catalog as catalog
   where catalog.permission_key = p_permission_key;

  if not found then
    raise exception 'MODULE_PERMISSION_CATALOG_REQUIRED' using errcode = '42501';
  end if;

  if catalog_row.module_key <> p_module_key
     or left(p_permission_key, char_length(p_module_key) + 1) <> p_module_key || '.' then
    raise exception 'MODULE_PERMISSION_NAMESPACE_MISMATCH' using errcode = '42501';
  end if;

  if p_validation_purpose in ('authorize', 'grant')
     and catalog_row.status <> 'active' then
    raise exception 'ACTIVE_MODULE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  requested_scope := case when p_resource_type is null then 'module' else 'resource' end;

  if p_validation_purpose <> 'revoke' then
    if requested_scope = 'module'
       and catalog_row.allowed_scope_mode not in ('module', 'both') then
      raise exception 'MODULE_PERMISSION_SCOPE_NOT_ALLOWED' using errcode = '42501';
    end if;

    if requested_scope = 'resource' then
      if catalog_row.allowed_scope_mode not in ('resource', 'both') then
        raise exception 'MODULE_PERMISSION_SCOPE_NOT_ALLOWED' using errcode = '42501';
      end if;
      if p_resource_type <> catalog_row.allowed_resource_type then
        raise exception 'MODULE_PERMISSION_RESOURCE_TYPE_INVALID' using errcode = '42501';
      end if;
      if char_length(p_resource_type) not between 1 and 63
         or p_resource_type !~ '^[a-z][a-z0-9_]{0,62}$'
         or char_length(p_resource_id) not between 1 and 255
         or p_resource_id <> btrim(p_resource_id) then
        raise exception 'INVALID_MODULE_RESOURCE_SCOPE' using errcode = '22023';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'moduleKey', catalog_row.module_key,
    'permissionKey', catalog_row.permission_key,
    'catalogStatus', catalog_row.status,
    'catalogVersion', catalog_row.catalog_version,
    'allowedScopeMode', catalog_row.allowed_scope_mode,
    'allowedResourceType', catalog_row.allowed_resource_type,
    'requestedScope', requested_scope,
    'resourceType', p_resource_type,
    'resourceId', p_resource_id,
    'sensitiveMutation', catalog_row.sensitive_mutation
  );
end;
$$;

create function public.require_effective_module_permission(
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
  catalog_context jsonb;
  matching_grant public.module_permission_grants%rowtype;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);
  catalog_context := public.validate_module_permission_catalog(
    p_module_key, p_permission_key, p_resource_type, p_resource_id, 'authorize'
  );

  if public.is_system_owner(actor_id) then
    return jsonb_build_object(
      'actorUserId', actor_id,
      'actorDeviceId', p_actor_device_id,
      'moduleKey', p_module_key,
      'permissionKey', p_permission_key,
      'resourceType', p_resource_type,
      'resourceId', p_resource_id,
      'authoritySource', 'system_owner',
      'grantId', null,
      'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
    );
  end if;

  matching_grant := null;
  if p_resource_type is not null then
    select * into matching_grant
      from public.module_permission_grants as grants
     where grants.user_id = actor_id
       and grants.module_key = p_module_key
       and grants.permission_key = p_permission_key
       and grants.resource_type = p_resource_type
       and grants.resource_id = p_resource_id
       and grants.revoked_at is null
     limit 1;
  end if;

  if matching_grant.grant_id is null then
    select * into matching_grant
      from public.module_permission_grants as grants
     where grants.user_id = actor_id
       and grants.module_key = p_module_key
       and grants.permission_key = p_permission_key
       and grants.resource_type is null
       and grants.resource_id is null
       and grants.revoked_at is null
     limit 1;
  end if;

  if matching_grant.grant_id is null then
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
      when matching_grant.resource_type is null then 'module_grant'
      else 'resource_grant'
    end,
    'grantId', matching_grant.grant_id,
    'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
  );
end;
$$;

alter table public.module_grant_operations
  drop constraint module_grant_operations_action_check,
  add constraint module_grant_operations_action_check check (
    action in ('create', 'grant', 'revoke', 'recover_revoke_final_manager')
  );
alter table public.module_grant_operations
  drop constraint module_grant_operations_action_grant_check,
  add constraint module_grant_operations_action_grant_check check (
    (action in ('create', 'grant') and requested_grant_id is null)
    or (action in ('revoke', 'recover_revoke_final_manager') and requested_grant_id is not null)
  );
alter table public.module_grant_operations
  drop constraint module_grant_operations_outcome_check,
  add constraint module_grant_operations_outcome_check check (
    outcome in ('created', 'existing', 'revoked', 'already_revoked', 'recovered')
  );
alter table public.module_grant_audit_log
  drop constraint module_grant_audit_log_event_type_check,
  add constraint module_grant_audit_log_event_type_check check (
    event_type in ('grant_created', 'grant_revoked', 'final_manager_recovery_revoked')
  );

create function public.manage_catalog_module_grant(
  p_actor_device_id uuid,
  p_operation_id uuid,
  p_action text,
  p_target_user_id uuid,
  p_module_key text,
  p_permission_key text,
  p_resource_type text default null,
  p_resource_id text default null,
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
  revalidated_actor_id uuid;
  authority_context jsonb;
  authority_source text;
  authority_grant_id uuid;
  catalog_context jsonb;
  intent text;
  target_status text;
  prior_operation public.module_grant_operations%rowtype;
  target_grant public.module_permission_grants%rowtype;
  existing_grant public.module_permission_grants%rowtype;
  result_grant_id uuid;
  result_status text;
  result jsonb;
  old_values jsonb;
  new_values jsonb;
begin
  if p_operation_id is null or p_target_user_id is null
     or p_action not in ('grant', 'revoke')
     or p_module_key is null or p_permission_key is null
     or p_permission_key in ('module.access', 'module.manage')
     or p_permission_key like 'module.%'
     or ((p_resource_type is null) <> (p_resource_id is null))
     or (p_action = 'grant' and (p_grant_id is not null or p_revocation_reason is not null))
     or (p_action = 'revoke' and p_grant_id is null)
     or (
       p_revocation_reason is not null
       and (
         char_length(btrim(p_revocation_reason)) not between 1 and 500
         or p_revocation_reason <> btrim(p_revocation_reason)
       )
     ) then
    raise exception 'INVALID_MODULE_GRANT_OPERATION' using errcode = '22023';
  end if;

  actor_id := public.require_current_approved_device(p_actor_device_id);
  catalog_context := public.validate_module_permission_catalog(
    p_module_key, p_permission_key, p_resource_type, p_resource_id,
    case when p_action = 'grant' then 'grant' else 'revoke' end
  );

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

  if p_action = 'grant' and actor_id = p_target_user_id then
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
      'resourceType', p_resource_type,
      'resourceId', p_resource_id,
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
    hashtextextended('module-managers:' || p_module_key, 0)
  );

  revalidated_actor_id := public.require_current_approved_device(p_actor_device_id);
  if revalidated_actor_id <> actor_id then
    raise exception 'MODULE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  if authority_source = 'system_owner' then
    if not public.is_system_owner(actor_id) then
      raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
    end if;
  elsif not exists (
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

  perform pg_advisory_xact_lock(hashtextextended(
    'module-grant:' || p_module_key || ':' || p_target_user_id::text || ':' ||
    p_permission_key || ':' || coalesce(p_resource_type, '<module>') || ':' ||
    coalesce(p_resource_id, '<module>'), 0
  ));

  if p_action = 'grant' then
    if not exists (select 1 from auth.users as users where users.id = p_target_user_id) then
      raise exception 'TARGET_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
    end if;

    target_status := null;
    select access.account_status into target_status
      from public.system_user_access as access
     where access.user_id = p_target_user_id
     for update;
    if target_status is distinct from 'approved' then
      raise exception 'TARGET_ACCOUNT_APPROVED_REQUIRED' using errcode = '42501';
    end if;

    select * into existing_grant
      from public.module_permission_grants as grants
     where grants.user_id = p_target_user_id
       and grants.module_key = p_module_key
       and grants.permission_key = p_permission_key
       and grants.resource_type is not distinct from p_resource_type
       and grants.resource_id is not distinct from p_resource_id
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
        'resourceType', p_resource_type,
        'resourceId', p_resource_id,
        'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
      );
    else
      insert into public.module_permission_grants (
        user_id, module_key, permission_key, resource_type, resource_id,
        granted_by, granted_by_device_id
      ) values (
        p_target_user_id, p_module_key, p_permission_key, p_resource_type, p_resource_id,
        actor_id, p_actor_device_id
      ) returning grant_id into result_grant_id;

      result_status := 'created';
      old_values := '{}'::jsonb;
      new_values := jsonb_build_object(
        'active', true,
        'permissionKey', p_permission_key,
        'resourceType', p_resource_type,
        'resourceId', p_resource_id,
        'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
      );
      result := jsonb_build_object(
        'status', result_status,
        'grantId', result_grant_id,
        'targetUserId', p_target_user_id,
        'moduleKey', p_module_key,
        'permissionKey', p_permission_key,
        'resourceType', p_resource_type,
        'resourceId', p_resource_id,
        'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
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
       or target_grant.resource_type is distinct from p_resource_type
       or target_grant.resource_id is distinct from p_resource_id then
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
        'resourceType', p_resource_type,
        'resourceId', p_resource_id,
        'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
      );
    else
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
        'resourceType', p_resource_type,
        'resourceId', p_resource_id,
        'catalogVersion', (catalog_context ->> 'catalogVersion')::integer
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
    p_resource_type, p_resource_id, p_grant_id, result_grant_id,
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
      p_module_key, p_permission_key, p_resource_type, p_resource_id,
      result_grant_id, authority_source, authority_grant_id, p_operation_id,
      old_values, new_values
    );
  end if;

  return result;
end;
$$;

create or replace function public.manage_foundation_module_grant(
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
  revalidated_actor_id uuid;
  authority_context jsonb;
  authority_source text;
  authority_grant_id uuid;
  intent text;
  target_status text;
  prior_operation public.module_grant_operations%rowtype;
  target_grant public.module_permission_grants%rowtype;
  existing_grant public.module_permission_grants%rowtype;
  result_grant_id uuid;
  result_status text;
  result jsonb;
  old_values jsonb;
  new_values jsonb;
  active_non_owner_manager_count bigint;
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
    hashtextextended('module-managers:' || p_module_key, 0)
  );

  revalidated_actor_id := public.require_current_approved_device(p_actor_device_id);
  if revalidated_actor_id <> actor_id then
    raise exception 'MODULE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  if authority_source = 'system_owner' then
    if not public.is_system_owner(actor_id) then
      raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
    end if;
  elsif not exists (
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

  perform pg_advisory_xact_lock(
    hashtextextended('module-grant:' || p_module_key || ':' || p_target_user_id::text, 0)
  );

  if p_action = 'create' then
    if not exists (select 1 from auth.users as users where users.id = p_target_user_id) then
      raise exception 'TARGET_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
    end if;
    target_status := null;
    select access.account_status into target_status
      from public.system_user_access as access
     where access.user_id = p_target_user_id
     for update;
    if target_status is distinct from 'approved' then
      raise exception 'TARGET_ACCOUNT_APPROVED_REQUIRED' using errcode = '42501';
    end if;

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
        'status', result_status, 'grantId', result_grant_id,
        'targetUserId', p_target_user_id, 'moduleKey', p_module_key,
        'permissionKey', p_permission_key, 'resourceType', null, 'resourceId', null
      );
    else
      insert into public.module_permission_grants (
        user_id, module_key, permission_key, granted_by, granted_by_device_id
      ) values (
        p_target_user_id, p_module_key, p_permission_key, actor_id, p_actor_device_id
      ) returning grant_id into result_grant_id;
      result_status := 'created';
      old_values := '{}'::jsonb;
      new_values := jsonb_build_object(
        'active', true, 'permissionKey', p_permission_key,
        'resourceType', null, 'resourceId', null
      );
      result := jsonb_build_object(
        'status', result_status, 'grantId', result_grant_id,
        'targetUserId', p_target_user_id, 'moduleKey', p_module_key,
        'permissionKey', p_permission_key, 'resourceType', null, 'resourceId', null
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
        'status', result_status, 'grantId', result_grant_id,
        'targetUserId', p_target_user_id, 'moduleKey', p_module_key,
        'permissionKey', p_permission_key, 'resourceType', null, 'resourceId', null
      );
    else
      if authority_source = 'module_grant'
         and actor_id = p_target_user_id
         and p_permission_key = 'module.manage' then
        raise exception 'MODULE_MANAGER_SELF_REVOCATION_PROHIBITED' using errcode = '42501';
      end if;

      if p_permission_key = 'module.manage'
         and not public.is_system_owner(p_target_user_id) then
        select count(*) into active_non_owner_manager_count
          from public.module_permission_grants as grants
         where grants.module_key = p_module_key
           and grants.permission_key = 'module.manage'
           and grants.resource_type is null
           and grants.resource_id is null
           and grants.revoked_at is null
           and not public.is_system_owner(grants.user_id);
        if active_non_owner_manager_count <= 1 then
          raise exception 'LAST_MODULE_MANAGER_REVOCATION_PROHIBITED' using errcode = '42501';
        end if;
      end if;

      old_values := jsonb_build_object(
        'active', true, 'permissionKey', target_grant.permission_key,
        'resourceType', null, 'resourceId', null
      );
      update public.module_permission_grants
         set revoked_at = now(), revoked_by = actor_id,
             revoked_by_device_id = p_actor_device_id,
             revocation_reason = p_revocation_reason
       where grant_id = result_grant_id;
      result_status := 'revoked';
      new_values := jsonb_build_object(
        'active', false, 'permissionKey', target_grant.permission_key,
        'resourceType', null, 'resourceId', null,
        'revocationReason', p_revocation_reason
      );
      result := jsonb_build_object(
        'status', result_status, 'grantId', result_grant_id,
        'targetUserId', p_target_user_id, 'moduleKey', p_module_key,
        'permissionKey', p_permission_key, 'resourceType', null, 'resourceId', null
      );
    end if;
  end if;

  insert into public.module_grant_operations (
    operation_id, action, actor_user_id, actor_device_id,
    target_user_id, module_key, permission_key, resource_type, resource_id,
    requested_grant_id, resulting_grant_id, revocation_reason,
    authority_source, authority_grant_id, intent_hash, outcome, stored_result
  ) values (
    p_operation_id, p_action, actor_id, p_actor_device_id,
    p_target_user_id, p_module_key, p_permission_key, null, null,
    p_grant_id, result_grant_id, p_revocation_reason,
    authority_source, authority_grant_id, intent, result_status, result
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

create function public.recover_revoke_final_module_manager(
  p_actor_device_id uuid,
  p_operation_id uuid,
  p_module_key text,
  p_target_user_id uuid,
  p_target_grant_id uuid,
  p_recovery_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  revalidated_actor_id uuid;
  intent text;
  prior_operation public.module_grant_operations%rowtype;
  target_grant public.module_permission_grants%rowtype;
  active_non_owner_manager_count bigint;
  result jsonb;
  old_values jsonb;
  new_values jsonb;
begin
  if p_operation_id is null or p_target_user_id is null or p_target_grant_id is null
     or p_module_key is null
     or char_length(btrim(coalesce(p_recovery_reason, ''))) not between 10 and 500
     or p_recovery_reason <> btrim(p_recovery_reason) then
    raise exception 'INVALID_FINAL_MANAGER_RECOVERY' using errcode = '22023';
  end if;

  actor_id := public.require_current_approved_device(p_actor_device_id);
  if not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.platform_modules as modules
     where modules.module_key = p_module_key and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;

  intent := encode(extensions.digest(
    jsonb_build_object(
      'action', 'recover_revoke_final_manager',
      'actorUserId', actor_id,
      'actorDeviceId', p_actor_device_id,
      'targetUserId', p_target_user_id,
      'moduleKey', p_module_key,
      'permissionKey', 'module.manage',
      'resourceType', null,
      'resourceId', null,
      'grantId', p_target_grant_id,
      'recoveryReason', p_recovery_reason
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
    hashtextextended('module-managers:' || p_module_key, 0)
  );
  revalidated_actor_id := public.require_current_approved_device(p_actor_device_id);
  if revalidated_actor_id <> actor_id or not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('module-grant:' || p_module_key || ':' || p_target_user_id::text, 0)
  );
  select * into target_grant
    from public.module_permission_grants as grants
   where grants.grant_id = p_target_grant_id
   for update;

  if not found
     or target_grant.user_id <> p_target_user_id
     or target_grant.module_key <> p_module_key
     or target_grant.permission_key <> 'module.manage'
     or target_grant.resource_type is not null
     or target_grant.resource_id is not null
     or target_grant.revoked_at is not null then
    raise exception 'MODULE_GRANT_NOT_FOUND_OR_STALE' using errcode = 'P0002';
  end if;
  if public.is_system_owner(p_target_user_id) then
    raise exception 'FINAL_MODULE_MANAGER_RECOVERY_TARGET_INVALID' using errcode = '42501';
  end if;

  select count(*) into active_non_owner_manager_count
    from public.module_permission_grants as grants
   where grants.module_key = p_module_key
     and grants.permission_key = 'module.manage'
     and grants.resource_type is null
     and grants.resource_id is null
     and grants.revoked_at is null
     and not public.is_system_owner(grants.user_id);
  if active_non_owner_manager_count <> 1 then
    raise exception 'FINAL_MODULE_MANAGER_RECOVERY_NOT_REQUIRED' using errcode = '42501';
  end if;

  old_values := jsonb_build_object(
    'active', true, 'permissionKey', 'module.manage',
    'resourceType', null, 'resourceId', null
  );
  update public.module_permission_grants
     set revoked_at = now(), revoked_by = actor_id,
         revoked_by_device_id = p_actor_device_id,
         revocation_reason = p_recovery_reason
   where grant_id = p_target_grant_id;
  new_values := jsonb_build_object(
    'active', false, 'permissionKey', 'module.manage',
    'resourceType', null, 'resourceId', null,
    'recoveryReason', p_recovery_reason
  );
  result := jsonb_build_object(
    'status', 'recovered', 'grantId', p_target_grant_id,
    'targetUserId', p_target_user_id, 'moduleKey', p_module_key,
    'permissionKey', 'module.manage', 'resourceType', null, 'resourceId', null,
    'recoveryReason', p_recovery_reason
  );

  insert into public.module_grant_operations (
    operation_id, action, actor_user_id, actor_device_id,
    target_user_id, module_key, permission_key, resource_type, resource_id,
    requested_grant_id, resulting_grant_id, revocation_reason,
    authority_source, authority_grant_id, intent_hash, outcome, stored_result
  ) values (
    p_operation_id, 'recover_revoke_final_manager', actor_id, p_actor_device_id,
    p_target_user_id, p_module_key, 'module.manage', null, null,
    p_target_grant_id, p_target_grant_id, p_recovery_reason,
    'system_owner', null, intent, 'recovered', result
  );

  insert into public.module_grant_audit_log (
    event_type, actor_user_id, actor_device_id, target_user_id,
    module_key, permission_key, resource_type, resource_id,
    grant_id, authority_source, authority_grant_id, operation_id,
    old_values, new_values
  ) values (
    'final_manager_recovery_revoked', actor_id, p_actor_device_id,
    p_target_user_id, p_module_key, 'module.manage', null, null,
    p_target_grant_id, 'system_owner', null, p_operation_id,
    old_values, new_values
  );

  return result;
end;
$$;

alter table public.module_permission_catalog enable row level security;

revoke all on table public.module_permission_catalog from public, anon, authenticated;

revoke all on function public.protect_module_permission_catalog_history()
  from public, anon, authenticated;
revoke all on function public.validate_module_permission_catalog(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.require_effective_module_permission(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.manage_catalog_module_grant(
  uuid, uuid, text, uuid, text, text, text, text, uuid, text
) from public, anon, authenticated;

revoke all on function public.manage_foundation_module_grant(
  uuid, uuid, text, uuid, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.manage_foundation_module_grant(
  uuid, uuid, text, uuid, text, text, uuid, text
) to authenticated;

revoke all on function public.recover_revoke_final_module_manager(
  uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.recover_revoke_final_module_manager(
  uuid, uuid, text, uuid, uuid, text
) to authenticated;

commit;
