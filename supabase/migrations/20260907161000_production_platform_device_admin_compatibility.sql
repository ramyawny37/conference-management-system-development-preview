-- Production compatibility bridge for the cryptographic device-session dispatcher.
-- No function in this package is directly executable by an API role.
begin;

do $$
begin
  if to_regclass('platform.profiles') is null
     or to_regclass('platform.permissions') is null
     or to_regclass('platform.roles') is null
     or to_regclass('platform.role_permissions') is null
     or to_regclass('platform.user_roles') is null
     or to_regclass('platform.devices') is null
     or to_regclass('platform.user_device_authorizations') is null
     or to_regclass('platform.audit_events') is null then
    raise exception 'PRODUCTION_PLATFORM_FOUNDATION_REQUIRED' using errcode='55000';
  end if;
end;
$$;

-- This checks actor identity, approved account state, and Platform authority only.
-- Device possession is deliberately not reimplemented here: the only caller is the
-- service-role-only dispatcher, which validates the cryptographic session first.
create or replace function platform_private.has_session_actor_permission(
  p_permission_code text
) returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and platform_private.is_account_approved(auth.uid())
    and exists(
      select 1
      from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=auth.uid()
        and assignment.scope_type='platform' and assignment.scope_id is null
        and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and role.domain='platform'
        and permission.domain='platform' and permission.code=p_permission_code
    );
$$;

create or replace function platform_private.change_session_device_authorization(
  p_authorization_id uuid,p_device_id uuid,p_status text,p_permission text,p_reason text
) returns void
language plpgsql security definer set search_path=''
as $$
declare target platform.user_device_authorizations%rowtype;
begin
  if auth.uid() is null then raise exception 'ACTOR_REQUIRED' using errcode='42501'; end if;
  if not platform_private.is_account_approved(auth.uid()) then
    raise exception 'APPROVED_PROFILE_REQUIRED' using errcode='42501';
  end if;
  if not platform_private.has_session_actor_permission(p_permission) then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_authorization_id is null or p_device_id is null then
    raise exception 'PLATFORM_DEVICE_TARGET_REQUIRED' using errcode='22023';
  end if;
  if p_status not in ('approved','blocked','revoked') then
    raise exception 'DEVICE_AUTHORIZATION_STATUS_INVALID' using errcode='22023';
  end if;

  select * into target
  from platform.user_device_authorizations device_authorization
  where device_authorization.id=p_authorization_id
    and device_authorization.device_id=p_device_id
  for update;
  if not found then raise exception 'DEVICE_AUTHORIZATION_NOT_FOUND' using errcode='P0002'; end if;
  if target.status='revoked' then
    raise exception 'DEVICE_AUTHORIZATION_REVOKED_TERMINAL' using errcode='55000';
  end if;
  if p_status='approved' and target.status<>'pending' then
    raise exception 'DEVICE_AUTHORIZATION_NOT_PENDING' using errcode='55000';
  end if;
  if p_status in ('blocked','revoked') and exists(
      select 1 from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      where assignment.user_id=target.user_id and assignment.revoked_at is null
        and role.domain='platform' and role.code='platform_owner'
    ) and not exists(
      select 1 from platform.user_device_authorizations other
      join platform.devices device on device.id=other.device_id
      where other.user_id=target.user_id and other.id<>target.id
        and other.status='approved' and device.lifecycle_status='active'
    ) then
    raise exception 'LAST_PLATFORM_OWNER_DEVICE_RESTRICTION_FORBIDDEN' using errcode='42501';
  end if;

  update platform.user_device_authorizations set
    status=p_status,status_reason=nullif(pg_catalog.btrim(p_reason),''),
    approved_by=case when p_status='approved' then auth.uid() else approved_by end,
    approved_at=case when p_status='approved' then pg_catalog.now() else approved_at end,
    blocked_by=case when p_status='blocked' then auth.uid() else null end,
    blocked_at=case when p_status='blocked' then pg_catalog.now() else null end,
    revoked_by=case when p_status='revoked' then auth.uid() else null end,
    revoked_at=case when p_status='revoked' then pg_catalog.now() else null end
  where id=target.id and device_id=target.device_id;

  perform platform_private.write_audit_event(
    auth.uid(),target.user_id,'platform','devices','device_authorization.'||p_status,
    'user_device_authorization',target.id,'platform',
    pg_catalog.jsonb_build_object('status',target.status),
    pg_catalog.jsonb_build_object('status',p_status),
    pg_catalog.jsonb_build_object('reason',p_reason,'deviceId',target.device_id),
    null,null,'device_session_dispatcher'
  );
end;
$$;

create or replace function platform.list_pending_device_authorizations() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
  if not platform_private.has_session_actor_permission('platform.devices.view') then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('status','success','devices',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'authorizationId',device_authorization.id,'deviceId',device_authorization.device_id,
      'deviceName',device.display_name,'platform',device.platform,'browser',device.browser,
      'authorizationStatus',device_authorization.status,'requestedAt',device_authorization.requested_at
    ) order by device_authorization.requested_at,device_authorization.id)
    from platform.user_device_authorizations device_authorization
    join platform.devices device on device.id=device_authorization.device_id
    join platform.profiles profile on profile.user_id=device_authorization.user_id
    where device_authorization.status='pending' and device.lifecycle_status='active'
      and profile.account_status='approved'
  ),'[]'::jsonb));
end;
$$;

create or replace function platform.approve_pending_device_authorization(
  p_authorization_id uuid,p_device_id uuid,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  perform platform_private.change_session_device_authorization(
    p_authorization_id,p_device_id,'approved','platform.devices.approve',p_reason
  );
  return pg_catalog.jsonb_build_object('status','applied','authorizationId',p_authorization_id,
    'deviceId',p_device_id,'authorizationStatus','approved');
end;
$$;

-- 03090000 revokes these superseded signatures by exact regprocedure. They are
-- fail-closed placeholders only and cannot restore the old header-based API.
create or replace function platform_private.superseded_device_admin_entrypoint()
returns void language plpgsql security definer set search_path=''
as $$ begin raise exception 'DEVICE_SESSION_DISPATCH_REQUIRED' using errcode='42501'; end; $$;
create or replace function platform.approve_device_authorization(uuid,text default null) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;
create or replace function platform.block_device_authorization(uuid,text default null) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;
create or replace function platform.revoke_device_authorization(uuid,text default null) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;
create or replace function platform.set_account_status(uuid,text,text default null) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;
create or replace function platform.grant_user_role(uuid,text,text,text,uuid default null) returns uuid language plpgsql security definer set search_path='' as $$ begin perform platform_private.superseded_device_admin_entrypoint(); return null; end; $$;
create or replace function platform.revoke_user_role(uuid) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;
create or replace function platform.grant_role_permission(text,text,text) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;
create or replace function platform.revoke_role_permission(text,text,text) returns void language sql security definer set search_path='' as $$ select platform_private.superseded_device_admin_entrypoint(); $$;

revoke all on function platform_private.has_session_actor_permission(text),platform_private.change_session_device_authorization(uuid,uuid,text,text,text),platform_private.superseded_device_admin_entrypoint() from public,anon,authenticated,service_role;
revoke all on function platform.list_pending_device_authorizations(),platform.approve_pending_device_authorization(uuid,uuid,text),platform.approve_device_authorization(uuid,text),platform.block_device_authorization(uuid,text),platform.revoke_device_authorization(uuid,text),platform.set_account_status(uuid,text,text),platform.grant_user_role(uuid,text,text,text,uuid),platform.revoke_user_role(uuid),platform.grant_role_permission(text,text,text),platform.revoke_role_permission(text,text,text) from public,anon,authenticated,service_role;

commit;
