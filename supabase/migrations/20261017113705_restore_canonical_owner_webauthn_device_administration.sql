begin;

-- The WebAuthn credential belongs to the owner, while actor_device_id records the
-- independently approved device from which the ceremony is executed.  A synced
-- passkey can therefore be used from another approved device without rewriting
-- its immutable enrollment provenance.
alter table public.device_possession_challenges
  drop constraint device_possession_challenges_credential_fk,
  add constraint device_possession_challenges_credential_user_fk
    foreign key(credential_id,user_id)
    references public.device_security_credentials(id,user_id) on delete restrict;
alter table public.privileged_device_listing_sessions
  drop constraint privileged_device_listing_sessions_credential_fk,
  add constraint privileged_device_listing_sessions_credential_user_fk
    foreign key(credential_id,user_id)
    references public.device_security_credentials(id,user_id) on delete restrict;
alter table public.privileged_device_authorization_audit_log
  drop constraint privileged_device_audit_actor_credential_fk,
  add constraint privileged_device_audit_actor_credential_user_fk
    foreign key(actor_credential_id,actor_user_id_snapshot)
    references public.device_security_credentials(id,user_id) on delete restrict;
alter table public.system_owner_device_authorization_operations
  drop constraint system_owner_device_operations_actor_credential_fk,
  add constraint system_owner_device_operations_actor_credential_user_fk
    foreign key(actor_credential_id,actor_user_id_snapshot)
    references public.device_security_credentials(id,user_id) on delete restrict;

create or replace function public.require_system_owner_webauthn_actor(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid
) returns public.device_security_credentials language plpgsql security definer
set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if not platform_private.is_canonical_platform_owner(p_actor_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  perform platform_private.require_canonical_device_authorization(
    p_actor_user_id,p_actor_device_id,true);
  select * into credential from public.device_security_credentials stored
  where stored.id=p_credential_id and stored.user_id=p_actor_user_id
    and stored.credential_kind='platform_primary' and stored.lifecycle_status='active'
    and stored.user_verification_policy='required'
    and (not stored.backup_state or stored.backup_eligible)
    and ((stored.backup_eligible and stored.backup_state)
      or stored.device_id=p_actor_device_id)
  for update;
  if not found then
    raise exception 'ACTIVE_PLATFORM_CREDENTIAL_REQUIRED' using errcode='42501';
  end if;
  return credential;
end; $$;
revoke all on function public.require_system_owner_webauthn_actor(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.require_system_owner_webauthn_actor(uuid,uuid,uuid)
  to service_role;

create or replace function public.get_system_owner_platform_device_administration_state(
  p_actor_user_id uuid,p_actor_device_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if not platform_private.is_canonical_platform_owner(p_actor_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  perform platform_private.require_canonical_device_authorization(
    p_actor_user_id,p_actor_device_id,true);
  select * into credential from public.device_security_credentials stored
  where stored.user_id=p_actor_user_id and stored.credential_kind='platform_primary'
    and stored.lifecycle_status='active' and stored.user_verification_policy='required'
    and (not stored.backup_state or stored.backup_eligible)
    and ((stored.backup_eligible and stored.backup_state)
      or stored.device_id=p_actor_device_id)
  order by (stored.device_id=p_actor_device_id) desc,stored.activated_at desc limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('status','enrollment_required');
  end if;
  return pg_catalog.jsonb_build_object('status','ready','credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'transports',credential.transports);
end; $$;
revoke all on function public.get_system_owner_platform_device_administration_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_system_owner_platform_device_administration_state(uuid,uuid)
  to service_role;

create or replace function public.begin_system_owner_device_possession_challenge(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_purpose text,p_target_user_id uuid,p_target_device_id uuid,p_operation_id uuid,
  p_environment text,p_expected_origin text,p_expected_rp_id text,p_challenge_hash bytea
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype; challenge_id uuid;
  existing public.system_owner_device_authorization_operations%rowtype;
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
    expected_origin,expected_rp_id,environment,expires_at)
  values(p_challenge_hash,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    p_purpose,p_target_user_id,p_target_device_id,p_operation_id,
    pg_catalog.lower(p_expected_origin),pg_catalog.lower(p_expected_rp_id),p_environment,
    pg_catalog.statement_timestamp()+interval '2 minutes') returning id into challenge_id;
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
    'publicKeyCose',pg_catalog.translate(pg_catalog.encode(credential.public_key_cose,'base64'),
      E'\\n\\r',''),'signCount',credential.sign_count,'transports',credential.transports,
    'purpose',challenge.purpose,'targetUserId',challenge.target_user_id,
    'targetDeviceId',challenge.target_device_id,'operationId',challenge.operation_id,
    'environment',challenge.environment,'expectedOrigin',challenge.expected_origin,
    'expectedRpId',challenge.expected_rp_id);
end; $$;
revoke all on function public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.complete_system_owner_pending_device_listing(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,p_session_id uuid,
  p_environment text,p_challenge_id uuid,p_challenge_hash bytea,p_listing_id uuid,
  p_listing_token_hash bytea,p_new_sign_count bigint,p_origin text,p_rp_id text,
  p_verification_context jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
  challenge public.device_possession_challenges%rowtype;
begin
  credential:=public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,p_credential_id);
  select * into challenge from public.device_possession_challenges stored
  where stored.id=p_challenge_id and stored.user_id=p_actor_user_id
    and stored.session_id=p_session_id and stored.actor_device_id=p_actor_device_id
    and stored.credential_id=p_credential_id
    and stored.purpose='SYSTEM_OWNER_PENDING_DEVICE_LIST'
    and stored.environment=p_environment and stored.challenge_hash=p_challenge_hash
  for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=pg_catalog.statement_timestamp()
    or challenge.expected_origin<>pg_catalog.lower(p_origin)
    or challenge.expected_rp_id<>pg_catalog.lower(p_rp_id)
    or p_new_sign_count<credential.sign_count or pg_catalog.octet_length(p_listing_token_hash)<>32
    or p_verification_context->'userVerified' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(p_verification_context->'backupEligible') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_verification_context->'backupState') is distinct from 'boolean'
    or (p_verification_context->>'backupEligible')::boolean is distinct from credential.backup_eligible
    or (p_verification_context->>'backupState')::boolean is distinct from credential.backup_state then
    raise exception 'PLATFORM_DEVICE_LIST_VERIFICATION_INVALID' using errcode='42501';
  end if;
  update public.device_possession_challenges set verified_at=pg_catalog.statement_timestamp(),
    verification_context=p_verification_context where id=p_challenge_id;
  update public.device_security_credentials set sign_count=p_new_sign_count,
    last_used_at=pg_catalog.statement_timestamp() where id=p_credential_id;
  insert into public.device_possession_challenge_consumers(challenge_id,user_id,session_id,
    actor_device_id,actor_credential_id,challenge_purpose,environment,consumer_kind,consumer_id)
  values(p_challenge_id,p_actor_user_id,p_session_id,p_actor_device_id,p_credential_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'listing_session',p_listing_id);
  insert into public.privileged_device_listing_sessions(id,opaque_token_hash,user_id,session_id,
    actor_device_id,credential_id,source_challenge_id,source_challenge_purpose,environment,scope,expires_at)
  values(p_listing_id,p_listing_token_hash,p_actor_user_id,p_session_id,p_actor_device_id,
    p_credential_id,p_challenge_id,challenge.purpose,p_environment,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY',pg_catalog.statement_timestamp()+interval '5 minutes');
  insert into public.privileged_device_authorization_audit_log(actor_user_id,
    actor_user_id_snapshot,actor_device_id,actor_credential_id,session_id_hash,session_id,
    challenge_id,challenge_purpose,environment,action,result,origin,rp_id,user_verified,
    backup_eligible,backup_state,security_context)
  values(p_actor_user_id,p_actor_user_id,p_actor_device_id,p_credential_id,
    extensions.digest(p_session_id::text,'sha256'),p_session_id,p_challenge_id,
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',p_environment,'pending_device_listed','verified',
    pg_catalog.lower(p_origin),pg_catalog.lower(p_rp_id),true,credential.backup_eligible,
    credential.backup_state,p_verification_context);
  update public.device_possession_challenges set consumed_at=pg_catalog.statement_timestamp()
  where id=p_challenge_id;
  return pg_catalog.jsonb_build_object('status','listed','listingId',p_listing_id,
    'expiresInSeconds',300);
end; $$;
revoke all on function public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb)
  to service_role;

create or replace function public.list_system_owner_pending_device_authorizations(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_environment text,
  p_listing_token_hash bytea
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.require_platform_device_backend();
  if not exists(select 1 from public.privileged_device_listing_sessions session
    where session.opaque_token_hash=p_listing_token_hash and session.user_id=p_actor_user_id
      and session.session_id=p_session_id and session.actor_device_id=p_actor_device_id
      and session.environment=p_environment
      and session.scope='SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY'
      and session.revoked_at is null and session.expires_at>pg_catalog.statement_timestamp())
    or not platform_private.is_canonical_platform_owner(p_actor_user_id) then
    raise exception 'PRIVILEGED_LISTING_SESSION_INVALID' using errcode='42501';
  end if;
  perform platform_private.require_canonical_device_authorization(
    p_actor_user_id,p_actor_device_id,true);
  return pg_catalog.jsonb_build_object('status','success','devices',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'targetUserId',device_authorization.user_id,'authorizationId',device_authorization.id,
      'deviceId',device_authorization.device_id,'deviceName',device.display_name,
      'platform',device.platform,'authorizationStatus',device_authorization.status,
      'requestedAt',device_authorization.requested_at,'displayName',profile.display_name,
      'email',users.email
    ) order by device_authorization.requested_at,device_authorization.id)
    from platform.user_device_authorizations device_authorization
    join platform.devices device on device.id=device_authorization.device_id
    join platform.profiles profile on profile.user_id=device_authorization.user_id
    join auth.users users on users.id=device_authorization.user_id
    where device_authorization.status='pending' and device_authorization.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null
      and device.compromised_at is null and profile.account_status='approved'
  ),'[]'::jsonb));
end; $$;
revoke all on function public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea)
  from public,anon,authenticated;
grant execute on function public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea)
  to service_role;

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
begin
  perform public.require_platform_device_backend();
  if p_action not in ('approve','reject') then
    raise exception 'PLATFORM_DEVICE_ACTION_INVALID' using errcode='22023';
  end if;
  v_purpose:=case p_action when 'approve' then 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE'
    else 'SYSTEM_OWNER_PENDING_DEVICE_REJECT' end;
  operation_action:=case p_action when 'approve' then 'approve_system_owner_pending_device'
    else 'reject_system_owner_pending_device' end;
  audit_action:=case p_action when 'approve' then 'pending_device_approved'
    else 'pending_device_rejected' end;
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
    and device_authorization.status='pending' and device_authorization.revoked_at is null
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
    raise exception 'PENDING_APPROVED_ACCOUNT_DEVICE_REQUIRED' using errcode='42501';
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
    revoked_by=case p_action when 'reject' then p_actor_user_id else null end,
    revoked_at=case p_action when 'reject' then pg_catalog.statement_timestamp() else null end,
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
    'devices','device_authorization.'||(case p_action when 'approve' then 'approved' else 'revoked' end),
    'user_device_authorization',target.id,'platform',
    pg_catalog.jsonb_build_object('status','pending'),
    pg_catalog.jsonb_build_object('status',case p_action when 'approve' then 'approved' else 'revoked' end),
    pg_catalog.jsonb_build_object('deviceId',p_target_device_id,'confirmation','webauthn'),
    null,p_operation_id,'system');
  update public.device_possession_challenges set consumed_at=pg_catalog.statement_timestamp()
  where id=p_challenge_id;
  return result;
end; $$;
revoke all on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)
  to service_role;

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
      when 'reject' then 'reject_system_owner_pending_device' else '' end) then
    raise exception 'PLATFORM_DEVICE_OPERATION_MISMATCH' using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object('status','completed','result',stored.stored_result);
end; $$;
revoke all on function public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text)
  to service_role;

commit;
