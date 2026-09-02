-- Phase 1A: one-time, Development-only cryptographic ownership handoff.
-- The existing Platform device and authorization remain authoritative.

create table platform.device_key_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  device_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  public_key_jwk jsonb not null,
  public_key_thumbprint text not null check (public_key_thumbprint ~ '^[0-9a-f]{64}$'),
  algorithm text not null check (algorithm = 'ECDSA_P256_SHA256'),
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active','rotated','revoked','retired')),
  migration_source text not null check (migration_source in ('current_http_only_device_secret','bound_key_rotation','privileged_recovery')),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  activated_at timestamptz not null default pg_catalog.statement_timestamp(),
  replaced_by_binding_id uuid null references platform.device_key_bindings(id) on delete restrict,
  rotated_at timestamptz null, revoked_at timestamptz null, retired_at timestamptz null,
  audit_event_id uuid null references platform.audit_events(id) on delete restrict,
  unique (id,user_id,device_id,device_authorization_id),
  unique (device_id,public_key_thumbprint),
  check (public_key_jwk->>'kty' = 'EC' and public_key_jwk->>'crv' = 'P-256'
    and public_key_jwk ? 'x' and public_key_jwk ? 'y' and not (public_key_jwk ? 'd')),
  check ((lifecycle_status='active' and rotated_at is null and revoked_at is null and retired_at is null)
    or (lifecycle_status='rotated' and rotated_at is not null)
    or (lifecycle_status='revoked' and revoked_at is not null)
    or (lifecycle_status='retired' and retired_at is not null))
);
create unique index device_key_bindings_one_active_device_idx
  on platform.device_key_bindings(device_id) where lifecycle_status='active';

create table platform_private.device_ownership_handoff_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  device_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  purpose text not null check (purpose='PLATFORM_DEVICE_OWNERSHIP_HANDOFF'),
  public_key_thumbprint text not null check (public_key_thumbprint ~ '^[0-9a-f]{64}$'),
  nonce text not null unique check (length(nonce) between 43 and 44),
  signing_payload text not null,
  signing_payload_hash bytea not null unique check (pg_catalog.octet_length(signing_payload_hash)=32),
  issued_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  assertion_jti uuid null unique,
  assertion_hash bytea null unique,
  binding_id uuid null references platform.device_key_bindings(id) on delete restrict,
  failed_at timestamptz null, failure_code text null,
  check (expires_at>issued_at and expires_at<=issued_at+interval '2 minutes'),
  check ((consumed_at is null and binding_id is null) or (consumed_at is not null and binding_id is not null)),
  check ((failed_at is null)=(failure_code is null))
);
create unique index device_ownership_handoff_one_open_idx
  on platform_private.device_ownership_handoff_challenges(user_id,device_id)
  where consumed_at is null and failed_at is null;

create table platform_private.device_ownership_handoff_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null, device_id uuid not null, device_authorization_id uuid not null,
  binding_id uuid not null, public_key_thumbprint text not null,
  purpose text not null check (purpose='PLATFORM_DEVICE_OWNERSHIP_HANDOFF'),
  migration_source text not null check (migration_source='current_http_only_device_secret'),
  challenge_id uuid not null unique, assertion_jti uuid not null unique,
  created_at timestamptz not null default pg_catalog.statement_timestamp()
);

create or replace function platform_private.prevent_device_handoff_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'DEVICE_OWNERSHIP_HANDOFF_AUDIT_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger device_ownership_handoff_audit_immutable before update or delete
  on platform_private.device_ownership_handoff_audit for each row
  execute function platform_private.prevent_device_handoff_audit_mutation();

alter table platform.device_key_bindings enable row level security;
alter table platform.device_key_bindings force row level security;
revoke all on platform.device_key_bindings from public,anon,authenticated;
grant select on platform.device_key_bindings to authenticated;
create policy device_key_bindings_read_own on platform.device_key_bindings for select to authenticated
  using (user_id=(select auth.uid()));
revoke all on platform_private.device_ownership_handoff_challenges from public,anon,authenticated;
revoke all on platform_private.device_ownership_handoff_audit from public,anon,authenticated;

create or replace function platform.begin_current_device_ownership_handoff(p_public_key_thumbprint text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_user uuid:=auth.uid(); v_authorization uuid; v_device uuid;
  v_id uuid; v_nonce text; v_issued timestamptz:=statement_timestamp(); v_expires timestamptz;
  v_payload text;
begin
  if v_user is null or p_public_key_thumbprint !~ '^[0-9a-f]{64}$' then
    raise exception 'DEVICE_HANDOFF_ARGUMENT_INVALID' using errcode='22023';
  end if;
  v_authorization:=platform_private.current_device_authorization_id(v_user);
  if v_authorization is null then raise exception 'DEVICE_HANDOFF_CURRENT_DEVICE_REQUIRED' using errcode='42501'; end if;
  select authorization.device_id into strict v_device from platform.user_device_authorizations authorization
    join platform.devices device on device.id=authorization.device_id
    join platform.profiles profile on profile.user_id=authorization.user_id
    where authorization.id=v_authorization and authorization.user_id=v_user
      and authorization.status='approved' and authorization.revoked_at is null
      and device.lifecycle_status='active' and profile.account_status='approved';
  if v_device<>'f9306733-612d-433f-a38e-5d72855c2fe3'::uuid then
    raise exception 'DEVICE_HANDOFF_CANONICAL_DEVICE_MISMATCH' using errcode='42501';
  end if;
  if exists(select 1 from platform.device_key_bindings binding where binding.device_id=v_device and binding.lifecycle_status='active') then
    raise exception 'DEVICE_HANDOFF_BINDING_ALREADY_ACTIVE' using errcode='55000';
  end if;
  update platform_private.device_ownership_handoff_challenges challenge
    set failed_at=v_issued,failure_code='EXPIRED_REPLACED'
    where challenge.user_id=v_user and challenge.device_id=v_device and challenge.consumed_at is null
      and challenge.failed_at is null and challenge.expires_at<=v_issued;
  v_id:=extensions.gen_random_uuid();
  v_nonce:=translate(encode(extensions.gen_random_bytes(32),'base64'),E'+/\n','-_');
  v_expires:=v_issued+interval '2 minutes';
  v_payload:='PLATFORM_DEVICE_OWNERSHIP_HANDOFF'||chr(10)||v_id||chr(10)||v_user||chr(10)||v_device||chr(10)||v_authorization||chr(10)||p_public_key_thumbprint||chr(10)||v_nonce||chr(10)||
    to_char(v_issued at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||chr(10)||to_char(v_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  insert into platform_private.device_ownership_handoff_challenges(id,user_id,device_id,device_authorization_id,purpose,
    public_key_thumbprint,nonce,signing_payload,signing_payload_hash,issued_at,expires_at)
  values(v_id,v_user,v_device,v_authorization,'PLATFORM_DEVICE_OWNERSHIP_HANDOFF',p_public_key_thumbprint,v_nonce,
    v_payload,extensions.digest(v_payload,'sha256'),v_issued,v_expires);
  return jsonb_build_object('challengeId',v_id,'userId',v_user,'deviceId',v_device,'authorizationId',v_authorization,
    'purpose','PLATFORM_DEVICE_OWNERSHIP_HANDOFF','publicKeyThumbprint',p_public_key_thumbprint,
    'signingPayload',v_payload,'issuedAt',v_issued,'expiresAt',v_expires);
end;
$$;

create or replace function platform.get_current_device_handoff_assertion_claims(p_challenge_id uuid,p_public_key_thumbprint text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_user uuid:=auth.uid(); v_authorization uuid; challenge platform_private.device_ownership_handoff_challenges%rowtype;
begin
  v_authorization:=platform_private.current_device_authorization_id(v_user);
  select * into challenge from platform_private.device_ownership_handoff_challenges item where item.id=p_challenge_id;
  if not found or challenge.user_id<>v_user or challenge.device_authorization_id<>v_authorization
    or challenge.device_id<>'f9306733-612d-433f-a38e-5d72855c2fe3'::uuid
    or challenge.public_key_thumbprint<>p_public_key_thumbprint or challenge.purpose<>'PLATFORM_DEVICE_OWNERSHIP_HANDOFF'
    or challenge.consumed_at is not null or challenge.failed_at is not null or challenge.expires_at<=statement_timestamp() then
    raise exception 'DEVICE_HANDOFF_ASSERTION_CLAIMS_DENIED' using errcode='42501';
  end if;
  return jsonb_build_object('userId',challenge.user_id,'deviceId',challenge.device_id,
    'authorizationId',challenge.device_authorization_id,'challengeId',challenge.id,
    'publicKeyThumbprint',challenge.public_key_thumbprint,'purpose',challenge.purpose,
    'signingPayload',challenge.signing_payload,'challengeExpiresAt',challenge.expires_at);
end;
$$;

create or replace function platform.complete_device_ownership_handoff(
  p_user_id uuid,p_device_id uuid,p_authorization_id uuid,p_challenge_id uuid,p_public_key_thumbprint text,
  p_public_key_jwk jsonb,p_assertion_jti uuid,p_assertion_hash bytea,p_assertion_issued_at timestamptz,p_assertion_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare challenge platform_private.device_ownership_handoff_challenges%rowtype; v_binding uuid; v_audit uuid; v_platform_audit uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'DEVICE_HANDOFF_BACKEND_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('device-handoff:'||p_challenge_id::text,0));
  select * into challenge from platform_private.device_ownership_handoff_challenges item where item.id=p_challenge_id for update;
  if not found or challenge.consumed_at is not null or challenge.failed_at is not null
    or challenge.expires_at<=statement_timestamp() or p_assertion_expires_at<=statement_timestamp()
    or p_assertion_expires_at>p_assertion_issued_at+interval '2 minutes'
    or challenge.user_id<>p_user_id or challenge.device_id<>p_device_id
    or challenge.device_authorization_id<>p_authorization_id or challenge.public_key_thumbprint<>p_public_key_thumbprint
    or challenge.purpose<>'PLATFORM_DEVICE_OWNERSHIP_HANDOFF' or p_device_id<>'f9306733-612d-433f-a38e-5d72855c2fe3'::uuid
    or pg_catalog.octet_length(p_assertion_hash)<>32 then
    raise exception 'DEVICE_HANDOFF_FINALIZATION_DENIED' using errcode='42501';
  end if;
  if not exists(select 1 from platform.user_device_authorizations authorization
      join platform.devices device on device.id=authorization.device_id
      join platform.profiles profile on profile.user_id=authorization.user_id
      where authorization.id=p_authorization_id and authorization.user_id=p_user_id and authorization.device_id=p_device_id
        and authorization.status='approved' and authorization.revoked_at is null and device.lifecycle_status='active'
        and profile.account_status='approved') then
    raise exception 'DEVICE_HANDOFF_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  insert into platform.device_key_bindings(user_id,device_id,device_authorization_id,public_key_jwk,
    public_key_thumbprint,algorithm,lifecycle_status,migration_source)
  values(p_user_id,p_device_id,p_authorization_id,p_public_key_jwk,p_public_key_thumbprint,
    'ECDSA_P256_SHA256','active','current_http_only_device_secret') returning id into v_binding;
  insert into platform_private.device_ownership_handoff_audit(user_id,device_id,device_authorization_id,binding_id,
    public_key_thumbprint,purpose,migration_source,challenge_id,assertion_jti)
  values(p_user_id,p_device_id,p_authorization_id,v_binding,p_public_key_thumbprint,'PLATFORM_DEVICE_OWNERSHIP_HANDOFF',
    'current_http_only_device_secret',p_challenge_id,p_assertion_jti) returning id into v_audit;
  insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
    entity_type,entity_id,scope_type,new_values,metadata,operation_id,source)
  values(p_user_id,p_authorization_id,p_user_id,'platform','devices','device_key_binding.activated',
    'device_key_binding',v_binding,'platform',jsonb_build_object('lifecycleStatus','active'),
    jsonb_build_object('deviceId',p_device_id,'authorizationId',p_authorization_id,'bindingId',v_binding,
      'publicKeyThumbprint',p_public_key_thumbprint,'purpose','PLATFORM_DEVICE_OWNERSHIP_HANDOFF',
      'migrationSource','current_http_only_device_secret','challengeId',p_challenge_id,'assertionJti',p_assertion_jti),
    p_assertion_jti,'system') returning id into v_platform_audit;
  update platform_private.device_ownership_handoff_challenges set consumed_at=statement_timestamp(),assertion_jti=p_assertion_jti,
    assertion_hash=p_assertion_hash,binding_id=v_binding where id=p_challenge_id;
  update platform.device_key_bindings set audit_event_id=v_platform_audit where id=v_binding;
  return jsonb_build_object('status','active','bindingId',v_binding,'deviceId',p_device_id,
    'authorizationId',p_authorization_id,'publicKeyThumbprint',p_public_key_thumbprint,'auditId',v_audit);
end;
$$;

create or replace function platform.get_my_device_key_binding_status()
returns jsonb language sql stable security definer set search_path=pg_catalog,platform as $$
  select coalesce((select jsonb_build_object('status',binding.lifecycle_status,'bindingId',binding.id,
    'deviceId',binding.device_id,'authorizationId',binding.device_authorization_id,
    'publicKeyThumbprint',binding.public_key_thumbprint,'algorithm',binding.algorithm)
    from platform.device_key_bindings binding join platform.user_device_authorizations authorization
      on authorization.id=binding.device_authorization_id and authorization.user_id=binding.user_id and authorization.device_id=binding.device_id
    join platform.devices device on device.id=binding.device_id join platform.profiles profile on profile.user_id=binding.user_id
    where binding.user_id=auth.uid() and binding.lifecycle_status='active' and authorization.status='approved'
      and authorization.revoked_at is null and device.lifecycle_status='active' and profile.account_status='approved'
    order by binding.activated_at desc limit 1),jsonb_build_object('status','missing'));
$$;

revoke all on function platform.begin_current_device_ownership_handoff(text) from public,anon,authenticated;
revoke all on function platform.get_current_device_handoff_assertion_claims(uuid,text) from public,anon,authenticated;
revoke all on function platform.complete_device_ownership_handoff(uuid,uuid,uuid,uuid,text,jsonb,uuid,bytea,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function platform.get_my_device_key_binding_status() from public,anon,authenticated;
grant execute on function platform.begin_current_device_ownership_handoff(text) to authenticated;
grant execute on function platform.get_current_device_handoff_assertion_claims(uuid,text) to authenticated;
grant execute on function platform.complete_device_ownership_handoff(uuid,uuid,uuid,uuid,text,jsonb,uuid,bytea,timestamptz,timestamptz) to service_role;
grant execute on function platform.get_my_device_key_binding_status() to authenticated;
