-- Reconcile legacy startup device reads with the canonical Platform relationship.
-- Function-only: no authorization, device, or other table data is changed.

create or replace function platform_private.resolve_startup_device_authorization_status(
  p_user_id uuid,p_device_id uuid
) returns text language plpgsql stable security definer set search_path='' as $$
declare v_status text;
begin
  select case
    when device.id is null then 'revoked'
    when uda.status='approved' and uda.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null
      and device.compromised_at is null then 'approved'
    when uda.status='pending' and uda.revoked_at is null then 'pending'
    else 'revoked'
  end into v_status
  from platform.user_device_authorizations uda
  left join platform.devices device on device.id=uda.device_id
  where uda.user_id=p_user_id and uda.device_id=p_device_id;
  if found then return v_status; end if;

  select legacy.authorization_status into v_status
  from public.user_device_authorizations legacy
  where legacy.user_id=p_user_id and legacy.device_id=p_device_id;
  return coalesce(v_status,'not_registered');
end; $$;

revoke all on function platform_private.resolve_startup_device_authorization_status(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.get_my_device_authorization(p_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  current_user_id uuid:=auth.uid();
  access_status text;
  device_status text;
  enforcement_state boolean;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select access.account_status into access_status from public.system_user_access access
  where access.user_id=current_user_id;
  device_status:=platform_private.resolve_startup_device_authorization_status(current_user_id,p_device_id);
  select enforcement.enforcement_enabled into enforcement_state
  from public.device_authorization_enforcement enforcement where enforcement.singleton_id=1;
  return pg_catalog.jsonb_build_object(
    'systemAccessStatus',coalesce(access_status,'missing'),
    'deviceAuthorizationStatus',device_status,
    'enforcementEnabled',coalesce(enforcement_state,false));
end; $$;

create or replace function public.get_my_device_aware_system_access(p_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  current_user_id uuid:=auth.uid();
  access_row public.system_user_access%rowtype;
  device_status text;
  enforcement_enabled boolean;
  roles text[];
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into access_row from public.system_user_access access where access.user_id=current_user_id;
  device_status:=platform_private.resolve_startup_device_authorization_status(current_user_id,p_device_id);
  select enforcement.enforcement_enabled into enforcement_enabled
  from public.device_authorization_enforcement enforcement where enforcement.singleton_id=1;
  select coalesce(pg_catalog.array_agg(system_roles.role order by system_roles.role),'{}'::text[])
  into roles from public.system_user_roles system_roles where system_roles.user_id=current_user_id;
  return pg_catalog.jsonb_build_object(
    'userId',current_user_id,
    'accountStatus',coalesce(access_row.account_status,'missing'),
    'canCreateConferences',coalesce(access_row.can_create_conferences,false),
    'systemRoles',roles,
    'isSystemOwner','system_owner'=any(roles),
    'isSystemAdmin','system_admin'=any(roles),
    'deviceAuthorizationStatus',device_status,
    'enforcementEnabled',coalesce(enforcement_enabled,false),
    'checkedAt',pg_catalog.clock_timestamp());
end; $$;
