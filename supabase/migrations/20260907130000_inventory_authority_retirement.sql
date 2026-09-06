-- Retire the dormant Inventory authority path without changing Warehouse authority.

update platform.roles
set is_assignable = false
where domain = 'inventory'
  and code in ('inventory_manager', 'inventory_operator', 'viewer')
  and is_assignable is distinct from false;

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
    ('inventory_manager','inventory','Inventory Manager','Manages inventory operations and reporting','inventory',true,false),
    ('inventory_operator','inventory','Inventory Operator','Runs approved daily inventory operations','inventory',true,false),
    ('viewer','inventory','Inventory Viewer','Read-only inventory access','inventory',true,false)
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

revoke all on function platform_private.seed_access_reference_data()
  from public,anon,authenticated,service_role;

create or replace function platform_private.has_permission_for(
  p_user_id uuid,p_permission_code text,p_scope_type text,p_scope_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select platform_private.is_account_approved(p_user_id)
    and coalesce(
      platform_private.validated_phase1c_device_authorization(
        p_user_id,platform_private.phase1c_context_device_id()
      ),
      platform_private.current_device_authorization_id(p_user_id)
    ) is not null
    and p_scope_type = 'platform' and p_scope_id is null
    and exists(select 1 from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=p_user_id and assignment.scope_type='platform' and assignment.scope_id is null
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and role.scope_type='platform' and role.domain='platform' and permission.domain='platform'
        and permission.code=p_permission_code);
$$;

revoke all on function platform_private.has_permission_for(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function platform.has_permission(
  p_permission_code text,p_scope_type text default 'platform',p_scope_id uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and p_scope_type = 'platform'
    and platform_private.has_permission_for(auth.uid(),p_permission_code,p_scope_type,p_scope_id);
$$;

create or replace function platform.get_my_access_context(
  p_domain text default 'platform',p_scope_type text default 'platform',p_scope_id uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
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
      and p_domain='platform' and p_scope_type='platform' and p_scope_id is null
      and role.domain='platform' and role.scope_type='platform'
      and assignment.scope_type='platform' and assignment.scope_id is null
      and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())),'[]'::jsonb),
    'permissions',coalesce((select pg_catalog.jsonb_agg(distinct permission.code order by permission.code)
      from platform.user_roles assignment join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=auth.uid() and p_domain='platform' and p_scope_type='platform' and p_scope_id is null
        and assignment.scope_type='platform' and assignment.scope_id is null
        and role.domain='platform' and role.scope_type='platform' and permission.domain='platform'
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and coalesce(platform_private.validated_phase1c_device_authorization(
          auth.uid(),platform_private.phase1c_context_device_id()
        ),platform_private.current_device_authorization_id(auth.uid())) is not null),'[]'::jsonb)
  ) end from (select 1) singleton left join platform.profiles profile on profile.user_id=auth.uid();
$$;

create or replace function platform.grant_user_role(
  p_user_id uuid,p_role_domain text,p_role_code text,p_scope_type text,p_scope_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_role platform.roles%rowtype;v_id uuid;
begin
  if not platform_private.has_permission_for(auth.uid(),'platform.roles.manage','platform',null) then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_role_domain = 'inventory' or p_scope_type = 'inventory' then
    raise exception 'INVENTORY_AUTHORITY_RETIRED' using errcode='42501';
  end if;
  if p_scope_type <> 'platform' or p_scope_id is not null then
    raise exception 'UNSUPPORTED_ROLE_SCOPE' using errcode='22023';
  end if;
  select * into v_role from platform.roles where domain=p_role_domain and code=p_role_code;
  if not found or v_role.scope_type<>p_scope_type then raise exception 'ROLE_NOT_FOUND_OR_SCOPE_INVALID' using errcode='P0002'; end if;
  if not v_role.is_assignable then raise exception 'ROLE_NOT_ASSIGNABLE' using errcode='42501'; end if;
  if not exists(select 1 from platform.profiles where user_id=p_user_id) then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
  select id into v_id from platform.user_roles where user_id=p_user_id and role_id=v_role.id and scope_type=p_scope_type and revoked_at is null;
  if v_id is null then
    insert into platform.user_roles(user_id,role_id,scope_type,scope_id,granted_by)
    values(p_user_id,v_role.id,p_scope_type,null,auth.uid()) returning id into v_id;
    perform platform_private.write_audit_event(auth.uid(),p_user_id,'platform','roles','role.granted','user_role',v_id,p_scope_type,null,
      pg_catalog.jsonb_build_object('domain',p_role_domain,'role',p_role_code),pg_catalog.jsonb_build_object());
  end if;
  return v_id;
end; $$;

revoke all on function platform.get_my_access_context(text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function platform.has_permission(text,text,uuid),
  platform.grant_user_role(uuid,text,text,text,uuid) to authenticated;
