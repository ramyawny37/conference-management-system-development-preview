begin;

-- Read-only owner administration is authorized by the canonical device-session
-- dispatcher.  The browser never supplies the actor device to this function:
-- execute_device_operation derives it from the verified session row.
create or replace function public.list_system_owner_pending_device_authorizations_for_session(
  p_actor_device_id uuid
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_actor_user_id uuid;
begin
  v_actor_user_id:=public.require_current_approved_device(p_actor_device_id);
  if not platform_private.is_canonical_platform_owner(v_actor_user_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;

  return pg_catalog.jsonb_build_object('status','success','devices',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'targetUserId',device_authorization.user_id,
      'authorizationId',device_authorization.id,
      'deviceId',device_authorization.device_id,
      'deviceName',device.display_name,
      'platform',device.platform,
      'browser',device.browser,
      'authorizationStatus',device_authorization.status,
      'requestedAt',device_authorization.requested_at,
      'displayName',profile.display_name,
      'email',users.email
    ) order by device_authorization.requested_at,device_authorization.id)
    from platform.user_device_authorizations device_authorization
    join platform.devices device on device.id=device_authorization.device_id
    join platform.profiles profile on profile.user_id=device_authorization.user_id
    join auth.users users on users.id=device_authorization.user_id
    where device_authorization.status='pending'
      and device_authorization.revoked_at is null
      and device.lifecycle_status='active'
      and device.retired_at is null
      and device.compromised_at is null
      and profile.account_status='approved'
  ),'[]'::jsonb));
end;
$$;

revoke all on function public.list_system_owner_pending_device_authorizations_for_session(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.list_system_owner_pending_device_authorizations_for_session(uuid)
  to postgres;

-- Extend the single canonical dispatcher instead of adding another Edge or RPC
-- boundary.  Fail if its exact active definition has drifted.
do $$
declare
  v_oid oid:='platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_marker text:=$marker$    case p_operation
    when 'get_user_management_actor_capabilities' then$marker$;
  v_replacement text:=$replacement$    case p_operation
    when 'list_system_owner_pending_device_authorizations' then
      perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
      return public.list_system_owner_pending_device_authorizations_for_session(v_session.device_id);
    when 'get_user_management_actor_capabilities' then$replacement$;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'));
  select pg_catalog.pg_get_functiondef(v_oid) into v_definition;
  if pg_catalog.strpos(v_definition,'list_system_owner_pending_device_authorizations')>0 then
    raise exception 'CANONICAL_OWNER_PENDING_DEVICE_SESSION_READ_ALREADY_ROUTED' using errcode='55000';
  end if;
  if pg_catalog.strpos(v_definition,v_marker)=0 then
    raise exception 'CANONICAL_PLATFORM_DISPATCHER_SHAPE_DRIFT' using errcode='55000';
  end if;
  execute pg_catalog.replace(v_definition,v_marker,v_replacement);
end;
$$;

revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  to service_role;

-- Retire the former WebAuthn listing-session completion and read contracts.
-- Historical tables and audit rows remain intact.
revoke all on function public.complete_system_owner_pending_device_listing(
  uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.list_system_owner_pending_device_authorizations(
  uuid,uuid,uuid,text,bytea
) from public,anon,authenticated,service_role;

commit;
