-- Phase W1 Round 3L.1: Production-safe structural Platform foundation.
-- This package establishes structure and active Platform reference data only.
-- Account/owner reconciliation remains in 20260907160000; native key enrollment remains later.

begin;

create schema if not exists platform;
create schema if not exists platform_private;
revoke all on schema platform from public, anon, authenticated;
revoke all on schema platform_private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table platform.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text null check (display_name is null or length(btrim(display_name)) between 1 and 120),
  phone text null check (phone is null or length(btrim(phone)) between 3 and 32),
  avatar_url text null check (avatar_url is null or length(avatar_url)<=2048),
  locale text null check (locale is null or locale~'^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'),
  timezone text null check (timezone is null or length(btrim(timezone)) between 1 and 120),
  account_status text not null default 'pending' check (account_status in ('pending','approved','blocked')),
  status_reason text null check (status_reason is null or length(status_reason)<=1000),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid null references platform.profiles(user_id) on delete set null,
  approved_at timestamptz null,
  approved_by uuid null references platform.profiles(user_id) on delete set null,
  blocked_at timestamptz null,
  blocked_by uuid null references platform.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(account_status<>'approved' or approved_at is not null),
  check(account_status<>'blocked' or blocked_at is not null)
);

create table platform.permissions (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check(code~'^(platform|inventory)\.[a-z][a-z0-9_.-]{1,110}$'),
  domain text not null check(domain in ('platform','inventory')),
  description text null check(description is null or length(description)<=500),
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(split_part(code,'.',1)=domain)
);

create table platform.roles (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null check(code~'^[a-z][a-z0-9._-]{2,79}$'),
  domain text not null check(domain in ('platform','inventory')),
  name text not null check(length(btrim(name)) between 1 and 120),
  description text null check(description is null or length(description)<=500),
  scope_type text not null check(scope_type in ('platform','inventory')),
  is_system boolean not null default true,
  is_assignable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(domain,code), check(domain=scope_type)
);

create table platform.role_permissions (
  role_id uuid not null references platform.roles(id) on delete cascade,
  permission_id uuid not null references platform.permissions(id) on delete cascade,
  created_by uuid null references platform.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(role_id,permission_id)
);

create table platform.user_roles (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete cascade,
  role_id uuid not null references platform.roles(id) on delete restrict,
  scope_type text not null check(scope_type in ('platform','inventory')),
  scope_id uuid null,
  granted_by uuid null references platform.profiles(user_id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by uuid null references platform.profiles(user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  check(scope_id is null), check(expires_at is null or expires_at>granted_at)
);
create unique index user_roles_active_assignment_idx on platform.user_roles(user_id,role_id,scope_type) where revoked_at is null;
create index user_roles_effective_access_idx on platform.user_roles(user_id,scope_type,revoked_at,expires_at);

create table platform.devices (
  id uuid primary key,
  secret_hash text not null unique check(secret_hash~'^[0-9a-f]{64}$'),
  display_name text null check(display_name is null or length(btrim(display_name)) between 1 and 120),
  platform text null check(platform is null or length(platform)<=120),
  browser text null check(browser is null or length(browser)<=120),
  lifecycle_status text not null default 'active' check(lifecycle_status in ('active','retired','compromised')),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  secret_rotated_at timestamptz null, retired_at timestamptz null, compromised_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(lifecycle_status<>'retired' or retired_at is not null),
  check(lifecycle_status<>'compromised' or compromised_at is not null)
);

create table platform.user_device_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete cascade,
  device_id uuid not null references platform.devices(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','approved','blocked','revoked')),
  requested_at timestamptz not null default now(),
  approved_by uuid null references platform.profiles(user_id) on delete set null, approved_at timestamptz null,
  blocked_by uuid null references platform.profiles(user_id) on delete set null, blocked_at timestamptz null,
  revoked_by uuid null references platform.profiles(user_id) on delete set null, revoked_at timestamptz null,
  status_reason text null check(status_reason is null or length(status_reason)<=1000),
  last_authorized_seen_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,device_id),
  check(status<>'approved' or approved_at is not null),
  check(status<>'blocked' or blocked_at is not null),
  check(status<>'revoked' or revoked_at is not null)
);
create index device_authorizations_user_status_idx on platform.user_device_authorizations(user_id,status);
create index device_authorizations_device_idx on platform.user_device_authorizations(device_id);

create table platform.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid null references platform.profiles(user_id) on delete set null,
  actor_device_authorization_id uuid null references platform.user_device_authorizations(id) on delete set null,
  subject_user_id uuid null references platform.profiles(user_id) on delete set null,
  domain text not null check(domain in ('platform','inventory')),
  module text not null check(module~'^[a-z][a-z0-9_-]{1,39}$'),
  action text not null check(action~'^[a-z][a-z0-9_.-]{1,119}$'),
  entity_type text not null check(entity_type~'^[a-z][a-z0-9_.-]{1,119}$'), entity_id uuid null,
  scope_type text null check(scope_type is null or scope_type in ('platform','inventory')), scope_id uuid null,
  old_values jsonb null check(old_values is null or jsonb_typeof(old_values)='object'),
  new_values jsonb null check(new_values is null or jsonb_typeof(new_values)='object'),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  request_id uuid null, operation_id uuid null,
  source text not null default 'rpc' check(source in ('rpc','bootstrap','migration','system')),
  occurred_at timestamptz not null default now(), check(scope_id is null)
);
create index audit_events_actor_time_idx on platform.audit_events(actor_user_id,occurred_at desc);
create index audit_events_entity_time_idx on platform.audit_events(entity_type,entity_id,occurred_at desc);
create index audit_events_domain_time_idx on platform.audit_events(domain,occurred_at desc);

create table platform.device_key_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  device_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  public_key_jwk jsonb not null,
  public_key_thumbprint text not null check(public_key_thumbprint~'^[0-9a-f]{64}$'),
  algorithm text not null check(algorithm='ECDSA_P256_SHA256'),
  lifecycle_status text not null default 'active' check(lifecycle_status in ('active','rotated','revoked','retired')),
  migration_source text not null constraint device_key_bindings_migration_source_check
    check(migration_source in ('current_http_only_device_secret','bound_key_rotation','privileged_recovery')),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  activated_at timestamptz not null default pg_catalog.statement_timestamp(),
  replaced_by_binding_id uuid null references platform.device_key_bindings(id) on delete restrict,
  rotated_at timestamptz null, revoked_at timestamptz null, retired_at timestamptz null,
  audit_event_id uuid null references platform.audit_events(id) on delete restrict,
  unique(id,user_id,device_id,device_authorization_id), unique(device_id,public_key_thumbprint),
  check(public_key_jwk->>'kty'='EC' and public_key_jwk->>'crv'='P-256' and public_key_jwk?'x' and public_key_jwk?'y' and not(public_key_jwk?'d')),
  check((lifecycle_status='active' and rotated_at is null and revoked_at is null and retired_at is null)
    or (lifecycle_status='rotated' and rotated_at is not null)
    or (lifecycle_status='revoked' and revoked_at is not null)
    or (lifecycle_status='retired' and retired_at is not null))
);
create unique index device_key_bindings_one_active_device_idx on platform.device_key_bindings(device_id) where lifecycle_status='active';

-- Active reference data is Platform-only. Inventory remains a dormant type value solely
-- because reviewed retirement migration 20260907130000 expects the historical type shape.
insert into platform.permissions(code,domain,description) values
 ('platform.access.manage','platform','Manage platform access configuration'),
 ('platform.users.view','platform','View platform users'),('platform.users.manage','platform','Approve or block platform users'),
 ('platform.roles.view','platform','View platform roles and grants'),('platform.roles.manage','platform','Manage platform role assignments'),
 ('platform.devices.view','platform','View devices and authorizations'),('platform.devices.approve','platform','Approve pending device authorizations'),
 ('platform.devices.block','platform','Block device authorizations'),('platform.devices.revoke','platform','Permanently revoke device authorizations'),
 ('platform.audit.view','platform','View platform audit events');
insert into platform.roles(code,domain,name,description,scope_type,is_system,is_assignable) values
 ('platform_owner','platform','Platform Owner','Canonical non-assignable owner role','platform',true,false),
 ('platform_admin','platform','Platform Admin','Administers users, roles, devices, and audit','platform',true,true);
insert into platform.role_permissions(role_id,permission_id)
select role.id,permission.id from platform.roles role cross join platform.permissions permission
where role.domain='platform' and role.code in ('platform_owner','platform_admin') and permission.domain='platform';

create or replace function platform_private.set_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=pg_catalog.now(); return new; end; $$;
create trigger profiles_set_updated_at before update on platform.profiles for each row execute function platform_private.set_updated_at();
create trigger permissions_set_updated_at before update on platform.permissions for each row execute function platform_private.set_updated_at();
create trigger roles_set_updated_at before update on platform.roles for each row execute function platform_private.set_updated_at();
create trigger devices_set_updated_at before update on platform.devices for each row execute function platform_private.set_updated_at();
create trigger device_authorizations_set_updated_at before update on platform.user_device_authorizations for each row execute function platform_private.set_updated_at();

create or replace function platform_private.provision_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into platform.profiles(user_id,display_name,account_status)
  values(new.id,nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'name','')),''),'pending')
  on conflict(user_id) do nothing;
  return new;
end; $$;
create trigger platform_auth_user_provisioned after insert on auth.users for each row execute function platform_private.provision_auth_user();

create or replace function platform_private.prevent_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'PLATFORM_AUDIT_IMMUTABLE' using errcode='55000'; end; $$;
create trigger platform_audit_immutable before update or delete on platform.audit_events for each row execute function platform_private.prevent_audit_mutation();

create or replace function platform_private.request_header(p_name text) returns text language sql stable set search_path='' as $$
 select nullif(coalesce(nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb->>lower(p_name),''),''); $$;
create or replace function platform_private.hash_device_secret(p_secret text) returns text language sql immutable set search_path='' as $$
 select case when p_secret~'^[A-Za-z0-9_-]{43}$' then pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_secret,'UTF8'),'sha256'),'hex') else null end; $$;
create or replace function platform_private.request_device_id() returns uuid language sql stable set search_path='' as $$
 select case when platform_private.request_header('x-platform-device-id')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then platform_private.request_header('x-platform-device-id')::uuid else null end; $$;
create or replace function platform_private.current_device_authorization_id(p_user_id uuid) returns uuid language sql stable security definer set search_path='' as $$
 select authorization.id from platform.user_device_authorizations authorization join platform.devices device on device.id=authorization.device_id
 where authorization.user_id=p_user_id and authorization.status='approved' and device.lifecycle_status='active'
 and device.id=platform_private.request_device_id() and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret')); $$;
create or replace function platform_private.is_account_approved(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from platform.profiles where user_id=p_user_id and account_status='approved'); $$;
create or replace function platform_private.has_permission_for(p_user_id uuid,p_permission_code text,p_scope_type text,p_scope_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select platform_private.is_account_approved(p_user_id) and platform_private.current_device_authorization_id(p_user_id) is not null
 and p_scope_type='platform' and p_scope_id is null and exists(select 1 from platform.user_roles assignment
 join platform.roles role on role.id=assignment.role_id join platform.role_permissions rp on rp.role_id=role.id
 join platform.permissions permission on permission.id=rp.permission_id where assignment.user_id=p_user_id
 and assignment.scope_type='platform' and assignment.scope_id is null and assignment.revoked_at is null
 and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now()) and role.domain='platform'
 and permission.domain='platform' and permission.code=p_permission_code); $$;
create or replace function platform_private.write_audit_event(
 p_actor_user_id uuid,p_subject_user_id uuid,p_domain text,p_module text,p_action text,p_entity_type text,p_entity_id uuid,
 p_scope_type text,p_old_values jsonb,p_new_values jsonb,p_metadata jsonb default '{}'::jsonb,
 p_request_id uuid default null,p_operation_id uuid default null,p_source text default 'rpc') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
 entity_type,entity_id,scope_type,scope_id,old_values,new_values,metadata,request_id,operation_id,source)
 values(p_actor_user_id,case when p_source='bootstrap' then null else platform_private.current_device_authorization_id(p_actor_user_id) end,
 p_subject_user_id,p_domain,p_module,p_action,p_entity_type,p_entity_id,p_scope_type,null,p_old_values,p_new_values,
 coalesce(p_metadata,'{}'::jsonb),p_request_id,p_operation_id,p_source) returning id into v_id;
 return v_id;
end; $$;
create or replace function platform.has_permission(p_permission_code text,p_scope_type text default 'inventory',p_scope_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and platform_private.has_permission_for(auth.uid(),p_permission_code,p_scope_type,p_scope_id); $$;

create or replace function platform.get_my_access_context(p_domain text default 'inventory',p_scope_type text default 'inventory',p_scope_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then null else pg_catalog.jsonb_build_object('userId',auth.uid(),'displayName',profile.display_name,
 'avatarUrl',profile.avatar_url,'accountStatus',coalesce(profile.account_status,'pending'),'deviceStatus',coalesce((select authorization.status
 from platform.user_device_authorizations authorization join platform.devices device on device.id=authorization.device_id
 where authorization.user_id=auth.uid() and device.id=platform_private.request_device_id()
 and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'missing'),
 'deviceLifecycle',coalesce((select device.lifecycle_status from platform.devices device where device.id=platform_private.request_device_id()
 and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'unknown'),
 'roles',coalesce((select pg_catalog.jsonb_agg(role.code order by role.code) from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
 where assignment.user_id=auth.uid() and assignment.scope_type=p_scope_type and assignment.scope_id is not distinct from p_scope_id
 and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())),'[]'::jsonb),
 'permissions',coalesce((select pg_catalog.jsonb_agg(distinct permission.code order by permission.code) from platform.user_roles assignment
 join platform.roles role on role.id=assignment.role_id join platform.role_permissions rp on rp.role_id=role.id join platform.permissions permission on permission.id=rp.permission_id
 where assignment.user_id=auth.uid() and assignment.scope_type=p_scope_type and assignment.scope_id is not distinct from p_scope_id
 and permission.domain=p_domain and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
 and platform_private.current_device_authorization_id(auth.uid()) is not null),'[]'::jsonb))
 from (select 1) singleton left join platform.profiles profile on profile.user_id=auth.uid(); $$;

create or replace function platform.register_current_device(p_display_name text default null,p_platform text default null,p_browser text default null)
returns text language plpgsql security definer set search_path='' as $$
begin
 raise exception 'PLATFORM_NATIVE_ENROLLMENT_REQUIRED' using errcode='42501';
end; $$;
create or replace function platform.get_my_device_authorization() returns jsonb language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null then null else pg_catalog.jsonb_build_object(
 'status',coalesce((select authorization.status from platform.user_device_authorizations authorization
 join platform.devices device on device.id=authorization.device_id where authorization.user_id=auth.uid()
 and device.id=platform_private.request_device_id()
 and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'missing'),
 'lifecycle',coalesce((select device.lifecycle_status from platform.devices device where device.id=platform_private.request_device_id()
 and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'unknown')) end; $$;
create or replace function platform.get_my_device_key_binding_status() returns jsonb language sql stable security definer set search_path=pg_catalog,platform as $$
 select coalesce((select jsonb_build_object('status',binding.lifecycle_status,'bindingId',binding.id,'deviceId',binding.device_id,
 'authorizationId',binding.device_authorization_id,'publicKeyThumbprint',binding.public_key_thumbprint,'algorithm',binding.algorithm)
 from platform.device_key_bindings binding where binding.user_id=auth.uid() and binding.lifecycle_status='active'
 order by binding.activated_at desc limit 1),jsonb_build_object('status','missing')); $$;

-- Signature-only, fail-closed shims satisfy the reviewed Conference migration's grant statements.
-- They deliberately implement none of the excluded Development ownership-handoff flow.
create or replace function platform.begin_current_device_ownership_handoff(p_public_key_thumbprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'PLATFORM_NATIVE_ENROLLMENT_REQUIRED' using errcode='42501'; end; $$;
create or replace function platform.get_current_device_handoff_assertion_claims(p_challenge_id uuid,p_public_key_thumbprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'PLATFORM_NATIVE_ENROLLMENT_REQUIRED' using errcode='42501'; end; $$;

alter table platform.profiles enable row level security;
alter table platform.permissions enable row level security;
alter table platform.roles enable row level security;
alter table platform.role_permissions enable row level security;
alter table platform.user_roles enable row level security;
alter table platform.devices enable row level security;
alter table platform.user_device_authorizations enable row level security;
alter table platform.audit_events enable row level security;
alter table platform.device_key_bindings enable row level security;
alter table platform.device_key_bindings force row level security;
revoke all on all tables in schema platform from public,anon,authenticated,service_role;
revoke all on all functions in schema platform_private from public,anon,authenticated,service_role;
revoke all on all functions in schema platform from public,anon,authenticated,service_role;
grant usage on schema platform to authenticated;
grant select on platform.profiles,platform.permissions,platform.roles,platform.role_permissions,platform.user_roles,
 platform.devices,platform.user_device_authorizations,platform.audit_events,platform.device_key_bindings to authenticated;
grant update(display_name,phone,avatar_url,locale,timezone) on platform.profiles to authenticated;
grant execute on function platform.has_permission(text,text,uuid),platform.get_my_access_context(text,text,uuid),
 platform.get_my_device_authorization(),platform.get_my_device_key_binding_status(),
 platform.begin_current_device_ownership_handoff(text),platform.get_current_device_handoff_assertion_claims(uuid,text) to authenticated;

create policy profiles_select_self_or_platform_viewer on platform.profiles for select to authenticated using(user_id=auth.uid() or platform.has_permission('platform.users.view','platform',null));
create policy profiles_update_self on platform.profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy permissions_select_authorized on platform.permissions for select to authenticated using(platform.has_permission('platform.roles.view','platform',null));
create policy roles_select_authorized on platform.roles for select to authenticated using(platform.has_permission('platform.roles.view','platform',null));
create policy role_permissions_select_authorized on platform.role_permissions for select to authenticated using(platform.has_permission('platform.roles.view','platform',null));
create policy user_roles_select_self_or_platform_viewer on platform.user_roles for select to authenticated using(user_id=auth.uid() or platform.has_permission('platform.roles.view','platform',null));
create policy devices_select_self_or_platform_viewer on platform.devices for select to authenticated using(exists(select 1 from platform.user_device_authorizations authorization where authorization.device_id=id and authorization.user_id=auth.uid()) or platform.has_permission('platform.devices.view','platform',null));
create policy device_authorizations_select_self_or_platform_viewer on platform.user_device_authorizations for select to authenticated using(user_id=auth.uid() or platform.has_permission('platform.devices.view','platform',null));
create policy audit_events_select_platform_auditor on platform.audit_events for select to authenticated using(platform.has_permission('platform.audit.view','platform',null));
create policy device_key_bindings_read_own on platform.device_key_bindings for select to authenticated using(user_id=(select auth.uid()));

comment on schema platform is 'Shared identity, access, device authorization, and audit foundation.';
comment on schema platform_private is 'Internal helpers; never expose through PostgREST.';
comment on function platform.has_permission(text,text,uuid) is 'Authoritative account + device + scoped Platform permission decision.';

commit;
