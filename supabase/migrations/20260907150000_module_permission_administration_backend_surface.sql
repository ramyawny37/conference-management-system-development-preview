-- Round 3G.2: protected module-permission administration reads and catalog grant transport.

create or replace function public.search_module_permission_candidates(
  p_actor_device_id uuid,
  p_module_key text,
  p_query text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  effective_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);
  if not exists (
    select 1 from public.platform_modules modules
     where modules.module_key = p_module_key and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;
  if not public.is_system_owner(actor_id) then
    perform public.require_module_permission(
      p_actor_device_id, p_module_key, 'module.manage', null, null
    );
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', candidates.id,
      'displayName', candidates.display_name,
      'email', candidates.email,
      'accountStatus', candidates.account_status
    ) order by coalesce(candidates.display_name, candidates.email), candidates.id)
    from (
      select users.id, profiles.display_name, users.email, access.account_status
        from auth.users users
        join public.system_user_access access on access.user_id = users.id
        left join public.profiles profiles on profiles.id = users.id
       where access.account_status = 'approved'
         and (
           normalized_query = ''
           or lower(coalesce(profiles.display_name, '')) like '%' || normalized_query || '%'
           or lower(coalesce(users.email, '')) like '%' || normalized_query || '%'
         )
       order by coalesce(profiles.display_name, users.email), users.id
       limit effective_limit
    ) candidates
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_module_permission_catalog_for_administration(
  p_actor_device_id uuid,
  p_module_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);
  if not exists (
    select 1 from public.platform_modules modules
     where modules.module_key = p_module_key and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;
  if not public.is_system_owner(actor_id) then
    perform public.require_module_permission(
      p_actor_device_id, p_module_key, 'module.manage', null, null
    );
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'permissionKey', catalog.permission_key,
      'displayName', catalog.display_name,
      'description', catalog.description,
      'allowedScopeMode', catalog.allowed_scope_mode,
      'allowedResourceType', catalog.allowed_resource_type,
      'sensitiveMutation', catalog.sensitive_mutation,
      'catalogVersion', catalog.catalog_version
    ) order by catalog.permission_key)
      from public.module_permission_catalog catalog
     where catalog.module_key = p_module_key
       and catalog.status = 'active'
       and catalog.permission_key not in ('module.access', 'module.manage')
       and catalog.permission_key not like 'module.%'
  ), '[]'::jsonb);
end;
$$;

create or replace function warehouse.list_permission_administration_stores(
  p_device_id uuid,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, warehouse
as $$
declare actor_id uuid;
begin
  actor_id := public.require_current_approved_device(p_device_id);
  if not exists (
    select 1 from public.platform_modules modules
     where modules.module_key = 'warehouse' and modules.status = 'active'
  ) then
    raise exception 'ACTIVE_MODULE_REQUIRED' using errcode = '42501';
  end if;
  if not public.is_system_owner(actor_id) then
    perform public.require_module_permission(
      p_device_id, 'warehouse', 'module.manage', null, null
    );
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'storeId', stores.id,
      'code', stores.code,
      'name', stores.name,
      'status', stores.status
    ) order by stores.code, stores.id)
      from warehouse.stores stores
     where coalesce(p_include_inactive, false) or stores.status = 'active'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.search_module_permission_candidates(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.list_module_permission_catalog_for_administration(uuid,text) from public, anon, authenticated;
revoke all on function warehouse.list_permission_administration_stores(uuid,boolean) from public, anon, authenticated;
grant execute on function public.search_module_permission_candidates(uuid,text,text,integer) to service_role;
grant execute on function public.list_module_permission_catalog_for_administration(uuid,text) to service_role;
grant execute on function warehouse.list_permission_administration_stores(uuid,boolean) to service_role;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  rename to execute_device_operation_pre_module_permission_administration;

create function platform.execute_device_operation(
  p_user_id uuid,
  p_session_id uuid,
  p_token_hash bytea,
  p_module text,
  p_operation text,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, platform, platform_private, warehouse
as $$
declare session platform_private.device_sessions%rowtype;
begin
  if not (
    (p_module = 'conference' and p_operation in (
      'search_module_permission_candidates',
      'list_module_permission_catalog_for_administration',
      'manage_catalog_module_grant'
    ))
    or (p_module = 'warehouse' and p_operation = 'list_permission_administration_stores')
  ) then
    return platform.execute_device_operation_pre_module_permission_administration(
      p_user_id, p_session_id, p_token_hash, p_module, p_operation, p_args
    );
  end if;
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode = '42501';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object'
     or p_args ? 'p_actor_device_id' or p_args ? 'p_device_id' then
    raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  select item.* into session
    from platform_private.device_sessions item
    join platform.device_key_bindings binding on binding.id = item.binding_id
    join platform.user_device_authorizations uda on uda.id = item.device_authorization_id
    join platform.devices device on device.id = item.device_id
    join platform.profiles profile on profile.user_id = item.user_id
   where item.id = p_session_id and item.user_id = p_user_id and item.token_hash = p_token_hash
     and item.purpose = 'PLATFORM_DEVICE_SESSION' and item.revoked_at is null
     and item.expires_at > statement_timestamp()
     and binding.user_id = item.user_id and binding.device_id = item.device_id
     and binding.device_authorization_id = item.device_authorization_id
     and binding.public_key_thumbprint = item.public_key_thumbprint
     and binding.algorithm = 'ECDSA_P256_SHA256' and binding.lifecycle_status = 'active'
     and binding.revoked_at is null and binding.retired_at is null
     and uda.user_id = item.user_id and uda.device_id = item.device_id
     and uda.status = 'approved' and uda.revoked_at is null
     and device.lifecycle_status = 'active' and device.retired_at is null
     and device.compromised_at is null and profile.account_status = 'approved';
  if not found then
    raise exception 'DEVICE_SESSION_INVALID' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'service_role'
  )::text, true);
  perform set_config('platform.phase1c_context', jsonb_build_object(
    'purpose', 'PLATFORM_DEVICE_SESSION_DISPATCH', 'session_id', session.id,
    'user_id', session.user_id, 'device_id', session.device_id,
    'authorization_id', session.device_authorization_id, 'binding_id', session.binding_id,
    'token_hash', encode(p_token_hash, 'hex')
  )::text, true);

  if p_operation = 'search_module_permission_candidates' then
    perform platform_private.require_exact_jsonb_keys(p_args, array['p_module_key','p_query','p_limit']);
    return public.search_module_permission_candidates(session.device_id, p_args->>'p_module_key', p_args->>'p_query', (p_args->>'p_limit')::integer);
  elsif p_operation = 'list_module_permission_catalog_for_administration' then
    perform platform_private.require_exact_jsonb_keys(p_args, array['p_module_key']);
    return public.list_module_permission_catalog_for_administration(session.device_id, p_args->>'p_module_key');
  elsif p_operation = 'manage_catalog_module_grant' then
    perform platform_private.require_exact_jsonb_keys(p_args, array['p_operation_id','p_action','p_target_user_id','p_module_key','p_permission_key','p_resource_type','p_resource_id','p_grant_id','p_revocation_reason']);
    return public.manage_catalog_module_grant(
      session.device_id, (p_args->>'p_operation_id')::uuid, p_args->>'p_action',
      (p_args->>'p_target_user_id')::uuid, p_args->>'p_module_key', p_args->>'p_permission_key',
      p_args->>'p_resource_type', p_args->>'p_resource_id', (p_args->>'p_grant_id')::uuid,
      p_args->>'p_revocation_reason'
    );
  end if;

  perform platform_private.require_exact_jsonb_keys(p_args, array['p_include_inactive']);
  return warehouse.list_permission_administration_stores(
    session.device_id, (p_args->>'p_include_inactive')::boolean
  );
end;
$$;

revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_module_permission_administration(uuid,uuid,bytea,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_module_permission_administration(uuid,uuid,bytea,text,text,jsonb)
  to service_role;

revoke all on function public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)
  to service_role;
