begin;

do $$
begin
  if to_regprocedure('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)') is null
     or to_regprocedure('reservations.mutate(uuid,text,jsonb)') is null then
    raise exception 'RESERVATIONS_DISPATCHER_FOUNDATION_REQUIRED' using errcode='55000';
  end if;
end;
$$;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  rename to execute_device_operation_pre_reservations;

create function platform.execute_device_operation(
  p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,platform,platform_private,reservations,reservations_private as $$
declare v_session platform_private.device_sessions%rowtype;
begin
  if p_module<>'reservations' then
    return platform.execute_device_operation_pre_reservations(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args);
  end if;
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_args is null or jsonb_typeof(p_args)<>'object' or p_args?'p_device_id' or p_args?'p_actor_device_id' or p_args?'p_actor_user_id' then
    raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  select item.* into v_session
  from platform_private.device_sessions item
  join platform.device_key_bindings binding on binding.id=item.binding_id
  join platform.user_device_authorizations uda on uda.id=item.device_authorization_id
  join platform.devices device on device.id=item.device_id
  join platform.profiles profile on profile.user_id=item.user_id
  where item.id=p_session_id and item.user_id=p_user_id and item.token_hash=p_token_hash
    and item.purpose='PLATFORM_DEVICE_SESSION' and item.revoked_at is null and item.expires_at>statement_timestamp()
    and binding.user_id=item.user_id and binding.device_id=item.device_id and binding.device_authorization_id=item.device_authorization_id
    and binding.public_key_thumbprint=item.public_key_thumbprint and binding.algorithm='ECDSA_P256_SHA256'
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and uda.user_id=item.user_id and uda.device_id=item.device_id and uda.status='approved' and uda.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,'user_id',v_session.user_id,
    'device_id',v_session.device_id,'authorization_id',v_session.device_authorization_id,
    'binding_id',v_session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);

  case p_operation
    when 'list_reservations' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_status','p_from','p_to','p_before_arrival','p_before_id','p_limit']);
      return reservations.list_reservations(v_session.device_id,(p_args->>'p_organization_id')::uuid,p_args->>'p_status',(p_args->>'p_from')::date,(p_args->>'p_to')::date,(p_args->>'p_before_arrival')::date,(p_args->>'p_before_id')::uuid,(p_args->>'p_limit')::integer);
    when 'get_reservation' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_reservation_id']);
      return reservations.get_reservation(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_reservation_id')::uuid);
    when 'search_reservation_guests' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_query','p_before_name','p_before_id','p_limit']);
      return reservations.search_reservation_guests(v_session.device_id,(p_args->>'p_organization_id')::uuid,p_args->>'p_query',p_args->>'p_before_name',(p_args->>'p_before_id')::uuid,(p_args->>'p_limit')::integer);
    when 'list_assignable_resources' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_from','p_to','p_adults','p_children','p_limit']);
      return reservations.list_assignable_resources(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_from')::date,(p_args->>'p_to')::date,(p_args->>'p_adults')::integer,(p_args->>'p_children')::integer,(p_args->>'p_limit')::integer);
    when 'get_reservation_history' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_reservation_id','p_before','p_limit']);
      return reservations.get_reservation_history(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_reservation_id')::uuid,(p_args->>'p_before')::timestamptz,(p_args->>'p_limit')::integer);
    when 'create_reservation' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_arrival_date','p_departure_date','p_adults','p_children','p_notes','p_currency_code','p_total_amount'],array['p_guest_id','p_guest']);
    when 'update_reservation' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_reservation_id','p_expected_revision','p_guest_id','p_arrival_date','p_departure_date','p_adults','p_children','p_notes','p_currency_code','p_total_amount']);
    when 'confirm_reservation','check_in_reservation','check_out_reservation' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_reservation_id','p_expected_revision']);
    when 'cancel_reservation' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_reservation_id','p_expected_revision','p_reason']);
    when 'assign_reservation' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_reservation_id','p_expected_revision','p_resource_id']);
    else raise exception 'RESERVATIONS_OPERATION_NOT_ALLOWED' using errcode='42501';
  end case;
  return reservations.mutate(v_session.device_id,p_operation,p_args);
end;
$$;

revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations(uuid,uuid,bytea,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb),
  platform.execute_device_operation_pre_reservations(uuid,uuid,bytea,text,text,jsonb)
  to service_role;

commit;
