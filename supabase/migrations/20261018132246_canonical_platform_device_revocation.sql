begin;

create or replace function public.begin_system_owner_device_possession_challenge(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_purpose text,p_target_user_id uuid,p_target_device_id uuid,p_operation_id uuid,
  p_environment text,p_expected_origin text,p_expected_rp_id text,p_challenge_hash bytea
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
  challenge_id uuid; existing public.system_owner_device_authorization_operations%rowtype;
  challenge_created_at timestamptz:=pg_catalog.statement_timestamp();
begin
  credential:=public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,p_credential_id);
  if p_session_id is null or pg_catalog.octet_length(p_challenge_hash)<>32
    or p_purpose not in ('SYSTEM_OWNER_PENDING_DEVICE_LIST',
      'SYSTEM_OWNER_PENDING_DEVICE_APPROVE','SYSTEM_OWNER_PENDING_DEVICE_REJECT',
      'SYSTEM_OWNER_DEVICE_REVOKE') then
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
    if p_purpose='SYSTEM_OWNER_DEVICE_REVOKE' and p_target_user_id=p_actor_user_id
      and p_target_device_id=p_actor_device_id then
      raise exception 'ACTOR_DEVICE_REVOCATION_FORBIDDEN' using errcode='42501';
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
        and existing.action=(case p_purpose
          when 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE' then 'approve_system_owner_pending_device'
          when 'SYSTEM_OWNER_PENDING_DEVICE_REJECT' then 'reject_system_owner_pending_device'
          when 'SYSTEM_OWNER_DEVICE_REVOKE' then 'revoke_system_owner_device' end) then
        return pg_catalog.jsonb_build_object('status','completed','result',existing.stored_result);
      end if;
      raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
    end if;
    if not exists(select 1 from platform.user_device_authorizations device_authorization
      join platform.devices device on device.id=device_authorization.device_id
      join platform.profiles profile on profile.user_id=device_authorization.user_id
      where device_authorization.user_id=p_target_user_id
        and device_authorization.device_id=p_target_device_id
        and device_authorization.status=(case when p_purpose='SYSTEM_OWNER_DEVICE_REVOKE'
          then 'approved' else 'pending' end)
        and device_authorization.revoked_at is null
        and device.lifecycle_status='active' and device.retired_at is null
        and device.compromised_at is null and profile.account_status='approved'
        and exists(select 1 from platform.device_key_bindings binding
          where binding.user_id=device_authorization.user_id
            and binding.device_id=device_authorization.device_id
            and binding.device_authorization_id=device_authorization.id
            and binding.lifecycle_status='active' and binding.revoked_at is null
            and binding.retired_at is null)) then
      if p_purpose='SYSTEM_OWNER_DEVICE_REVOKE' then
        raise exception 'APPROVED_UNREVOKED_DEVICE_REQUIRED' using errcode='42501';
      end if;
      raise exception 'PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED' using errcode='42501';
    end if;
    if p_purpose='SYSTEM_OWNER_DEVICE_REVOKE'
      and platform_private.is_canonical_platform_owner(p_target_user_id)
      and (select pg_catalog.count(*) from platform.user_device_authorizations approved
        join platform.devices device on device.id=approved.device_id
        where approved.user_id=p_target_user_id and approved.status='approved'
          and approved.revoked_at is null and device.lifecycle_status='active'
          and device.retired_at is null and device.compromised_at is null)<=1 then
      raise exception 'OWNER_LAST_APPROVED_DEVICE_REVOCATION_FORBIDDEN' using errcode='42501';
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

create or replace function public.complete_system_owner_pending_device_operation(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_environment text,p_challenge_id uuid,p_challenge_hash bytea,p_operation_id uuid,
  p_target_user_id uuid,p_target_device_id uuid,p_action text,p_new_sign_count bigint,
  p_origin text,p_rp_id text,p_verification_context jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
  challenge public.device_possession_challenges%rowtype;
  existing public.system_owner_device_authorization_operations%rowtype;
  target platform.user_device_authorizations%rowtype;
  result jsonb; v_purpose text; operation_action text; audit_action text;
  target_initial_status text;
begin
  perform public.require_platform_device_backend();
  if p_action not in ('approve','reject','revoke') then
    raise exception 'PLATFORM_DEVICE_ACTION_INVALID' using errcode='22023';
  end if;
  v_purpose:=case p_action when 'approve' then 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
    when 'reject' then 'SYSTEM_OWNER_PENDING_DEVICE_REJECT'
    else 'SYSTEM_OWNER_DEVICE_REVOKE' end;
  operation_action:=case p_action when 'approve' then 'approve_system_owner_pending_device'
    when 'reject' then 'reject_system_owner_pending_device'
    else 'revoke_system_owner_device' end;
  audit_action:=case p_action when 'approve' then 'pending_device_approved'
    when 'reject' then 'pending_device_rejected' else 'approved_device_revoked' end;
  target_initial_status:=case when p_action='revoke' then 'approved' else 'pending' end;
  if p_action='revoke' and p_target_user_id=p_actor_user_id
    and p_target_device_id=p_actor_device_id then
    raise exception 'ACTOR_DEVICE_REVOCATION_FORBIDDEN' using errcode='42501';
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
      and existing.action=operation_action and existing.environment=p_environment then
      return existing.stored_result;
    end if;
    raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
  end if;
  credential:=public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,p_credential_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-device-authorization-user:'||p_target_user_id::text,0));
  select * into challenge from public.device_possession_challenges stored
  where stored.id=p_challenge_id and stored.user_id=p_actor_user_id
    and stored.session_id=p_session_id and stored.actor_device_id=p_actor_device_id
    and stored.credential_id=p_credential_id and stored.purpose=v_purpose
    and stored.target_user_id=p_target_user_id and stored.target_device_id=p_target_device_id
    and stored.operation_id=p_operation_id and stored.environment=p_environment
    and stored.challenge_hash=p_challenge_hash for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=pg_catalog.statement_timestamp()
    or challenge.expected_origin<>pg_catalog.lower(p_origin)
    or challenge.expected_rp_id<>pg_catalog.lower(p_rp_id)
    or p_new_sign_count<credential.sign_count
    or p_verification_context->'userVerified' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(p_verification_context->'backupEligible') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_verification_context->'backupState') is distinct from 'boolean'
    or (p_verification_context->>'backupEligible')::boolean is distinct from credential.backup_eligible
    or (p_verification_context->>'backupState')::boolean is distinct from credential.backup_state then
    raise exception 'PLATFORM_DEVICE_OPERATION_VERIFICATION_INVALID' using errcode='42501';
  end if;
  select device_authorization.* into target
  from platform.user_device_authorizations device_authorization
  join platform.devices device on device.id=device_authorization.device_id
  join platform.profiles profile on profile.user_id=device_authorization.user_id
  where device_authorization.user_id=p_target_user_id
    and device_authorization.device_id=p_target_device_id
    and device_authorization.status=target_initial_status
    and device_authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null
    and device.compromised_at is null and profile.account_status='approved'
    and exists(select 1 from platform.device_key_bindings binding
      where binding.user_id=device_authorization.user_id
        and binding.device_id=device_authorization.device_id
        and binding.device_authorization_id=device_authorization.id
        and binding.lifecycle_status='active' and binding.revoked_at is null
        and binding.retired_at is null)
  for update of device_authorization;
  if not found then
    if p_action='revoke' then
      raise exception 'APPROVED_UNREVOKED_DEVICE_REQUIRED' using errcode='42501';
    end if;
    raise exception 'PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED' using errcode='42501';
  end if;
  if p_action='revoke' and platform_private.is_canonical_platform_owner(p_target_user_id)
    and (select pg_catalog.count(*) from platform.user_device_authorizations approved
      join platform.devices device on device.id=approved.device_id
      where approved.user_id=p_target_user_id and approved.status='approved'
        and approved.revoked_at is null and device.lifecycle_status='active'
        and device.retired_at is null and device.compromised_at is null)<=1 then
    raise exception 'OWNER_LAST_APPROVED_DEVICE_REVOCATION_FORBIDDEN' using errcode='42501';
  end if;
  update public.device_possession_challenges set verified_at=pg_catalog.statement_timestamp(),
    verification_context=p_verification_context where id=p_challenge_id;
  update public.device_security_credentials set sign_count=p_new_sign_count,
    last_used_at=pg_catalog.statement_timestamp() where id=p_credential_id;
  insert into public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  values(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    v_purpose,p_environment,'device_authorization_operation',p_operation_id);
  update platform.user_device_authorizations set
    status=case p_action when 'approve' then 'approved' else 'revoked' end,
    approved_by=case p_action when 'approve' then p_actor_user_id else approved_by end,
    approved_at=case p_action when 'approve' then pg_catalog.statement_timestamp() else approved_at end,
    revoked_by=case when p_action in ('reject','revoke') then p_actor_user_id else null end,
    revoked_at=case when p_action in ('reject','revoke') then pg_catalog.statement_timestamp() else null end,
    status_reason=null
  where id=target.id and user_id=p_target_user_id and device_id=p_target_device_id;
  result:=pg_catalog.jsonb_build_object('status','applied','action',p_action,
    'targetUserId',p_target_user_id,'deviceId',p_target_device_id,
    'authorizationStatus',case p_action when 'approve' then 'approved' else 'revoked' end,
    'operationId',p_operation_id);
  insert into public.system_owner_device_authorization_operations(operation_id,actor_user_id,
    actor_user_id_snapshot,actor_device_id,actor_credential_id,challenge_id,session_id,
    challenge_purpose,environment,target_user_id,target_user_id_snapshot,target_device_id,
    action,outcome,stored_result)
  values(p_operation_id,p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    p_challenge_id,p_session_id,v_purpose,p_environment,p_target_user_id,p_target_user_id,
    p_target_device_id,operation_action,'applied',result);
  insert into public.privileged_device_authorization_audit_log(actor_user_id,
    actor_user_id_snapshot,actor_device_id,actor_credential_id,session_id_hash,session_id,
    challenge_id,challenge_purpose,environment,target_user_id,target_user_id_snapshot,
    target_device_id,challenge_target_user_id,challenge_target_device_id,action,operation_id,
    result,origin,rp_id,user_verified,backup_eligible,backup_state,security_context)
  values(p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,v_purpose,
    p_environment,p_target_user_id,p_target_user_id,p_target_device_id,p_target_user_id,
    p_target_device_id,audit_action,p_operation_id,'applied',pg_catalog.lower(p_origin),
    pg_catalog.lower(p_rp_id),true,credential.backup_eligible,credential.backup_state,
    p_verification_context);
  perform platform_private.write_audit_event(p_actor_user_id,p_target_user_id,'platform',
    'devices','device_authorization.'||(case p_action when 'approve' then 'approved'
      when 'reject' then 'rejected' else 'revoked' end),
    'user_device_authorization',target.id,'platform',
    pg_catalog.jsonb_build_object('status',target_initial_status),
    pg_catalog.jsonb_build_object('status',case p_action when 'approve' then 'approved' else 'revoked' end),
    pg_catalog.jsonb_build_object('deviceId',p_target_device_id,'confirmation','webauthn'),
    null,p_operation_id,'system');
  update public.device_possession_challenges set consumed_at=pg_catalog.statement_timestamp()
  where id=p_challenge_id;
  return result;
end; $$;

create or replace function public.get_system_owner_device_operation_result(
  p_actor_user_id uuid,p_actor_device_id uuid,p_operation_id uuid,p_target_user_id uuid,
  p_target_device_id uuid,p_action text,p_environment text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare stored public.system_owner_device_authorization_operations%rowtype;
begin
  perform public.require_platform_device_backend();
  if not platform_private.is_canonical_platform_owner(p_actor_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  perform platform_private.require_canonical_device_authorization(
    p_actor_user_id,p_actor_device_id,true);
  select * into stored from public.system_owner_device_authorization_operations operation
  where operation.operation_id=p_operation_id;
  if not found then return pg_catalog.jsonb_build_object('status','not_found'); end if;
  if stored.actor_user_id_snapshot<>p_actor_user_id
    or stored.actor_device_id<>p_actor_device_id
    or stored.target_user_id_snapshot<>p_target_user_id
    or stored.target_device_id<>p_target_device_id or stored.environment<>p_environment
    or stored.action<>(case p_action when 'approve' then 'approve_system_owner_pending_device'
      when 'reject' then 'reject_system_owner_pending_device'
      when 'revoke' then 'revoke_system_owner_device' else '' end) then
    raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object('status','completed','result',stored.stored_result);
end; $$;

create or replace function public.guard_device_security_credential_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare recovery_counter_update boolean:=false;
  owner_assertion_counter_update boolean:=false;
  counter_only_update boolean:=false;
begin
  if tg_op='INSERT' then
    if new.lifecycle_status<>'enrollment_pending' then
      raise exception 'DEVICE_SECURITY_CREDENTIAL_MUST_ENROLL_PENDING' using errcode='42501';
    end if;
    perform platform_private.require_canonical_device_authorization(new.user_id,new.device_id,true);
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  if new.id<>old.id or new.webauthn_credential_id<>old.webauthn_credential_id
    or new.user_id<>old.user_id or new.device_id<>old.device_id
    or new.credential_kind<>old.credential_kind or new.public_key_cose<>old.public_key_cose
    or new.public_key_algorithm<>old.public_key_algorithm or new.aaguid is distinct from old.aaguid
    or new.transports<>old.transports or new.backup_eligible<>old.backup_eligible
    or new.backup_state<>old.backup_state or new.user_verification_policy<>old.user_verification_policy
    or new.created_at<>old.created_at then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_IDENTITY_IMMUTABLE' using errcode='42501';
  end if;
  if (old.enrolled_at is not null and new.enrolled_at is distinct from old.enrolled_at)
    or (old.activated_at is not null and new.activated_at is distinct from old.activated_at)
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_SECURITY_TIME_IMMUTABLE' using errcode='42501';
  end if;
  if old.lifecycle_status='revoked'
    or (old.lifecycle_status='enrollment_pending' and new.lifecycle_status not in ('enrollment_pending','active','revoked'))
    or (old.lifecycle_status='active' and new.lifecycle_status not in ('active','rotation_pending','recovery_required','revoked'))
    or (old.lifecycle_status='rotation_pending' and new.lifecycle_status not in ('rotation_pending','active','recovery_required','revoked'))
    or (old.lifecycle_status='recovery_required' and new.lifecycle_status not in ('recovery_required','revoked')) then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_TRANSITION_INVALID' using errcode='42501';
  end if;
  if new.sign_count<old.sign_count then
    raise exception 'DEVICE_SECURITY_CREDENTIAL_COUNTER_REGRESSION' using errcode='42501';
  end if;
  counter_only_update:=new.lifecycle_status='active' and old.lifecycle_status='active'
    and (pg_catalog.to_jsonb(new)-array['sign_count','last_used_at']::text[])
      =(pg_catalog.to_jsonb(old)-array['sign_count','last_used_at']::text[])
    and new.last_used_at is not null
    and (old.last_used_at is null or new.last_used_at>=old.last_used_at);
  if counter_only_update and new.credential_kind='platform_primary'
    and new.user_verification_policy='required' and new.backup_eligible and new.backup_state then
    select exists(select 1 from public.device_possession_challenges challenge
      join platform.user_device_authorizations actor_authorization
        on actor_authorization.user_id=challenge.user_id
       and actor_authorization.device_id=challenge.actor_device_id
      join platform.devices actor_device on actor_device.id=challenge.actor_device_id
      join platform.profiles actor_profile on actor_profile.user_id=challenge.user_id
      where challenge.user_id=new.user_id and challenge.credential_id=new.id
        and challenge.purpose in ('SYSTEM_OWNER_PENDING_DEVICE_LIST',
          'SYSTEM_OWNER_PENDING_DEVICE_APPROVE','SYSTEM_OWNER_PENDING_DEVICE_REJECT',
          'SYSTEM_OWNER_DEVICE_REVOKE')
        and challenge.verified_at is not null and challenge.consumed_at is null
        and challenge.failed_at is null and challenge.expires_at>pg_catalog.statement_timestamp()
        and challenge.verification_context->'userVerified'='true'::jsonb
        and (challenge.verification_context->>'backupEligible')::boolean is true
        and (challenge.verification_context->>'backupState')::boolean is true
        and actor_authorization.status='approved' and actor_authorization.revoked_at is null
        and actor_device.lifecycle_status='active' and actor_device.retired_at is null
        and actor_device.compromised_at is null and actor_profile.account_status='approved'
        and platform_private.is_canonical_platform_owner(challenge.user_id)
        and exists(select 1 from platform.device_key_bindings binding
          where binding.user_id=actor_authorization.user_id
            and binding.device_id=actor_authorization.device_id
            and binding.device_authorization_id=actor_authorization.id
            and binding.lifecycle_status='active' and binding.revoked_at is null
            and binding.retired_at is null)) into owner_assertion_counter_update;
  end if;
  if counter_only_update and not owner_assertion_counter_update then
    select exists(select 1 from platform_private.stable_device_recovery_authorizations recovery
      join platform_private.stable_device_recovery_challenges challenge
        on challenge.recovery_authorization_id=recovery.id and challenge.credential_id=recovery.credential_id
      join platform.user_device_authorizations target_authorization
        on target_authorization.id=recovery.target_authorization_id
       and target_authorization.user_id=recovery.owner_user_id
       and target_authorization.device_id=recovery.target_device_id
      join platform.devices target_device on target_device.id=recovery.target_device_id
      where recovery.owner_user_id=new.user_id and recovery.credential_id=new.id
        and recovery.issuance_basis='reviewed_platform_owner_passkey_recovery'
        and recovery.review_reference is not null and recovery.environment='development_preview'
        and recovery.expected_origin='https://ramyawny37.github.io'
        and recovery.expected_rp_id='ramyawny37.github.io' and recovery.consumed_at is null
        and pg_catalog.statement_timestamp() between recovery.issued_at and recovery.expires_at
        and target_authorization.status='pending' and target_authorization.revoked_at is null
        and target_device.lifecycle_status='active' and target_device.retired_at is null
        and target_device.compromised_at is null and challenge.verified_at is not null
        and challenge.consumed_at is null and challenge.failed_at is null
        and challenge.expires_at>pg_catalog.statement_timestamp()
        and challenge.verification_context->'userVerified'='true'::jsonb
        and (challenge.verification_context->>'backupEligible')::boolean is not distinct from new.backup_eligible
        and (challenge.verification_context->>'backupState')::boolean is not distinct from new.backup_state
        and (not (challenge.verification_context->>'backupState')::boolean
          or (challenge.verification_context->>'backupEligible')::boolean)) into recovery_counter_update;
  end if;
  if new.lifecycle_status='active'
    and not recovery_counter_update and not owner_assertion_counter_update then
    perform platform_private.require_canonical_device_authorization(new.user_id,new.device_id,true);
  end if;
  return new;
end; $$;

revoke all on function public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea)
  from public,anon,authenticated;
revoke all on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)
  from public,anon,authenticated;
revoke all on function public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.guard_device_security_credential_lifecycle()
  from public,anon,authenticated;
grant execute on function public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea)
  to service_role;
grant execute on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)
  to service_role;
grant execute on function public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text)
  to service_role;

commit;
