begin;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  rename to execute_device_operation_pre_module_entry_access_gate;

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
set search_path='pg_catalog','public','platform','platform_private'
as $$
declare
  verified_session platform_private.device_sessions%rowtype;
begin
  if p_module not in ('warehouse','reservations') or p_operation<>'check_module_access' then
    return platform.execute_device_operation_pre_module_entry_access_gate(
      p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args
    );
  end if;

  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  if p_args is null or jsonb_typeof(p_args)<>'object'
     or p_args ?| array['device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id'] then
    raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);

  select session.* into verified_session
  from platform_private.device_sessions session
  join platform.device_key_bindings binding on binding.id=session.binding_id
  join platform.user_device_authorizations authorization on authorization.id=session.device_authorization_id
  join platform.devices device on device.id=session.device_id
  join platform.profiles profile on profile.user_id=session.user_id
  where session.id=p_session_id and session.user_id=p_user_id and session.token_hash=p_token_hash
    and session.purpose='PLATFORM_DEVICE_SESSION' and session.revoked_at is null and session.expires_at>statement_timestamp()
    and binding.user_id=session.user_id and binding.device_id=session.device_id and binding.device_authorization_id=session.device_authorization_id
    and binding.public_key_thumbprint=session.public_key_thumbprint and binding.algorithm='ECDSA_P256_SHA256'
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and authorization.user_id=session.user_id and authorization.device_id=session.device_id
    and authorization.status='approved' and authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then
    raise exception 'DEVICE_SESSION_INVALID' using errcode='42501';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',verified_session.id,
    'user_id',verified_session.user_id,'device_id',verified_session.device_id,
    'authorization_id',verified_session.device_authorization_id,'binding_id',verified_session.binding_id,
    'token_hash',encode(p_token_hash,'hex')
  )::text,true);

  perform public.require_module_permission(verified_session.device_id,p_module,'module.access',null,null);
  return jsonb_build_object('status','allowed','moduleKey',p_module);
end;
$$;

revoke all on function platform.execute_device_operation_pre_module_entry_access_gate(uuid,uuid,bytea,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation_pre_module_entry_access_gate(uuid,uuid,bytea,text,text,jsonb)
  to postgres;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  to service_role;

commit;
