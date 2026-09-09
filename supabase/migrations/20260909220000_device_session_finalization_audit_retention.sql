create or replace function platform.complete_device_session(
  p_challenge_id uuid,p_user_id uuid,p_device_id uuid,p_authorization_id uuid,p_binding_id uuid,
  p_public_key_thumbprint text,p_session_id uuid,p_token_hash bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_challenge platform_private.device_session_challenges%rowtype; v_now timestamptz:=statement_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DEVICE_SESSION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_session_id is null or octet_length(p_token_hash)<>32 then raise exception 'DEVICE_SESSION_ARGUMENT_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('device-session:'||p_challenge_id::text,0));
  select * into v_challenge from platform_private.device_session_challenges where id=p_challenge_id for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.failed_at is not null or v_challenge.expires_at<=v_now
    or v_challenge.user_id<>p_user_id or v_challenge.device_id<>p_device_id
    or v_challenge.device_authorization_id<>p_authorization_id or v_challenge.binding_id<>p_binding_id
    or v_challenge.public_key_thumbprint<>p_public_key_thumbprint
    or v_challenge.purpose<>'PLATFORM_DEVICE_SESSION_ESTABLISH'
    or v_challenge.origin<>'https://ramyawny37.github.io' then raise exception 'DEVICE_SESSION_CHALLENGE_INVALID' using errcode='42501'; end if;
  if not exists(select 1 from platform.device_key_bindings binding
    join platform.user_device_authorizations uda on uda.id=binding.device_authorization_id
    join platform.devices device on device.id=binding.device_id join platform.profiles profile on profile.user_id=binding.user_id
    where binding.id=p_binding_id and binding.user_id=p_user_id and binding.device_id=p_device_id
      and binding.device_authorization_id=p_authorization_id and binding.public_key_thumbprint=p_public_key_thumbprint
      and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
      and uda.user_id=p_user_id and uda.device_id=p_device_id and uda.status='approved' and uda.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null and profile.account_status='approved')
    then raise exception 'DEVICE_SESSION_AUTHORITY_INVALID' using errcode='42501'; end if;
  insert into platform_private.device_sessions(id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,token_hash,purpose,created_at,expires_at,challenge_id)
  values(p_session_id,p_user_id,p_device_id,p_authorization_id,p_binding_id,p_public_key_thumbprint,p_token_hash,'PLATFORM_DEVICE_SESSION',v_now,v_now+interval '5 minutes',p_challenge_id);
  update platform_private.device_session_challenges set consumed_at=v_now,session_id=p_session_id where id=p_challenge_id;
  insert into platform_private.device_session_audit(event,session_id,challenge_id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,purpose)
  values('established',p_session_id,p_challenge_id,p_user_id,p_device_id,p_authorization_id,p_binding_id,p_public_key_thumbprint,'PLATFORM_DEVICE_SESSION');
  return jsonb_build_object('sessionId',p_session_id,'userId',p_user_id,'deviceId',p_device_id,'authorizationId',p_authorization_id,'bindingId',p_binding_id,'purpose','PLATFORM_DEVICE_SESSION','issuedAt',v_now,'expiresAt',v_now+interval '5 minutes');
end; $$;
