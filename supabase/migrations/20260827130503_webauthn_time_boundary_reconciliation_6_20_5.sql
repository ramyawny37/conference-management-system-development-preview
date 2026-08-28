begin;

CREATE OR REPLACE FUNCTION public.begin_system_owner_device_possession_challenge(p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid, p_session_id uuid, p_purpose text, p_target_user_id uuid, p_target_device_id uuid, p_operation_id uuid, p_environment text, p_expected_origin text, p_expected_rp_id text, p_challenge_hash bytea)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare credential public.device_security_credentials%rowtype; challenge_id uuid;
  existing public.system_owner_device_authorization_operations%rowtype;
begin
  credential:=public.require_system_owner_webauthn_actor(p_actor_user_id,p_actor_device_id,p_credential_id);
  if p_session_id is null or octet_length(p_challenge_hash)<>32
    or p_purpose not in ('SYSTEM_OWNER_PENDING_DEVICE_LIST','SYSTEM_OWNER_PENDING_DEVICE_APPROVE',
      'SYSTEM_OWNER_PENDING_DEVICE_REJECT') then
    raise exception 'PLATFORM_DEVICE_CHALLENGE_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if p_purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST' then
    if p_target_user_id is not null or p_target_device_id is not null or p_operation_id is not null then
      raise exception 'PLATFORM_DEVICE_LIST_CHALLENGE_BINDING_INVALID' using errcode='22023'; end if;
  else
    if p_target_user_id is null or p_target_device_id is null or p_operation_id is null then
      raise exception 'PLATFORM_DEVICE_MUTATION_CHALLENGE_BINDING_INVALID' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('system-owner-device-operation:'||p_operation_id::text,0));
    select * into existing from public.system_owner_device_authorization_operations operations
      where operations.operation_id=p_operation_id;
    if found then
      if existing.actor_user_id_snapshot=p_actor_user_id and existing.actor_device_id=p_actor_device_id
        and existing.target_user_id_snapshot=p_target_user_id
        and existing.target_device_id=p_target_device_id and existing.environment=p_environment
        and existing.action=(case p_purpose when 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
          then 'approve_system_owner_pending_device' else 'reject_system_owner_pending_device' end) then
        return jsonb_build_object('status','completed','result',existing.stored_result);
      end if;
      raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
    end if;
    if not exists(select 1 from public.user_device_authorizations uda
      join public.devices devices on devices.id=uda.device_id and devices.user_id=uda.user_id
      join public.system_user_access access on access.user_id=uda.user_id
      where uda.user_id=p_target_user_id and uda.device_id=p_target_device_id
        and uda.authorization_status='pending' and uda.revoked_at is null
        and access.account_status='approved') then
      raise exception 'PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED' using errcode='42501';
    end if;
  end if;
  insert into public.device_possession_challenges(challenge_hash,user_id,session_id,actor_device_id,
    credential_id,purpose,target_user_id,target_device_id,operation_id,expected_origin,
    expected_rp_id,environment,expires_at)
  values(p_challenge_hash,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,p_purpose,
    p_target_user_id,p_target_device_id,p_operation_id,lower(p_expected_origin),lower(p_expected_rp_id),
    p_environment,now()+interval '2 minutes') returning id into challenge_id;
  return jsonb_build_object('status','challenge_created','challengeId',challenge_id,
    'credentialId',credential.id,'credentialExternalId',encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',encode(credential.public_key_cose,'base64'),'signCount',credential.sign_count,
    'transports',credential.transports,'operationId',p_operation_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_system_owner_pending_device_listing(p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid, p_session_id uuid, p_environment text, p_challenge_id uuid, p_challenge_hash bytea, p_listing_id uuid, p_listing_token_hash bytea, p_new_sign_count bigint, p_origin text, p_rp_id text, p_verification_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare credential public.device_security_credentials%rowtype;
  challenge public.device_possession_challenges%rowtype;
begin
  credential:=public.require_system_owner_webauthn_actor(p_actor_user_id,p_actor_device_id,p_credential_id);
  select * into challenge from public.device_possession_challenges challenges
    where challenges.id=p_challenge_id and challenges.user_id=p_actor_user_id
      and challenges.session_id=p_session_id and challenges.actor_device_id=p_actor_device_id
      and challenges.credential_id=p_credential_id
      and challenges.purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
      and challenges.environment=p_environment and challenges.challenge_hash=p_challenge_hash for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=statement_timestamp()
    or challenge.expected_origin<>lower(p_origin) or challenge.expected_rp_id<>lower(p_rp_id)
    or p_new_sign_count<credential.sign_count or octet_length(p_listing_token_hash)<>32
    or p_verification_context->'userVerified' is distinct from 'true'::jsonb
    or jsonb_typeof(p_verification_context->'backupEligible') is distinct from 'boolean'
    or jsonb_typeof(p_verification_context->'backupState') is distinct from 'boolean'
    or (p_verification_context->'backupState'='true'::jsonb
      and p_verification_context->'backupEligible'='false'::jsonb) then
    raise exception 'PLATFORM_DEVICE_LIST_VERIFICATION_INVALID' using errcode='42501';
  end if;
  update public.device_possession_challenges set verified_at=statement_timestamp(),
    verification_context=p_verification_context where id=p_challenge_id;
  update public.device_security_credentials set sign_count=p_new_sign_count,last_used_at=statement_timestamp()
    where id=p_credential_id;
  insert into public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  values(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'listing_session',p_listing_id);
  insert into public.privileged_device_listing_sessions(id,opaque_token_hash,user_id,session_id,
    actor_device_id,credential_id,source_challenge_id,environment,scope,expires_at)
  values(p_listing_id,p_listing_token_hash,p_actor_user_id,p_session_id,p_actor_device_id,
    p_credential_id,p_challenge_id,p_environment,'SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY',
    now()+interval '5 minutes');
  insert into public.privileged_device_authorization_audit_log(actor_user_id,actor_user_id_snapshot,
    actor_device_id,actor_credential_id,session_id_hash,session_id,challenge_id,challenge_purpose,
    environment,action,result,origin,rp_id,user_verified,backup_eligible,backup_state,security_context)
  values(p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'pending_device_listed','verified',
    lower(p_origin),lower(p_rp_id),true,
    (p_verification_context->>'backupEligible')::boolean,
    (p_verification_context->>'backupState')::boolean,p_verification_context);
  update public.device_possession_challenges set consumed_at=statement_timestamp() where id=p_challenge_id;
  return jsonb_build_object('status','listed','listingId',p_listing_id,'expiresInSeconds',300);
end;
$function$;

commit;

