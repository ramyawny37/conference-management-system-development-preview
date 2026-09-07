-- Require foundation module access before non-owner business authority and prevent transitive module-manager delegation.

create or replace function public.require_effective_module_permission(
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

  perform public.require_module_permission(
    p_actor_device_id, p_module_key, 'module.access', null, null
  );

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

  if p_permission_key = 'module.manage' then
    if not public.is_system_owner(actor_id) then
      raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
    end if;
    authority_source := 'system_owner';
    authority_grant_id := null;
  elsif public.is_system_owner(actor_id) then
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
  if p_permission_key = 'module.manage' then
    if authority_source <> 'system_owner' or not public.is_system_owner(actor_id) then
      raise exception 'SYSTEM_OWNER_REQUIRED' using errcode = '42501';
    end if;
  elsif authority_source = 'system_owner' then
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


