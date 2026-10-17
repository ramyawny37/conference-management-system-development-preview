-- PostgreSQL wraps base64 output at 76 characters. Remove only CR/LF bytes;
-- the previous translate(..., E'\\\\n\\\\r', '') expression removed valid
-- base64 letters while leaving the line break in the encoded COSE key.
create or replace function public.get_system_owner_device_challenge_verification_material(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_challenge_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare challenge public.device_possession_challenges%rowtype;
  credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  select * into challenge from public.device_possession_challenges stored
  where stored.id=p_challenge_id and stored.user_id=p_actor_user_id
    and stored.actor_device_id=p_actor_device_id and stored.session_id=p_session_id;
  if not found or challenge.credential_id is null or challenge.verified_at is not null
    or challenge.consumed_at is not null or challenge.failed_at is not null
    or challenge.expires_at<=pg_catalog.statement_timestamp() then
    raise exception 'PLATFORM_DEVICE_CHALLENGE_NOT_VERIFIABLE' using errcode='42501';
  end if;
  credential:=public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,challenge.credential_id);
  return pg_catalog.jsonb_build_object('credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',pg_catalog.replace(pg_catalog.replace(
      pg_catalog.encode(credential.public_key_cose,'base64'),pg_catalog.chr(10),''),
      pg_catalog.chr(13),''),
    'signCount',credential.sign_count,'transports',credential.transports,
    'purpose',challenge.purpose,'targetUserId',challenge.target_user_id,
    'targetDeviceId',challenge.target_device_id,'operationId',challenge.operation_id,
    'environment',challenge.environment,'expectedOrigin',challenge.expected_origin,
    'expectedRpId',challenge.expected_rp_id);
end; $$;

revoke all on function public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid)
  to service_role;
