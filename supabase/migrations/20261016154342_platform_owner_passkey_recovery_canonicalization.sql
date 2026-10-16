-- Canonical Development-only platform-owner recovery.
-- The reviewed grant is bound to the current MacIntel device. Password auth may
-- use the grant, but can neither create it nor complete it without WebAuthn.

alter table platform_private.stable_device_recovery_authorizations
  alter column source_authorization_id drop not null,
  alter column source_device_id drop not null;

alter table platform_private.stable_device_recovery_audit
  alter column source_authorization_id drop not null,
  alter column source_device_id drop not null;

alter table platform_private.stable_device_recovery_authorizations
  add column if not exists issuance_basis text not null default 'legacy_approved_device',
  add column if not exists review_reference text null;

alter table platform_private.stable_device_recovery_authorizations
  drop constraint if exists stable_device_recovery_authorizations_issuance_basis_check;
alter table platform_private.stable_device_recovery_authorizations
  add constraint stable_device_recovery_authorizations_issuance_basis_check
  check (issuance_basis in ('legacy_approved_device','reviewed_platform_owner_passkey_recovery'));

alter table platform_private.stable_device_recovery_audit
  drop constraint if exists stable_device_recovery_audit_action_check,
  drop constraint if exists stable_device_recovery_audit_result_check;
alter table platform_private.stable_device_recovery_audit
  add constraint stable_device_recovery_audit_action_check
    check (action in ('recovery_authorized','stable_device_approved','passkey_verification_failed')),
  add constraint stable_device_recovery_audit_result_check
    check (result in ('issued','applied','denied'));

create or replace function platform_private.require_platform_owner_recovery_credential(
  p_owner_user_id uuid,p_credential_id uuid
) returns public.device_security_credentials language plpgsql security definer
set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if not platform_private.is_canonical_platform_owner(p_owner_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  select * into credential from public.device_security_credentials stored
  where stored.id=p_credential_id and stored.user_id=p_owner_user_id
    and stored.credential_kind='platform_primary'
    and stored.lifecycle_status='active'
    and stored.user_verification_policy='required'
    and (not stored.backup_state or stored.backup_eligible)
  for update;
  if not found then
    raise exception 'ACTIVE_PLATFORM_RECOVERY_CREDENTIAL_REQUIRED' using errcode='42501';
  end if;
  return credential;
end; $$;
revoke all on function platform_private.require_platform_owner_recovery_credential(uuid,uuid)
  from public,anon,authenticated;
grant execute on function platform_private.require_platform_owner_recovery_credential(uuid,uuid)
  to service_role;

create or replace function public.get_stable_development_platform_device_recovery_state(
  p_actor_user_id uuid,p_actor_device_id uuid
) returns jsonb language plpgsql volatile security definer
set search_path='' as $$
declare recovery platform_private.stable_device_recovery_authorizations%rowtype;
  credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if p_actor_user_id is null or p_actor_device_id is null then
    raise exception 'STABLE_DEVICE_RECOVERY_TARGET_REQUIRED' using errcode='22023';
  end if;
  select * into recovery
  from platform_private.stable_device_recovery_authorizations item
  where item.owner_user_id=p_actor_user_id
    and item.target_device_id=p_actor_device_id
    and item.issuance_basis='reviewed_platform_owner_passkey_recovery'
    and item.environment='development_preview'
    and item.expected_origin='https://ramyawny37.github.io'
    and item.expected_rp_id='ramyawny37.github.io'
    and item.review_reference is not null
    and item.consumed_at is null
    and pg_catalog.statement_timestamp() between item.issued_at and item.expires_at
  for update;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  if not exists(select 1 from platform.user_device_authorizations target_authorization
      join platform.devices device on device.id=target_authorization.device_id
      where target_authorization.id=recovery.target_authorization_id
        and target_authorization.user_id=recovery.owner_user_id
        and target_authorization.device_id=recovery.target_device_id
        and target_authorization.status='pending' and target_authorization.revoked_at is null
        and device.lifecycle_status='active' and device.retired_at is null
        and device.compromised_at is null) then
    raise exception 'STABLE_DEVICE_RECOVERY_TARGET_INVALID' using errcode='42501';
  end if;
  credential:=platform_private.require_platform_owner_recovery_credential(
    recovery.owner_user_id,recovery.credential_id);
  return pg_catalog.jsonb_build_object('status','ready','credentialId',credential.id,
    'targetDeviceId',recovery.target_device_id);
end; $$;

create or replace function public.begin_stable_development_platform_device_recovery(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,
  p_session_id uuid,p_challenge_hash bytea,p_environment text
) returns jsonb language plpgsql volatile security definer
set search_path='' as $$
declare recovery platform_private.stable_device_recovery_authorizations%rowtype;
  credential public.device_security_credentials%rowtype; challenge_id uuid;
begin
  perform public.require_platform_device_backend();
  if p_actor_user_id is null or p_actor_device_id is null or p_session_id is null
    or pg_catalog.octet_length(p_challenge_hash)<>32
    or p_environment<>'development_preview' then
    raise exception 'STABLE_DEVICE_RECOVERY_ARGUMENT_INVALID' using errcode='22023';
  end if;
  select * into recovery
  from platform_private.stable_device_recovery_authorizations item
  where item.owner_user_id=p_actor_user_id and item.target_device_id=p_actor_device_id
    and item.credential_id=p_credential_id
    and item.issuance_basis='reviewed_platform_owner_passkey_recovery'
    and item.review_reference is not null and item.environment=p_environment
    and item.expected_origin='https://ramyawny37.github.io'
    and item.expected_rp_id='ramyawny37.github.io'
    and item.consumed_at is null
    and pg_catalog.statement_timestamp() between item.issued_at and item.expires_at
  for update;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  credential:=platform_private.require_platform_owner_recovery_credential(
    recovery.owner_user_id,recovery.credential_id);
  if not exists(select 1 from platform.user_device_authorizations target_authorization
      join platform.devices device on device.id=target_authorization.device_id
      where target_authorization.id=recovery.target_authorization_id
        and target_authorization.user_id=recovery.owner_user_id
        and target_authorization.device_id=recovery.target_device_id
        and target_authorization.status='pending' and target_authorization.revoked_at is null
        and device.lifecycle_status='active' and device.retired_at is null
        and device.compromised_at is null) then
    raise exception 'STABLE_DEVICE_RECOVERY_TARGET_INVALID' using errcode='42501';
  end if;
  update platform_private.stable_device_recovery_challenges challenge
  set failed_at=pg_catalog.statement_timestamp(),failure_code='expired_replaced'
  where challenge.recovery_authorization_id=recovery.id
    and challenge.verified_at is null and challenge.consumed_at is null
    and challenge.failed_at is null
    and challenge.expires_at<=pg_catalog.statement_timestamp();
  if exists(select 1 from platform_private.stable_device_recovery_challenges challenge
      where challenge.recovery_authorization_id=recovery.id
        and challenge.verified_at is null and challenge.consumed_at is null
        and challenge.failed_at is null
        and challenge.expires_at>pg_catalog.statement_timestamp()) then
    raise exception 'STABLE_DEVICE_RECOVERY_CHALLENGE_ACTIVE' using errcode='55000';
  end if;
  insert into platform_private.stable_device_recovery_challenges(
    recovery_authorization_id,session_id,challenge_hash,credential_id,expires_at)
  values(recovery.id,p_session_id,p_challenge_hash,credential.id,
    pg_catalog.statement_timestamp()+interval '2 minutes') returning id into challenge_id;
  return pg_catalog.jsonb_build_object('status','challenge_created','challengeId',challenge_id,
    'recoveryAuthorizationId',recovery.id,'operationId',recovery.operation_id,
    'credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',pg_catalog.translate(pg_catalog.encode(credential.public_key_cose,'base64'),E'\n\r',''),
    'signCount',credential.sign_count,'transports',credential.transports);
end; $$;

create or replace function public.get_stable_development_platform_device_recovery_material(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_challenge_id uuid
) returns jsonb language plpgsql volatile security definer
set search_path='' as $$
declare challenge platform_private.stable_device_recovery_challenges%rowtype;
  recovery platform_private.stable_device_recovery_authorizations%rowtype;
  credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  select * into challenge from platform_private.stable_device_recovery_challenges item
  where item.id=p_challenge_id and item.session_id=p_session_id for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=pg_catalog.statement_timestamp() then
    raise exception 'STABLE_DEVICE_RECOVERY_CHALLENGE_INVALID' using errcode='42501';
  end if;
  select * into recovery from platform_private.stable_device_recovery_authorizations item
  where item.id=challenge.recovery_authorization_id and item.owner_user_id=p_actor_user_id
    and item.target_device_id=p_actor_device_id
    and item.issuance_basis='reviewed_platform_owner_passkey_recovery'
    and item.consumed_at is null and pg_catalog.statement_timestamp()<=item.expires_at;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  credential:=platform_private.require_platform_owner_recovery_credential(
    recovery.owner_user_id,challenge.credential_id);
  return pg_catalog.jsonb_build_object('credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',pg_catalog.translate(pg_catalog.encode(credential.public_key_cose,'base64'),E'\n\r',''),
    'signCount',credential.sign_count,'transports',credential.transports,
    'expectedOrigin',recovery.expected_origin,'expectedRpId',recovery.expected_rp_id,
    'targetDeviceId',recovery.target_device_id);
end; $$;

create or replace function public.fail_stable_development_platform_device_recovery(
  p_actor_user_id uuid,p_actor_device_id uuid,p_session_id uuid,p_challenge_id uuid,
  p_failure_code text
) returns jsonb language plpgsql volatile security definer
set search_path='' as $$
declare challenge platform_private.stable_device_recovery_challenges%rowtype;
  recovery platform_private.stable_device_recovery_authorizations%rowtype;
begin
  perform public.require_platform_device_backend();
  if p_failure_code not in ('ASSERTION_VERIFICATION_FAILED','ASSERTION_NOT_VERIFIED',
      'CREDENTIAL_POLICY_DENIED') then
    raise exception 'STABLE_DEVICE_RECOVERY_FAILURE_CODE_INVALID' using errcode='22023';
  end if;
  select * into challenge from platform_private.stable_device_recovery_challenges item
  where item.id=p_challenge_id and item.session_id=p_session_id for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null then
    return pg_catalog.jsonb_build_object('status','unchanged');
  end if;
  select * into recovery from platform_private.stable_device_recovery_authorizations item
  where item.id=challenge.recovery_authorization_id and item.owner_user_id=p_actor_user_id
    and item.target_device_id=p_actor_device_id and item.consumed_at is null;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  update platform_private.stable_device_recovery_challenges
  set failed_at=pg_catalog.statement_timestamp(),failure_code=p_failure_code where id=challenge.id;
  insert into platform_private.stable_device_recovery_audit(
    recovery_authorization_id,challenge_id,operation_id,actor_user_id,
    source_authorization_id,source_device_id,target_authorization_id,target_device_id,
    credential_id,environment,action,result,origin,rp_id,user_verified,
    backup_eligible,backup_state,evidence)
  values(recovery.id,challenge.id,recovery.operation_id,recovery.owner_user_id,null,null,
    recovery.target_authorization_id,recovery.target_device_id,recovery.credential_id,
    recovery.environment,'passkey_verification_failed','denied',recovery.expected_origin,
    recovery.expected_rp_id,false,false,false,
    pg_catalog.jsonb_build_object('failureCode',p_failure_code));
  return pg_catalog.jsonb_build_object('status','failed');
end; $$;

create or replace function public.complete_stable_development_platform_device_recovery(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid,
  p_session_id uuid,p_challenge_id uuid,p_challenge_hash bytea,
  p_recovery_authorization_id uuid,p_operation_id uuid,p_environment text,
  p_new_sign_count bigint,p_origin text,p_rp_id text,p_verification_context jsonb
) returns jsonb language plpgsql volatile security definer
set search_path='' as $$
declare recovery platform_private.stable_device_recovery_authorizations%rowtype;
  challenge platform_private.stable_device_recovery_challenges%rowtype;
  credential public.device_security_credentials%rowtype;
  target platform.user_device_authorizations%rowtype;
begin
  perform public.require_platform_device_backend();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'stable-device-recovery:'||p_recovery_authorization_id::text,0));
  select * into recovery from platform_private.stable_device_recovery_authorizations item
  where item.id=p_recovery_authorization_id and item.operation_id=p_operation_id
    and item.owner_user_id=p_actor_user_id and item.target_device_id=p_actor_device_id
    and item.credential_id=p_credential_id
    and item.issuance_basis='reviewed_platform_owner_passkey_recovery'
    and item.review_reference is not null and item.environment='development_preview'
    and item.environment=p_environment and item.consumed_at is null
    and pg_catalog.statement_timestamp() between item.issued_at and item.expires_at for update;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  credential:=platform_private.require_platform_owner_recovery_credential(
    recovery.owner_user_id,recovery.credential_id);
  select * into challenge from platform_private.stable_device_recovery_challenges item
  where item.id=p_challenge_id and item.recovery_authorization_id=recovery.id
    and item.session_id=p_session_id and item.credential_id=p_credential_id
    and item.challenge_hash=p_challenge_hash for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at<=pg_catalog.statement_timestamp()
    or pg_catalog.lower(p_origin)<>recovery.expected_origin
    or pg_catalog.lower(p_rp_id)<>recovery.expected_rp_id
    or p_new_sign_count<credential.sign_count
    or p_verification_context->'userVerified' is distinct from 'true'::jsonb
    or (p_verification_context->>'backupEligible')::boolean is distinct from credential.backup_eligible
    or (p_verification_context->>'backupState')::boolean is distinct from credential.backup_state
    or ((p_verification_context->>'backupState')::boolean
      and not (p_verification_context->>'backupEligible')::boolean) then
    raise exception 'STABLE_DEVICE_RECOVERY_VERIFICATION_INVALID' using errcode='42501';
  end if;
  select * into target from platform.user_device_authorizations item
  where item.id=recovery.target_authorization_id and item.user_id=recovery.owner_user_id
    and item.device_id=recovery.target_device_id and item.status='pending'
    and item.revoked_at is null for update;
  if not found or not exists(select 1 from platform.devices device
      where device.id=recovery.target_device_id and device.lifecycle_status='active'
        and device.retired_at is null and device.compromised_at is null) then
    raise exception 'STABLE_DEVICE_RECOVERY_TARGET_INVALID' using errcode='42501';
  end if;
  update platform_private.stable_device_recovery_challenges
  set verified_at=pg_catalog.statement_timestamp(),verification_context=p_verification_context
  where id=challenge.id;
  update public.device_security_credentials
  set sign_count=p_new_sign_count,last_used_at=pg_catalog.statement_timestamp()
  where id=credential.id;
  update platform.user_device_authorizations
  set status='approved',approved_by=recovery.owner_user_id,
    approved_at=pg_catalog.statement_timestamp(),
    status_reason='Reviewed Development platform-owner passkey recovery'
  where id=recovery.target_authorization_id;
  insert into platform.audit_events(actor_user_id,actor_device_authorization_id,
    subject_user_id,domain,module,action,entity_type,entity_id,scope_type,
    old_values,new_values,metadata,operation_id,source)
  values(recovery.owner_user_id,null,recovery.owner_user_id,'platform','devices',
    'device_authorization.approved','user_device_authorization',
    recovery.target_authorization_id,'platform',
    pg_catalog.jsonb_build_object('status','pending'),
    pg_catalog.jsonb_build_object('status','approved'),
    pg_catalog.jsonb_build_object('recoveryAuthorizationId',recovery.id,
      'webauthnVerified',true,'issuanceBasis',recovery.issuance_basis,
      'reviewReference',recovery.review_reference),recovery.operation_id,'system');
  insert into platform_private.stable_device_recovery_audit(
    recovery_authorization_id,challenge_id,operation_id,actor_user_id,
    source_authorization_id,source_device_id,target_authorization_id,target_device_id,
    credential_id,environment,action,result,origin,rp_id,user_verified,
    backup_eligible,backup_state,evidence)
  values(recovery.id,challenge.id,recovery.operation_id,recovery.owner_user_id,null,null,
    recovery.target_authorization_id,recovery.target_device_id,recovery.credential_id,
    recovery.environment,'stable_device_approved','applied',recovery.expected_origin,
    recovery.expected_rp_id,true,credential.backup_eligible,credential.backup_state,
    pg_catalog.jsonb_build_object('challengeConsumed',true,'authorizationConsumed',true,
      'issuanceBasis',recovery.issuance_basis,'reviewReference',recovery.review_reference));
  update platform_private.stable_device_recovery_challenges
  set consumed_at=pg_catalog.statement_timestamp() where id=challenge.id;
  update platform_private.stable_device_recovery_authorizations
  set consumed_at=pg_catalog.statement_timestamp() where id=recovery.id;
  return pg_catalog.jsonb_build_object('status','applied',
    'authorizationStatus','approved','operationId',recovery.operation_id,
    'targetDeviceId',recovery.target_device_id);
end; $$;

revoke all on function public.get_stable_development_platform_device_recovery_state(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.begin_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,bytea,text)
  from public,anon,authenticated;
revoke all on function public.get_stable_development_platform_device_recovery_material(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.fail_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.complete_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,uuid,bytea,uuid,uuid,text,bigint,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.get_stable_development_platform_device_recovery_state(uuid,uuid)
  to service_role;
grant execute on function public.begin_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,bytea,text)
  to service_role;
grant execute on function public.get_stable_development_platform_device_recovery_material(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.fail_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.complete_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,uuid,bytea,uuid,uuid,text,bigint,text,text,jsonb)
  to service_role;

do $$
declare owner_id constant uuid:='916c0d83-4c5a-4a9e-89bb-4faa671166f7';
  target_authorization constant uuid:='9a7b9795-33c4-4c75-ba89-9e42e4456442';
  target_device constant uuid:='9bd5edb6-c92a-4dd3-a3d5-80c5ebb74d78';
  active_credential constant uuid:='2106a2d2-d214-4705-bc4f-01262d9581fb';
  recovery_id uuid; recovery_operation uuid;
begin
  if not platform_private.is_canonical_platform_owner(owner_id)
    or not exists(select 1 from platform.user_device_authorizations target_item
      join platform.devices device on device.id=target_item.device_id
      where target_item.id=target_authorization and target_item.user_id=owner_id
        and target_item.device_id=target_device and target_item.status='pending'
        and target_item.revoked_at is null and device.lifecycle_status='active'
        and device.platform='MacIntel' and device.retired_at is null
        and device.compromised_at is null)
    or not exists(select 1 from public.device_security_credentials credential
      where credential.id=active_credential and credential.user_id=owner_id
        and credential.credential_kind='platform_primary'
        and credential.lifecycle_status='active' and credential.backup_eligible=true
        and credential.backup_state=true
        and credential.user_verification_policy='required') then
    raise exception 'REVIEWED_RECOVERY_ISSUANCE_STATE_INVALID' using errcode='42501';
  end if;
  insert into platform_private.stable_device_recovery_authorizations(
    owner_user_id,source_authorization_id,source_device_id,target_authorization_id,
    target_device_id,actor_public_device_id,credential_id,environment,expected_origin,
    expected_rp_id,expires_at,reason,issuance_basis,review_reference)
  values(owner_id,null,null,target_authorization,target_device,target_device,active_credential,
    'development_preview','https://ramyawny37.github.io','ramyawny37.github.io',
    pg_catalog.statement_timestamp()+interval '24 hours',
    'Reviewed recovery for the current MacIntel browser identity using the enrolled owner passkey',
    'reviewed_platform_owner_passkey_recovery',
    'PLATFORM_OWNER_PASSKEY_RECOVERY_20261016_CURRENT_MACINTEL')
  returning id,operation_id into recovery_id,recovery_operation;
  insert into platform_private.stable_device_recovery_audit(
    recovery_authorization_id,operation_id,actor_user_id,source_authorization_id,
    source_device_id,target_authorization_id,target_device_id,credential_id,environment,
    action,result,origin,rp_id,user_verified,backup_eligible,backup_state,evidence)
  values(recovery_id,recovery_operation,owner_id,null,null,target_authorization,target_device,
    active_credential,'development_preview','recovery_authorized','issued',
    'https://ramyawny37.github.io','ramyawny37.github.io',false,true,true,
    pg_catalog.jsonb_build_object('oneTime',true,'targetBound',true,'expiresIn','24 hours',
      'targetPlatform','MacIntel','independentOfApprovedDevice',true,
      'reviewReference','PLATFORM_OWNER_PASSKEY_RECOVERY_20261016_CURRENT_MACINTEL'));
end $$;
