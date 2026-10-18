begin;

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
  target_initial_status text; operation_at timestamptz:=pg_catalog.statement_timestamp();
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
    when 'reject' then 'pending_device_rejected' else 'device_revoked' end;
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
    or challenge.failed_at is not null or challenge.expires_at<=operation_at
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
    and (p_action='revoke' or exists(
      select 1 from platform.device_key_bindings binding
      where binding.user_id=device_authorization.user_id
        and binding.device_id=device_authorization.device_id
        and binding.device_authorization_id=device_authorization.id
        and binding.lifecycle_status='active' and binding.revoked_at is null
        and binding.retired_at is null))
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
  update public.device_possession_challenges set verified_at=operation_at,
    verification_context=p_verification_context where id=p_challenge_id;
  update public.device_security_credentials set sign_count=p_new_sign_count,
    last_used_at=operation_at where id=p_credential_id;
  insert into public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  values(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    v_purpose,p_environment,'device_authorization_operation',p_operation_id);

  if p_action='revoke' then
    update public.device_security_credentials set lifecycle_status='revoked',
      revoked_at=operation_at,revoked_by=p_actor_user_id,
      revocation_reason='system_owner_device_revocation'
    where user_id=p_target_user_id and device_id=p_target_device_id
      and lifecycle_status in ('enrollment_pending','active','rotation_pending','recovery_required')
      and revoked_at is null;
    update platform_private.device_session_challenges set failed_at=operation_at,
      failure_code='DEVICE_AUTHORIZATION_REVOKED'
    where user_id=p_target_user_id and device_id=p_target_device_id
      and consumed_at is null and failed_at is null;
    update platform_private.device_sessions set revoked_at=operation_at
    where user_id=p_target_user_id and device_id=p_target_device_id and revoked_at is null;
    update platform.device_key_bindings set lifecycle_status='revoked',revoked_at=operation_at
    where user_id=p_target_user_id and device_id=p_target_device_id
      and device_authorization_id=target.id and lifecycle_status='active'
      and revoked_at is null and retired_at is null;
  end if;

  update platform.user_device_authorizations set
    status=case p_action when 'approve' then 'approved' else 'revoked' end,
    approved_by=case p_action when 'approve' then p_actor_user_id else approved_by end,
    approved_at=case p_action when 'approve' then operation_at else approved_at end,
    revoked_by=case when p_action in ('reject','revoke') then p_actor_user_id else null end,
    revoked_at=case when p_action in ('reject','revoke') then operation_at else null end,
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
  update public.device_possession_challenges set consumed_at=operation_at
  where id=p_challenge_id;
  return result;
end; $$;

revoke all on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)
  to service_role;

commit;
