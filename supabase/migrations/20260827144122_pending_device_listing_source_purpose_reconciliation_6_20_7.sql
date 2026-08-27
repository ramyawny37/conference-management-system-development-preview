BEGIN;

CREATE OR REPLACE FUNCTION public.complete_system_owner_pending_device_listing(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_environment text,p_challenge_id uuid,p_challenge_hash bytea,p_listing_id uuid,
  p_listing_token_hash bytea,p_new_sign_count bigint,p_origin text,p_rp_id text,
  p_verification_context jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog, public AS $$
DECLARE credential public.device_security_credentials%rowtype;
  challenge public.device_possession_challenges%rowtype;
BEGIN
  credential:=public.require_system_owner_webauthn_actor(p_actor_user_id,p_actor_device_id,p_credential_id);
  SELECT * INTO challenge FROM public.device_possession_challenges challenges
    WHERE challenges.id=p_challenge_id AND challenges.user_id=p_actor_user_id
      AND challenges.session_id=p_session_id AND challenges.actor_device_id=p_actor_device_id
      AND challenges.credential_id=p_credential_id
      AND challenges.purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
      AND challenges.environment=p_environment AND challenges.challenge_hash=p_challenge_hash FOR UPDATE;
  IF NOT FOUND OR challenge.verified_at IS NOT NULL OR challenge.consumed_at IS NOT NULL
    OR challenge.failed_at IS NOT NULL OR challenge.expires_at<=statement_timestamp()
    OR challenge.expected_origin<>lower(p_origin) OR challenge.expected_rp_id<>lower(p_rp_id)
    OR p_new_sign_count<credential.sign_count OR octet_length(p_listing_token_hash)<>32
    OR p_verification_context->'userVerified' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(p_verification_context->'backupEligible') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_verification_context->'backupState') IS DISTINCT FROM 'boolean'
    OR (p_verification_context->'backupState'='true'::jsonb
      AND p_verification_context->'backupEligible'='false'::jsonb) THEN
    RAISE EXCEPTION 'PLATFORM_DEVICE_LIST_VERIFICATION_INVALID' USING errcode='42501';
  END IF;
  UPDATE public.device_possession_challenges SET verified_at=statement_timestamp(),
    verification_context=p_verification_context WHERE id=p_challenge_id;
  UPDATE public.device_security_credentials SET sign_count=p_new_sign_count,last_used_at=statement_timestamp()
    WHERE id=p_credential_id;
  INSERT INTO public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  VALUES(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'listing_session',p_listing_id);
  INSERT INTO public.privileged_device_listing_sessions(id,opaque_token_hash,user_id,session_id,
    actor_device_id,credential_id,source_challenge_id,source_challenge_purpose,environment,scope,expires_at)
  VALUES(p_listing_id,p_listing_token_hash,p_actor_user_id,p_session_id,p_actor_device_id,
    p_credential_id,p_challenge_id,challenge.purpose,p_environment,'SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY',
    now()+interval '5 minutes');
  INSERT INTO public.privileged_device_authorization_audit_log(actor_user_id,actor_user_id_snapshot,
    actor_device_id,actor_credential_id,session_id_hash,session_id,challenge_id,challenge_purpose,
    environment,action,result,origin,rp_id,user_verified,backup_eligible,backup_state,security_context)
  VALUES(p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'pending_device_listed','verified',
    lower(p_origin),lower(p_rp_id),true,
    (p_verification_context->>'backupEligible')::boolean,
    (p_verification_context->>'backupState')::boolean,p_verification_context);
  UPDATE public.device_possession_challenges SET consumed_at=statement_timestamp() WHERE id=p_challenge_id;
  RETURN jsonb_build_object('status','listed','listingId',p_listing_id,'expiresInSeconds',300);
END;
$$;

COMMIT;
