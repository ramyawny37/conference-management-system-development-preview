-- Keep rejected/revoked device authorizations in security history, but do not
-- present them as actionable devices in the canonical user-management view.
create or replace function public.get_user_management_devices(
  p_actor_device_id uuid, p_target_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;
begin
  if p_target_user_id is null then
    raise exception 'TARGET_USER_REQUIRED' using errcode='22023';
  end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  if not platform_private.user_has_module_permission_for(
    actor_id,'platform.devices.view',null,null
  ) then
    raise exception 'DEVICE_READ_SCOPE_DENIED' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('status','success','devices',
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'deviceId',da.device_id,'deviceName',d.display_name,'platform',d.platform,
      'lastSeenAt',d.last_seen_at,'authorizationStatus',da.status,
      'requestedAt',da.requested_at,'approvedAt',da.approved_at,
      'revokedAt',da.revoked_at,'lastRegisteredAt',da.last_authorized_seen_at,
      'capabilities',pg_catalog.jsonb_build_object(
        'canApprove',platform_private.user_has_module_permission_for(actor_id,'platform.devices.approve',null,null) and da.status='pending',
        'canReject',platform_private.user_has_module_permission_for(actor_id,'platform.devices.block',null,null) and da.status='pending',
        'canRevoke',platform_private.user_has_module_permission_for(actor_id,'platform.devices.revoke',null,null) and da.status='approved'
      )
    ) order by da.created_at,da.device_id)
    from platform.user_device_authorizations da
    join platform.devices d on d.id=da.device_id
    where da.user_id=p_target_user_id and da.status in ('pending','approved')
    ),'[]'::jsonb));
end $$;
