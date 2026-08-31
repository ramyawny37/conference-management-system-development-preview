-- One-time, Development-only recovery for the stable Platform browser identity.
-- This is deliberately target-bound and is not a general device-approval bypass.

create table platform_private.stable_device_recovery_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references platform.profiles(user_id) on delete restrict,
  source_authorization_id uuid not null unique references platform.user_device_authorizations(id) on delete restrict,
  source_device_id uuid not null unique references platform.devices(id) on delete restrict,
  target_authorization_id uuid not null unique references platform.user_device_authorizations(id) on delete restrict,
  target_device_id uuid not null unique references platform.devices(id) on delete restrict,
  actor_public_device_id uuid not null,
  credential_id uuid not null references public.device_security_credentials(id) on delete restrict,
  environment text not null check (environment = 'development_preview'),
  expected_origin text not null check (expected_origin = 'https://ramyawny37.github.io'),
  expected_rp_id text not null check (expected_rp_id = 'ramyawny37.github.io'),
  issued_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  operation_id uuid not null unique default extensions.gen_random_uuid(),
  reason text not null,
  check (source_device_id <> target_device_id),
  check (expires_at > issued_at and expires_at <= issued_at + interval '24 hours'),
  check (consumed_at is null or consumed_at between issued_at and expires_at)
);

create table platform_private.stable_device_recovery_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  recovery_authorization_id uuid not null unique references platform_private.stable_device_recovery_authorizations(id) on delete restrict,
  session_id uuid not null unique,
  challenge_hash bytea not null unique check (pg_catalog.octet_length(challenge_hash) = 32),
  credential_id uuid not null references public.device_security_credentials(id) on delete restrict,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  consumed_at timestamptz null,
  failed_at timestamptz null,
  failure_code text null,
  verification_context jsonb null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  check (expires_at > created_at and expires_at <= created_at + interval '2 minutes'),
  check (consumed_at is null or (verified_at is not null and consumed_at >= verified_at)),
  check ((failed_at is null) = (failure_code is null)),
  check (failed_at is null or consumed_at is null)
);

create table platform_private.stable_device_recovery_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  recovery_authorization_id uuid not null references platform_private.stable_device_recovery_authorizations(id) on delete restrict,
  challenge_id uuid null references platform_private.stable_device_recovery_challenges(id) on delete restrict,
  operation_id uuid not null,
  actor_user_id uuid not null,
  source_authorization_id uuid not null,
  source_device_id uuid not null,
  target_authorization_id uuid not null,
  target_device_id uuid not null,
  credential_id uuid not null,
  environment text not null,
  action text not null check (action in ('recovery_authorized','stable_device_approved')),
  result text not null check (result in ('issued','applied')),
  origin text not null,
  rp_id text not null,
  user_verified boolean not null,
  backup_eligible boolean not null,
  backup_state boolean not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.statement_timestamp()
);

create or replace function platform_private.prevent_stable_device_recovery_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'STABLE_DEVICE_RECOVERY_AUDIT_IMMUTABLE' using errcode = '55000';
end;
$$;
create trigger stable_device_recovery_audit_immutable
before update or delete on platform_private.stable_device_recovery_audit
for each row execute function platform_private.prevent_stable_device_recovery_audit_mutation();

create or replace function public.begin_stable_development_platform_device_recovery(
  p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid,
  p_session_id uuid, p_challenge_hash bytea, p_environment text
) returns jsonb language plpgsql security definer
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
  if not found then raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode = '42501'; end if;
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

create or replace function public.get_stable_development_platform_device_recovery_material(
  p_actor_user_id uuid, p_actor_device_id uuid, p_session_id uuid, p_challenge_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare challenge platform_private.stable_device_recovery_challenges%rowtype;
  recovery platform_private.stable_device_recovery_authorizations%rowtype;
  credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  select * into challenge from platform_private.stable_device_recovery_challenges item
    where item.id = p_challenge_id and item.session_id = p_session_id;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at <= pg_catalog.statement_timestamp() then
    raise exception 'STABLE_DEVICE_RECOVERY_CHALLENGE_INVALID' using errcode = '42501';
  end if;
  select * into recovery from platform_private.stable_device_recovery_authorizations item
    where item.id = challenge.recovery_authorization_id and item.owner_user_id = p_actor_user_id
      and item.actor_public_device_id = p_actor_device_id and item.consumed_at is null
      and pg_catalog.statement_timestamp() <= item.expires_at;
  if not found then raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode = '42501'; end if;
  credential := public.require_system_owner_webauthn_actor(p_actor_user_id,p_actor_device_id,challenge.credential_id);
  return pg_catalog.jsonb_build_object('credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'publicKeyCose',pg_catalog.translate(pg_catalog.encode(credential.public_key_cose,'base64'),E'\n\r',''),
    'signCount',credential.sign_count,'transports',credential.transports,
    'expectedOrigin',recovery.expected_origin,'expectedRpId',recovery.expected_rp_id);
end;
$$;

create or replace function public.complete_stable_development_platform_device_recovery(
  p_actor_user_id uuid, p_actor_device_id uuid, p_credential_id uuid,
  p_session_id uuid, p_challenge_id uuid, p_challenge_hash bytea,
  p_recovery_authorization_id uuid, p_operation_id uuid, p_environment text,
  p_new_sign_count bigint, p_origin text, p_rp_id text, p_verification_context jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare recovery platform_private.stable_device_recovery_authorizations%rowtype;
  challenge platform_private.stable_device_recovery_challenges%rowtype;
  credential public.device_security_credentials%rowtype;
  target platform.user_device_authorizations%rowtype;
begin
  perform public.require_platform_device_backend();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stable-device-recovery:'||p_recovery_authorization_id::text,0));
  credential := public.require_system_owner_webauthn_actor(p_actor_user_id,p_actor_device_id,p_credential_id);
  select * into recovery from platform_private.stable_device_recovery_authorizations item
    where item.id = p_recovery_authorization_id and item.operation_id = p_operation_id
      and item.owner_user_id = p_actor_user_id and item.actor_public_device_id = p_actor_device_id
      and item.credential_id = p_credential_id and item.environment = 'development_preview'
      and item.environment = p_environment and item.consumed_at is null
      and pg_catalog.statement_timestamp() between item.issued_at and item.expires_at for update;
  if not found then raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode = '42501'; end if;
  select * into challenge from platform_private.stable_device_recovery_challenges item
    where item.id = p_challenge_id and item.recovery_authorization_id = recovery.id
      and item.session_id = p_session_id and item.credential_id = p_credential_id
      and item.challenge_hash = p_challenge_hash for update;
  if not found or challenge.verified_at is not null or challenge.consumed_at is not null
    or challenge.failed_at is not null or challenge.expires_at <= pg_catalog.statement_timestamp()
    or pg_catalog.lower(p_origin) <> recovery.expected_origin
    or pg_catalog.lower(p_rp_id) <> recovery.expected_rp_id
    or p_new_sign_count < credential.sign_count
    or p_verification_context->'userVerified' is distinct from 'true'::jsonb
    or (p_verification_context->>'backupEligible')::boolean is distinct from credential.backup_eligible
    or (p_verification_context->>'backupState')::boolean is distinct from credential.backup_state
    or ((p_verification_context->>'backupState')::boolean
      and not (p_verification_context->>'backupEligible')::boolean) then
    raise exception 'STABLE_DEVICE_RECOVERY_VERIFICATION_INVALID' using errcode = '42501';
  end if;
  if not exists(select 1 from platform.profiles profile where profile.user_id=recovery.owner_user_id and profile.account_status='approved')
    or not exists(select 1 from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
      where assignment.user_id=recovery.owner_user_id and role.domain='platform' and role.code='platform_owner'
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.statement_timestamp()))
    or not exists(select 1 from platform.user_device_authorizations source_authorization join platform.devices source_device on source_device.id=source_authorization.device_id
      where source_authorization.id=recovery.source_authorization_id and source_authorization.user_id=recovery.owner_user_id
        and source_authorization.device_id=recovery.source_device_id and source_authorization.status='approved' and source_device.lifecycle_status='active') then
    raise exception 'STABLE_DEVICE_RECOVERY_OWNER_OR_SOURCE_INVALID' using errcode = '42501';
  end if;
  select * into target from platform.user_device_authorizations item
    where item.id=recovery.target_authorization_id and item.user_id=recovery.owner_user_id
      and item.device_id=recovery.target_device_id and item.status='pending' for update;
  if not found or not exists(select 1 from platform.devices device where device.id=recovery.target_device_id and device.lifecycle_status='active') then
    raise exception 'STABLE_DEVICE_RECOVERY_TARGET_INVALID' using errcode = '42501';
  end if;
  update platform_private.stable_device_recovery_challenges set verified_at=pg_catalog.statement_timestamp(),
    verification_context=p_verification_context where id=challenge.id;
  update public.device_security_credentials set sign_count=p_new_sign_count,last_used_at=pg_catalog.statement_timestamp()
    where id=credential.id;
  update platform.user_device_authorizations set status='approved',approved_by=recovery.owner_user_id,
    approved_at=pg_catalog.statement_timestamp(),status_reason='One-time stable Development origin WebAuthn recovery'
    where id=recovery.target_authorization_id;
  insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
    entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
  values(recovery.owner_user_id,recovery.source_authorization_id,recovery.owner_user_id,'platform','devices',
    'device_authorization.approved','user_device_authorization',recovery.target_authorization_id,'platform',
    pg_catalog.jsonb_build_object('status','pending'),pg_catalog.jsonb_build_object('status','approved'),
    pg_catalog.jsonb_build_object('recoveryAuthorizationId',recovery.id,'webauthnVerified',true),recovery.operation_id,'system');
  insert into platform_private.stable_device_recovery_audit(recovery_authorization_id,challenge_id,operation_id,
    actor_user_id,source_authorization_id,source_device_id,target_authorization_id,target_device_id,credential_id,
    environment,action,result,origin,rp_id,user_verified,backup_eligible,backup_state,evidence)
  values(recovery.id,challenge.id,recovery.operation_id,recovery.owner_user_id,recovery.source_authorization_id,
    recovery.source_device_id,recovery.target_authorization_id,recovery.target_device_id,recovery.credential_id,
    recovery.environment,'stable_device_approved','applied',recovery.expected_origin,recovery.expected_rp_id,true,
    credential.backup_eligible,credential.backup_state,
    pg_catalog.jsonb_build_object('challengeConsumed',true,'authorizationConsumed',true));
  update platform_private.stable_device_recovery_challenges set consumed_at=pg_catalog.statement_timestamp() where id=challenge.id;
  update platform_private.stable_device_recovery_authorizations set consumed_at=pg_catalog.statement_timestamp() where id=recovery.id;
  return pg_catalog.jsonb_build_object('status','applied','authorizationStatus','approved','operationId',recovery.operation_id);
end;
$$;

revoke all on table platform_private.stable_device_recovery_authorizations from public,anon,authenticated;
revoke all on table platform_private.stable_device_recovery_challenges from public,anon,authenticated;
revoke all on table platform_private.stable_device_recovery_audit from public,anon,authenticated;
revoke all on function public.begin_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,bytea,text) from public,anon,authenticated;
revoke all on function public.get_stable_development_platform_device_recovery_material(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.complete_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,uuid,bytea,uuid,uuid,text,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,bytea,text) to service_role;
grant execute on function public.get_stable_development_platform_device_recovery_material(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.complete_stable_development_platform_device_recovery(uuid,uuid,uuid,uuid,uuid,bytea,uuid,uuid,text,bigint,text,text,jsonb) to service_role;

do $$
declare owner_id uuid; source_auth uuid; source_device uuid; target_auth uuid; target_device uuid;
  public_actor_device uuid; active_credential uuid; recovery_id uuid; recovery_operation uuid;
begin
  select device_authorization.user_id,device_authorization.id,device_authorization.device_id
    into strict owner_id,source_auth,source_device
  from platform.user_device_authorizations device_authorization
  where device_authorization.device_id::text like '9bce8898-%' and device_authorization.status='approved';
  select device_authorization.id,device_authorization.device_id into strict target_auth,target_device
  from platform.user_device_authorizations device_authorization
  where device_authorization.user_id=owner_id and device_authorization.device_id::text like 'f9306733-%' and device_authorization.status='pending';
  if exists(select 1 from platform.user_device_authorizations device_authorization
      where device_authorization.device_id::text like 'b23ece81-%' and device_authorization.status='approved') then
    raise exception 'EXCLUDED_DEVICE_ALREADY_APPROVED' using errcode='42501';
  end if;
  select credential.device_id,credential.id into strict public_actor_device,active_credential
  from public.device_security_credentials credential
  where credential.user_id=owner_id and credential.credential_kind='platform_primary'
    and credential.lifecycle_status='active' and credential.user_verification_policy='required'
    and (not credential.backup_state or credential.backup_eligible);
  insert into platform_private.stable_device_recovery_authorizations(owner_user_id,source_authorization_id,
    source_device_id,target_authorization_id,target_device_id,actor_public_device_id,credential_id,environment,
    expected_origin,expected_rp_id,expires_at,reason)
  values(owner_id,source_auth,source_device,target_auth,target_device,public_actor_device,active_credential,
    'development_preview','https://ramyawny37.github.io','ramyawny37.github.io',
    pg_catalog.statement_timestamp()+interval '24 hours','Approved one-time stable Development origin onboarding')
  returning id,operation_id into recovery_id,recovery_operation;
  insert into platform_private.stable_device_recovery_audit(recovery_authorization_id,operation_id,actor_user_id,
    source_authorization_id,source_device_id,target_authorization_id,target_device_id,credential_id,environment,
    action,result,origin,rp_id,user_verified,backup_eligible,backup_state,evidence)
  values(recovery_id,recovery_operation,owner_id,source_auth,source_device,target_auth,target_device,active_credential,
    'development_preview','recovery_authorized','issued','https://ramyawny37.github.io','ramyawny37.github.io',
    false,false,false,pg_catalog.jsonb_build_object('oneTime',true,'targetBound',true));
end;
$$;
