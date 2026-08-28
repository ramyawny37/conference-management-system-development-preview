begin;

do $preflight$
begin
  if (select pg_get_constraintdef(oid, true)
      from pg_constraint
      where conname='device_security_credentials_non_backup_policy'
        and conrelid='public.device_security_credentials'::regclass)
     is distinct from 'CHECK (backup_eligible = false AND backup_state = false)' then
    raise exception 'DEVICE_SECURITY_CREDENTIALS_POLICY_DRIFT';
  end if;

  if (select pg_get_constraintdef(oid, true)
      from pg_constraint
      where conname='privileged_device_audit_webauthn_policy'
        and conrelid='public.privileged_device_authorization_audit_log'::regclass)
     is distinct from 'CHECK ((action = ANY (ARRAY[''credential_bootstrap_authorization_issued''::text, ''credential_recovery_authorization_issued''::text])) AND actor_credential_id IS NULL AND challenge_id IS NULL AND session_id IS NULL AND challenge_purpose IS NULL AND operation_id IS NULL AND challenge_target_user_id IS NULL AND challenge_target_device_id IS NULL OR (action <> ALL (ARRAY[''credential_bootstrap_authorization_issued''::text, ''credential_recovery_authorization_issued''::text])) AND challenge_id IS NOT NULL AND session_id IS NOT NULL AND challenge_purpose IS NOT NULL AND (actor_credential_id IS NOT NULL OR action = ''credential_enrolled''::text AND challenge_purpose = ''SYSTEM_OWNER_CREDENTIAL_ENROLLMENT''::text) AND user_verified = true AND backup_eligible = false AND backup_state = false)' then
    raise exception 'PRIVILEGED_DEVICE_AUDIT_POLICY_DRIFT';
  end if;

  if exists (
    select 1 from public.device_security_credentials
    where backup_state and not backup_eligible
  ) then
    raise exception 'INVALID_DEVICE_SECURITY_CREDENTIAL_BACKUP_STATE';
  end if;

  if exists (
    select 1 from public.privileged_device_authorization_audit_log
    where backup_state and not backup_eligible
  ) then
    raise exception 'INVALID_PRIVILEGED_DEVICE_AUDIT_BACKUP_STATE';
  end if;
end;
$preflight$;

alter table public.device_security_credentials
  drop constraint device_security_credentials_non_backup_policy;
alter table public.device_security_credentials
  add constraint device_security_credentials_non_backup_policy
  check (not backup_state or backup_eligible);

alter table public.privileged_device_authorization_audit_log
  drop constraint privileged_device_audit_webauthn_policy;
alter table public.privileged_device_authorization_audit_log
  add constraint privileged_device_audit_webauthn_policy
  check ((action = ANY (ARRAY['credential_bootstrap_authorization_issued'::text, 'credential_recovery_authorization_issued'::text])) AND actor_credential_id IS NULL AND challenge_id IS NULL AND session_id IS NULL AND challenge_purpose IS NULL AND operation_id IS NULL AND challenge_target_user_id IS NULL AND challenge_target_device_id IS NULL OR (action <> ALL (ARRAY['credential_bootstrap_authorization_issued'::text, 'credential_recovery_authorization_issued'::text])) AND challenge_id IS NOT NULL AND session_id IS NOT NULL AND challenge_purpose IS NOT NULL AND (actor_credential_id IS NOT NULL OR action = 'credential_enrolled'::text AND challenge_purpose = 'SYSTEM_OWNER_CREDENTIAL_ENROLLMENT'::text) AND user_verified = true AND (NOT backup_state OR backup_eligible));

CREATE OR REPLACE FUNCTION public.get_system_owner_platform_device_administration_state(p_actor_user_id uuid, p_actor_device_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    order by credentials.activated_at desc limit 1;
  if not found then return jsonb_build_object('status','enrollment_required'); end if;
  return jsonb_build_object('status','ready','credentialId',credential.id,
    'credentialExternalId',encode(credential.webauthn_credential_id,'base64'),
    'transports',credential.transports);
end;
$function$;


CREATE OR REPLACE FUNCTION public.require_system_owner_webauthn_actor(p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid)
 RETURNS device_security_credentials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      and credentials.user_verification_policy='required'
    for update;
  if not found then raise exception 'ACTIVE_PLATFORM_CREDENTIAL_REQUIRED' using errcode='42501'; end if;
  return credential;
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
    statement_timestamp()+interval '5 minutes');
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


CREATE OR REPLACE FUNCTION public.complete_system_owner_pending_device_operation(p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid, p_session_id uuid, p_environment text, p_challenge_id uuid, p_challenge_hash bytea, p_operation_id uuid, p_target_user_id uuid, p_target_device_id uuid, p_action text, p_new_sign_count bigint, p_origin text, p_rp_id text, p_verification_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    or p_verification_context->'userVerified' is distinct from 'true'::jsonb
    or jsonb_typeof(p_verification_context->'backupEligible') is distinct from 'boolean'
    or jsonb_typeof(p_verification_context->'backupState') is distinct from 'boolean'
    or (p_verification_context->'backupState'='true'::jsonb
      and p_verification_context->'backupEligible'='false'::jsonb) then
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
    audit_action,p_operation_id,'applied',lower(p_origin),lower(p_rp_id),true,
    (p_verification_context->>'backupEligible')::boolean,
    (p_verification_context->>'backupState')::boolean,p_verification_context);
  update public.device_possession_challenges set consumed_at=statement_timestamp() where id=p_challenge_id;
  return result;
end;
$function$;


commit;
