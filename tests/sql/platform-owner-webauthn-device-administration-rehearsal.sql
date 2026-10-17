create schema auth;
create schema platform;
create schema platform_private;
create schema extensions;
create extension pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
exception when duplicate_object or unique_violation then null; end $$;

create table auth.users(id uuid primary key,email text);
create table platform.roles(id uuid primary key,domain text,code text);
create table platform.profiles(user_id uuid primary key,display_name text,account_status text);
create table platform.user_roles(user_id uuid,role_id uuid,scope_type text,scope_id uuid,
  revoked_at timestamptz,expires_at timestamptz);
create table platform.devices(id uuid primary key,user_id uuid,display_name text,platform text,
  lifecycle_status text,retired_at timestamptz,compromised_at timestamptz);
create table platform.user_device_authorizations(
  id uuid primary key,user_id uuid,device_id uuid,status text,requested_at timestamptz default now(),
  approved_by uuid,approved_at timestamptz,blocked_by uuid,blocked_at timestamptz,
  revoked_by uuid,revoked_at timestamptz,status_reason text,last_authorized_seen_at timestamptz,
  created_at timestamptz default now(),updated_at timestamptz default now(),
  unique(user_id,device_id));
create table platform.device_key_bindings(id uuid primary key,user_id uuid,device_id uuid,
  device_authorization_id uuid,lifecycle_status text,revoked_at timestamptz,retired_at timestamptz);
create table platform.test_audit(id uuid default gen_random_uuid(),action text,operation_id uuid);

create table public.device_security_credentials(
  id uuid primary key,webauthn_credential_id bytea,user_id uuid,device_id uuid,
  credential_kind text,public_key_cose bytea,public_key_algorithm integer,aaguid uuid,
  transports text[],sign_count bigint,backup_eligible boolean,backup_state boolean,
  user_verification_policy text,lifecycle_status text,created_at timestamptz default now(),
  enrolled_at timestamptz,activated_at timestamptz,last_used_at timestamptz,revoked_at timestamptz,
  revoked_by uuid,revocation_reason text,unique(id,user_id),unique(id,user_id,device_id));
create table public.device_possession_challenges(
  id uuid primary key default gen_random_uuid(),challenge_hash bytea,user_id uuid,session_id uuid,
  actor_device_id uuid,credential_id uuid,purpose text,target_user_id uuid,target_device_id uuid,
  replaced_device_id uuid,replacement_device_id uuid,operation_id uuid,expected_origin text,
  expected_rp_id text,environment text,expires_at timestamptz,verified_at timestamptz,
  consumed_at timestamptz,failed_at timestamptz,failure_code text,verification_context jsonb,
  constraint device_possession_challenges_credential_fk
    foreign key(credential_id,user_id,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id));
create table public.device_possession_challenge_consumers(
  challenge_id uuid,user_id uuid,session_id uuid,actor_device_id uuid,actor_credential_id uuid,
  challenge_purpose text,environment text,consumer_kind text,consumer_id uuid);
create table public.privileged_device_listing_sessions(
  id uuid primary key,opaque_token_hash bytea,user_id uuid,session_id uuid,actor_device_id uuid,
  credential_id uuid,source_challenge_id uuid,source_challenge_purpose text,environment text,
  scope text,issued_at timestamptz default now(),expires_at timestamptz,revoked_at timestamptz,
  constraint privileged_device_listing_sessions_credential_fk
    foreign key(credential_id,user_id,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id));
create table public.privileged_device_authorization_audit_log(
  id uuid primary key default gen_random_uuid(),actor_user_id uuid,actor_user_id_snapshot uuid,
  actor_device_id uuid,actor_credential_id uuid,session_id_hash bytea,session_id uuid,
  challenge_id uuid,challenge_purpose text,environment text,target_user_id uuid,
  target_user_id_snapshot uuid,target_device_id uuid,challenge_target_user_id uuid,
  challenge_target_device_id uuid,action text,operation_id uuid,result text,origin text,rp_id text,
  user_verified boolean,backup_eligible boolean,backup_state boolean,security_context jsonb,
  constraint privileged_device_audit_actor_credential_fk
    foreign key(actor_credential_id,actor_user_id_snapshot,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id));
create table public.system_owner_device_authorization_operations(
  operation_id uuid primary key,actor_user_id uuid,actor_user_id_snapshot uuid,
  actor_device_id uuid,actor_credential_id uuid,challenge_id uuid,session_id uuid,
  challenge_purpose text,environment text,target_user_id uuid,target_user_id_snapshot uuid,
  target_device_id uuid,action text,outcome text,stored_result jsonb,
  constraint system_owner_device_operations_actor_credential_fk
    foreign key(actor_credential_id,actor_user_id_snapshot,actor_device_id)
    references public.device_security_credentials(id,user_id,device_id));

create function public.require_platform_device_backend() returns void language plpgsql as $$ begin null; end $$;
create function platform_private.is_canonical_platform_owner(p_user_id uuid)
returns boolean language sql stable as $$
  select exists(select 1 from platform.profiles profile
    join platform.user_roles assignment on assignment.user_id=profile.user_id
    join platform.roles role on role.id=assignment.role_id
    where profile.user_id=p_user_id and profile.account_status='approved'
      and assignment.scope_type='platform' and assignment.scope_id is null
      and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>now())
      and role.domain='platform' and role.code='platform_owner');
$$;
create function platform_private.require_canonical_device_authorization(
  p_user_id uuid,p_device_id uuid,p_require_active_binding boolean default true
) returns uuid language plpgsql stable as $$
declare result uuid;
begin
  select item.id into result from platform.user_device_authorizations item
  join platform.devices device on device.id=item.device_id
  join platform.profiles profile on profile.user_id=item.user_id
  where item.user_id=p_user_id and item.device_id=p_device_id
    and item.status='approved' and item.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved' and (not p_require_active_binding or exists(
      select 1 from platform.device_key_bindings binding
      where binding.user_id=item.user_id and binding.device_id=item.device_id
        and binding.device_authorization_id=item.id and binding.lifecycle_status='active'
        and binding.revoked_at is null and binding.retired_at is null));
  if result is null then raise exception 'APPROVED_PLATFORM_DEVICE_REQUIRED' using errcode='42501'; end if;
  return result;
end $$;
create function platform_private.write_audit_event(
  p_actor_user_id uuid,p_subject_user_id uuid,p_domain text,p_module text,p_action text,
  p_entity_type text,p_entity_id uuid,p_scope_type text,p_old_values jsonb,p_new_values jsonb,
  p_metadata jsonb default '{}'::jsonb,p_request_id uuid default null,
  p_operation_id uuid default null,p_source text default 'rpc'
) returns uuid language plpgsql as $$
declare result uuid:=gen_random_uuid();
begin
  insert into platform.test_audit(id,action,operation_id) values(result,p_action,p_operation_id);
  return result;
end $$;

\ir ../../supabase/migrations/20261017113705_restore_canonical_owner_webauthn_device_administration.sql

insert into auth.users values
 ('10000000-0000-4000-8000-000000000001','owner@example.test'),
 ('10000000-0000-4000-8000-000000000002','member@example.test'),
 ('10000000-0000-4000-8000-000000000003','approve@example.test'),
 ('10000000-0000-4000-8000-000000000004','reject@example.test'),
 ('10000000-0000-4000-8000-000000000005','history@example.test');
insert into platform.roles values('11000000-0000-4000-8000-000000000001','platform','platform_owner');
insert into platform.profiles values
 ('10000000-0000-4000-8000-000000000001','Owner','approved'),
 ('10000000-0000-4000-8000-000000000002','Member','approved'),
 ('10000000-0000-4000-8000-000000000003','Approve target','approved'),
 ('10000000-0000-4000-8000-000000000004','Reject target','approved'),
 ('10000000-0000-4000-8000-000000000005','Historical target','approved');
insert into platform.user_roles values(
 '10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
 'platform',null,null,null);
insert into platform.devices values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Current owner','MacIntel','active',null,null),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Other owner','MacIntel','active',null,null),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','Approve me','Win32','active',null,null),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','Reject me','Linux','active',null,null),
 ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','Rejected history','Linux','active',null,null),
 ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','Member device','Linux','active',null,null);
insert into platform.user_device_authorizations(id,user_id,device_id,status,approved_at,revoked_at) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','approved',now(),null),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','approved',now(),null),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','pending',null,null),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','pending',null,null),
 ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000005','revoked',null,now()),
 ('30000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006','approved',now(),null);
insert into platform.device_key_bindings
select gen_random_uuid(),user_id,device_id,id,'active',null,null
from platform.user_device_authorizations;
insert into public.device_security_credentials(id,webauthn_credential_id,user_id,device_id,
  credential_kind,public_key_cose,public_key_algorithm,transports,sign_count,backup_eligible,
  backup_state,user_verification_policy,lifecycle_status,enrolled_at,activated_at)
values
 ('40000000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000099','platform_primary',decode('a1','hex'),-7,array['hybrid'],0,true,true,'required','active',now(),now()),
 ('40000000-0000-4000-8000-000000000002',decode(repeat('bb',32),'hex'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','platform_primary',decode('a1','hex'),-7,array['internal'],0,false,false,'required','active',now(),now()),
 ('40000000-0000-4000-8000-000000000003',decode(repeat('cc',32),'hex'),'10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','platform_primary',decode('a1','hex'),-7,array['internal'],0,false,false,'required','revoked',now(),now());

do $$
declare state jsonb; credential public.device_security_credentials%rowtype;
begin
  state:=public.get_system_owner_platform_device_administration_state(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
  if state->>'status'<>'ready' or state->>'credentialId'<>'40000000-0000-4000-8000-000000000001' then
    raise exception 'SYNCED_ORPHAN_CREDENTIAL_NOT_READY';
  end if;
  credential:=public.require_system_owner_webauthn_actor(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001');
  if credential.id is null then raise exception 'SYNCED_ORPHAN_CREDENTIAL_REJECTED'; end if;
  credential:=public.require_system_owner_webauthn_actor(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002');
  if credential.id is null then raise exception 'BOUND_CREDENTIAL_REJECTED_ON_ORIGINAL_DEVICE'; end if;
end $$;

do $$ begin
  perform public.require_system_owner_webauthn_actor(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002');
  raise exception 'CROSS_DEVICE_NON_SYNCED_CREDENTIAL_ACCEPTED';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.require_system_owner_webauthn_actor(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003');
  raise exception 'REVOKED_CREDENTIAL_ACCEPTED';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.get_system_owner_platform_device_administration_state(
    '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006');
  raise exception 'NON_OWNER_ACCEPTED';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update platform.user_device_authorizations set status='pending'
  where id='30000000-0000-4000-8000-000000000001';
  perform public.get_system_owner_platform_device_administration_state(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
  raise exception 'PENDING_ACTOR_DEVICE_ACCEPTED';
exception when insufficient_privilege then null; end $$;

create temp table ceremony_state(name text primary key,id uuid);
do $$ declare result jsonb; begin
  result:=public.begin_system_owner_device_possession_challenge(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
    'SYSTEM_OWNER_PENDING_DEVICE_LIST',null,null,null,'development_preview',
    'https://ramyawny37.github.io','ramyawny37.github.io',decode(repeat('01',32),'hex'));
  insert into ceremony_state values('list',(result->>'challengeId')::uuid);
end $$;
select public.get_system_owner_device_challenge_verification_material(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',(select id from ceremony_state where name='list'));
select public.complete_system_owner_pending_device_listing(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
  'development_preview',(select id from ceremony_state where name='list'),decode(repeat('01',32),'hex'),
  '51000000-0000-4000-8000-000000000001',decode(repeat('02',32),'hex'),0,
  'https://ramyawny37.github.io','ramyawny37.github.io',
  '{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb);
do $$ declare listed jsonb; begin
  listed:=public.list_system_owner_pending_device_authorizations(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001','development_preview',decode(repeat('02',32),'hex'));
  if jsonb_array_length(listed->'devices')<>2 then raise exception 'PENDING_LIST_FILTER_FAILED'; end if;
end $$;
do $$ begin
  perform public.complete_system_owner_pending_device_listing(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
    'development_preview',(select id from ceremony_state where name='list'),decode(repeat('01',32),'hex'),
    '51000000-0000-4000-8000-000000000002',decode(repeat('03',32),'hex'),0,
    'https://ramyawny37.github.io','ramyawny37.github.io',
    '{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb);
  raise exception 'LIST_CHALLENGE_REPLAY_ACCEPTED';
exception when insufficient_privilege then null; end $$;

do $$ declare result jsonb; begin
  result:=public.begin_system_owner_device_possession_challenge(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
    'SYSTEM_OWNER_PENDING_DEVICE_APPROVE','10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000001',
    'development_preview','https://ramyawny37.github.io','ramyawny37.github.io',decode(repeat('04',32),'hex'));
  insert into ceremony_state values('approve',(result->>'challengeId')::uuid);
end $$;
select public.complete_system_owner_pending_device_operation(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
  'development_preview',(select id from ceremony_state where name='approve'),decode(repeat('04',32),'hex'),
  '52000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003','approve',0,'https://ramyawny37.github.io',
  'ramyawny37.github.io','{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb);
-- Exact retry is idempotent and returns the stored result without mutating twice.
select public.complete_system_owner_pending_device_operation(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
  'development_preview',(select id from ceremony_state where name='approve'),decode(repeat('04',32),'hex'),
  '52000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003','approve',0,'https://ramyawny37.github.io',
  'ramyawny37.github.io','{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb);
select public.get_system_owner_device_operation_result(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003','approve','development_preview');
do $$ begin
  perform public.begin_system_owner_device_possession_challenge(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',gen_random_uuid(),
    'SYSTEM_OWNER_PENDING_DEVICE_REJECT','10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003',gen_random_uuid(),'development_preview',
    'https://ramyawny37.github.io','ramyawny37.github.io',decode(repeat('05',32),'hex'));
  raise exception 'SECOND_DECISION_ON_APPROVED_TARGET_ACCEPTED';
exception when insufficient_privilege then null; end $$;

do $$ declare result jsonb; begin
  result:=public.begin_system_owner_device_possession_challenge(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',
    'SYSTEM_OWNER_PENDING_DEVICE_REJECT','10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000002',
    'development_preview','https://ramyawny37.github.io','ramyawny37.github.io',decode(repeat('06',32),'hex'));
  insert into ceremony_state values('reject',(result->>'challengeId')::uuid);
end $$;
do $$ begin
  perform public.complete_system_owner_pending_device_operation(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',
    'development_preview',(select id from ceremony_state where name='reject'),decode(repeat('06',32),'hex'),
    '52000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000003','reject',0,'https://ramyawny37.github.io',
    'ramyawny37.github.io','{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb);
  raise exception 'TARGET_SUBSTITUTION_ACCEPTED';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.complete_system_owner_pending_device_operation(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',
    'development_preview',(select id from ceremony_state where name='reject'),decode(repeat('06',32),'hex'),
    '52000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000004','reject',0,'https://ramyawny37.github.io',
    'ramyawny37.github.io','{"userVerified":false,"backupEligible":true,"backupState":true}'::jsonb);
  raise exception 'MISSING_USER_VERIFICATION_ACCEPTED';
exception when insufficient_privilege then null; end $$;
select public.complete_system_owner_pending_device_operation(
  '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',
  'development_preview',(select id from ceremony_state where name='reject'),decode(repeat('06',32),'hex'),
  '52000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000004','reject',0,'https://ramyawny37.github.io',
  'ramyawny37.github.io','{"userVerified":true,"backupEligible":true,"backupState":true}'::jsonb);

do $$ declare listed jsonb; begin
  listed:=public.list_system_owner_pending_device_authorizations(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001','development_preview',decode(repeat('02',32),'hex'));
  if jsonb_array_length(listed->'devices')<>0 then raise exception 'DECIDED_DEVICES_STILL_LISTED'; end if;
  if (select count(*) from public.privileged_device_authorization_audit_log)<>3 then
    raise exception 'PRIVILEGED_AUDIT_COUNT_INVALID';
  end if;
  if (select count(*) from platform.test_audit)<>2 then raise exception 'PLATFORM_AUDIT_COUNT_INVALID'; end if;
  if (select count(*) from public.system_owner_device_authorization_operations)<>2 then
    raise exception 'OPERATION_LEDGER_COUNT_INVALID';
  end if;
end $$;

select pg_catalog.jsonb_build_object('status','pass','positive',8,'negative',10,
  'audits',(select count(*) from public.privileged_device_authorization_audit_log),
  'operations',(select count(*) from public.system_owner_device_authorization_operations),
  'pendingAfter',(select count(*) from platform.user_device_authorizations where status='pending'));
