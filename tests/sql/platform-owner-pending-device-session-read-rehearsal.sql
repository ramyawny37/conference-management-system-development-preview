\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth; create schema platform; create schema platform_private;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;

create table auth.users(id uuid primary key,email text);
create table platform.profiles(user_id uuid primary key,display_name text,account_status text);
create table platform.devices(id uuid primary key,display_name text,platform text,browser text,lifecycle_status text,retired_at timestamptz,compromised_at timestamptz);
create table platform.user_device_authorizations(id uuid primary key,user_id uuid,device_id uuid,status text,requested_at timestamptz,revoked_at timestamptz);
create table platform.device_key_bindings(id uuid primary key,user_id uuid,device_id uuid,device_authorization_id uuid,public_key_thumbprint text,algorithm text,lifecycle_status text,revoked_at timestamptz,retired_at timestamptz);
create table platform_private.device_sessions(id uuid primary key,user_id uuid,device_id uuid,device_authorization_id uuid,binding_id uuid,public_key_thumbprint text,token_hash bytea,purpose text,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
create table platform_private.owners(user_id uuid primary key);

create function platform_private.is_canonical_platform_owner(p_user_id uuid) returns boolean language sql stable as $$select exists(select 1 from platform_private.owners where user_id=p_user_id)$$;
create function platform_private.require_exact_jsonb_keys(p_args jsonb,p_required text[],p_optional text[] default array[]::text[]) returns void language plpgsql as $$begin if (select coalesce(array_agg(key order by key),array[]::text[]) from jsonb_object_keys(p_args) key) is distinct from (select coalesce(array_agg(key order by key),array[]::text[]) from unnest(p_required||p_optional) key) then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if; end$$;
create function public.require_current_approved_device(p_actor_device_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_context jsonb:=coalesce(nullif(current_setting('platform.phase1c_context',true),''),'{}')::jsonb;
begin
  if v_user is null or v_context->>'purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH'
    or (v_context->>'user_id')::uuid is distinct from v_user
    or (v_context->>'device_id')::uuid is distinct from p_actor_device_id then
    raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501';
  end if;
  if not exists(select 1 from platform.user_device_authorizations a join platform.devices d on d.id=a.device_id join platform.profiles p on p.user_id=a.user_id join platform.device_key_bindings b on b.device_authorization_id=a.id and b.user_id=a.user_id and b.device_id=a.device_id where a.user_id=v_user and a.device_id=p_actor_device_id and a.status='approved' and a.revoked_at is null and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null and p.account_status='approved' and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null) then raise exception 'APPROVED_PLATFORM_DEVICE_REQUIRED' using errcode='42501'; end if;
  return v_user;
end$$;

create function public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea) returns jsonb language sql as $$select '{}'::jsonb$$;
grant execute on function public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb),public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea) to service_role;

create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='pg_catalog','public','platform','platform_private' as $$
declare v_session platform_private.device_sessions%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
  select s.* into v_session from platform_private.device_sessions s join platform.device_key_bindings b on b.id=s.binding_id join platform.user_device_authorizations a on a.id=s.device_authorization_id join platform.devices d on d.id=s.device_id join platform.profiles p on p.user_id=s.user_id where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null and s.expires_at>statement_timestamp() and b.user_id=s.user_id and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256' and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved' and a.revoked_at is null and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null and p.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','user_id',v_session.user_id,'device_id',v_session.device_id)::text,true);
  if p_module='platform' then
    case p_operation
    when 'get_user_management_actor_capabilities' then return '{}'::jsonb;
    else raise exception 'PLATFORM_OPERATION_NOT_ALLOWED' using errcode='42501';
    end case;
  end if;
  raise exception 'PLATFORM_OPERATION_NOT_ALLOWED' using errcode='42501';
end$$;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) to service_role;
grant usage on schema platform to service_role;

\ir ../../supabase/migrations/20261018214500_canonical_owner_pending_device_session_read.sql

insert into auth.users values
 ('10000000-0000-4000-8000-000000000001','owner@test'),('10000000-0000-4000-8000-000000000002','other@test'),('10000000-0000-4000-8000-000000000003','target@test');
insert into platform.profiles values
 ('10000000-0000-4000-8000-000000000001','Owner','approved'),('10000000-0000-4000-8000-000000000002','Other','approved'),('10000000-0000-4000-8000-000000000003','Target','approved');
insert into platform_private.owners values('10000000-0000-4000-8000-000000000001');
insert into platform.devices values
 ('20000000-0000-4000-8000-000000000001','Owner device','web','test','active',null,null),
 ('20000000-0000-4000-8000-000000000002','Other device','web','test','active',null,null),
 ('20000000-0000-4000-8000-000000000003','Pending target','web','test','active',null,null),
 ('20000000-0000-4000-8000-000000000004','Rejected target','web','test','active',null,null),
 ('20000000-0000-4000-8000-000000000005','Revoked target','web','test','active',null,null);
insert into platform.user_device_authorizations values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','approved',now(),null),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','approved',now(),null),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','pending',now(),null),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004','rejected',now(),null),
 ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000005','pending',now(),now());
insert into platform.device_key_bindings values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','owner-key','ECDSA_P256_SHA256','active',null,null),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','other-key','ECDSA_P256_SHA256','active',null,null);
insert into platform_private.device_sessions values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','owner-key',digest('owner-token','sha256'),'PLATFORM_DEVICE_SESSION',now(),now()+interval '5 minutes',null),
 ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','other-key',digest('other-token','sha256'),'PLATFORM_DEVICE_SESSION',now(),now()+interval '5 minutes',null),
 ('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','owner-key',digest('expired-token','sha256'),'PLATFORM_DEVICE_SESSION',now()-interval '10 minutes',now()-interval '5 minutes',null);

set role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select platform.execute_device_operation('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',digest('owner-token','sha256'),'platform','list_system_owner_pending_device_authorizations','{}')->'devices';
select platform.execute_device_operation('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',digest('owner-token','sha256'),'platform','list_system_owner_pending_device_authorizations','{}')->'devices';

do $$begin
  begin perform platform.execute_device_operation('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002',digest('other-token','sha256'),'platform','list_system_owner_pending_device_authorizations','{}'); raise exception 'NON_OWNER_ACCEPTED'; exception when insufficient_privilege then null; end;
  begin perform platform.execute_device_operation('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',digest('expired-token','sha256'),'platform','list_system_owner_pending_device_authorizations','{}'); raise exception 'EXPIRED_ACCEPTED'; exception when insufficient_privilege then null; end;
  begin perform platform.execute_device_operation('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',digest('wrong','sha256'),'platform','list_system_owner_pending_device_authorizations','{}'); raise exception 'BAD_TOKEN_ACCEPTED'; exception when insufficient_privilege then null; end;
  begin perform platform.execute_device_operation('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001',digest('owner-token','sha256'),'platform','list_system_owner_pending_device_authorizations','{}'); raise exception 'USER_SESSION_MISMATCH_ACCEPTED'; exception when insufficient_privilege then null; end;
end$$;
reset role;

select jsonb_build_object(
  'status','pass','positive',2,'negative',4,
  'listed',(select count(*) from platform.user_device_authorizations where status='pending' and revoked_at is null),
  'legacyServiceRoleExecute',has_function_privilege('service_role','public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea)','execute'),
  'directAuthenticatedExecute',has_function_privilege('authenticated','public.list_system_owner_pending_device_authorizations_for_session(uuid)','execute')
);
