-- Forward-only reconciliation of the reviewed guarded first Platform owner bootstrap contract.
-- This migration installs the one-time function only; it does not execute bootstrap.

create or replace function platform.bootstrap_first_platform_owner(
  p_user_id uuid,p_device_id uuid,p_device_secret text,p_device_name text default 'First platform owner device')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role_id uuid;v_authorization_id uuid;v_hash text:=platform_private.hash_device_secret(p_device_secret);v_metadata jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('platform:first-owner-bootstrap'));
  if exists(select 1 from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
    where role.domain='platform' and role.code='platform_owner' and assignment.revoked_at is null) then
    raise exception 'BOOTSTRAP_ALREADY_COMPLETED' using errcode='55000';
  end if;
  if p_user_id is null or p_device_id is null or v_hash is null then raise exception 'INVALID_BOOTSTRAP_IDENTITY' using errcode='22023'; end if;
  select raw_user_meta_data into v_metadata from auth.users where id=p_user_id;
  if not found then raise exception 'AUTH_USER_NOT_FOUND' using errcode='P0002'; end if;
  select id into v_role_id from platform.roles where domain='platform' and code='platform_owner';
  if v_role_id is null then raise exception 'REFERENCE_DATA_NOT_SEEDED' using errcode='55000'; end if;
  insert into platform.profiles(user_id,display_name,account_status,status_changed_at,approved_at)
  values(p_user_id,nullif(pg_catalog.btrim(coalesce(v_metadata->>'display_name',v_metadata->>'name','')),''),'approved',pg_catalog.now(),pg_catalog.now())
  on conflict(user_id) do update set account_status='approved',status_reason='first platform owner bootstrap',
    status_changed_at=pg_catalog.now(),approved_at=pg_catalog.now(),blocked_at=null,blocked_by=null;
  update platform.profiles set status_changed_by=p_user_id,approved_by=p_user_id where user_id=p_user_id;
  insert into platform.devices(id,secret_hash,display_name) values(p_device_id,v_hash,nullif(pg_catalog.btrim(p_device_name),''))
  on conflict(id) do nothing;
  if not exists(select 1 from platform.devices where id=p_device_id and secret_hash=v_hash) then
    raise exception 'DEVICE_CREDENTIAL_MISMATCH' using errcode='42501';
  end if;
  insert into platform.user_device_authorizations(user_id,device_id,status,approved_by,approved_at)
  values(p_user_id,p_device_id,'approved',p_user_id,pg_catalog.now())
  on conflict(user_id,device_id) do update set status='approved',approved_by=p_user_id,approved_at=pg_catalog.now(),
    blocked_by=null,blocked_at=null,revoked_by=null,revoked_at=null,status_reason='first platform owner bootstrap'
  returning id into v_authorization_id;
  insert into platform.user_roles(user_id,role_id,scope_type,granted_by,metadata)
  values(p_user_id,v_role_id,'platform',p_user_id,pg_catalog.jsonb_build_object('bootstrap',true));
  perform platform_private.write_audit_event(p_user_id,p_user_id,'platform','bootstrap','platform.bootstrap_completed','profile',p_user_id,
    'platform',null,pg_catalog.jsonb_build_object('accountStatus','approved','deviceAuthorizationId',v_authorization_id,'role','platform_owner'),
    pg_catalog.jsonb_build_object('bootstrap',true),null,null,'bootstrap');
  return v_authorization_id;
end; $$;
revoke all on function platform.bootstrap_first_platform_owner(uuid,uuid,text,text) from public,anon,authenticated;
comment on function platform.bootstrap_first_platform_owner(uuid,uuid,text,text) is
  'One-time privileged SQL bootstrap. Grants platform_owner only; Inventory access is a separate audited grant.';

