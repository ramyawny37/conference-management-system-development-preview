\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema platform;
create schema platform_private;

create function auth.role() returns text language sql stable set search_path=''
as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.role',true),'') $$;

create table platform.profiles (
  user_id uuid primary key,
  account_status text not null check(account_status in ('pending','approved','blocked'))
);
create table platform.roles (
  id uuid primary key, code text not null, domain text not null, scope_type text not null
);
create table platform.user_roles (
  id uuid primary key, user_id uuid not null references platform.profiles(user_id),
  role_id uuid not null references platform.roles(id), scope_type text not null,
  scope_id uuid, revoked_at timestamptz, expires_at timestamptz
);
create table platform.devices (
  id uuid primary key, lifecycle_status text not null check(lifecycle_status in ('active','retired','compromised'))
);
create table platform.user_device_authorizations (
  id uuid primary key, user_id uuid not null references platform.profiles(user_id),
  device_id uuid not null references platform.devices(id),
  status text not null check(status in ('pending','approved','blocked','revoked')),
  status_reason text, approved_by uuid, approved_at timestamptz,
  unique(user_id,device_id)
);
create table platform.audit_events (
  id uuid primary key default pg_catalog.gen_random_uuid(), actor_user_id uuid,
  actor_device_authorization_id uuid, subject_user_id uuid, domain text, module text,
  action text, entity_type text, entity_id uuid, scope_type text, old_values jsonb,
  new_values jsonb, metadata jsonb, request_id uuid, operation_id uuid, source text,
  occurred_at timestamptz not null default pg_catalog.statement_timestamp()
);
create table platform.device_key_bindings (
  id uuid primary key, user_id uuid not null references platform.profiles(user_id),
  device_id uuid not null references platform.devices(id),
  device_authorization_id uuid not null references platform.user_device_authorizations(id),
  lifecycle_status text not null check(lifecycle_status in ('active','rotated','revoked','retired'))
);
create table platform_private.device_sessions(id uuid primary key);
create schema legacy_fixture;
create table legacy_fixture.user_device_authorizations(id uuid primary key);
create table legacy_fixture.webauthn_credentials(id uuid primary key);

create function platform_private.write_audit_event(
 p_actor_user_id uuid,p_subject_user_id uuid,p_domain text,p_module text,p_action text,p_entity_type text,p_entity_id uuid,
 p_scope_type text,p_old_values jsonb,p_new_values jsonb,p_metadata jsonb default '{}'::jsonb,
 p_request_id uuid default null,p_operation_id uuid default null,p_source text default 'rpc') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid:=pg_catalog.gen_random_uuid();
begin
  insert into platform.audit_events(id,actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,
    action,entity_type,entity_id,scope_type,old_values,new_values,metadata,request_id,operation_id,source)
  values(v_id,p_actor_user_id,null,p_subject_user_id,p_domain,p_module,p_action,p_entity_type,p_entity_id,p_scope_type,
    p_old_values,p_new_values,p_metadata,p_request_id,p_operation_id,p_source);
  return v_id;
end $$;

\ir ../../supabase/migrations/20260908220000_platform_zero_approved_owner_device_recovery.sql

create function pg_temp.reset_fixture(
  p_account_status text default 'approved',p_owner boolean default true,
  p_authorization_status text default 'pending',p_device_lifecycle text default 'active',
  p_binding_lifecycle text default 'active'
) returns void language plpgsql as $$
begin
  truncate platform_private.zero_approved_owner_device_recovery_operations,platform.audit_events,
    platform.device_key_bindings,platform.user_device_authorizations,platform.devices,
    platform.user_roles,platform.roles,platform.profiles,platform_private.device_sessions,
    legacy_fixture.user_device_authorizations,legacy_fixture.webauthn_credentials cascade;
  insert into platform.profiles values
    ('00000000-0000-4000-8000-000000000101',p_account_status),
    ('00000000-0000-4000-8000-000000000102','approved');
  insert into platform.roles values
    ('00000000-0000-4000-8000-000000000201','platform_owner','platform','platform');
  if p_owner then
    insert into platform.user_roles values
      ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000101',
       '00000000-0000-4000-8000-000000000201','platform',null,null,null);
  end if;
  insert into platform.devices values('00000000-0000-4000-8000-000000000301',p_device_lifecycle);
  insert into platform.user_device_authorizations
    (id,user_id,device_id,status,approved_at) values(
    '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000301',p_authorization_status,
    case when p_authorization_status='approved' then pg_catalog.statement_timestamp() else null end);
  insert into platform.device_key_bindings values(
    '00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000401',p_binding_lifecycle);
  insert into legacy_fixture.user_device_authorizations values('00000000-0000-4000-8000-000000000901');
  insert into legacy_fixture.webauthn_credentials values('00000000-0000-4000-8000-000000000902');
end $$;

create function pg_temp.recover(p_operation uuid default '00000000-0000-4000-8000-000000000601')
returns jsonb language sql as $$
  select platform.recover_zero_approved_owner_device(
    '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501',
    p_operation,'isolated PostgreSQL 17 recovery rehearsal')
$$;

create function pg_temp.expect_error(p_sql text,p_message text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: %',p_message;
exception when others then
  if sqlerrm='EXPECTED_ERROR_NOT_RAISED: '||p_message or position(p_message in sqlerrm)=0 then raise; end if;
end $$;

select pg_catalog.set_config('request.jwt.claim.role','service_role',false);

-- Valid recovery, exact mutation, truthful audit, and no side effects.
select pg_temp.reset_fixture();
do $$ declare first_result jsonb; replay_result jsonb; begin
  first_result:=pg_temp.recover(); replay_result:=pg_temp.recover();
  if first_result<>replay_result then raise exception 'IDEMPOTENT_RESULT_MISMATCH'; end if;
  if (select count(*) from platform.user_device_authorizations where status='approved')<>1 then raise exception 'EXACT_MUTATION_FAILED'; end if;
  if (select approved_by from platform.user_device_authorizations limit 1) is not null then raise exception 'FAKE_ACTOR_FOUND'; end if;
  if (select count(*) from platform.audit_events)<>1 then raise exception 'AUDIT_COUNT_INVALID'; end if;
  if (select count(*) from platform_private.zero_approved_owner_device_recovery_operations)<>1 then raise exception 'LEDGER_COUNT_INVALID'; end if;
  if (select count(*) from platform_private.device_sessions)<>0 then raise exception 'SESSION_CREATED'; end if;
  if (select count(*) from legacy_fixture.user_device_authorizations)<>1 then raise exception 'LEGACY_MUTATED'; end if;
  if (select count(*) from legacy_fixture.webauthn_credentials)<>1 then raise exception 'WEBAUTHN_MUTATED'; end if;
end $$;

-- The operation ID cannot be retargeted or have its context changed.
select pg_temp.expect_error($q$select platform.recover_zero_approved_owner_device(
  '00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000601','isolated PostgreSQL 17 recovery rehearsal')$q$,
  'ZERO_APPROVED_OWNER_RECOVERY_OPERATION_RETARGET_DENIED');
select pg_temp.expect_error($q$select platform.recover_zero_approved_owner_device(
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000601','changed reason')$q$,
  'ZERO_APPROVED_OWNER_RECOVERY_OPERATION_RETARGET_DENIED');

-- Role, account, approved-device, and non-pending status failures.
select pg_temp.reset_fixture(p_owner=>false);
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_PLATFORM_OWNER_REQUIRED');
select pg_temp.reset_fixture(p_account_status=>'pending');
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_APPROVED_ACCOUNT_REQUIRED');
select pg_temp.reset_fixture(p_authorization_status=>'approved');
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_APPROVED_DEVICE_EXISTS');
select pg_temp.reset_fixture(p_authorization_status=>'blocked');
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.reset_fixture(p_authorization_status=>'revoked');
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');

-- Device and binding state/identity failures.
select pg_temp.reset_fixture(p_device_lifecycle=>'retired');
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.reset_fixture(p_binding_lifecycle=>'revoked');
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.reset_fixture(); delete from platform.device_key_bindings;
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.reset_fixture(); update platform.device_key_bindings set user_id='00000000-0000-4000-8000-000000000102';
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.reset_fixture();
insert into platform.devices values('00000000-0000-4000-8000-000000000302','active');
update platform.device_key_bindings set device_id='00000000-0000-4000-8000-000000000302';
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.reset_fixture();
insert into platform.devices values('00000000-0000-4000-8000-000000000302','active');
insert into platform.user_device_authorizations values(
  '00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000302','pending',null,null,null);
update platform.device_key_bindings set device_authorization_id='00000000-0000-4000-8000-000000000402';
select pg_temp.expect_error('select pg_temp.recover()','ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');

-- Wrong target IDs fail closed.
select pg_temp.reset_fixture();
select pg_temp.expect_error($q$select platform.recover_zero_approved_owner_device(
  '00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000602','x')$q$,'ZERO_APPROVED_OWNER_RECOVERY_PLATFORM_OWNER_REQUIRED');
select pg_temp.expect_error($q$select platform.recover_zero_approved_owner_device(
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000603','x')$q$,'ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');
select pg_temp.expect_error($q$select platform.recover_zero_approved_owner_device(
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000604','x')$q$,'ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID');

-- Two distinct recovery operations for two pending devices can approve only one.
select pg_temp.reset_fixture();
insert into platform.devices values('00000000-0000-4000-8000-000000000302','active');
insert into platform.user_device_authorizations values(
  '00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000302','pending',null,null,null);
insert into platform.device_key_bindings values(
  '00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000402','active');
select pg_temp.recover();
select pg_temp.expect_error($q$select platform.recover_zero_approved_owner_device(
  '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000502',
  '00000000-0000-4000-8000-000000000602','second target')$q$,
  'ZERO_APPROVED_OWNER_RECOVERY_APPROVED_DEVICE_EXISTS');

-- Catalog privileges and immutability.
do $$ begin
  if has_function_privilege('public','platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text)','execute') then raise exception 'PUBLIC_EXECUTE_PRESENT'; end if;
  if has_function_privilege('anon','platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text)','execute') then raise exception 'ANON_EXECUTE_PRESENT'; end if;
  if has_function_privilege('authenticated','platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text)','execute') then raise exception 'AUTHENTICATED_EXECUTE_PRESENT'; end if;
  if not has_function_privilege('service_role','platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text)','execute') then raise exception 'SERVICE_EXECUTE_MISSING'; end if;
end $$;
select pg_temp.expect_error('update platform_private.zero_approved_owner_device_recovery_operations set reason=''tampered''','ZERO_APPROVED_OWNER_RECOVERY_OPERATION_IMMUTABLE');

select 'PLATFORM_ZERO_DEVICE_OWNER_RECOVERY_REHEARSAL_PASS' as result;
