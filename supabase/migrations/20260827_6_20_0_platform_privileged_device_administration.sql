begin;

-- Platform-level System Owner device administration. WebAuthn assertions are
-- verified by the trusted Edge Function; these functions are service-role only.
alter table public.webauthn_privileged_device_feature
  drop constraint if exists webauthn_privileged_device_feature_enabled_check;

create or replace function public.require_platform_device_backend()
returns void language plpgsql stable security definer
set search_path=pg_catalog, public as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'PLATFORM_DEVICE_BACKEND_REQUIRED' using errcode='42501';
  end if;
end;
$$;

create or replace function public.require_system_owner_webauthn_actor(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid
) returns public.device_security_credentials
language plpgsql security definer
set search_path=pg_catalog, public as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if p_actor_user_id is null or p_actor_device_id is null or p_credential_id is null then
    raise exception 'PLATFORM_DEVICE_ACTOR_CONTEXT_REQUIRED' using errcode='22023';
  end if;
  if not exists(select 1 from public.system_user_access access
    where access.user_id=p_actor_user_id and access.account_status='approved')
    or not public.is_system_owner(p_actor_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  if not exists(select 1 from public.user_device_authorizations uda
    where uda.user_id=p_actor_user_id and uda.device_id=p_actor_device_id
      and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'APPROVED_ACTOR_DEVICE_REQUIRED' using errcode='42501';
  end if;
  select * into credential from public.device_security_credentials credentials
    where credentials.id=p_credential_id and credentials.user_id=p_actor_user_id
      and credentials.device_id=p_actor_device_id
      and credentials.credential_kind='platform_primary'
      and credentials.lifecycle_status='active'
      and credentials.backup_eligible=false and credentials.backup_state=false
      and credentials.user_verification_policy='required'
    for update;
  if not found then raise exception 'ACTIVE_PLATFORM_CREDENTIAL_REQUIRED' using errcode='42501'; end if;
  return credential;
end;
$$;

create or replace function public.begin_system_owner_credential_enrollment(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,
  p_environment text,p_expected_origin text,p_expected_rp_id text,
  p_challenge_hash bytea,p_operation_id uuid,p_bootstrap_hash bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare bootstrap_authorization public.system_owner_credential_bootstrap_authorizations%rowtype;
  challenge_id uuid;
begin
  perform public.require_platform_device_backend();
  if p_session_id is null or p_operation_id is null or octet_length(p_challenge_hash)<>32
    or octet_length(p_bootstrap_hash)<>32 then
    raise exception 'CREDENTIAL_ENROLLMENT_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if not exists(select 1 from public.system_user_access access where access.user_id=p_actor_user_id
      and access.account_status='approved') or not public.is_system_owner(p_actor_user_id)
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_actor_user_id and uda.device_id=p_actor_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  select * into bootstrap_authorization from public.system_owner_credential_bootstrap_authorizations bootstrap
    where bootstrap.authorization_hash=p_bootstrap_hash
      and bootstrap.intended_user_id=p_actor_user_id
      and bootstrap.intended_device_id=p_actor_device_id
      and bootstrap.environment=p_environment and bootstrap.consumed_at is null
      and statement_timestamp() between bootstrap.issued_at and bootstrap.expires_at
    for update;
  if not found then raise exception 'CREDENTIAL_BOOTSTRAP_AUTHORIZATION_INVALID' using errcode='42501'; end if;
  insert into public.device_possession_challenges(challenge_hash,user_id,session_id,
    actor_device_id,credential_id,purpose,operation_id,expected_origin,expected_rp_id,
    environment,expires_at)
  values(p_challenge_hash,p_actor_user_id,p_session_id,p_actor_device_id,null,
    'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT',p_operation_id,lower(p_expected_origin),
    lower(p_expected_rp_id),p_environment,statement_timestamp()+interval '2 minutes')
  returning id into challenge_id;
  return jsonb_build_object('status','challenge_created','challengeId',challenge_id,
    'bootstrapAuthorizationId',bootstrap_authorization.id,'operationId',p_operation_id);
end;
$$;

create or replace function public.issue_system_owner_credential_bootstrap_authorization(
  p_operator_user_id uuid,p_operator_device_id uuid,p_intended_user_id uuid,
  p_intended_device_id uuid,p_environment text,p_authorization_hash bytea,
  p_origin text,p_rp_id text,p_reason text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare audit_id uuid; authorization_id uuid;
begin
  perform public.require_platform_device_backend();
  if octet_length(p_authorization_hash)<>32 or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'CREDENTIAL_BOOTSTRAP_ISSUANCE_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if not public.is_system_owner(p_operator_user_id)
    or not exists(select 1 from public.system_user_access access where access.user_id=p_operator_user_id
      and access.account_status='approved')
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_operator_user_id and uda.device_id=p_operator_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null)
    or not public.is_system_owner(p_intended_user_id)
    or not exists(select 1 from public.system_user_access access where access.user_id=p_intended_user_id
      and access.account_status='approved')
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_intended_user_id and uda.device_id=p_intended_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'CREDENTIAL_BOOTSTRAP_APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  insert into public.privileged_device_authorization_audit_log(actor_user_id,actor_user_id_snapshot,
    actor_device_id,actor_credential_id,session_id_hash,session_id,challenge_id,challenge_purpose,
    environment,target_user_id,target_user_id_snapshot,target_device_id,action,operation_id,result,
    origin,rp_id,user_verified,backup_eligible,backup_state,security_context)
  values(p_operator_user_id,p_operator_user_id,p_operator_device_id,null,
    extensions.digest('bootstrap-issuance:'||p_authorization_hash::text,'sha256'),null,null,null,p_environment,
    p_intended_user_id,p_intended_user_id,p_intended_device_id,
    'credential_bootstrap_authorization_issued',null,'issued',lower(p_origin),lower(p_rp_id),
    false,false,false,jsonb_build_object('reason',btrim(p_reason))) returning id into audit_id;
  insert into public.system_owner_credential_bootstrap_authorizations(authorization_hash,
    intended_user_id,intended_device_id,environment,intended_device_authorization_status,
    intended_device_revoked_at,intended_user_system_owner,expires_at,operator_user_id,reason,issuance_audit_id)
  values(p_authorization_hash,p_intended_user_id,p_intended_device_id,p_environment,'approved',null,true,
    statement_timestamp()+interval '10 minutes',p_operator_user_id,btrim(p_reason),audit_id)
  returning id into authorization_id;
  return jsonb_build_object('status','issued','authorizationId',authorization_id,
    'expiresInSeconds',600,'auditId',audit_id);
end;
$$;

create or replace function public.get_system_owner_platform_device_administration_state(
  p_actor_user_id uuid,p_actor_device_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if not exists(select 1 from public.system_user_access access where access.user_id=p_actor_user_id
      and access.account_status='approved') or not public.is_system_owner(p_actor_user_id)
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_actor_user_id and uda.device_id=p_actor_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  select * into credential from public.device_security_credentials credentials
    where credentials.user_id=p_actor_user_id and credentials.device_id=p_actor_device_id
      and credentials.credential_kind='platform_primary' and credentials.lifecycle_status='active'
      and credentials.backup_eligible=false and credentials.backup_state=false
    order by credentials.activated_at desc limit 1;
  if not found then return jsonb_build_object('status','enrollment_required'); end if;
  return jsonb_build_object('status','ready','credentialId',credential.id,
    'credentialExternalId',encode(credential.webauthn_credential_id,'base64'),
    'transports',credential.transports);
end;
$$;

create or replace function public.complete_system_owner_credential_enrollment(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_environment text,
  p_challenge_id uuid,p_challenge_hash bytea,p_operation_id uuid,p_bootstrap_authorization_id uuid,
  p_credential_id bytea,p_public_key_cose bytea,p_public_key_algorithm integer,
  p_aaguid uuid,p_transports text[],p_sign_count bigint,p_origin text,p_rp_id text,
  p_verification_context jsonb
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
    or coalesce((p_verification_context->>'backupEligible')::boolean,true)<>false
    or coalesce((p_verification_context->>'backupState')::boolean,true)<>false then
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
    p_public_key_algorithm,p_aaguid,coalesce(p_transports,'{}'::text[]),p_sign_count,false,false,
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
    true,false,false,p_verification_context) returning id into audit_id;
  update public.system_owner_credential_bootstrap_authorizations set consumed_at=consumed_at
    where id=p_bootstrap_authorization_id;
  update public.device_possession_challenges set consumed_at=statement_timestamp()
    where id=p_challenge_id;
  return jsonb_build_object('status','applied','credentialId',credential_id,'auditId',audit_id);
end;
$$;

create or replace function public.begin_system_owner_device_possession_challenge(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_purpose text,p_target_user_id uuid,p_target_device_id uuid,p_operation_id uuid,
  p_environment text,p_expected_origin text,p_expected_rp_id text,p_challenge_hash bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
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
        and existing.action=case p_purpose when 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
          then 'approve_system_owner_pending_device' else 'reject_system_owner_pending_device' end then
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
    p_environment,statement_timestamp()+interval '2 minutes') returning id into challenge_id;
  return jsonb_build_object('status','challenge_created','challengeId',challenge_id,
    'credentialId',credential.id,'credentialExternalId',encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',encode(credential.public_key_cose,'base64'),'signCount',credential.sign_count,
    'transports',credential.transports,'operationId',p_operation_id);
end;
$$;

create or replace function public.complete_system_owner_pending_device_listing(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_environment text,p_challenge_id uuid,p_challenge_hash bytea,p_listing_id uuid,p_listing_token_hash bytea,
  p_new_sign_count bigint,p_origin text,p_rp_id text,p_verification_context jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
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
    or coalesce((p_verification_context->>'userVerified')::boolean,false)<>true
    or coalesce((p_verification_context->>'backupEligible')::boolean,true)<>false
    or coalesce((p_verification_context->>'backupState')::boolean,true)<>false then
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
    statement_timestamp()+interval '5 minutes');
  insert into public.privileged_device_authorization_audit_log(actor_user_id,actor_user_id_snapshot,
    actor_device_id,actor_credential_id,session_id_hash,session_id,challenge_id,challenge_purpose,
    environment,action,result,origin,rp_id,user_verified,backup_eligible,backup_state,security_context)
  values(p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'pending_device_listed','verified',
    lower(p_origin),lower(p_rp_id),true,false,false,p_verification_context);
  update public.device_possession_challenges set consumed_at=statement_timestamp() where id=p_challenge_id;
  return jsonb_build_object('status','listed','listingId',p_listing_id,'expiresInSeconds',300);
end;
$$;

create or replace function public.get_system_owner_device_challenge_verification_material(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_challenge_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare challenge public.device_possession_challenges%rowtype;
  credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  select * into challenge from public.device_possession_challenges challenges
    where challenges.id=p_challenge_id and challenges.user_id=p_actor_user_id
      and challenges.actor_device_id=p_actor_device_id and challenges.session_id=p_session_id;
  if not found or challenge.credential_id is null or challenge.verified_at is not null
    or challenge.consumed_at is not null or challenge.failed_at is not null
    or challenge.expires_at<=statement_timestamp() then
    raise exception 'PLATFORM_DEVICE_CHALLENGE_NOT_VERIFIABLE' using errcode='42501';
  end if;
  credential:=public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,challenge.credential_id);
  return jsonb_build_object('credentialId',credential.id,
    'credentialExternalId',encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',encode(credential.public_key_cose,'base64'),
    'signCount',credential.sign_count,'transports',credential.transports,
    'purpose',challenge.purpose,'targetUserId',challenge.target_user_id,
    'targetDeviceId',challenge.target_device_id,'operationId',challenge.operation_id,
    'environment',challenge.environment,'expectedOrigin',challenge.expected_origin,
    'expectedRpId',challenge.expected_rp_id);
end;
$$;

create or replace function public.fail_system_owner_device_possession_challenge(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_challenge_id uuid,
  p_failure_code text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare challenge public.device_possession_challenges%rowtype;
begin
  perform public.require_platform_device_backend();
  select * into challenge from public.device_possession_challenges challenges
    where challenges.id=p_challenge_id and challenges.user_id=p_actor_user_id
      and challenges.actor_device_id=p_actor_device_id and challenges.session_id=p_session_id
    for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null then
    raise exception 'PLATFORM_DEVICE_CHALLENGE_TERMINAL' using errcode='42501';
  end if;
  update public.device_possession_challenges set failed_at=statement_timestamp(),
    failure_code=left(regexp_replace(upper(coalesce(p_failure_code,'VERIFICATION_FAILED')),
      '[^A-Z0-9_]+','','g'),80) where id=p_challenge_id;
  return jsonb_build_object('status','failed','challengeId',p_challenge_id);
end;
$$;

create or replace function public.list_system_owner_pending_device_authorizations(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_environment text,
  p_listing_token_hash bytea
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog, public as $$
begin
  perform public.require_platform_device_backend();
  if not exists(select 1 from public.privileged_device_listing_sessions sessions
    where sessions.opaque_token_hash=p_listing_token_hash and sessions.user_id=p_actor_user_id
      and sessions.session_id=p_session_id and sessions.actor_device_id=p_actor_device_id
      and sessions.environment=p_environment and sessions.scope='SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY'
      and sessions.revoked_at is null and sessions.expires_at>statement_timestamp())
    or not exists(select 1 from public.system_user_access access where access.user_id=p_actor_user_id
      and access.account_status='approved') or not public.is_system_owner(p_actor_user_id)
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_actor_user_id and uda.device_id=p_actor_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'PRIVILEGED_LISTING_SESSION_INVALID' using errcode='42501';
  end if;
  return jsonb_build_object('status','success','devices',coalesce((select jsonb_agg(jsonb_build_object(
    'targetUserId',uda.user_id,'deviceId',uda.device_id,
    'deviceName',devices.device_name,'platform',devices.platform,
    'authorizationStatus',uda.authorization_status,'requestedAt',uda.requested_at,
    'lastRegisteredAt',uda.last_registered_at,'displayName',profiles.display_name,
    'email',users.email) order by uda.requested_at,uda.device_id)
    from public.user_device_authorizations uda
    join public.devices devices on devices.id=uda.device_id and devices.user_id=uda.user_id
    join public.system_user_access access on access.user_id=uda.user_id and access.account_status='approved'
    join auth.users users on users.id=uda.user_id
    left join public.profiles profiles on profiles.id=uda.user_id
    where uda.authorization_status='pending' and uda.revoked_at is null),'[]'::jsonb));
end;
$$;

create or replace function public.complete_system_owner_pending_device_operation(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_environment text,p_challenge_id uuid,p_challenge_hash bytea,p_operation_id uuid,p_target_user_id uuid,
  p_target_device_id uuid,p_action text,p_new_sign_count bigint,p_origin text,p_rp_id text,
  p_verification_context jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare credential public.device_security_credentials%rowtype;
  challenge public.device_possession_challenges%rowtype;
  existing public.system_owner_device_authorization_operations%rowtype;
  result jsonb; purpose text; operation_action text; audit_action text;
begin
  perform public.require_platform_device_backend();
  if p_action not in ('approve','reject') then raise exception 'PLATFORM_DEVICE_ACTION_INVALID' using errcode='22023'; end if;
  purpose:=case p_action when 'approve' then 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE' else 'SYSTEM_OWNER_PENDING_DEVICE_REJECT' end;
  operation_action:=case p_action when 'approve' then 'approve_system_owner_pending_device' else 'reject_system_owner_pending_device' end;
  audit_action:=case p_action when 'approve' then 'pending_device_approved' else 'pending_device_rejected' end;
  perform pg_advisory_xact_lock(hashtextextended('system-owner-device-operation:'||p_operation_id::text,0));
  select * into existing from public.system_owner_device_authorization_operations operations
    where operations.operation_id=p_operation_id;
  if found then
    if existing.actor_user_id_snapshot=p_actor_user_id and existing.actor_device_id=p_actor_device_id
      and existing.target_user_id_snapshot=p_target_user_id and existing.target_device_id=p_target_device_id
      and existing.action=operation_action and existing.environment=p_environment then return existing.stored_result; end if;
    raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
  end if;
  credential:=public.require_system_owner_webauthn_actor(p_actor_user_id,p_actor_device_id,p_credential_id);
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-user:'||p_target_user_id::text,0));
  select * into challenge from public.device_possession_challenges challenges
    where challenges.id=p_challenge_id and challenges.user_id=p_actor_user_id
      and challenges.session_id=p_session_id and challenges.actor_device_id=p_actor_device_id
      and challenges.credential_id=p_credential_id and challenges.purpose=purpose
      and challenges.target_user_id=p_target_user_id and challenges.target_device_id=p_target_device_id
      and challenges.operation_id=p_operation_id and challenges.environment=p_environment
      and challenges.challenge_hash=p_challenge_hash for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=statement_timestamp()
    or challenge.expected_origin<>lower(p_origin) or challenge.expected_rp_id<>lower(p_rp_id)
    or p_new_sign_count<credential.sign_count
    or coalesce((p_verification_context->>'userVerified')::boolean,false)<>true
    or coalesce((p_verification_context->>'backupEligible')::boolean,true)<>false
    or coalesce((p_verification_context->>'backupState')::boolean,true)<>false then
    raise exception 'PLATFORM_DEVICE_OPERATION_VERIFICATION_INVALID' using errcode='42501';
  end if;
  perform 1 from public.user_device_authorizations uda
    join public.devices devices on devices.id=uda.device_id and devices.user_id=uda.user_id
    join public.system_user_access access on access.user_id=uda.user_id
    where uda.user_id=p_target_user_id and uda.device_id=p_target_device_id
      and uda.authorization_status='pending' and uda.revoked_at is null
      and access.account_status='approved' for update of uda;
  if not found then raise exception 'PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED' using errcode='42501'; end if;
  update public.device_possession_challenges set verified_at=statement_timestamp(),
    verification_context=p_verification_context where id=p_challenge_id;
  update public.device_security_credentials set sign_count=p_new_sign_count,last_used_at=statement_timestamp()
    where id=p_credential_id;
  insert into public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  values(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,purpose,
    p_environment,'device_authorization_operation',p_operation_id);
  if p_action='approve' then
    update public.user_device_authorizations set authorization_status='approved',approved_at=statement_timestamp(),
      approved_by=p_actor_user_id,revoked_at=null,revoked_by=null
      where user_id=p_target_user_id and device_id=p_target_device_id;
  else
    update public.user_device_authorizations set authorization_status='revoked',revoked_at=statement_timestamp(),
      revoked_by=p_actor_user_id where user_id=p_target_user_id and device_id=p_target_device_id;
  end if;
  result:=jsonb_build_object('status','applied','action',p_action,'targetUserId',p_target_user_id,
    'deviceId',p_target_device_id,'authorizationStatus',case p_action when 'approve' then 'approved' else 'revoked' end,
    'operationId',p_operation_id);
  insert into public.system_owner_device_authorization_operations(operation_id,actor_user_id,
    actor_user_id_snapshot,actor_device_id,actor_credential_id,challenge_id,session_id,
    challenge_purpose,environment,target_user_id,target_user_id_snapshot,target_device_id,
    action,outcome,stored_result)
  values(p_operation_id,p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    p_challenge_id,p_session_id,purpose,p_environment,p_target_user_id,p_target_user_id,
    p_target_device_id,operation_action,'applied',result);
  insert into public.privileged_device_authorization_audit_log(actor_user_id,actor_user_id_snapshot,
    actor_device_id,actor_credential_id,session_id_hash,session_id,challenge_id,challenge_purpose,
    environment,target_user_id,target_user_id_snapshot,target_device_id,challenge_target_user_id,
    challenge_target_device_id,action,operation_id,result,origin,rp_id,user_verified,
    backup_eligible,backup_state,security_context)
  values(p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,purpose,p_environment,
    p_target_user_id,p_target_user_id,p_target_device_id,p_target_user_id,p_target_device_id,
    audit_action,p_operation_id,'applied',lower(p_origin),lower(p_rp_id),true,false,false,p_verification_context);
  update public.device_possession_challenges set consumed_at=statement_timestamp() where id=p_challenge_id;
  return result;
end;
$$;

create or replace function public.get_system_owner_device_operation_result(
  p_actor_user_id uuid,p_actor_device_id uuid,p_operation_id uuid,p_target_user_id uuid,
  p_target_device_id uuid,p_action text,p_environment text
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog, public as $$
declare stored public.system_owner_device_authorization_operations%rowtype;
begin
  perform public.require_platform_device_backend();
  if not exists(select 1 from public.system_user_access access where access.user_id=p_actor_user_id
      and access.account_status='approved') or not public.is_system_owner(p_actor_user_id)
    or not exists(select 1 from public.user_device_authorizations uda
      where uda.user_id=p_actor_user_id and uda.device_id=p_actor_device_id
        and uda.authorization_status='approved' and uda.revoked_at is null) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  select * into stored from public.system_owner_device_authorization_operations operations
    where operations.operation_id=p_operation_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if stored.actor_user_id_snapshot<>p_actor_user_id or stored.actor_device_id<>p_actor_device_id
    or stored.target_user_id_snapshot<>p_target_user_id or stored.target_device_id<>p_target_device_id
    or stored.environment<>p_environment
    or stored.action<>case p_action when 'approve' then 'approve_system_owner_pending_device'
      when 'reject' then 'reject_system_owner_pending_device' else '' end then
    raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
  end if;
  return jsonb_build_object('status','completed','result',stored.stored_result);
end;
$$;

revoke all on function public.require_platform_device_backend() from public,anon,authenticated;
revoke all on function public.require_system_owner_webauthn_actor(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.begin_system_owner_credential_enrollment(uuid,uuid,uuid,text,text,text,bytea,uuid,bytea) from public,anon,authenticated;
revoke all on function public.issue_system_owner_credential_bootstrap_authorization(uuid,uuid,uuid,uuid,text,bytea,text,text,text) from public,anon,authenticated;
revoke all on function public.get_system_owner_platform_device_administration_state(uuid,uuid) from public,anon,authenticated;
revoke all on function public.complete_system_owner_credential_enrollment(uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,bytea,bytea,integer,uuid,text[],bigint,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea) from public,anon,authenticated;
revoke all on function public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.fail_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea) from public,anon,authenticated;
revoke all on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;

grant execute on function public.require_platform_device_backend() to service_role;
grant execute on function public.require_system_owner_webauthn_actor(uuid,uuid,uuid) to service_role;
grant execute on function public.begin_system_owner_credential_enrollment(uuid,uuid,uuid,text,text,text,bytea,uuid,bytea) to service_role;
grant execute on function public.issue_system_owner_credential_bootstrap_authorization(uuid,uuid,uuid,uuid,text,bytea,text,text,text) to service_role;
grant execute on function public.get_system_owner_platform_device_administration_state(uuid,uuid) to service_role;
grant execute on function public.complete_system_owner_credential_enrollment(uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,bytea,bytea,integer,uuid,text[],bigint,text,text,jsonb) to service_role;
grant execute on function public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea) to service_role;
grant execute on function public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb) to service_role;
grant execute on function public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.fail_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea) to service_role;
grant execute on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb) to service_role;
grant execute on function public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

do $$
declare controlled_owner name; signature text;
begin
  select pg_get_userbyid(classes.relowner) into controlled_owner from pg_class classes
    join pg_namespace namespaces on namespaces.oid=classes.relnamespace
    where namespaces.nspname='public' and classes.relname='user_device_authorizations';
  foreach signature in array array[
    'require_platform_device_backend()','require_system_owner_webauthn_actor(uuid,uuid,uuid)',
    'begin_system_owner_credential_enrollment(uuid,uuid,uuid,text,text,text,bytea,uuid,bytea)',
    'issue_system_owner_credential_bootstrap_authorization(uuid,uuid,uuid,uuid,text,bytea,text,text,text)',
    'get_system_owner_platform_device_administration_state(uuid,uuid)',
    'complete_system_owner_credential_enrollment(uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,bytea,bytea,integer,uuid,text[],bigint,text,text,jsonb)',
    'begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea)',
    'complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb)',
    'get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid)',
    'fail_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text)',
    'list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea)',
    'complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)',
    'get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text)']
  loop execute format('alter function public.%s owner to %I',signature,controlled_owner); end loop;
end;
$$;

update public.webauthn_privileged_device_feature set enabled=true,updated_at=statement_timestamp()
where singleton_id=1 and enabled=false;

commit;
