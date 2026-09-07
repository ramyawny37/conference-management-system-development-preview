create or replace function platform.get_device_session_challenge_context(p_challenge_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_challenge platform_private.device_session_challenges%rowtype; v_jwk jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'DEVICE_SESSION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  select challenge.* into v_challenge
  from platform_private.device_session_challenges challenge
  join platform.device_key_bindings binding on binding.id=challenge.binding_id
  join platform.user_device_authorizations device_authorization on device_authorization.id=challenge.device_authorization_id
  join platform.devices device on device.id=challenge.device_id
  join platform.profiles profile on profile.user_id=challenge.user_id
  where challenge.id=p_challenge_id and challenge.user_id=p_user_id
    and challenge.purpose='PLATFORM_DEVICE_SESSION_ESTABLISH'
    and challenge.origin='https://ramyawny37.github.io'
    and challenge.consumed_at is null and challenge.failed_at is null and challenge.expires_at>statement_timestamp()
    and binding.user_id=challenge.user_id and binding.device_id=challenge.device_id
    and binding.device_authorization_id=challenge.device_authorization_id
    and binding.public_key_thumbprint=challenge.public_key_thumbprint
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and binding.algorithm='ECDSA_P256_SHA256'
    and device_authorization.user_id=challenge.user_id and device_authorization.device_id=challenge.device_id
    and device_authorization.status='approved' and device_authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_CHALLENGE_INVALID' using errcode='42501'; end if;
  select binding.public_key_jwk into strict v_jwk
    from platform.device_key_bindings binding where binding.id=v_challenge.binding_id;
  return jsonb_build_object('challengeId',v_challenge.id,'userId',v_challenge.user_id,'deviceId',v_challenge.device_id,
    'authorizationId',v_challenge.device_authorization_id,'bindingId',v_challenge.binding_id,
    'publicKeyThumbprint',v_challenge.public_key_thumbprint,'purpose',v_challenge.purpose,'origin',v_challenge.origin,
    'issuedAt',v_challenge.issued_at,'expiresAt',v_challenge.expires_at,'signingPayload',v_challenge.signing_payload,
    'publicKeyJwk',v_jwk);
end;
$$;
