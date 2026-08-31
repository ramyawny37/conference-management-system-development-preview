-- Forward-only Platform-domain device administration contract.
-- This migration does not approve, block, revoke, or bootstrap any device.

create or replace function platform.list_pending_device_authorizations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not platform_private.has_permission_for(
    auth.uid(), 'platform.devices.view', 'platform', null
  ) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'success',
    'devices', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'authorizationId', device_authorization.id,
          'deviceId', device_authorization.device_id,
          'deviceName', device.display_name,
          'platform', device.platform,
          'browser', device.browser,
          'authorizationStatus', device_authorization.status,
          'requestedAt', device_authorization.requested_at
        ) order by device_authorization.requested_at, device_authorization.id
      )
      from platform.user_device_authorizations device_authorization
      join platform.devices device on device.id = device_authorization.device_id
      join platform.profiles profile on profile.user_id = device_authorization.user_id
      where device_authorization.status = 'pending'
        and device.lifecycle_status = 'active'
        and profile.account_status = 'approved'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function platform.approve_pending_device_authorization(
  p_authorization_id uuid,
  p_device_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target platform.user_device_authorizations%rowtype;
begin
  if not platform_private.has_permission_for(
    auth.uid(), 'platform.devices.approve', 'platform', null
  ) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_authorization_id is null or p_device_id is null then
    raise exception 'PLATFORM_DEVICE_TARGET_REQUIRED' using errcode = '22023';
  end if;

  select * into target
  from platform.user_device_authorizations device_authorization
  where device_authorization.id = p_authorization_id
    and device_authorization.device_id = p_device_id
  for update;

  if not found then
    raise exception 'DEVICE_AUTHORIZATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target.status <> 'pending' then
    raise exception 'DEVICE_AUTHORIZATION_NOT_PENDING' using errcode = '55000';
  end if;

  perform platform_private.change_device_authorization(
    target.id, 'approved', 'platform.devices.approve', p_reason
  );

  return pg_catalog.jsonb_build_object(
    'status', 'applied',
    'authorizationId', target.id,
    'deviceId', target.device_id,
    'authorizationStatus', 'approved'
  );
end;
$$;

revoke all on function platform.list_pending_device_authorizations()
  from public, anon, authenticated;
revoke all on function platform.approve_pending_device_authorization(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function platform.list_pending_device_authorizations()
  to authenticated;
grant execute on function platform.approve_pending_device_authorization(uuid, uuid, text)
  to authenticated;
