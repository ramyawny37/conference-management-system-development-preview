-- Permit a fresh WebAuthn ceremony after an earlier recovery challenge expires,
-- while preserving every historical challenge and allowing at most one current
-- unresolved challenge for the one-time recovery authorization.

alter table platform_private.stable_device_recovery_challenges
  drop constraint if exists stable_device_recovery_challenges_recovery_authorization_id_key;

create unique index if not exists stable_device_recovery_one_unresolved_challenge
  on platform_private.stable_device_recovery_challenges(recovery_authorization_id)
  where verified_at is null and consumed_at is null and failed_at is null;

create or replace function public.begin_stable_development_platform_device_recovery(
  p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid,
  p_session_id uuid, p_challenge_hash bytea, p_environment text
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public as $$
declare
  recovery platform_private.stable_device_recovery_authorizations%rowtype;
  credential public.device_security_credentials%rowtype;
  challenge_id uuid;
begin
  perform public.require_platform_device_backend();
  if p_session_id is null or pg_catalog.octet_length(p_challenge_hash) <> 32
    or p_environment <> 'development_preview' then
    raise exception 'STABLE_DEVICE_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  credential := public.require_system_owner_webauthn_actor(
    p_actor_user_id, p_actor_device_id, p_credential_id
  );
  select * into recovery
  from platform_private.stable_device_recovery_authorizations recovery_item
  where recovery_item.owner_user_id = p_actor_user_id
    and recovery_item.actor_public_device_id = p_actor_device_id
    and recovery_item.credential_id = p_credential_id
    and recovery_item.environment = p_environment
    and recovery_item.consumed_at is null
    and pg_catalog.statement_timestamp() between recovery_item.issued_at and recovery_item.expires_at
  for update;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode = '42501';
  end if;
  if recovery.expected_origin <> 'https://ramyawny37.github.io'
    or recovery.expected_rp_id <> 'ramyawny37.github.io' then
    raise exception 'STABLE_DEVICE_RECOVERY_RP_BINDING_INVALID' using errcode = '42501';
  end if;
  if not exists(select 1 from platform.profiles profile
      where profile.user_id = recovery.owner_user_id and profile.account_status = 'approved')
    or not exists(select 1 from platform.user_roles assignment
      join platform.roles role on role.id = assignment.role_id
      where assignment.user_id = recovery.owner_user_id and role.domain = 'platform'
        and role.code = 'platform_owner' and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at > pg_catalog.statement_timestamp()))
    or not exists(select 1 from platform.user_device_authorizations source_authorization
      join platform.devices source_device on source_device.id = source_authorization.device_id
      where source_authorization.id = recovery.source_authorization_id
        and source_authorization.user_id = recovery.owner_user_id
        and source_authorization.device_id = recovery.source_device_id
        and source_authorization.status = 'approved' and source_device.lifecycle_status = 'active')
    or not exists(select 1 from platform.user_device_authorizations target_authorization
      join platform.devices target_device on target_device.id = target_authorization.device_id
      where target_authorization.id = recovery.target_authorization_id
        and target_authorization.user_id = recovery.owner_user_id
        and target_authorization.device_id = recovery.target_device_id
        and target_authorization.status = 'pending' and target_device.lifecycle_status = 'active') then
    raise exception 'STABLE_DEVICE_RECOVERY_LIVE_STATE_INVALID' using errcode = '42501';
  end if;

  update platform_private.stable_device_recovery_challenges challenge
  set failed_at = pg_catalog.statement_timestamp(), failure_code = 'expired_replaced'
  where challenge.recovery_authorization_id = recovery.id
    and challenge.verified_at is null and challenge.consumed_at is null
    and challenge.failed_at is null
    and challenge.expires_at <= pg_catalog.statement_timestamp();

  if exists(select 1
      from platform_private.stable_device_recovery_challenges challenge
      where challenge.recovery_authorization_id = recovery.id
        and challenge.verified_at is null and challenge.consumed_at is null
        and challenge.failed_at is null
        and challenge.expires_at > pg_catalog.statement_timestamp()) then
    raise exception 'STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE' using errcode = '55000';
  end if;

  insert into platform_private.stable_device_recovery_challenges(
    recovery_authorization_id, session_id, challenge_hash, credential_id, expires_at
  ) values(recovery.id, p_session_id, p_challenge_hash, credential.id,
    pg_catalog.statement_timestamp() + interval '2 minutes') returning id into challenge_id;
  return pg_catalog.jsonb_build_object(
    'status','challenge_created','challengeId',challenge_id,
    'recoveryAuthorizationId',recovery.id,'operationId',recovery.operation_id,
    'credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',pg_catalog.translate(pg_catalog.encode(credential.public_key_cose,'base64'),E'\n\r',''),
    'signCount',credential.sign_count,'transports',credential.transports
  );
end;
$$;

revoke all on function public.begin_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,bytea,text)
  from public,anon,authenticated;
grant execute on function public.begin_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,bytea,text)
  to service_role;
