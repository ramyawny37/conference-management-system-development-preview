begin;

create extension if not exists pgcrypto;
create schema auth;
create schema platform;
create schema platform_private;

create function auth.role() returns text language sql stable as $$
  select current_setting('request.jwt.claim.role',true)
$$;

create table platform.profiles(user_id uuid primary key,account_status text not null);
create table platform.devices(id uuid primary key,lifecycle_status text not null,retired_at timestamptz,compromised_at timestamptz);
create table platform.user_device_authorizations(id uuid primary key,user_id uuid not null,device_id uuid not null,status text not null,revoked_at timestamptz);
create table platform.device_key_bindings(id uuid primary key,user_id uuid not null,device_id uuid not null,device_authorization_id uuid not null,public_key_thumbprint text not null,algorithm text not null,lifecycle_status text not null,revoked_at timestamptz,retired_at timestamptz);
create table platform_private.device_session_challenges(id uuid primary key,user_id uuid not null,device_id uuid not null,device_authorization_id uuid not null,binding_id uuid not null,public_key_thumbprint text not null,purpose text not null,origin text not null,issued_at timestamptz not null,expires_at timestamptz not null,consumed_at timestamptz,session_id uuid,failed_at timestamptz,failure_code text);
create table platform_private.device_sessions(
  id uuid primary key,user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  device_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  binding_id uuid not null references platform.device_key_bindings(id) on delete restrict,
  public_key_thumbprint text not null check(public_key_thumbprint~'^[0-9a-f]{64}$'),
  token_hash bytea not null unique check(octet_length(token_hash)=32),purpose text not null check(purpose='PLATFORM_DEVICE_SESSION'),
  created_at timestamptz not null,expires_at timestamptz not null,revoked_at timestamptz,
  challenge_id uuid not null unique references platform_private.device_session_challenges(id) on delete restrict,
  check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
create index device_sessions_active_binding_lookup_idx on platform_private.device_sessions(binding_id,expires_at) where revoked_at is null;
create table platform_private.device_session_audit(
  id uuid primary key default gen_random_uuid(),event text not null check(event='established'),
  session_id uuid not null unique references platform_private.device_sessions(id) on delete restrict,
  challenge_id uuid not null unique references platform_private.device_session_challenges(id) on delete restrict,
  user_id uuid not null,device_id uuid not null,device_authorization_id uuid not null,binding_id uuid not null,
  public_key_thumbprint text not null,purpose text not null check(purpose='PLATFORM_DEVICE_SESSION'),created_at timestamptz not null default statement_timestamp()
);

\ir ../../supabase/migrations/20260909220000_device_session_finalization_audit_retention.sql

do $$
declare
  v_user constant uuid:='10000000-0000-4000-8000-000000000001';
  v_device constant uuid:='10000000-0000-4000-8000-000000000002';
  v_authorization constant uuid:='10000000-0000-4000-8000-000000000003';
  v_binding constant uuid:='10000000-0000-4000-8000-000000000004';
  v_old_challenge constant uuid:='10000000-0000-4000-8000-000000000005';
  v_old_session constant uuid:='10000000-0000-4000-8000-000000000006';
  v_challenge_one constant uuid:='10000000-0000-4000-8000-000000000007';
  v_session_one constant uuid:='10000000-0000-4000-8000-000000000008';
  v_challenge_two constant uuid:='10000000-0000-4000-8000-000000000009';
  v_session_two constant uuid:='10000000-0000-4000-8000-000000000010';
  v_invalid_challenge constant uuid:='10000000-0000-4000-8000-000000000011';
  v_thumbprint constant text:='cf0abff910e8d7bdc6aa31f33ef0121d1678e902e345ddde046ad546f0484d1a';
  v_result jsonb; v_rejected boolean;
begin
  insert into platform.profiles values(v_user,'approved');
  insert into platform.devices values(v_device,'active',null,null);
  insert into platform.user_device_authorizations values(v_authorization,v_user,v_device,'approved',null);
  insert into platform.device_key_bindings values(v_binding,v_user,v_device,v_authorization,v_thumbprint,'ECDSA_P256_SHA256','active',null,null);
  insert into platform_private.device_session_challenges values
    (v_old_challenge,v_user,v_device,v_authorization,v_binding,v_thumbprint,'PLATFORM_DEVICE_SESSION_ESTABLISH','https://ramyawny37.github.io',statement_timestamp()-interval '8 days',statement_timestamp()-interval '8 days'+interval '2 minutes',statement_timestamp()-interval '8 days',v_old_session,null,null),
    (v_challenge_one,v_user,v_device,v_authorization,v_binding,v_thumbprint,'PLATFORM_DEVICE_SESSION_ESTABLISH','https://ramyawny37.github.io',statement_timestamp(),statement_timestamp()+interval '2 minutes',null,null,null,null),
    (v_challenge_two,v_user,v_device,v_authorization,v_binding,v_thumbprint,'PLATFORM_DEVICE_SESSION_ESTABLISH','https://ramyawny37.github.io',statement_timestamp(),statement_timestamp()+interval '2 minutes',null,null,null,null),
    (v_invalid_challenge,v_user,v_device,v_authorization,v_binding,v_thumbprint,'PLATFORM_DEVICE_SESSION_ESTABLISH','https://ramyawny37.github.io',statement_timestamp(),statement_timestamp()+interval '2 minutes',null,null,null,null);
  insert into platform_private.device_sessions values(v_old_session,v_user,v_device,v_authorization,v_binding,v_thumbprint,digest('old-token','sha256'),'PLATFORM_DEVICE_SESSION',statement_timestamp()-interval '8 days',statement_timestamp()-interval '8 days'+interval '5 minutes',null,v_old_challenge);
  insert into platform_private.device_session_audit(event,session_id,challenge_id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,purpose) values('established',v_old_session,v_old_challenge,v_user,v_device,v_authorization,v_binding,v_thumbprint,'PLATFORM_DEVICE_SESSION');
  perform set_config('request.jwt.claim.role','service_role',true);

  v_result:=platform.complete_device_session(v_challenge_one,v_user,v_device,v_authorization,v_binding,v_thumbprint,v_session_one,digest('new-token-one','sha256'));
  if v_result->>'sessionId'<>v_session_one::text then raise exception 'NORMAL_FINALIZATION_FAILED'; end if;
  if not exists(select 1 from platform_private.device_sessions where id=v_old_session) then raise exception 'OLD_AUDITED_SESSION_REMOVED'; end if;
  if not exists(select 1 from platform_private.device_session_audit where session_id=v_old_session) then raise exception 'OLD_AUDIT_REMOVED'; end if;

  v_rejected:=false;
  begin perform platform.complete_device_session(v_challenge_one,v_user,v_device,v_authorization,v_binding,v_thumbprint,gen_random_uuid(),digest('replay-token','sha256'));
  exception when sqlstate '42501' then v_rejected:=true; end;
  if not v_rejected then raise exception 'REPLAY_ACCEPTED'; end if;

  v_rejected:=false;
  begin perform platform.complete_device_session(v_invalid_challenge,v_user,v_device,v_authorization,v_binding,'af0abff910e8d7bdc6aa31f33ef0121d1678e902e345ddde046ad546f0484d1a',gen_random_uuid(),digest('invalid-token','sha256'));
  exception when sqlstate '42501' then v_rejected:=true; end;
  if not v_rejected then raise exception 'INVALID_AUTHORITY_ACCEPTED'; end if;

  v_result:=platform.complete_device_session(v_challenge_two,v_user,v_device,v_authorization,v_binding,v_thumbprint,v_session_two,digest('new-token-two','sha256'));
  if v_result->>'sessionId'<>v_session_two::text or (select count(*) from platform_private.device_sessions where binding_id=v_binding)<>3 then raise exception 'MULTIPLE_SESSION_BEHAVIOR_FAILED'; end if;
  if (select confdeltype from pg_constraint where conname='device_session_audit_session_id_fkey')<>'r' then raise exception 'AUDIT_FK_NOT_RESTRICT'; end if;
end $$;

rollback;
