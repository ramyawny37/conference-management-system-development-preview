begin;

-- Permit both synced and non-synced system-owner passkeys while preserving
-- mandatory user verification and the existing credential lifecycle.
create or replace function public.complete_system_owner_credential_enrollment(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_environment text,
  p_challenge_id uuid,p_challenge_hash bytea,p_operation_id uuid,
  p_bootstrap_authorization_id uuid,p_credential_id bytea,p_public_key_cose bytea,
  p_public_key_algorithm integer,p_aaguid uuid,p_transports text[],p_sign_count bigint,
  p_origin text,p_rp_id text,p_verification_context jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare challenge public.device_possession_challenges%rowtype; credential_id uuid;
  audit_id uuid;
begin
  perform public.require_platform_device_backend();
  perform pg_advisory_xact_lock(hashtextextended('credential-enrollment:'||p_operation_id::text,0));
  select * into challenge from public.device_possession_challenges challenges
    where challenges.id=p_challenge_id and challenges.user_id=p_actor_user_id
      and challenges.session_id=p_session_id and challenges.actor_device_id=p_actor_device_id
      and challenges.credential_id is null
      and challenges.purpose='SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'
      and challenges.operation_id=p_operation_id and challenges.environment=p_environment
      and challenges.challenge_hash=p_challenge_hash
    for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=statement_timestamp()
    or challenge.expected_origin<>lower(p_origin) or challenge.expected_rp_id<>lower(p_rp_id)
    or coalesce((p_verification_context->>'userVerified')::boolean,false)<>true
    or jsonb_typeof(p_verification_context->'backupEligible') is distinct from 'boolean'
    or jsonb_typeof(p_verification_context->'backupState') is distinct from 'boolean' then
    raise exception 'CREDENTIAL_ENROLLMENT_VERIFICATION_INVALID' using errcode='42501';
  end if;
  if not exists(select 1 from public.system_owner_credential_bootstrap_authorizations bootstrap
    where bootstrap.id=p_bootstrap_authorization_id
      and bootstrap.intended_user_id=p_actor_user_id
      and bootstrap.intended_device_id=p_actor_device_id
      and bootstrap.environment=p_environment and bootstrap.consumed_at is null
      and statement_timestamp() between bootstrap.issued_at and bootstrap.expires_at) then
    raise exception 'CREDENTIAL_BOOTSTRAP_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  update public.device_possession_challenges set verified_at=statement_timestamp(),
    verification_context=p_verification_context where id=p_challenge_id;
  insert into public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  values(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,null,
    'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT',p_environment,'credential_enrollment',p_operation_id);
  insert into public.device_security_credentials(webauthn_credential_id,user_id,device_id,
    credential_kind,public_key_cose,public_key_algorithm,aaguid,transports,sign_count,
    backup_eligible,backup_state,user_verification_policy,lifecycle_status)
  values(p_credential_id,p_actor_user_id,p_actor_device_id,'platform_primary',p_public_key_cose,
    p_public_key_algorithm,p_aaguid,coalesce(p_transports,'{}'::text[]),p_sign_count,
    (p_verification_context->>'backupEligible')::boolean,
    (p_verification_context->>'backupState')::boolean,
    'required','enrollment_pending') returning id into credential_id;
  update public.device_security_credentials set lifecycle_status='active',enrolled_at=statement_timestamp(),
    activated_at=statement_timestamp(),last_used_at=statement_timestamp() where id=credential_id;
  insert into public.privileged_device_authorization_audit_log(actor_user_id,
    actor_user_id_snapshot,actor_device_id,actor_credential_id,session_id_hash,session_id,
    challenge_id,challenge_purpose,environment,target_user_id,target_user_id_snapshot,
    target_device_id,action,operation_id,result,origin,rp_id,user_verified,
    backup_eligible,backup_state,security_context)
  values(p_actor_user_id,p_actor_user_id,p_actor_device_id,null,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,
    'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT',p_environment,p_actor_user_id,p_actor_user_id,
    p_actor_device_id,'credential_enrolled',p_operation_id,'applied',lower(p_origin),lower(p_rp_id),
    true,(p_verification_context->>'backupEligible')::boolean,
    (p_verification_context->>'backupState')::boolean,p_verification_context) returning id into audit_id;
  update public.system_owner_credential_bootstrap_authorizations set consumed_at=consumed_at
    where id=p_bootstrap_authorization_id;
  update public.device_possession_challenges set consumed_at=statement_timestamp()
    where id=p_challenge_id;
  return jsonb_build_object('status','applied','credentialId',credential_id,'auditId',audit_id);
end;
$$;

commit;
