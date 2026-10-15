begin;

-- Extend the existing canonical role tables. No parallel role or permission
-- store is introduced: role permissions continue to reference
-- platform.permissions and assignments continue to live in platform.user_roles.
alter table platform.roles
  drop constraint roles_domain_check,
  drop constraint roles_scope_type_check,
  drop constraint roles_check,
  add constraint roles_domain_check check (domain in ('platform','conference')),
  add constraint roles_scope_type_check check (scope_type in ('platform','conference')),
  add constraint roles_check check (domain=scope_type);

alter table platform.user_roles
  drop constraint user_roles_scope_type_check,
  drop constraint user_roles_scope_id_check,
  add constraint user_roles_scope_type_check check (scope_type in ('platform','conference')),
  add constraint user_roles_scope_contract_check check (
    (scope_type='platform' and scope_id is null)
    or (scope_type='conference' and scope_id is not null)
  );

drop index platform.user_roles_active_assignment_idx;
create unique index user_roles_active_assignment_idx
on platform.user_roles(user_id,role_id,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
where revoked_at is null;
drop index platform.user_roles_effective_access_idx;
create index user_roles_effective_access_idx
on platform.user_roles(user_id,scope_type,scope_id,revoked_at,expires_at);

alter table platform.audit_events
  drop constraint platform_audit_events_scope_invariant_check,
  add constraint platform_audit_events_scope_invariant_check check (
    (scope_type is null and scope_id is null)
    or (scope_type in('platform','inventory') and scope_id is null)
    or (scope_type in('reservations','conference') and scope_id is not null)
  );

insert into platform.roles(code,domain,name,description,scope_type,is_system,is_assignable)
values
 ('conference_manager','conference','Conference Manager','Manages authorized operational areas and delegates responsibilities inside one Conference.','conference',true,true),
 ('people_manager','conference','People Manager','Manages canonical Conference participation and reads the required directory data.','conference',true,true),
 ('accommodation_manager','conference','Accommodation Manager','Manages accommodation and reads the people required for room assignment.','conference',true,true),
 ('restaurant_manager','conference','Restaurant Manager','Manages restaurant operations and reads the people required for service.','conference',true,true),
 ('transport_manager','conference','Transport Manager','Manages transport operations and reads the people required for assignment.','conference',true,true),
 ('conference_viewer','conference','Conference Viewer','Reads non-financial Conference operational sections without mutation authority.','conference',true,true)
on conflict(domain,code) do update set
 name=excluded.name,description=excluded.description,scope_type=excluded.scope_type,
 is_system=excluded.is_system,is_assignable=excluded.is_assignable,updated_at=statement_timestamp();

-- Role changes are explicit and repeatable. Removing obsolete mappings first
-- prevents an older deployment from silently retaining broader authority.
delete from platform.role_permissions rp
using platform.roles r
where r.id=rp.role_id and r.domain='conference';

insert into platform.role_permissions(role_id,permission_id)
select r.id,p.id from platform.roles r join platform.permissions p on p.code=any(case r.code
 when 'conference_manager' then array[
  'conference.access.view','conference.settings.view','conference.people.view','conference.people.manage',
  'conference.accommodation.view','conference.accommodation.manage','conference.restaurant.view','conference.restaurant.manage',
  'conference.transport.view','conference.transport.manage','conference.air_conditioning.view','conference.air_conditioning.manage',
  'conference.cards.view','conference.cards.export','conference.reports.view','conference.reports.export',
  'conference.search.view','conference.sync.write','conference.members.view','conference.members.manage',
  'conference.lifecycle.manage','conference.accounts.view','conference.accounts.manage'
 ]::text[]
 when 'people_manager' then array[
  'conference.access.view','conference.settings.view','conference.people.view','conference.people.manage',
  'conference.search.view','conference.sync.write'
 ]::text[]
 when 'accommodation_manager' then array[
  'conference.access.view','conference.settings.view','conference.people.view',
  'conference.accommodation.view','conference.accommodation.manage',
  'conference.air_conditioning.view','conference.air_conditioning.manage','conference.sync.write'
 ]::text[]
 when 'restaurant_manager' then array[
  'conference.access.view','conference.settings.view','conference.people.view',
  'conference.restaurant.view','conference.restaurant.manage','conference.sync.write'
 ]::text[]
 when 'transport_manager' then array[
  'conference.access.view','conference.settings.view','conference.people.view',
  'conference.transport.view','conference.transport.manage','conference.sync.write'
 ]::text[]
 when 'conference_viewer' then array[
  'conference.access.view','conference.settings.view','conference.people.view',
  'conference.accommodation.view','conference.restaurant.view','conference.transport.view',
  'conference.air_conditioning.view','conference.cards.view','conference.reports.view','conference.search.view'
 ]::text[]
 else array[]::text[] end)
where r.domain='conference' and p.domain='conference' and p.status='active'
on conflict do nothing;

create or replace function platform_private.user_has_module_permission_for(
 p_user_id uuid,p_permission_key text,p_resource_type text default null,p_resource_id text default null
) returns boolean language sql stable security definer set search_path='' as $$
 select platform_private.is_account_approved(p_user_id) and (
  platform_private.is_canonical_platform_owner(p_user_id)
  or exists(
   select 1 from platform.permission_grants g join platform.permissions p on p.id=g.permission_id
   where g.user_id=p_user_id and g.revoked_at is null and p.status='active'
    and p.code in(p_permission_key,case when p_permission_key=split_part(p_permission_key,'.',1)||'.module.access' then split_part(p_permission_key,'.',1)||'.module.manage' else p_permission_key end)
    and ((p_resource_type is null and g.scope_type='module')
      or (g.scope_type='module' and p.allowed_scope_mode in('module','both'))
      or (g.scope_type='resource' and g.resource_type=p_resource_type and g.resource_id=p_resource_id))
  )
  or exists(
   select 1 from platform.user_roles a
   join platform.roles r on r.id=a.role_id
   join platform.role_permissions rp on rp.role_id=r.id
   join platform.permissions p on p.id=rp.permission_id
   where a.user_id=p_user_id and a.revoked_at is null
    and (a.expires_at is null or a.expires_at>statement_timestamp())
    and p.status='active'
    and p.code in(p_permission_key,case when p_permission_key=split_part(p_permission_key,'.',1)||'.module.access' then split_part(p_permission_key,'.',1)||'.module.manage' else p_permission_key end)
    and ((a.scope_type='platform' and a.scope_id is null and p_resource_type is null)
      or (a.scope_type='conference' and p_resource_type='conference' and a.scope_id::text=p_resource_id))
  )
 );
$$;
revoke all on function platform_private.user_has_module_permission_for(uuid,text,text,text) from public,anon,authenticated,service_role;

create or replace function public.require_effective_module_permission(
 p_actor_device_id uuid,p_module_key text,p_permission_key text,
 p_resource_type text default null,p_resource_id text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid;v_permission platform.permissions%rowtype;v_grant platform.permission_grants%rowtype;v_assignment platform.user_roles%rowtype;v_role_code text;v_requested_scope text;
begin
 v_actor:=public.require_current_approved_device(p_actor_device_id);
 if p_module_key not in('conference','warehouse','reservations') or p_permission_key is null
  or split_part(p_permission_key,'.',1)<>p_module_key or ((p_resource_type is null)<>(p_resource_id is null))
 then raise exception 'INVALID_MODULE_PERMISSION_REQUEST' using errcode='22023'; end if;
 select * into v_permission from platform.permissions where code=p_permission_key and domain=p_module_key and status='active';
 if not found then raise exception 'ACTIVE_MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if;
 v_requested_scope:=case when p_resource_type is null then 'module' else 'resource' end;
 if v_requested_scope='module' and v_permission.allowed_scope_mode not in('module','both') then raise exception 'MODULE_PERMISSION_SCOPE_NOT_ALLOWED' using errcode='42501'; end if;
 if v_requested_scope='resource' and (v_permission.allowed_scope_mode not in('resource','both') or v_permission.allowed_resource_type<>p_resource_type or p_resource_id is null or length(p_resource_id) not between 1 and 255 or p_resource_id<>btrim(p_resource_id)) then raise exception 'MODULE_PERMISSION_RESOURCE_TYPE_INVALID' using errcode='42501'; end if;
 if platform_private.is_canonical_platform_owner(v_actor) then return jsonb_build_object('actorUserId',v_actor,'actorDeviceId',p_actor_device_id,'moduleKey',p_module_key,'permissionKey',p_permission_key,'resourceType',p_resource_type,'resourceId',p_resource_id,'authoritySource','platform_owner','grantId',null,'roleCode','platform_owner'); end if;
 if v_requested_scope='resource' then select g.* into v_grant from platform.permission_grants g where g.user_id=v_actor and g.permission_id=v_permission.id and g.scope_type='resource' and g.resource_type=p_resource_type and g.resource_id=p_resource_id and g.revoked_at is null limit 1; end if;
 if v_grant.id is null and v_permission.allowed_scope_mode in('module','both') then select g.* into v_grant from platform.permission_grants g where g.user_id=v_actor and g.permission_id in(v_permission.id,case when p_permission_key=p_module_key||'.module.access' then (select id from platform.permissions where code=p_module_key||'.module.manage' and status='active') else v_permission.id end) and g.scope_type='module' and g.resource_type is null and g.resource_id is null and g.revoked_at is null limit 1; end if;
 if v_grant.id is not null then return jsonb_build_object('actorUserId',v_actor,'actorDeviceId',p_actor_device_id,'moduleKey',p_module_key,'permissionKey',p_permission_key,'resourceType',p_resource_type,'resourceId',p_resource_id,'authoritySource',case when v_grant.scope_type='module' then 'module_grant' else 'resource_grant' end,'grantId',v_grant.id,'roleCode',null); end if;
 select a.* into v_assignment from platform.user_roles a join platform.roles r on r.id=a.role_id join platform.role_permissions rp on rp.role_id=r.id join platform.permissions p on p.id=rp.permission_id where a.user_id=v_actor and a.revoked_at is null and (a.expires_at is null or a.expires_at>statement_timestamp()) and p.status='active' and p.code in(p_permission_key,case when p_permission_key=p_module_key||'.module.access' then p_module_key||'.module.manage' else p_permission_key end) and ((v_requested_scope='resource' and a.scope_type=p_resource_type and a.scope_id::text=p_resource_id) or (v_requested_scope='module' and a.scope_type='platform' and a.scope_id is null)) order by a.granted_at limit 1;
 if v_assignment.id is null then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if;
 select code into v_role_code from platform.roles where id=v_assignment.role_id;
 return jsonb_build_object('actorUserId',v_actor,'actorDeviceId',p_actor_device_id,'moduleKey',p_module_key,'permissionKey',p_permission_key,'resourceType',p_resource_type,'resourceId',p_resource_id,'authoritySource','role','grantId',v_assignment.id,'roleCode',v_role_code);
end $$;

create or replace function public.search_module_permission_candidates(p_actor_device_id uuid,p_module_key text,p_query text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid;q text:=lower(btrim(coalesce(p_query,'')));lim integer:=least(greatest(coalesce(p_limit,50),1),100);owner_or_manager boolean;
begin
 a:=public.require_current_approved_device(p_actor_device_id);
 if p_module_key not in('conference','warehouse','reservations') then raise exception 'ACTIVE_MODULE_REQUIRED' using errcode='42501'; end if;
 owner_or_manager:=platform_private.is_canonical_platform_owner(a) or platform_private.user_has_module_permission_for(a,p_module_key||'.module.manage',null,null);
 if not owner_or_manager and not(p_module_key='conference' and exists(select 1 from public.conferences c where c.deleted_at is null and platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',c.id::text))) then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('userId',x.user_id,'displayName',x.display_name,'email',x.email,'accountStatus',x.account_status) order by coalesce(x.display_name,x.email),x.user_id) from (select p.user_id,p.display_name,u.email,p.account_status from platform.profiles p join auth.users u on u.id=p.user_id where p.account_status='approved' and (q='' or position(q in lower(coalesce(p.display_name,'')||' '||coalesce(u.email,'')))>0) and (owner_or_manager or exists(select 1 from public.conferences c where c.deleted_at is null and platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',c.id::text) and platform_private.user_has_module_permission_for(p.user_id,'conference.access.view','conference',c.id::text))) order by coalesce(p.display_name,u.email),p.user_id limit lim) x),'[]'::jsonb);
end $$;

create or replace function public.search_user_management_users(p_actor_device_id uuid,p_query text default null,p_account_status text default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;normalized_query text:=lower(btrim(coalesce(p_query,'')));effective_limit integer:=least(greatest(coalesce(p_limit,100),1),500);
begin
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null)
  and not platform_private.user_has_module_permission_for(actor_id,'platform.audit.view',null,null)
  and not platform_private.user_has_module_permission_for(actor_id,'platform.access.manage',null,null)
 then raise exception 'USER_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 if p_account_status is not null and p_account_status not in('pending','approved','blocked') then raise exception 'INVALID_ACCOUNT_STATUS' using errcode='22023'; end if;
 return jsonb_build_object('status','success','capabilities',public.get_user_management_actor_capabilities(p_actor_device_id)-'status',
  'users',case when platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null) then coalesce((select jsonb_agg(jsonb_build_object('userId',ordered.id,'displayName',ordered.display_name,'email',ordered.email,'accountStatus',ordered.account_status,'deviceCount',platform_private.canonical_device_count(ordered.id)) order by ordered.sort_name,ordered.id) from (select u.id,p.display_name,u.email,p.account_status,coalesce(p.display_name,u.email) sort_name from auth.users u join platform.profiles p on p.user_id=u.id where (p_account_status is null or p.account_status=p_account_status) and (normalized_query='' or lower(coalesce(p.display_name,'')) like '%'||normalized_query||'%' or lower(coalesce(u.email,'')) like '%'||normalized_query||'%') order by coalesce(p.display_name,u.email),u.id limit effective_limit) ordered),'[]'::jsonb) else '[]'::jsonb end,
  'audit',case when platform_private.user_has_module_permission_for(actor_id,'platform.audit.view',null,null) then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'occurredAt',x.occurred_at,'module',x.module,'action',x.action,'subjectUserId',x.subject_user_id,'scopeType',x.scope_type,'scopeId',x.scope_id,'source',x.source) order by x.occurred_at desc,x.id desc) from (select e.* from platform.audit_events e order by e.occurred_at desc,e.id desc limit 100) x),'[]'::jsonb) else null end,
  'security',jsonb_build_object('approvedDeviceRequired',true,'deviceSessionRequired',true,'selfElevationAllowed',false,'legacyTenancyEnabled',false,'canManageSecurity',platform_private.user_has_module_permission_for(actor_id,'platform.access.manage',null,null)));
end $$;

create or replace function public.get_user_management_actor_capabilities(p_actor_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;
begin
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null)
  and not platform_private.user_has_module_permission_for(actor_id,'platform.roles.view',null,null)
  and not platform_private.user_has_module_permission_for(actor_id,'platform.devices.view',null,null)
 then raise exception 'USER_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('status','success',
  'canOpenUserManagement',platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null),
  'canViewAccount',platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null),
  'canManageAccount',platform_private.user_has_module_permission_for(actor_id,'platform.users.manage',null,null),
  'canViewDevices',platform_private.user_has_module_permission_for(actor_id,'platform.devices.view',null,null),
  'canManageDevices',platform_private.user_has_module_permission_for(actor_id,'platform.devices.approve',null,null)
    or platform_private.user_has_module_permission_for(actor_id,'platform.devices.block',null,null)
    or platform_private.user_has_module_permission_for(actor_id,'platform.devices.revoke',null,null),
  'canViewRoles',platform_private.user_has_module_permission_for(actor_id,'platform.roles.view',null,null),
  'canManageRoles',platform_private.user_has_module_permission_for(actor_id,'platform.roles.manage',null,null),
  'canViewAudit',platform_private.user_has_module_permission_for(actor_id,'platform.audit.view',null,null),
  'canManageSecurity',platform_private.user_has_module_permission_for(actor_id,'platform.access.manage',null,null));
end $$;

create or replace function public.list_module_permission_resources_for_administration(p_actor_device_id uuid,p_module_key text,p_resource_type text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid;owner_or_manager boolean;
begin
 a:=public.require_current_approved_device(p_actor_device_id);
 if not exists(select 1 from platform.permissions p where p.domain=p_module_key and p.status='active' and p.allowed_resource_type=p_resource_type) then raise exception 'MODULE_PERMISSION_RESOURCE_TYPE_NOT_ALLOWED' using errcode='42501'; end if;
 owner_or_manager:=platform_private.is_canonical_platform_owner(a) or platform_private.user_has_module_permission_for(a,p_module_key||'.module.manage',null,null);
 if p_module_key='conference' and p_resource_type='conference' then return coalesce((select jsonb_agg(jsonb_build_object('resourceId',c.id,'resourceType','conference','code',null,'name',c.name,'displayName',c.name,'status',c.status) order by c.name,c.id) from public.conferences c where c.deleted_at is null and (owner_or_manager or platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',c.id::text))),'[]'::jsonb); end if;
 if not owner_or_manager then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if p_module_key='warehouse' and p_resource_type='store' then return coalesce((select jsonb_agg(jsonb_build_object('resourceId',s.id,'resourceType','store','code',s.code,'name',s.name,'displayName',s.name,'status',s.status) order by s.code,s.id) from warehouse.stores s where s.status='active'),'[]'::jsonb); end if;
 if p_module_key='reservations' and p_resource_type='event' then return coalesce((select jsonb_agg(jsonb_build_object('resourceId',e.id,'resourceType','event','code',null,'name',e.name,'displayName',e.name,'status',e.status) order by e.start_date desc,e.name,e.id) from reservations.events e where reservations_private.has_event_permission(a,'reservations.event.manage',e.id)),'[]'::jsonb); end if;
 raise exception 'MODULE_PERMISSION_RESOURCE_DISCOVERY_UNSUPPORTED' using errcode='42501';
end $$;

create or replace function public.list_module_permission_catalog_for_administration(p_actor_device_id uuid,p_module_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid;allowed boolean;
begin
 a:=public.require_current_approved_device(p_actor_device_id);
 if p_module_key not in('conference','warehouse','reservations') then raise exception 'ACTIVE_MODULE_REQUIRED' using errcode='42501'; end if;
 allowed:=platform_private.is_canonical_platform_owner(a) or platform_private.user_has_module_permission_for(a,p_module_key||'.module.manage',null,null);
 if not allowed and p_module_key='conference' then allowed:=exists(select 1 from public.conferences c where c.deleted_at is null and platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',c.id::text)); end if;
 if not allowed then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('permissionKey',p.code,'displayName',p.code,'description',p.description,'allowedScopeMode',p.allowed_scope_mode,'allowedResourceType',p.allowed_resource_type,'sensitiveMutation',p.sensitive_mutation,'catalogVersion',1) order by p.code) from platform.permissions p where p.domain=p_module_key and p.status='active' and p.code not in(p_module_key||'.module.access',p_module_key||'.module.manage')),'[]'::jsonb);
end $$;

create or replace function public.list_module_permission_grants(p_actor_device_id uuid,p_module_key text,p_target_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid;t uuid;owner_or_manager boolean;
begin
 a:=public.require_current_approved_device(p_actor_device_id);t:=coalesce(p_target_user_id,a);
 if p_module_key not in('conference','warehouse','reservations') then raise exception 'ACTIVE_MODULE_REQUIRED' using errcode='42501'; end if;
 owner_or_manager:=platform_private.is_canonical_platform_owner(a) or platform_private.user_has_module_permission_for(a,p_module_key||'.module.manage',null,null);
 if t<>a and not owner_or_manager and not(p_module_key='conference' and exists(select 1 from public.conferences c where c.deleted_at is null and platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',c.id::text) and platform_private.user_has_module_permission_for(t,'conference.access.view','conference',c.id::text))) then raise exception 'MODULE_PERMISSION_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('status','success','targetUserId',t,'moduleKey',p_module_key,
  'grants',coalesce((select jsonb_agg(jsonb_build_object('grantId',g.id,'permissionKey',p.code,'resourceType',g.resource_type,'resourceId',g.resource_id,'grantedAt',g.granted_at,'revokedAt',g.revoked_at,'source','direct') order by g.granted_at,g.id) from platform.permission_grants g join platform.permissions p on p.id=g.permission_id where g.user_id=t and p.domain=p_module_key and (owner_or_manager or g.resource_type<>'conference' or exists(select 1 from public.conferences c where c.id::text=g.resource_id and platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',c.id::text)))),'[]'::jsonb),
  'roles',coalesce((select jsonb_agg(jsonb_build_object('roleCode',r.code,'displayName',r.name,'description',r.description,'permissions',(select coalesce(jsonb_agg(p.code order by p.code),'[]'::jsonb) from platform.role_permissions rp join platform.permissions p on p.id=rp.permission_id where rp.role_id=r.id)) order by r.code) from platform.roles r where r.domain=p_module_key and r.is_assignable),'[]'::jsonb),
  'roleAssignments',coalesce((select jsonb_agg(jsonb_build_object('assignmentId',ur.id,'roleCode',r.code,'scopeType',ur.scope_type,'scopeId',ur.scope_id,'grantedAt',ur.granted_at,'revokedAt',ur.revoked_at,'source','role') order by ur.granted_at,ur.id) from platform.user_roles ur join platform.roles r on r.id=ur.role_id where ur.user_id=t and r.domain=p_module_key and (owner_or_manager or ur.scope_type<>'conference' or platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',ur.scope_id::text))),'[]'::jsonb));
end $$;

create or replace function public.manage_catalog_module_grant(
 p_actor_device_id uuid,p_operation_id uuid,p_action text,p_target_user_id uuid,p_module_key text,p_permission_key text,
 p_resource_type text default null,p_resource_id text default null,p_grant_id uuid default null,p_revocation_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;g uuid;expected_code text;role_row platform.roles%rowtype;assignment platform.user_roles%rowtype;authz uuid;
begin
 if p_operation_id is null or p_target_user_id is null or p_module_key not in('conference','warehouse','reservations') or p_action not in('grant','revoke','create','role_grant','role_revoke') then raise exception 'INVALID_MODULE_GRANT_OPERATION' using errcode='22023'; end if;
 a:=public.require_current_approved_device(p_actor_device_id);authz:=platform_private.validated_phase1c_device_authorization(a,p_actor_device_id);
 if p_action in('role_grant','role_revoke') then
  if p_module_key<>'conference' or p_resource_type<>'conference' or p_resource_id is null or p_permission_key not like 'role:%' then raise exception 'INVALID_ROLE_ASSIGNMENT_OPERATION' using errcode='22023'; end if;
  select * into role_row from platform.roles where domain='conference' and code=substring(p_permission_key from 6) and is_assignable;
  if not found then raise exception 'ROLE_NOT_ASSIGNABLE' using errcode='42501'; end if;
  if not platform_private.is_canonical_platform_owner(a) then
   if not platform_private.user_has_module_permission_for(a,'conference.members.manage','conference',p_resource_id) then raise exception 'CONFERENCE_ROLE_DELEGATION_DENIED' using errcode='42501'; end if;
   if exists(select 1 from platform.role_permissions rp join platform.permissions p on p.id=rp.permission_id where rp.role_id=role_row.id and not platform_private.user_has_module_permission_for(a,p.code,'conference',p_resource_id)) then raise exception 'ROLE_EXCEEDS_ACTOR_AUTHORITY' using errcode='42501'; end if;
  end if;
  if not exists(select 1 from public.conferences where id::text=p_resource_id and deleted_at is null) or not exists(select 1 from platform.profiles where user_id=p_target_user_id and account_status='approved') then raise exception 'ROLE_SCOPE_OR_TARGET_INVALID' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conference-role:'||p_target_user_id::text||':'||role_row.id::text||':'||p_resource_id,0));
  if p_action='role_grant' then
   if p_grant_id is not null then raise exception 'INVALID_ROLE_ASSIGNMENT_OPERATION' using errcode='22023'; end if;
   select ur.* into assignment from platform.user_roles ur where ur.user_id=p_target_user_id and ur.role_id=role_row.id and ur.scope_type='conference' and ur.scope_id::text=p_resource_id and ur.revoked_at is null;
   if assignment.id is null then insert into platform.user_roles(user_id,role_id,scope_type,scope_id,granted_by,metadata) values(p_target_user_id,role_row.id,'conference',p_resource_id::uuid,a,jsonb_build_object('operationId',p_operation_id,'source','platform_administration')) returning * into assignment; insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,new_values,metadata,operation_id,source) values(a,authz,p_target_user_id,'platform','roles','role.granted','user_role',assignment.id,'conference',p_resource_id::uuid,jsonb_build_object('roleCode',role_row.code),jsonb_build_object('permissionKey','conference.members.manage'),p_operation_id,'rpc'); end if;
  else
   select ur.* into assignment from platform.user_roles ur where ur.id=p_grant_id and ur.user_id=p_target_user_id and ur.role_id=role_row.id and ur.scope_type='conference' and ur.scope_id::text=p_resource_id;
   if assignment.id is null then raise exception 'ROLE_ASSIGNMENT_NOT_FOUND' using errcode='P0002'; end if;
   if assignment.revoked_at is null then update platform.user_roles set revoked_at=statement_timestamp(),revoked_by=a,metadata=metadata||jsonb_build_object('revocationReason',nullif(btrim(p_revocation_reason),''),'revocationOperationId',p_operation_id) where id=assignment.id; insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,old_values,new_values,metadata,operation_id,source) values(a,authz,p_target_user_id,'platform','roles','role.revoked','user_role',assignment.id,'conference',p_resource_id::uuid,jsonb_build_object('roleCode',role_row.code),jsonb_build_object('revoked',true),jsonb_build_object('permissionKey','conference.members.manage','reason',p_revocation_reason),p_operation_id,'rpc'); end if;
  end if;
  return jsonb_build_object('status',case when p_action='role_revoke' then 'revoked' else 'applied' end,'grantId',assignment.id,'targetUserId',p_target_user_id,'moduleKey',p_module_key,'permissionKey',p_permission_key,'resourceType',p_resource_type,'resourceId',p_resource_id);
 end if;
 expected_code:=p_module_key||'.module.manage';
 if p_permission_key=expected_code then if not platform_private.is_canonical_platform_owner(a) then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501'; end if; elsif not platform_private.is_canonical_platform_owner(a) then perform public.require_effective_module_permission(p_actor_device_id,p_module_key,expected_code,null,null); end if;
 if p_action in('grant','create') then if p_grant_id is not null then raise exception 'INVALID_MODULE_GRANT_OPERATION' using errcode='22023'; end if;g:=platform_private.create_permission_grant(a,p_actor_device_id,p_target_user_id,p_module_key,p_permission_key,p_resource_type,p_resource_id,p_operation_id); else select x.id into g from platform.permission_grants x join platform.permissions p on p.id=x.permission_id where x.id=p_grant_id and x.user_id=p_target_user_id and p.domain=p_module_key and p.code=p_permission_key and x.resource_type is not distinct from p_resource_type and x.resource_id is not distinct from p_resource_id;if g is null then raise exception 'PERMISSION_GRANT_NOT_FOUND_OR_STALE' using errcode='P0002'; end if;perform platform_private.revoke_permission_grant(a,p_actor_device_id,g,p_revocation_reason); end if;
 return jsonb_build_object('status',case when p_action='revoke' then 'revoked' else 'applied' end,'grantId',g,'targetUserId',p_target_user_id,'moduleKey',p_module_key,'permissionKey',p_permission_key,'resourceType',p_resource_type,'resourceId',p_resource_id);
end $$;

revoke all on function public.search_module_permission_candidates(uuid,text,text,integer),public.list_module_permission_resources_for_administration(uuid,text,text),public.list_module_permission_grants(uuid,text,uuid),public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.search_module_permission_candidates(uuid,text,text,integer),public.list_module_permission_resources_for_administration(uuid,text,text),public.list_module_permission_grants(uuid,text,uuid),public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text) to service_role;

commit;
