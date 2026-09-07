-- Forward-only Production foundation reconciliation package.
-- Provenance: legacy public authority projected into the reviewed Platform
-- foundation. This migration never bootstraps authority or device credentials.
begin;

do $$
begin
  if to_regclass('public.system_user_access') is null
     or to_regclass('public.system_user_roles') is null
     or to_regclass('public.devices') is null
     or to_regclass('public.user_device_authorizations') is null then
    raise exception 'PRODUCTION_LEGACY_AUTHORITY_PREREQUISITE_MISSING' using errcode='55000';
  end if;
  if to_regclass('platform.profiles') is null
     or to_regclass('platform.roles') is null
     or to_regclass('platform.user_roles') is null
     or to_regclass('platform.devices') is null
     or to_regclass('platform.user_device_authorizations') is null then
    raise exception 'CANONICAL_PLATFORM_FOUNDATION_PREREQUISITE_MISSING' using errcode='55000';
  end if;
end;
$$;

do $$
begin
  if exists(
    select 1 from public.system_user_access access
    left join auth.users users on users.id=access.user_id
    where users.id is null or access.account_status not in ('pending','approved','blocked')
  ) then
    raise exception 'PRODUCTION_ACCOUNT_SOURCE_INVALID' using errcode='22023';
  end if;
  if exists(
    select 1 from public.system_user_roles system_role
    left join auth.users users on users.id=system_role.user_id
    left join public.system_user_access access on access.user_id=system_role.user_id
    where system_role.role='system_owner'
      and (users.id is null or access.account_status is distinct from 'approved')
  ) then
    raise exception 'PRODUCTION_SYSTEM_OWNER_SOURCE_INVALID' using errcode='55000';
  end if;
  if exists(
    select 1 from public.system_user_access access
    join platform.profiles profile on profile.user_id=access.user_id
    where profile.account_status is distinct from access.account_status
  ) then
    raise exception 'PLATFORM_PROFILE_LEGACY_CONFLICT' using errcode='55000';
  end if;
end;
$$;

-- Establish identity-only rows only after the contradiction guard has
-- inspected the Platform profiles that pre-dated this reconciliation. The
-- default remains pending and this grants no authority. Actor identities are
-- therefore available before legacy approved_by/blocked_by foreign keys are
-- projected without being mistaken for pre-existing Platform state.
insert into platform.profiles(user_id,display_name)
select users.id,nullif(btrim(coalesce(users.raw_user_meta_data->>'display_name',users.raw_user_meta_data->>'name','')),'')
from auth.users users
order by users.id
on conflict(user_id) do nothing;

insert into platform.profiles(
  user_id,account_status,status_changed_at,status_changed_by,
  approved_at,approved_by,blocked_at,blocked_by
)
select access.user_id,access.account_status,
  coalesce(case access.account_status when 'approved' then access.approved_at when 'blocked' then access.blocked_at else access.updated_at end,access.updated_at,access.created_at,statement_timestamp()),
  case access.account_status when 'approved' then access.approved_by when 'blocked' then access.blocked_by else null end,
  case when access.account_status='approved' then coalesce(access.approved_at,access.updated_at,access.created_at) else access.approved_at end,
  access.approved_by,
  case when access.account_status='blocked' then coalesce(access.blocked_at,access.updated_at,access.created_at) else access.blocked_at end,
  access.blocked_by
from public.system_user_access access
order by access.user_id
on conflict(user_id) do update set
  account_status=excluded.account_status,status_changed_at=excluded.status_changed_at,
  status_changed_by=excluded.status_changed_by,approved_at=excluded.approved_at,
  approved_by=excluded.approved_by,blocked_at=excluded.blocked_at,
  blocked_by=excluded.blocked_by,updated_at=statement_timestamp();

do $$
declare owner_role_id uuid; owner_role_count integer;
begin
  select count(*) into owner_role_count
  from platform.roles role
  where role.domain='platform' and role.code='platform_owner'
    and role.scope_type='platform' and role.is_system=true and role.is_assignable=false;
  if owner_role_count<>1 then
    raise exception 'PLATFORM_OWNER_COMPATIBILITY_ROLE_INVALID' using errcode='55000';
  end if;
  select role.id into owner_role_id from platform.roles role
  where role.domain='platform' and role.code='platform_owner'
    and role.scope_type='platform' and role.is_system=true and role.is_assignable=false;
  if exists(
    select 1 from platform.user_roles assignment
    where assignment.role_id=owner_role_id and assignment.scope_type='platform'
      and assignment.scope_id is null and assignment.revoked_at is null
      and not exists(select 1 from public.system_user_roles legacy where legacy.user_id=assignment.user_id and legacy.role='system_owner')
  ) then
    raise exception 'INDEPENDENT_PLATFORM_OWNER_CONTRADICTION' using errcode='55000';
  end if;
  insert into platform.user_roles(user_id,role_id,scope_type,scope_id,granted_by,expires_at,metadata)
  select legacy.user_id,owner_role_id,'platform',null,null,null,
    jsonb_build_object('authoritySource','system_owner','compatibilityProjection',true,'productionFoundationReconciliation',true)
  from public.system_user_roles legacy
  where legacy.role='system_owner'
    and not exists(select 1 from platform.user_roles assignment where assignment.user_id=legacy.user_id and assignment.role_id=owner_role_id and assignment.scope_type='platform' and assignment.scope_id is null and assignment.revoked_at is null)
  order by legacy.user_id;
  update platform.user_roles assignment set expires_at=null
  where assignment.role_id=owner_role_id and assignment.scope_type='platform'
    and assignment.scope_id is null and assignment.revoked_at is null
    and assignment.expires_at is not null
    and exists(select 1 from public.system_user_roles legacy where legacy.user_id=assignment.user_id and legacy.role='system_owner');
end;
$$;

create table platform_private.legacy_device_reconciliation_boundaries(
  legacy_user_id uuid not null references auth.users(id) on delete restrict,
  legacy_device_id uuid not null references public.devices(id) on delete restrict,
  legacy_authorization_status text not null check(legacy_authorization_status in ('registered','pending','approved','revoked')),
  reconciliation_state text not null check(reconciliation_state in ('requires_cryptographic_handoff','pending_reenrollment','revoked')),
  usable_platform_credential boolean not null default false check(usable_platform_credential=false),
  recorded_at timestamptz not null default statement_timestamp(),
  primary key(legacy_user_id,legacy_device_id),unique(legacy_device_id),
  check((legacy_authorization_status='approved' and reconciliation_state='requires_cryptographic_handoff') or (legacy_authorization_status in ('registered','pending') and reconciliation_state='pending_reenrollment') or (legacy_authorization_status='revoked' and reconciliation_state='revoked'))
);
revoke all on platform_private.legacy_device_reconciliation_boundaries from public,anon,authenticated,service_role;

do $$
begin
  if exists(select 1 from public.user_device_authorizations legacy_authorization left join auth.users users on users.id=legacy_authorization.user_id left join public.devices device on device.id=legacy_authorization.device_id and device.user_id=legacy_authorization.user_id where users.id is null or device.id is null or legacy_authorization.authorization_status not in ('registered','pending','approved','revoked') or (legacy_authorization.authorization_status='approved' and (legacy_authorization.approved_at is null or legacy_authorization.revoked_at is not null)) or (legacy_authorization.authorization_status in ('registered','pending') and legacy_authorization.revoked_at is not null) or (legacy_authorization.authorization_status='revoked' and legacy_authorization.revoked_at is null)) then
    raise exception 'PRODUCTION_LEGACY_DEVICE_SOURCE_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from public.user_device_authorizations legacy_authorization join platform.devices device on device.id=legacy_authorization.device_id)
     or exists(select 1 from public.user_device_authorizations legacy join platform.user_device_authorizations platform_authorization on platform_authorization.user_id=legacy.user_id and platform_authorization.device_id=legacy.device_id) then
    raise exception 'LEGACY_PLATFORM_DEVICE_IDENTITY_CONFLICT' using errcode='55000';
  end if;
end;
$$;

insert into platform_private.legacy_device_reconciliation_boundaries(legacy_user_id,legacy_device_id,legacy_authorization_status,reconciliation_state,usable_platform_credential)
select legacy_authorization.user_id,legacy_authorization.device_id,legacy_authorization.authorization_status,
  case legacy_authorization.authorization_status when 'approved' then 'requires_cryptographic_handoff' when 'revoked' then 'revoked' else 'pending_reenrollment' end,false
from public.user_device_authorizations legacy_authorization
order by legacy_authorization.user_id,legacy_authorization.device_id
on conflict(legacy_user_id,legacy_device_id) do update set
  legacy_authorization_status=excluded.legacy_authorization_status,
  reconciliation_state=excluded.reconciliation_state,
  usable_platform_credential=false,recorded_at=statement_timestamp();

commit;
