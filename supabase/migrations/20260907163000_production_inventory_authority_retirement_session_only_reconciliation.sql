-- Production Inventory-authority retirement with Phase 1C-only possession proof.
begin;

do $$
begin
  if to_regclass('platform.permissions') is null or to_regclass('platform.roles') is null
     or to_regclass('platform.role_permissions') is null or to_regclass('platform.user_roles') is null
     or to_regclass('platform.profiles') is null or to_regclass('platform.audit_events') is null
     or to_regprocedure('platform_private.validated_phase1c_device_authorization(uuid,uuid)') is null
     or to_regprocedure('platform_private.phase1c_context_device_id()') is null then
    raise exception 'PRODUCTION_PHASE1C_AUTHORITY_FOUNDATION_REQUIRED' using errcode='55000';
  end if;
end;
$$;

insert into platform.permissions(code,domain,description) values
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
on conflict(code) do update set domain=excluded.domain,description=excluded.description,updated_at=pg_catalog.now();

insert into platform.roles(code,domain,name,description,scope_type,is_system,is_assignable) values
  ('platform_owner','platform','Platform Owner','Bootstrap owner with every platform permission','platform',true,false),
  ('platform_admin','platform','Platform Admin','Administers users, roles, devices, and audit','platform',true,true),
  ('inventory_manager','inventory','Inventory Manager','Retired Inventory reference role','inventory',true,false),
  ('inventory_operator','inventory','Inventory Operator','Retired Inventory reference role','inventory',true,false),
  ('viewer','inventory','Inventory Viewer','Retired Inventory reference role','inventory',true,false)
on conflict(domain,code) do update set name=excluded.name,description=excluded.description,
  scope_type=excluded.scope_type,is_system=excluded.is_system,is_assignable=excluded.is_assignable,updated_at=pg_catalog.now();

insert into platform.role_permissions(role_id,permission_id)
select role.id,permission.id from platform.roles role cross join platform.permissions permission
where role.domain='platform' and role.code in ('platform_owner','platform_admin') and permission.domain='platform'
on conflict do nothing;

create or replace function platform_private.has_permission_for(
  p_user_id uuid,p_permission_code text,p_scope_type text,p_scope_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select platform_private.is_account_approved(p_user_id)
    and platform_private.validated_phase1c_device_authorization(
      p_user_id,platform_private.phase1c_context_device_id()
    ) is not null
    and p_scope_type='platform' and p_scope_id is null
    and exists(select 1 from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=p_user_id and assignment.scope_type='platform' and assignment.scope_id is null
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and role.scope_type='platform' and role.domain='platform' and permission.domain='platform'
        and permission.code=p_permission_code);
$$;

create or replace function platform.has_permission(
  p_permission_code text,p_scope_type text default 'platform',p_scope_id uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and p_scope_type='platform'
    and platform_private.has_permission_for(auth.uid(),p_permission_code,p_scope_type,p_scope_id);
$$;

-- There is no runtime caller for this routine. It reports account/role metadata
-- only and explicitly makes no claim about device possession or permissions.
create or replace function platform.get_my_access_context(
  p_domain text default 'platform',p_scope_type text default 'platform',p_scope_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  select case when auth.uid() is null then null else pg_catalog.jsonb_build_object(
    'userId',auth.uid(),'displayName',profile.display_name,'avatarUrl',profile.avatar_url,
    'accountStatus',coalesce(profile.account_status,'pending'),'deviceStatus','not_asserted',
    'deviceLifecycle','not_asserted','possessionVerified',false,
    'roles',coalesce((select pg_catalog.jsonb_agg(role.code order by role.code)
      from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
      where assignment.user_id=auth.uid() and p_domain='platform' and p_scope_type='platform' and p_scope_id is null
        and role.domain='platform' and role.scope_type='platform' and assignment.scope_type='platform'
        and assignment.scope_id is null and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())),'[]'::jsonb),
    'permissions','[]'::jsonb
  ) end from (select 1) singleton left join platform.profiles profile on profile.user_id=auth.uid();
$$;

create or replace function platform.grant_user_role(
  p_user_id uuid,p_role_domain text,p_role_code text,p_scope_type text,p_scope_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare target_role platform.roles%rowtype; assignment_id uuid; actor_authorization_id uuid;
begin
  if not platform_private.has_permission_for(auth.uid(),'platform.roles.manage','platform',null) then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  actor_authorization_id:=platform_private.validated_phase1c_device_authorization(
    auth.uid(),platform_private.phase1c_context_device_id());
  if actor_authorization_id is null then raise exception 'DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
  if p_role_domain='inventory' or p_scope_type='inventory' then
    raise exception 'INVENTORY_AUTHORITY_RETIRED' using errcode='42501';
  end if;
  if p_scope_type<>'platform' or p_scope_id is not null then
    raise exception 'UNSUPPORTED_ROLE_SCOPE' using errcode='22023';
  end if;
  select * into target_role from platform.roles where domain=p_role_domain and code=p_role_code;
  if not found or target_role.scope_type<>p_scope_type then raise exception 'ROLE_NOT_FOUND_OR_SCOPE_INVALID' using errcode='P0002'; end if;
  if not target_role.is_assignable then raise exception 'ROLE_NOT_ASSIGNABLE' using errcode='42501'; end if;
  if not exists(select 1 from platform.profiles where user_id=p_user_id) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
  select id into assignment_id from platform.user_roles where user_id=p_user_id and role_id=target_role.id
    and scope_type=p_scope_type and scope_id is null and revoked_at is null;
  if assignment_id is null then
    insert into platform.user_roles(user_id,role_id,scope_type,scope_id,granted_by)
    values(p_user_id,target_role.id,p_scope_type,null,auth.uid()) returning id into assignment_id;
    insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
      entity_type,entity_id,scope_type,old_values,new_values,metadata,source)
    values(auth.uid(),actor_authorization_id,p_user_id,'platform','roles','role.granted','user_role',assignment_id,
      p_scope_type,null,pg_catalog.jsonb_build_object('domain',p_role_domain,'role',p_role_code),
      '{}'::jsonb,'device_session_dispatcher');
  end if;
  return assignment_id;
end;
$$;

revoke all on function platform_private.has_permission_for(uuid,text,text,uuid),platform.get_my_access_context(text,text,uuid),platform.grant_user_role(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function platform.has_permission(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function platform.has_permission(text,text,uuid) to authenticated;

do $$
begin
  if exists(select 1 from platform.roles where domain='inventory'
    and code in ('inventory_manager','inventory_operator','viewer') and is_assignable) then
    raise exception 'INVENTORY_AUTHORITY_RETIREMENT_INCOMPLETE' using errcode='55000';
  end if;
end;
$$;

commit;
