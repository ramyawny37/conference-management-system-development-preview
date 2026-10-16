begin;
create schema platform;
create schema platform_private;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
exception when duplicate_object or unique_violation then null; end $;

create table platform.devices(
  id uuid primary key,lifecycle_status text not null,retired_at timestamptz,compromised_at timestamptz
);
create table platform.user_device_authorizations(
  id uuid primary key,user_id uuid not null,device_id uuid not null references platform.devices(id),
  status text not null,revoked_at timestamptz,approved_at timestamptz
);
create table public.device_security_credentials(
  id uuid primary key,webauthn_credential_id bytea not null,user_id uuid not null,device_id uuid not null,
  credential_kind text not null,public_key_cose bytea not null,public_key_algorithm integer not null,
  aaguid uuid,transports text[] not null,sign_count bigint not null,backup_eligible boolean not null,
  backup_state boolean not null,user_verification_policy text not null,lifecycle_status text not null,
  created_at timestamptz not null,enrolled_at timestamptz,activated_at timestamptz,last_used_at timestamptz,
  revoked_at timestamptz,revoked_by uuid,revocation_reason text
);
create table platform_private.stable_device_recovery_authorizations(
  id uuid primary key,owner_user_id uuid not null,target_authorization_id uuid not null,
  target_device_id uuid not null,credential_id uuid not null,issuance_basis text not null,
  review_reference text,environment text not null,expected_origin text not null,expected_rp_id text not null,
  issued_at timestamptz not null,expires_at timestamptz not null,consumed_at timestamptz
);
create table platform_private.stable_device_recovery_challenges(
  id uuid primary key,recovery_authorization_id uuid not null,credential_id uuid not null,
  expires_at timestamptz not null,verified_at timestamptz,consumed_at timestamptz,failed_at timestamptz,
  verification_context jsonb
);
create table platform_private.recovery_test_audit(id bigserial primary key,action text not null);

create function platform_private.require_canonical_device_authorization(
  p_user_id uuid,p_device_id uuid,p_lock boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  select item.id into result from platform.user_device_authorizations item
  join platform.devices device on device.id=item.device_id
  where item.user_id=p_user_id and item.device_id=p_device_id and item.status='approved'
    and item.revoked_at is null and device.lifecycle_status='active';
  if result is null then
    raise exception 'APPROVED_PLATFORM_DEVICE_REQUIRED' using errcode='42501';
  end if;
  return result;
end $$;

\ir ../../supabase/migrations/20261016163453_platform_owner_passkey_recovery_counter_guard.sql
create trigger device_security_credentials_lifecycle_guard
before insert or update or delete on public.device_security_credentials
for each row execute function public.guard_device_security_credential_lifecycle();

create function pg_temp.reset_recovery_fixture() returns void language plpgsql as $$
begin
  truncate platform_private.recovery_test_audit,
    platform_private.stable_device_recovery_challenges,
    platform_private.stable_device_recovery_authorizations,
    public.device_security_credentials,platform.user_device_authorizations,platform.devices restart identity;
  insert into platform.devices values
    ('20000000-0000-4000-8000-000000000001','active',null,null),
    ('20000000-0000-4000-8000-000000000002','active',null,null);
  insert into platform.user_device_authorizations values
    ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001','pending',null,null),
    ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002','pending',null,null);
  alter table public.device_security_credentials disable trigger device_security_credentials_lifecycle_guard;
  insert into public.device_security_credentials values(
    '40000000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    'platform_primary',decode('a1','hex'),-7,null,array['hybrid'],0,true,true,'required','active',
    statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
    statement_timestamp()-interval '2 days',null,null,null,null);
  alter table public.device_security_credentials enable trigger device_security_credentials_lifecycle_guard;
  insert into platform_private.stable_device_recovery_authorizations values(
    '50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001','reviewed_platform_owner_passkey_recovery',
    'POSTGRES_TRIGGER_REHEARSAL','development_preview','https://ramyawny37.github.io',
    'ramyawny37.github.io',statement_timestamp()-interval '1 minute',
    statement_timestamp()+interval '1 hour',null);
  insert into platform_private.stable_device_recovery_challenges values(
    '60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',statement_timestamp()+interval '2 minutes',
    null,null,null,null);
end $$;

create function pg_temp.complete_recovery_fixture(p_force_failure boolean default false)
returns void language plpgsql as $$
begin
  update platform_private.stable_device_recovery_challenges
  set verified_at=statement_timestamp(),
    verification_context='{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb
  where id='60000000-0000-4000-8000-000000000001';
  update public.device_security_credentials
  set sign_count=1,last_used_at=statement_timestamp()
  where id='40000000-0000-4000-8000-000000000001';
  update platform.user_device_authorizations set status='approved',approved_at=statement_timestamp()
  where id='30000000-0000-4000-8000-000000000002';
  insert into platform_private.recovery_test_audit(action) values('stable_device_approved');
  update platform_private.stable_device_recovery_challenges set consumed_at=statement_timestamp()
  where id='60000000-0000-4000-8000-000000000001';
  update platform_private.stable_device_recovery_authorizations set consumed_at=statement_timestamp()
  where id='50000000-0000-4000-8000-000000000001';
  if p_force_failure then raise exception 'FORCED_ATOMIC_ROLLBACK'; end if;
end $$;

select pg_temp.reset_recovery_fixture();
select pg_temp.complete_recovery_fixture(false);
do $$ begin
  if (select sign_count from public.device_security_credentials)<>1 then raise exception 'COUNTER_NOT_UPDATED'; end if;
  if (select status from platform.user_device_authorizations where id='30000000-0000-4000-8000-000000000002')<>'approved' then raise exception 'TARGET_NOT_APPROVED'; end if;
  if (select consumed_at from platform_private.stable_device_recovery_authorizations) is null then raise exception 'AUTHORIZATION_NOT_CONSUMED'; end if;
  if (select consumed_at from platform_private.stable_device_recovery_challenges) is null then raise exception 'CHALLENGE_NOT_CONSUMED'; end if;
  if (select count(*) from platform_private.recovery_test_audit)<>1 then raise exception 'AUDIT_NOT_WRITTEN'; end if;
end $$;

-- A consumed recovery cannot authorize a second counter write.
do $$ begin
  update public.device_security_credentials set sign_count=2,last_used_at=statement_timestamp();
  raise exception 'REPLAY_COUNTER_UPDATE_ACCEPTED';
exception when insufficient_privilege then null; end $$;

-- Password/service access without a verified challenge remains insufficient.
select pg_temp.reset_recovery_fixture();
do $$ begin
  update public.device_security_credentials set sign_count=1,last_used_at=statement_timestamp();
  raise exception 'UNVERIFIED_COUNTER_UPDATE_ACCEPTED';
exception when insufficient_privilege then null; end $$;
do $$ begin
  if (select sign_count from public.device_security_credentials)<>0 then raise exception 'REJECTED_UPDATE_PERSISTED'; end if;
end $$;

-- Target substitution invalidates the database-derived recovery context.
update platform_private.stable_device_recovery_challenges
set verified_at=statement_timestamp(),verification_context='{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb;
update platform_private.stable_device_recovery_authorizations
set target_device_id='20000000-0000-4000-8000-000000000001';
do $$ begin
  update public.device_security_credentials set sign_count=1,last_used_at=statement_timestamp();
  raise exception 'CHANGED_TARGET_ACCEPTED';
exception when insufficient_privilege then null; end $$;

-- Counter regression and credential identity mutation remain independently guarded.
select pg_temp.reset_recovery_fixture();
alter table public.device_security_credentials disable trigger device_security_credentials_lifecycle_guard;
update public.device_security_credentials set sign_count=2;
alter table public.device_security_credentials enable trigger device_security_credentials_lifecycle_guard;
update platform_private.stable_device_recovery_challenges
set verified_at=statement_timestamp(),verification_context='{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb;
do $$ begin
  update public.device_security_credentials set sign_count=1,last_used_at=statement_timestamp();
  raise exception 'COUNTER_REGRESSION_ACCEPTED';
exception when insufficient_privilege then
  if sqlerrm<>'DEVICE_SECURITY_CREDENTIAL_COUNTER_REGRESSION' then raise; end if;
end $$;
do $$ begin
  update public.device_security_credentials set public_key_algorithm=-257;
  raise exception 'IDENTITY_MUTATION_ACCEPTED';
exception when insufficient_privilege then
  if sqlerrm<>'DEVICE_SECURITY_CREDENTIAL_IDENTITY_IMMUTABLE' then raise; end if;
end $$;

-- Any later failure rolls back verification, counter, approval, audit and consumption together.
select pg_temp.reset_recovery_fixture();
do $$ begin
  perform pg_temp.complete_recovery_fixture(true);
  raise exception 'FORCED_FAILURE_NOT_RAISED';
exception when raise_exception then
  if sqlerrm<>'FORCED_ATOMIC_ROLLBACK' then raise; end if;
end $$;
do $$ begin
  if (select sign_count from public.device_security_credentials)<>0 then raise exception 'COUNTER_ROLLBACK_FAILED'; end if;
  if (select status from platform.user_device_authorizations where id='30000000-0000-4000-8000-000000000002')<>'pending' then raise exception 'APPROVAL_ROLLBACK_FAILED'; end if;
  if (select verified_at from platform_private.stable_device_recovery_challenges) is not null then raise exception 'VERIFICATION_ROLLBACK_FAILED'; end if;
  if (select consumed_at from platform_private.stable_device_recovery_challenges) is not null then raise exception 'CHALLENGE_ROLLBACK_FAILED'; end if;
  if (select consumed_at from platform_private.stable_device_recovery_authorizations) is not null then raise exception 'AUTHORIZATION_ROLLBACK_FAILED'; end if;
  if exists(select 1 from platform_private.recovery_test_audit) then raise exception 'AUDIT_ROLLBACK_FAILED'; end if;
end $$;

select jsonb_build_object('status','pass','trigger','device_security_credentials_lifecycle_guard',
  'success',true,'rejection',true,'rollback',true);
rollback;
