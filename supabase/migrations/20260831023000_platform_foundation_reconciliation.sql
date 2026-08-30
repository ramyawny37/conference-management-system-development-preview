-- Forward-only Development reconciliation of the reviewed Platform foundation.
-- Canonical source authority: Platform/Conference repository.
-- Reviewed source lineage: warehouse-management-system migrations
-- 20260825000100_access_foundation_schema.sql,
-- 20260825000200_access_reference_data.sql,
-- 20260825000300_access_rls_and_rpc.sql.
-- This migration intentionally does not bootstrap or approve any account or device.

create schema if not exists platform;
create schema if not exists platform_private;
create schema if not exists inventory;
revoke all on schema platform from public, anon, authenticated;
revoke all on schema platform_private from public, anon, authenticated;
revoke all on schema inventory from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table platform.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text null check (display_name is null or length(btrim(display_name)) between 1 and 120),
  phone text null check (phone is null or length(btrim(phone)) between 3 and 32),
  avatar_url text null check (avatar_url is null or length(avatar_url) <= 2048),
  locale text null check (locale is null or locale ~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'),
  timezone text null check (timezone is null or length(btrim(timezone)) between 1 and 120),
  account_status text not null default 'pending' check (account_status in ('pending', 'approved', 'blocked')),
  status_reason text null check (status_reason is null or length(status_reason) <= 1000),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid null references platform.profiles(user_id) on delete set null,
  approved_at timestamptz null, approved_by uuid null references platform.profiles(user_id) on delete set null,
  blocked_at timestamptz null, blocked_by uuid null references platform.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (account_status <> 'approved' or approved_at is not null),
  check (account_status <> 'blocked' or blocked_at is not null)
);

create table platform.permissions (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^(platform|inventory)\.[a-z][a-z0-9_.-]{1,110}$'),
  domain text not null check (domain in ('platform', 'inventory')),
  description text null check (description is null or length(description) <= 500),
  is_system boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (split_part(code, '.', 1) = domain)
);

create table platform.roles (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9._-]{2,79}$'),
  domain text not null check (domain in ('platform', 'inventory')),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text null check (description is null or length(description) <= 500),
  scope_type text not null check (scope_type in ('platform', 'inventory')),
  is_system boolean not null default true, is_assignable boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (domain, code), check (domain = scope_type)
);

create table platform.role_permissions (
  role_id uuid not null references platform.roles(id) on delete cascade,
  permission_id uuid not null references platform.permissions(id) on delete cascade,
  created_by uuid null references platform.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(), primary key (role_id, permission_id)
);

create table platform.user_roles (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete cascade,
  role_id uuid not null references platform.roles(id) on delete restrict,
  scope_type text not null check (scope_type in ('platform', 'inventory')), scope_id uuid null,
  granted_by uuid null references platform.profiles(user_id) on delete set null,
  granted_at timestamptz not null default now(), expires_at timestamptz null,
  revoked_at timestamptz null, revoked_by uuid null references platform.profiles(user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (scope_id is null), check (expires_at is null or expires_at > granted_at)
);
create unique index user_roles_active_assignment_idx on platform.user_roles (user_id, role_id, scope_type) where revoked_at is null;
create index user_roles_effective_access_idx on platform.user_roles (user_id, scope_type, revoked_at, expires_at);

create table platform.devices (
  id uuid primary key,
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  display_name text null check (display_name is null or length(btrim(display_name)) between 1 and 120),
  platform text null check (platform is null or length(platform) <= 120),
  browser text null check (browser is null or length(browser) <= 120),
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'retired', 'compromised')),
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  secret_rotated_at timestamptz null, retired_at timestamptz null, compromised_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (lifecycle_status <> 'retired' or retired_at is not null),
  check (lifecycle_status <> 'compromised' or compromised_at is not null)
);

create table platform.user_device_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references platform.profiles(user_id) on delete cascade,
  device_id uuid not null references platform.devices(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_by uuid null references platform.profiles(user_id) on delete set null, approved_at timestamptz null,
  blocked_by uuid null references platform.profiles(user_id) on delete set null, blocked_at timestamptz null,
  revoked_by uuid null references platform.profiles(user_id) on delete set null, revoked_at timestamptz null,
  status_reason text null check (status_reason is null or length(status_reason) <= 1000),
  last_authorized_seen_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, device_id),
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'blocked' or blocked_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);
create index device_authorizations_user_status_idx on platform.user_device_authorizations (user_id, status);
create index device_authorizations_device_idx on platform.user_device_authorizations (device_id);

create table platform.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid null references platform.profiles(user_id) on delete set null,
  actor_device_authorization_id uuid null references platform.user_device_authorizations(id) on delete set null,
  subject_user_id uuid null references platform.profiles(user_id) on delete set null,
  domain text not null check (domain in ('platform', 'inventory')),
  module text not null check (module ~ '^[a-z][a-z0-9_-]{1,39}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_.-]{1,119}$'), entity_id uuid null,
  scope_type text null check (scope_type is null or scope_type in ('platform', 'inventory')), scope_id uuid null,
  old_values jsonb null check (old_values is null or jsonb_typeof(old_values) = 'object'),
  new_values jsonb null check (new_values is null or jsonb_typeof(new_values) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  request_id uuid null, operation_id uuid null,
  source text not null default 'rpc' check (source in ('rpc', 'bootstrap', 'migration', 'system')),
  occurred_at timestamptz not null default now(), check (scope_id is null)
);
create index audit_events_actor_time_idx on platform.audit_events (actor_user_id, occurred_at desc);
create index audit_events_entity_time_idx on platform.audit_events (entity_type, entity_id, occurred_at desc);
create index audit_events_domain_time_idx on platform.audit_events (domain, occurred_at desc);
create or replace function platform_private.seed_access_reference_data()
returns void language plpgsql set search_path = '' as $$
begin
  insert into platform.permissions (code, domain, description) values
    ('platform.access.manage','platform','Manage platform access configuration'),
    ('platform.users.view','platform','View platform users'),('platform.users.manage','platform','Approve or block platform users'),
    ('platform.roles.view','platform','View platform roles and grants'),('platform.roles.manage','platform','Manage platform and domain role assignments'),
    ('platform.devices.view','platform','View devices and authorizations'),('platform.devices.approve','platform','Approve pending device authorizations'),
    ('platform.devices.block','platform','Block device authorizations'),('platform.devices.revoke','platform','Permanently revoke device authorizations'),
    ('platform.audit.view','platform','View platform audit events'),
    ('inventory.access','inventory','Access inventory'),('inventory.products.view','inventory','View products'),
    ('inventory.products.create','inventory','Create products'),('inventory.products.edit','inventory','Edit products'),
    ('inventory.products.delete','inventory','Archive or delete eligible products'),('inventory.warehouses.view','inventory','View warehouses'),
    ('inventory.warehouses.manage','inventory','Manage warehouses'),('inventory.parties.view','inventory','View parties'),
    ('inventory.parties.manage','inventory','Manage parties'),('inventory.stock.view','inventory','View stock and movements'),
    ('inventory.stock.receive','inventory','Receive stock'),('inventory.stock.issue','inventory','Issue stock'),
    ('inventory.stock.transfer','inventory','Transfer stock'),('inventory.purchases.view','inventory','View purchases'),
    ('inventory.purchases.manage','inventory','Manage purchases'),('inventory.payments.view','inventory','View payments and balances'),
    ('inventory.payments.manage','inventory','Manage payments and allocations'),('inventory.reports.view','inventory','View inventory reports'),
    ('inventory.settings.manage','inventory','Manage inventory-specific settings')
  on conflict (code) do update set domain=excluded.domain,description=excluded.description,updated_at=pg_catalog.now();

  insert into platform.roles (code,domain,name,description,scope_type,is_system,is_assignable) values
    ('platform_owner','platform','Platform Owner','Bootstrap owner with every platform permission','platform',true,false),
    ('platform_admin','platform','Platform Admin','Administers users, roles, devices, and audit','platform',true,true),
    ('inventory_manager','inventory','Inventory Manager','Manages inventory operations and reporting','inventory',true,true),
    ('inventory_operator','inventory','Inventory Operator','Runs approved daily inventory operations','inventory',true,true),
    ('viewer','inventory','Inventory Viewer','Read-only inventory access','inventory',true,true)
  on conflict (domain,code) do update set name=excluded.name,description=excluded.description,scope_type=excluded.scope_type,
    is_system=excluded.is_system,is_assignable=excluded.is_assignable,updated_at=pg_catalog.now();

  insert into platform.role_permissions (role_id,permission_id)
  select r.id,p.id from platform.roles r cross join platform.permissions p
  where r.domain='platform' and r.code in ('platform_owner','platform_admin') and p.domain='platform' on conflict do nothing;

  insert into platform.role_permissions (role_id,permission_id)
  select r.id,p.id from platform.roles r join platform.permissions p on p.code=any(array[
    'inventory.access','inventory.products.view','inventory.products.create','inventory.products.edit','inventory.warehouses.view',
    'inventory.warehouses.manage','inventory.parties.view','inventory.parties.manage','inventory.stock.view','inventory.stock.receive',
    'inventory.stock.issue','inventory.stock.transfer','inventory.purchases.view','inventory.purchases.manage','inventory.payments.view',
    'inventory.payments.manage','inventory.reports.view','inventory.settings.manage'])
  where r.domain='inventory' and r.code='inventory_manager' on conflict do nothing;

  insert into platform.role_permissions (role_id,permission_id)
  select r.id,p.id from platform.roles r join platform.permissions p on p.code=any(array[
    'inventory.access','inventory.products.view','inventory.products.create','inventory.products.edit','inventory.warehouses.view',
    'inventory.parties.view','inventory.parties.manage','inventory.stock.view','inventory.stock.receive','inventory.stock.issue',
    'inventory.stock.transfer','inventory.purchases.view','inventory.purchases.manage','inventory.payments.view','inventory.reports.view'])
  where r.domain='inventory' and r.code='inventory_operator' on conflict do nothing;

  insert into platform.role_permissions (role_id,permission_id)
  select r.id,p.id from platform.roles r join platform.permissions p on p.code=any(array[
    'inventory.access','inventory.products.view','inventory.warehouses.view','inventory.parties.view','inventory.stock.view',
    'inventory.purchases.view','inventory.payments.view','inventory.reports.view'])
  where r.domain='inventory' and r.code='viewer' on conflict do nothing;
end; $$;
revoke all on function platform_private.seed_access_reference_data() from public,anon,authenticated;
select platform_private.seed_access_reference_data();

create or replace function platform_private.set_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=pg_catalog.now(); return new; end; $$;
create trigger profiles_set_updated_at before update on platform.profiles for each row execute function platform_private.set_updated_at();
create trigger permissions_set_updated_at before update on platform.permissions for each row execute function platform_private.set_updated_at();
create trigger roles_set_updated_at before update on platform.roles for each row execute function platform_private.set_updated_at();
create trigger devices_set_updated_at before update on platform.devices for each row execute function platform_private.set_updated_at();
create trigger device_authorizations_set_updated_at before update on platform.user_device_authorizations for each row execute function platform_private.set_updated_at();

create or replace function platform_private.provision_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into platform.profiles(user_id,display_name)
  values(new.id,nullif(pg_catalog.btrim(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'name','')),''))
  on conflict(user_id) do nothing;
  return new;
end; $$;
create trigger platform_auth_user_provisioned after insert on auth.users for each row execute function platform_private.provision_auth_user();

create or replace function platform_private.prevent_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'PLATFORM_AUDIT_IMMUTABLE' using errcode='55000'; end; $$;
create trigger platform_audit_immutable before update or delete on platform.audit_events for each row execute function platform_private.prevent_audit_mutation();

create or replace function platform_private.request_header(p_name text) returns text language sql stable set search_path='' as $$
  select nullif(coalesce(nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb->>lower(p_name),''),'');
$$;
create or replace function platform_private.hash_device_secret(p_secret text) returns text language sql immutable set search_path='' as $$
  select case when p_secret ~ '^[A-Za-z0-9_-]{43}$'
    then pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_secret,'UTF8'),'sha256'),'hex') else null end;
$$;
create or replace function platform_private.request_device_id() returns uuid language sql stable set search_path='' as $$
  select case when platform_private.request_header('x-platform-device-id')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then platform_private.request_header('x-platform-device-id')::uuid else null end;
$$;
create or replace function platform_private.current_device_authorization_id(p_user_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select device_authorization.id from platform.user_device_authorizations device_authorization
  join platform.devices device on device.id=device_authorization.device_id
  where device_authorization.user_id=p_user_id and device_authorization.status='approved'
    and device.lifecycle_status='active'
    and device.id=platform_private.request_device_id()
    and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'));
$$;
create or replace function platform_private.is_account_approved(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from platform.profiles profile where profile.user_id=p_user_id and profile.account_status='approved');
$$;
create or replace function platform_private.has_permission_for(p_user_id uuid,p_permission_code text,p_scope_type text,p_scope_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select platform_private.is_account_approved(p_user_id)
    and platform_private.current_device_authorization_id(p_user_id) is not null
    and p_scope_type in ('platform','inventory') and p_scope_id is null
    and exists(
      select 1 from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=p_user_id and assignment.scope_type=p_scope_type and assignment.scope_id is null
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and role.scope_type=assignment.scope_type and role.domain=permission.domain
        and permission.code=p_permission_code and permission.domain=p_scope_type);
$$;

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
  select auth.uid() is not null and platform_private.has_permission_for(auth.uid(),p_permission_code,p_scope_type,p_scope_id);
$$;

create or replace function platform.get_my_access_context(p_domain text default 'inventory',p_scope_type text default 'inventory',p_scope_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else pg_catalog.jsonb_build_object(
    'userId',auth.uid(),'displayName',profile.display_name,'avatarUrl',profile.avatar_url,
    'accountStatus',coalesce(profile.account_status,'pending'),
    'deviceStatus',coalesce((select device_authorization.status from platform.user_device_authorizations device_authorization
      join platform.devices device on device.id=device_authorization.device_id
      where device_authorization.user_id=auth.uid()
        and device.id=platform_private.request_device_id()
        and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'missing'),
    'deviceLifecycle',coalesce((select device.lifecycle_status from platform.devices device
      where device.id=platform_private.request_device_id()
        and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'unknown'),
    'roles',coalesce((select pg_catalog.jsonb_agg(role.code order by role.code) from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id where assignment.user_id=auth.uid()
      and assignment.scope_type=p_scope_type and assignment.scope_id is not distinct from p_scope_id
      and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())),'[]'::jsonb),
    'permissions',coalesce((select pg_catalog.jsonb_agg(distinct permission.code order by permission.code)
      from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=auth.uid() and assignment.scope_type=p_scope_type
        and assignment.scope_id is not distinct from p_scope_id and permission.domain=p_domain
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and platform_private.current_device_authorization_id(auth.uid()) is not null),'[]'::jsonb)
  ) end from (select 1) singleton left join platform.profiles profile on profile.user_id=auth.uid();
$$;

create or replace function platform.register_current_device(p_display_name text default null,p_platform text default null,p_browser text default null)
returns text language plpgsql security definer set search_path='' as $$
declare p_device_id uuid:=platform_private.request_device_id();v_hash text:=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'));
  v_existing_hash text;v_status text;v_inserted integer;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='28000'; end if;
  if p_device_id is null or v_hash is null then raise exception 'INVALID_DEVICE_CREDENTIALS' using errcode='22023'; end if;
  select secret_hash into v_existing_hash from platform.devices where id=p_device_id;
  if found and v_existing_hash<>v_hash then raise exception 'DEVICE_CREDENTIAL_MISMATCH' using errcode='42501'; end if;
  insert into platform.devices(id,secret_hash,display_name,platform,browser)
  values(p_device_id,v_hash,nullif(pg_catalog.btrim(p_display_name),''),nullif(pg_catalog.btrim(p_platform),''),nullif(pg_catalog.btrim(p_browser),''))
  on conflict(id) do update set last_seen_at=pg_catalog.now(),display_name=coalesce(excluded.display_name,platform.devices.display_name),
    platform=coalesce(excluded.platform,platform.devices.platform),browser=coalesce(excluded.browser,platform.devices.browser);
  insert into platform.user_device_authorizations(user_id,device_id) values(auth.uid(),p_device_id)
  on conflict(user_id,device_id) do nothing;
  get diagnostics v_inserted=row_count;
  select status into v_status from platform.user_device_authorizations where user_id=auth.uid() and device_id=p_device_id;
  if v_inserted>0 then perform platform_private.write_audit_event(auth.uid(),auth.uid(),'platform','devices','device.registered',
    'user_device_authorization',(select id from platform.user_device_authorizations where user_id=auth.uid() and device_id=p_device_id),
    'platform',null,pg_catalog.jsonb_build_object('status',v_status),pg_catalog.jsonb_build_object('deviceId',p_device_id)); end if;
  return v_status;
end; $$;

create or replace function platform.get_my_device_authorization() returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else pg_catalog.jsonb_build_object(
    'status',coalesce((select device_authorization.status from platform.user_device_authorizations device_authorization join platform.devices device on device.id=device_authorization.device_id
      where device_authorization.user_id=auth.uid() and device.id=platform_private.request_device_id()
      and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'missing'),
    'lifecycle',coalesce((select device.lifecycle_status from platform.devices device where device.id=platform_private.request_device_id()
      and device.secret_hash=platform_private.hash_device_secret(platform_private.request_header('x-platform-device-secret'))),'unknown')) end;
$$;

create or replace function platform.set_account_status(p_user_id uuid,p_status text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_old text;
begin
  if p_status not in ('pending','approved','blocked') then raise exception 'INVALID_ACCOUNT_STATUS' using errcode='22023'; end if;
  if not platform_private.has_permission_for(auth.uid(),'platform.users.manage','platform',null) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  if p_user_id=auth.uid() and p_status<>'approved' then raise exception 'SELF_ACCOUNT_RESTRICTION_FORBIDDEN' using errcode='42501'; end if;
  if p_status<>'approved' and exists(select 1 from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
    where assignment.user_id=p_user_id and assignment.revoked_at is null and role.domain='platform' and role.code='platform_owner') then
    raise exception 'PLATFORM_OWNER_ACCOUNT_RESTRICTION_FORBIDDEN' using errcode='42501';
  end if;
  select account_status into v_old from platform.profiles where user_id=p_user_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
  update platform.profiles set account_status=p_status,status_reason=nullif(pg_catalog.btrim(p_reason),''),status_changed_at=pg_catalog.now(),status_changed_by=auth.uid(),
    approved_at=case when p_status='approved' then pg_catalog.now() else approved_at end,approved_by=case when p_status='approved' then auth.uid() else approved_by end,
    blocked_at=case when p_status='blocked' then pg_catalog.now() else null end,blocked_by=case when p_status='blocked' then auth.uid() else null end where user_id=p_user_id;
  perform platform_private.write_audit_event(auth.uid(),p_user_id,'platform','users','account.status_changed','profile',p_user_id,'platform',
    pg_catalog.jsonb_build_object('status',v_old),pg_catalog.jsonb_build_object('status',p_status),pg_catalog.jsonb_build_object('reason',p_reason));
end; $$;

create or replace function platform.grant_user_role(p_user_id uuid,p_role_domain text,p_role_code text,p_scope_type text,p_scope_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_role platform.roles%rowtype;v_id uuid;
begin
  if not platform_private.has_permission_for(auth.uid(),'platform.roles.manage','platform',null) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  if p_scope_type not in ('platform','inventory') or p_scope_id is not null then raise exception 'UNSUPPORTED_ROLE_SCOPE' using errcode='22023'; end if;
  select * into v_role from platform.roles where domain=p_role_domain and code=p_role_code;
  if not found or v_role.scope_type<>p_scope_type then raise exception 'ROLE_NOT_FOUND_OR_SCOPE_INVALID' using errcode='P0002'; end if;
  if not v_role.is_assignable then raise exception 'ROLE_NOT_ASSIGNABLE' using errcode='42501'; end if;
  if not exists(select 1 from platform.profiles where user_id=p_user_id) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
  select id into v_id from platform.user_roles where user_id=p_user_id and role_id=v_role.id and scope_type=p_scope_type and revoked_at is null;
  if v_id is null then insert into platform.user_roles(user_id,role_id,scope_type,scope_id,granted_by) values(p_user_id,v_role.id,p_scope_type,null,auth.uid()) returning id into v_id;
    perform platform_private.write_audit_event(auth.uid(),p_user_id,'platform','roles','role.granted','user_role',v_id,p_scope_type,null,
      pg_catalog.jsonb_build_object('domain',p_role_domain,'role',p_role_code),pg_catalog.jsonb_build_object()); end if;
  return v_id;
end; $$;

create or replace function platform.revoke_user_role(p_assignment_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_assignment platform.user_roles%rowtype;v_role platform.roles%rowtype;
begin
  if not platform_private.has_permission_for(auth.uid(),'platform.roles.manage','platform',null) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  select * into v_assignment from platform.user_roles where id=p_assignment_id for update;
  if not found then raise exception 'ROLE_ASSIGNMENT_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_role from platform.roles where id=v_assignment.role_id;
  if v_role.code='platform_owner' then raise exception 'PLATFORM_OWNER_ROLE_CANNOT_BE_REVOKED_BY_RPC' using errcode='42501'; end if;
  if v_assignment.revoked_at is null then update platform.user_roles set revoked_at=pg_catalog.now(),revoked_by=auth.uid() where id=p_assignment_id;
    perform platform_private.write_audit_event(auth.uid(),v_assignment.user_id,'platform','roles','role.revoked','user_role',p_assignment_id,v_assignment.scope_type,
      pg_catalog.jsonb_build_object('domain',v_role.domain,'role',v_role.code),null,pg_catalog.jsonb_build_object()); end if;
end; $$;

create or replace function platform_private.change_role_permission(p_role_domain text,p_role_code text,p_permission_code text,p_granted boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_role platform.roles%rowtype;v_permission platform.permissions%rowtype;v_changed integer;
begin
  if not platform_private.has_permission_for(auth.uid(),'platform.roles.manage','platform',null) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  select * into v_role from platform.roles where domain=p_role_domain and code=p_role_code;
  select * into v_permission from platform.permissions where code=p_permission_code;
  if v_role.id is null or v_permission.id is null then raise exception 'ROLE_OR_PERMISSION_NOT_FOUND' using errcode='P0002'; end if;
  if v_role.domain<>v_permission.domain then raise exception 'CROSS_DOMAIN_PERMISSION_FORBIDDEN' using errcode='42501'; end if;
  if v_role.code='platform_owner' then raise exception 'PLATFORM_OWNER_PERMISSIONS_IMMUTABLE' using errcode='42501'; end if;
  if p_granted then insert into platform.role_permissions(role_id,permission_id,created_by) values(v_role.id,v_permission.id,auth.uid()) on conflict do nothing;
  else delete from platform.role_permissions where role_id=v_role.id and permission_id=v_permission.id; end if;
  get diagnostics v_changed=row_count;
  if v_changed>0 then perform platform_private.write_audit_event(auth.uid(),null,'platform','roles',case when p_granted then 'permission.granted' else 'permission.revoked' end,
    'role',v_role.id,v_role.scope_type,null,pg_catalog.jsonb_build_object('permission',p_permission_code,'granted',p_granted),pg_catalog.jsonb_build_object()); end if;
end; $$;
create or replace function platform.grant_role_permission(p_role_domain text,p_role_code text,p_permission_code text) returns void language plpgsql security definer set search_path='' as $$
begin perform platform_private.change_role_permission(p_role_domain,p_role_code,p_permission_code,true); end; $$;
create or replace function platform.revoke_role_permission(p_role_domain text,p_role_code text,p_permission_code text) returns void language plpgsql security definer set search_path='' as $$
begin perform platform_private.change_role_permission(p_role_domain,p_role_code,p_permission_code,false); end; $$;

create or replace function platform_private.change_device_authorization(p_authorization_id uuid,p_status text,p_permission text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_row platform.user_device_authorizations%rowtype;
begin
  if not platform_private.has_permission_for(auth.uid(),p_permission,'platform',null) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  select * into v_row from platform.user_device_authorizations where id=p_authorization_id for update;
  if not found then raise exception 'DEVICE_AUTHORIZATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_row.status='revoked' then raise exception 'DEVICE_AUTHORIZATION_REVOKED_TERMINAL' using errcode='55000'; end if;
  if p_status in ('blocked','revoked') and exists(select 1 from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
      where assignment.user_id=v_row.user_id and assignment.revoked_at is null and role.domain='platform' and role.code='platform_owner')
    and not exists(select 1 from platform.user_device_authorizations other join platform.devices device on device.id=other.device_id
      where other.user_id=v_row.user_id and other.id<>v_row.id and other.status='approved' and device.lifecycle_status='active') then
    raise exception 'LAST_PLATFORM_OWNER_DEVICE_RESTRICTION_FORBIDDEN' using errcode='42501';
  end if;
  update platform.user_device_authorizations set status=p_status,status_reason=nullif(pg_catalog.btrim(p_reason),''),
    approved_by=case when p_status='approved' then auth.uid() else approved_by end,approved_at=case when p_status='approved' then pg_catalog.now() else approved_at end,
    blocked_by=case when p_status='blocked' then auth.uid() else null end,blocked_at=case when p_status='blocked' then pg_catalog.now() else null end,
    revoked_by=case when p_status='revoked' then auth.uid() else null end,revoked_at=case when p_status='revoked' then pg_catalog.now() else null end
  where id=p_authorization_id;
  perform platform_private.write_audit_event(auth.uid(),v_row.user_id,'platform','devices','device_authorization.'||p_status,'user_device_authorization',p_authorization_id,
    'platform',pg_catalog.jsonb_build_object('status',v_row.status),pg_catalog.jsonb_build_object('status',p_status),pg_catalog.jsonb_build_object('reason',p_reason));
end; $$;
create or replace function platform.approve_device_authorization(p_authorization_id uuid,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
begin perform platform_private.change_device_authorization(p_authorization_id,'approved','platform.devices.approve',p_reason); end; $$;
create or replace function platform.block_device_authorization(p_authorization_id uuid,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
begin perform platform_private.change_device_authorization(p_authorization_id,'blocked','platform.devices.block',p_reason); end; $$;
create or replace function platform.revoke_device_authorization(p_authorization_id uuid,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
begin perform platform_private.change_device_authorization(p_authorization_id,'revoked','platform.devices.revoke',p_reason); end; $$;

revoke all on all functions in schema platform_private from public,anon,authenticated;
revoke all on all functions in schema platform from public,anon,authenticated;
grant usage on schema platform to authenticated;
grant execute on function platform.has_permission(text,text,uuid),platform.get_my_access_context(text,text,uuid),
  platform.register_current_device(text,text,text),platform.get_my_device_authorization(),
  platform.set_account_status(uuid,text,text),platform.grant_user_role(uuid,text,text,text,uuid),platform.revoke_user_role(uuid),
  platform.grant_role_permission(text,text,text),platform.revoke_role_permission(text,text,text),
  platform.approve_device_authorization(uuid,text),platform.block_device_authorization(uuid,text),platform.revoke_device_authorization(uuid,text) to authenticated;

alter table platform.profiles enable row level security; alter table platform.permissions enable row level security;
alter table platform.roles enable row level security; alter table platform.role_permissions enable row level security;
alter table platform.user_roles enable row level security; alter table platform.devices enable row level security;
alter table platform.user_device_authorizations enable row level security; alter table platform.audit_events enable row level security;
revoke all on all tables in schema platform from public,anon,authenticated;
grant select on platform.profiles,platform.permissions,platform.roles,platform.role_permissions,platform.user_roles,
  platform.devices,platform.user_device_authorizations,platform.audit_events to authenticated;
grant update(display_name,phone,avatar_url,locale,timezone) on platform.profiles to authenticated;

create policy profiles_select_self_or_platform_viewer on platform.profiles for select to authenticated using
  (user_id=auth.uid() or platform.has_permission('platform.users.view','platform',null));
create policy profiles_update_self on platform.profiles for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy permissions_select_authorized on platform.permissions for select to authenticated using
  (platform.has_permission('platform.roles.view','platform',null));
create policy roles_select_authorized on platform.roles for select to authenticated using
  (platform.has_permission('platform.roles.view','platform',null));
create policy role_permissions_select_authorized on platform.role_permissions for select to authenticated using
  (platform.has_permission('platform.roles.view','platform',null));
create policy user_roles_select_self_or_platform_viewer on platform.user_roles for select to authenticated using
  (user_id=auth.uid() or platform.has_permission('platform.roles.view','platform',null));
create policy devices_select_self_or_platform_viewer on platform.devices for select to authenticated using
  (exists(select 1 from platform.user_device_authorizations device_authorization where device_authorization.device_id=id and device_authorization.user_id=auth.uid())
    or platform.has_permission('platform.devices.view','platform',null));
create policy device_authorizations_select_self_or_platform_viewer on platform.user_device_authorizations for select to authenticated using
  (user_id=auth.uid() or platform.has_permission('platform.devices.view','platform',null));
create policy audit_events_select_platform_auditor on platform.audit_events for select to authenticated using
  (platform.has_permission('platform.audit.view','platform',null));

comment on schema platform is 'Shared identity, access, device authorization, and audit foundation.';
comment on schema platform_private is 'Internal helpers; never expose through PostgREST.';
comment on function platform.has_permission(text,text,uuid) is 'Authoritative account + device + scoped permission decision.';
