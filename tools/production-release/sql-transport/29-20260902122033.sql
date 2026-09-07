-- Phase 1B: Supabase-owned short-lived device sessions established by bound-key proof.

create table platform_private.device_session_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  device_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  binding_id uuid not null references platform.device_key_bindings(id) on delete restrict,
  public_key_thumbprint text not null check (public_key_thumbprint ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose='PLATFORM_DEVICE_SESSION_ESTABLISH'),
  origin text not null check (origin='https://ramyawny37.github.io'),
  nonce text not null unique check (length(nonce) between 43 and 44),
  signing_payload text not null,
  signing_payload_hash bytea not null unique check (pg_catalog.octet_length(signing_payload_hash)=32),
  issued_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  session_id uuid null unique,
  failed_at timestamptz null,
  failure_code text null,
  check (expires_at>issued_at and expires_at<=issued_at+interval '2 minutes'),
  check ((consumed_at is null and session_id is null) or (consumed_at is not null and session_id is not null)),
  check ((failed_at is null)=(failure_code is null))
);

create unique index device_session_challenges_one_open_idx
  on platform_private.device_session_challenges(user_id,binding_id)
  where consumed_at is null and failed_at is null;

create table platform_private.device_sessions (
  id uuid primary key,
  user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  device_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  binding_id uuid not null references platform.device_key_bindings(id) on delete restrict,
  public_key_thumbprint text not null check (public_key_thumbprint ~ '^[0-9a-f]{64}$'),
  token_hash bytea not null unique check (pg_catalog.octet_length(token_hash)=32),
  purpose text not null check (purpose='PLATFORM_DEVICE_SESSION'),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  challenge_id uuid not null unique references platform_private.device_session_challenges(id) on delete restrict,
  check (expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);

create unique index device_sessions_one_active_binding_idx
  on platform_private.device_sessions(binding_id) where revoked_at is null;

create table platform_private.device_session_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  event text not null check (event='established'),
  session_id uuid not null unique references platform_private.device_sessions(id) on delete restrict,
  challenge_id uuid not null unique references platform_private.device_session_challenges(id) on delete restrict,
  user_id uuid not null,
  device_id uuid not null,
  device_authorization_id uuid not null,
  binding_id uuid not null,
  public_key_thumbprint text not null,
  purpose text not null check (purpose='PLATFORM_DEVICE_SESSION'),
  created_at timestamptz not null default pg_catalog.statement_timestamp()
);

create or replace function platform_private.prevent_device_session_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'DEVICE_SESSION_AUDIT_IMMUTABLE' using errcode='55000'; end;
$$;

create trigger device_session_audit_immutable before update or delete
  on platform_private.device_session_audit for each row
  execute function platform_private.prevent_device_session_audit_mutation();

alter table platform_private.device_session_challenges enable row level security;
alter table platform_private.device_session_challenges force row level security;
alter table platform_private.device_sessions enable row level security;
alter table platform_private.device_sessions force row level security;
alter table platform_private.device_session_audit enable row level security;
alter table platform_private.device_session_audit force row level security;

revoke all on platform_private.device_session_challenges from public,anon,authenticated,service_role;
revoke all on platform_private.device_sessions from public,anon,authenticated,service_role;
revoke all on platform_private.device_session_audit from public,anon,authenticated,service_role;

create or replace function platform.begin_device_session_challenge(p_binding_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare
  v_user uuid:=auth.uid();
  v_binding platform.device_key_bindings%rowtype;
  v_id uuid:=extensions.gen_random_uuid();
  v_nonce text;
  v_issued timestamptz:=statement_timestamp();
  v_expires timestamptz:=v_issued+interval '2 minutes';
  v_payload text;
begin
  if v_user is null or p_binding_id is null then
    raise exception 'DEVICE_SESSION_AUTH_REQUIRED' using errcode='42501';
  end if;

  select binding.* into v_binding
  from platform.device_key_bindings binding
  join platform.user_device_authorizations device_authorization
    on device_authorization.id=binding.device_authorization_id
    and device_authorization.user_id=binding.user_id and device_authorization.device_id=binding.device_id
  join platform.devices device on device.id=binding.device_id
  join platform.profiles profile on profile.user_id=binding.user_id
  where binding.id=p_binding_id and binding.user_id=v_user
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and binding.algorithm='ECDSA_P256_SHA256'
    and device_authorization.status='approved' and device_authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_BINDING_INVALID' using errcode='42501'; end if;

  update platform_private.device_session_challenges challenge
  set failed_at=v_issued,failure_code='EXPIRED_REPLACED'
  where challenge.user_id=v_user and challenge.binding_id=p_binding_id
    and challenge.consumed_at is null and challenge.failed_at is null and challenge.expires_at<=v_issued;

  if exists(select 1 from platform_private.device_session_challenges challenge
    where challenge.user_id=v_user and challenge.binding_id=p_binding_id
      and challenge.consumed_at is null and challenge.failed_at is null) then
    raise exception 'DEVICE_SESSION_CHALLENGE_ALREADY_OPEN' using errcode='55000';
  end if;

  v_nonce:=translate(encode(extensions.gen_random_bytes(32),'base64'),E'+/\n','-_');
  v_payload:='PLATFORM_DEVICE_SESSION_ESTABLISH'||chr(10)||'v1'||chr(10)||v_id||chr(10)||v_user||chr(10)||
    v_binding.device_id||chr(10)||v_binding.device_authorization_id||chr(10)||v_binding.id||chr(10)||
    v_binding.public_key_thumbprint||chr(10)||v_nonce||chr(10)||
    to_char(v_issued at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||chr(10)||
    to_char(v_expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||chr(10)||
    'https://ramyawny37.github.io';

  insert into platform_private.device_session_challenges(id,user_id,device_id,device_authorization_id,binding_id,
    public_key_thumbprint,purpose,origin,nonce,signing_payload,signing_payload_hash,issued_at,expires_at)
  values(v_id,v_user,v_binding.device_id,v_binding.device_authorization_id,v_binding.id,v_binding.public_key_thumbprint,
    'PLATFORM_DEVICE_SESSION_ESTABLISH','https://ramyawny37.github.io',v_nonce,v_payload,
    extensions.digest(v_payload,'sha256'),v_issued,v_expires);

  return jsonb_build_object('challengeId',v_id,'userId',v_user,'deviceId',v_binding.device_id,
    'authorizationId',v_binding.device_authorization_id,'bindingId',v_binding.id,
    'publicKeyThumbprint',v_binding.public_key_thumbprint,'purpose','PLATFORM_DEVICE_SESSION_ESTABLISH',
    'origin','https://ramyawny37.github.io','nonce',v_nonce,'issuedAt',v_issued,'expiresAt',v_expires,
    'signingPayload',v_payload);
end;
$$;

create or replace function platform.get_device_session_challenge_context(p_challenge_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_challenge platform_private.device_session_challenges%rowtype; v_jwk jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'DEVICE_SESSION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  select challenge into v_challenge
  from platform_private.device_session_challenges challenge
  join platform.device_key_bindings binding on binding.id=challenge.binding_id
  join platform.user_device_authorizations device_authorization on device_authorization.id=challenge.device_authorization_id
  join platform.devices device on device.id=challenge.device_id
  join platform.profiles profile on profile.user_id=challenge.user_id
  where challenge.id=p_challenge_id and challenge.user_id=p_user_id
    and challenge.purpose='PLATFORM_DEVICE_SESSION_ESTABLISH'
    and challenge.origin='https://ramyawny37.github.io'
    and challenge.consumed_at is null and challenge.failed_at is null and challenge.expires_at>statement_timestamp()
    and binding.user_id=challenge.user_id and binding.device_id=challenge.device_id
    and binding.device_authorization_id=challenge.device_authorization_id
    and binding.public_key_thumbprint=challenge.public_key_thumbprint
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and binding.algorithm='ECDSA_P256_SHA256'
    and device_authorization.user_id=challenge.user_id and device_authorization.device_id=challenge.device_id
    and device_authorization.status='approved' and device_authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_CHALLENGE_INVALID' using errcode='42501'; end if;
  select binding.public_key_jwk into strict v_jwk
    from platform.device_key_bindings binding where binding.id=v_challenge.binding_id;
  return jsonb_build_object('challengeId',v_challenge.id,'userId',v_challenge.user_id,'deviceId',v_challenge.device_id,
    'authorizationId',v_challenge.device_authorization_id,'bindingId',v_challenge.binding_id,
    'publicKeyThumbprint',v_challenge.public_key_thumbprint,'purpose',v_challenge.purpose,'origin',v_challenge.origin,
    'issuedAt',v_challenge.issued_at,'expiresAt',v_challenge.expires_at,'signingPayload',v_challenge.signing_payload,
    'publicKeyJwk',v_jwk);
end;
$$;

create or replace function platform.complete_device_session(
  p_challenge_id uuid,p_user_id uuid,p_device_id uuid,p_authorization_id uuid,p_binding_id uuid,
  p_public_key_thumbprint text,p_session_id uuid,p_token_hash bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_challenge platform_private.device_session_challenges%rowtype; v_now timestamptz:=statement_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'DEVICE_SESSION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  if p_session_id is null or pg_catalog.octet_length(p_token_hash)<>32 then
    raise exception 'DEVICE_SESSION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('device-session:'||p_challenge_id::text,0));
  select * into v_challenge from platform_private.device_session_challenges challenge
    where challenge.id=p_challenge_id for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.failed_at is not null
    or v_challenge.expires_at<=v_now or v_challenge.user_id<>p_user_id or v_challenge.device_id<>p_device_id
    or v_challenge.device_authorization_id<>p_authorization_id or v_challenge.binding_id<>p_binding_id
    or v_challenge.public_key_thumbprint<>p_public_key_thumbprint
    or v_challenge.purpose<>'PLATFORM_DEVICE_SESSION_ESTABLISH'
    or v_challenge.origin<>'https://ramyawny37.github.io' then
    raise exception 'DEVICE_SESSION_CHALLENGE_INVALID' using errcode='42501';
  end if;
  if not exists(select 1 from platform.device_key_bindings binding
    join platform.user_device_authorizations device_authorization on device_authorization.id=binding.device_authorization_id
    join platform.devices device on device.id=binding.device_id
    join platform.profiles profile on profile.user_id=binding.user_id
    where binding.id=p_binding_id and binding.user_id=p_user_id and binding.device_id=p_device_id
      and binding.device_authorization_id=p_authorization_id and binding.public_key_thumbprint=p_public_key_thumbprint
      and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active'
      and binding.revoked_at is null and binding.retired_at is null
      and device_authorization.user_id=p_user_id and device_authorization.device_id=p_device_id
      and device_authorization.status='approved' and device_authorization.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
      and profile.account_status='approved') then
    raise exception 'DEVICE_SESSION_AUTHORITY_INVALID' using errcode='42501';
  end if;

  update platform_private.device_sessions set revoked_at=v_now
    where binding_id=p_binding_id and revoked_at is null;
  insert into platform_private.device_sessions(id,user_id,device_id,device_authorization_id,binding_id,
    public_key_thumbprint,token_hash,purpose,created_at,expires_at,challenge_id)
  values(p_session_id,p_user_id,p_device_id,p_authorization_id,p_binding_id,p_public_key_thumbprint,p_token_hash,
    'PLATFORM_DEVICE_SESSION',v_now,v_now+interval '5 minutes',p_challenge_id);
  update platform_private.device_session_challenges
    set consumed_at=v_now,session_id=p_session_id where id=p_challenge_id;
  insert into platform_private.device_session_audit(event,session_id,challenge_id,user_id,device_id,
    device_authorization_id,binding_id,public_key_thumbprint,purpose)
  values('established',p_session_id,p_challenge_id,p_user_id,p_device_id,p_authorization_id,p_binding_id,
    p_public_key_thumbprint,'PLATFORM_DEVICE_SESSION');
  return jsonb_build_object('sessionId',p_session_id,'userId',p_user_id,'deviceId',p_device_id,
    'authorizationId',p_authorization_id,'bindingId',p_binding_id,'purpose','PLATFORM_DEVICE_SESSION',
    'issuedAt',v_now,'expiresAt',v_now+interval '5 minutes');
end;
$$;

create or replace function platform.verify_device_session(p_user_id uuid,p_session_id uuid,p_token_hash bytea)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' or pg_catalog.octet_length(p_token_hash)<>32 then
    raise exception 'DEVICE_SESSION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  select jsonb_build_object('valid',true,'sessionId',session.id,'userId',session.user_id,
    'deviceId',session.device_id,'authorizationId',session.device_authorization_id,'bindingId',session.binding_id,
    'purpose',session.purpose,'issuedAt',session.created_at,'expiresAt',session.expires_at)
  into v_result
  from platform_private.device_sessions session
  join platform.device_key_bindings binding on binding.id=session.binding_id
  join platform.user_device_authorizations device_authorization on device_authorization.id=session.device_authorization_id
  join platform.devices device on device.id=session.device_id
  join platform.profiles profile on profile.user_id=session.user_id
  where session.id=p_session_id and session.user_id=p_user_id
    and session.token_hash=p_token_hash and session.purpose='PLATFORM_DEVICE_SESSION'
    and session.revoked_at is null and session.expires_at>statement_timestamp()
    and binding.user_id=session.user_id and binding.device_id=session.device_id
    and binding.device_authorization_id=session.device_authorization_id
    and binding.public_key_thumbprint=session.public_key_thumbprint
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and device_authorization.user_id=session.user_id and device_authorization.device_id=session.device_id
    and device_authorization.status='approved' and device_authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if v_result is null then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  return v_result;
end;
$$;

revoke all on function platform.begin_device_session_challenge(uuid) from public,anon,authenticated,service_role;
revoke all on function platform.get_device_session_challenge_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function platform.complete_device_session(uuid,uuid,uuid,uuid,uuid,text,uuid,bytea) from public,anon,authenticated,service_role;
revoke all on function platform.verify_device_session(uuid,uuid,bytea) from public,anon,authenticated,service_role;
grant execute on function platform.begin_device_session_challenge(uuid) to authenticated;
grant execute on function platform.get_device_session_challenge_context(uuid,uuid) to service_role;
grant execute on function platform.complete_device_session(uuid,uuid,uuid,uuid,uuid,text,uuid,bytea) to service_role;
grant execute on function platform.verify_device_session(uuid,uuid,bytea) to service_role;
