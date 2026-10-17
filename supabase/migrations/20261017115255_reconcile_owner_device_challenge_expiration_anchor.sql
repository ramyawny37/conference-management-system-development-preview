-- Anchor both challenge timestamps to the same instant. The table's expiration
-- constraint permits at most two minutes from created_at; mixing now() (the
-- transaction timestamp) with statement_timestamp() can exceed that boundary.
create or replace function public.begin_system_owner_device_possession_challenge(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_purpose text,p_target_user_id uuid,p_target_device_id uuid,p_operation_id uuid,
  p_environment text,p_expected_origin text,p_expected_rp_id text,p_challenge_hash bytea
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype; challenge_id uuid;
  existing public.system_owner_device_authorization_operations%rowtype;
  challenge_created_at timestamptz:=pg_catalog.statement_timestamp();
begin
  credential:=public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,p_credential_id);
  if p_session_id is null or pg_catalog.octet_length(p_challenge_hash)<>32
    or p_purpose not in ('SYSTEM_OWNER_PENDING_DEVICE_LIST',
      'SYSTEM_OWNER_PENDING_DEVICE_APPROVE','SYSTEM_OWNER_PENDING_DEVICE_REJECT') then
    raise exception 'PLATFORM_DEVICE_CHALLENGE_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if p_purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST' then
    if p_target_user_id is not null or p_target_device_id is not null
      or p_operation_id is not null then
      raise exception 'PLATFORM_DEVICE_LIST_CHALLENGE_BINDING_INVALID' using errcode='22023';
    end if;
  else
    if p_target_user_id is null or p_target_device_id is null or p_operation_id is null then
      raise exception 'PLATFORM_DEVICE_MUTATION_CHALLENGE_BINDING_INVALID' using errcode='22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'system-owner-device-operation:'||p_operation_id::text,0));
    select * into existing from public.system_owner_device_authorization_operations operation
    where operation.operation_id=p_operation_id;
    if found then
      if existing.actor_user_id_snapshot=p_actor_user_id
        and existing.actor_device_id=p_actor_device_id
        and existing.target_user_id_snapshot=p_target_user_id
        and existing.target_device_id=p_target_device_id
        and existing.environment=p_environment
        and existing.action=(case p_purpose when 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
          then 'approve_system_owner_pending_device' else 'reject_system_owner_pending_device' end) then
        return pg_catalog.jsonb_build_object('status','completed','result',existing.stored_result);
      end if;
      raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
    end if;
    if not exists(select 1 from platform.user_device_authorizations device_authorization
      join platform.devices device on device.id=device_authorization.device_id
      join platform.profiles profile on profile.user_id=device_authorization.user_id
      where device_authorization.user_id=p_target_user_id
        and device_authorization.device_id=p_target_device_id
        and device_authorization.status='pending' and device_authorization.revoked_at is null
        and device.lifecycle_status='active' and device.retired_at is null
        and device.compromised_at is null and profile.account_status='approved'
        and exists(select 1 from platform.device_key_bindings binding
          where binding.user_id=device_authorization.user_id
            and binding.device_id=device_authorization.device_id
            and binding.device_authorization_id=device_authorization.id
            and binding.lifecycle_status='active' and binding.revoked_at is null
            and binding.retired_at is null)) then
      raise exception 'PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED' using errcode='42501';
    end if;
  end if;
  insert into public.device_possession_challenges(challenge_hash,user_id,session_id,
    actor_device_id,credential_id,purpose,target_user_id,target_device_id,operation_id,
    expected_origin,expected_rp_id,environment,created_at,expires_at)
  values(p_challenge_hash,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    p_purpose,p_target_user_id,p_target_device_id,p_operation_id,
    pg_catalog.lower(p_expected_origin),pg_catalog.lower(p_expected_rp_id),p_environment,
    challenge_created_at,challenge_created_at+interval '2 minutes') returning id into challenge_id;
  return pg_catalog.jsonb_build_object('status','challenge_created','challengeId',challenge_id,
    'credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',pg_catalog.encode(credential.public_key_cose,'base64'),
    'signCount',credential.sign_count,'transports',credential.transports,
    'operationId',p_operation_id);
end; $$;

revoke all on function public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea)
  from public,anon,authenticated;
grant execute on function public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea)
  to service_role;
