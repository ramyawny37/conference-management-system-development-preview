begin;

-- The public legacy mutator remains a fail-closed compatibility stub, but it
-- is no longer reachable through the device-operation dispatcher.
do $$
declare
  definition text;
  legacy_branch text := $branch$    when 'manage_foundation_module_grant' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_action','p_target_user_id','p_module_key','p_permission_key','p_grant_id','p_revocation_reason']);
      return public.manage_foundation_module_grant(v_session.device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_action',(p_args->>'p_target_user_id')::uuid,p_args->>'p_module_key',p_args->>'p_permission_key',(p_args->>'p_grant_id')::uuid,p_args->>'p_revocation_reason');
$branch$;
begin
  select pg_get_functiondef('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure)
    into definition;
  if position(legacy_branch in definition)=0 then
    raise exception 'LEGACY_PERMISSION_DISPATCH_BRANCH_NOT_FOUND';
  end if;
  definition:=replace(definition,legacy_branch,'');
  if position('manage_foundation_module_grant' in definition)>0 then
    raise exception 'LEGACY_PERMISSION_DISPATCH_BRANCH_REMAINS';
  end if;
  if position('recover_revoke_final_module_manager' in definition)=0 then
    raise exception 'FINAL_MANAGER_RECOVERY_BRANCH_MISSING';
  end if;
  execute definition;
end $$;

create or replace function platform_private.create_permission_grant(
 p_actor uuid,p_actor_device_id uuid,p_target uuid,p_module text,p_permission text,
 p_resource_type text default null,p_resource_id text default null,p_operation_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_permission_id uuid;v_id uuid;v_device_authorization_id uuid;
begin
 if p_actor is null or p_actor_device_id is null or p_target is null or p_operation_id is null
 or p_module not in('conference','warehouse','reservations')
 or p_permission is null or ((p_resource_type is null)<>(p_resource_id is null)) then
  raise exception 'INVALID_PERMISSION_GRANT' using errcode='22023'; end if;
 v_device_authorization_id:=platform_private.validated_phase1c_device_authorization(p_actor,p_actor_device_id);
 if v_device_authorization_id is null then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from platform.profiles where user_id=p_target and account_status='approved') then
  raise exception 'TARGET_ACCOUNT_APPROVED_REQUIRED' using errcode='42501'; end if;
 select id into v_permission_id from platform.permissions
 where domain=p_module and code=p_permission and status='active'
 and ((p_resource_type is null and allowed_scope_mode in('module','both'))
   or (p_resource_type is not null and allowed_scope_mode in('resource','both') and allowed_resource_type=p_resource_type));
 if v_permission_id is null then raise exception 'ACTIVE_PERMISSION_SCOPE_REQUIRED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('permission-grant:'||p_target::text||':'||v_permission_id::text||':'||coalesce(p_resource_type,'')||':'||coalesce(p_resource_id,''),0));
 select id into v_id from platform.permission_grants
 where user_id=p_target and permission_id=v_permission_id and revoked_at is null
 and ((p_resource_type is null and scope_type='module')
  or (p_resource_type is not null and scope_type='resource' and resource_type=p_resource_type and resource_id=p_resource_id));
 if v_id is null then
  insert into platform.permission_grants(user_id,permission_id,scope_type,resource_type,resource_id,granted_by,metadata)
  values(p_target,v_permission_id,case when p_resource_type is null then 'module' else 'resource' end,
   p_resource_type,p_resource_id,p_actor,
   jsonb_build_object('actorDeviceId',p_actor_device_id,'operationId',p_operation_id))
  returning id into v_id;
  insert into platform.audit_events(
   actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
   entity_type,entity_id,scope_type,new_values,metadata,operation_id,source
  ) values(
   p_actor,v_device_authorization_id,p_target,'platform',p_module,'permission.granted',
   'permission_grant',v_id,'platform',
   jsonb_build_object('grantId',v_id,'targetUserId',p_target,'moduleKey',p_module,
    'permissionKey',p_permission,'grantScope',case when p_resource_type is null then 'module' else 'resource' end,
    'resourceType',p_resource_type,'resourceId',p_resource_id),
   jsonb_build_object('actorDeviceId',p_actor_device_id),p_operation_id,'rpc'
  );
 end if;
 return v_id;
end $$;

create or replace function platform_private.revoke_permission_grant(
 p_actor uuid,p_device uuid,p_grant uuid,p_reason text default null,p_operation_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_grant platform.permission_grants%rowtype;v_permission platform.permissions%rowtype;v_device_authorization_id uuid;
begin
 if p_actor is null or p_device is null or p_grant is null or p_operation_id is null then raise exception 'INVALID_PERMISSION_REVOKE' using errcode='22023'; end if;
 v_device_authorization_id:=platform_private.validated_phase1c_device_authorization(p_actor,p_device);
 if v_device_authorization_id is null then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
 select * into v_grant from platform.permission_grants where id=p_grant for update;
 if not found then raise exception 'PERMISSION_GRANT_NOT_FOUND' using errcode='P0002'; end if;
 if v_grant.revoked_at is null then
  update platform.permission_grants set revoked_at=statement_timestamp(),revoked_by=p_actor,
   metadata=metadata||jsonb_build_object('revokedByDeviceId',p_device,'revocationReason',p_reason,'revocationOperationId',p_operation_id)
  where id=p_grant;
  select * into v_permission from platform.permissions where id=v_grant.permission_id;
  insert into platform.audit_events(
   actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
   entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source
  ) values(
   p_actor,v_device_authorization_id,v_grant.user_id,'platform',v_permission.domain,'permission.revoked',
   'permission_grant',v_grant.id,'platform',
   jsonb_build_object('grantId',v_grant.id,'targetUserId',v_grant.user_id,'moduleKey',v_permission.domain,
    'permissionKey',v_permission.code,'grantScope',v_grant.scope_type,'resourceType',v_grant.resource_type,'resourceId',v_grant.resource_id),
   jsonb_build_object('revoked',true),
   jsonb_build_object('actorDeviceId',p_device,'reason',p_reason),p_operation_id,'rpc'
  );
 end if;
 return p_grant;
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
 if p_action in('grant','create') then if p_grant_id is not null then raise exception 'INVALID_MODULE_GRANT_OPERATION' using errcode='22023'; end if;g:=platform_private.create_permission_grant(a,p_actor_device_id,p_target_user_id,p_module_key,p_permission_key,p_resource_type,p_resource_id,p_operation_id); else select x.id into g from platform.permission_grants x join platform.permissions p on p.id=x.permission_id where x.id=p_grant_id and x.user_id=p_target_user_id and p.domain=p_module_key and p.code=p_permission_key and x.resource_type is not distinct from p_resource_type and x.resource_id is not distinct from p_resource_id;if g is null then raise exception 'PERMISSION_GRANT_NOT_FOUND_OR_STALE' using errcode='P0002'; end if;perform platform_private.revoke_permission_grant(a,p_actor_device_id,g,p_revocation_reason,p_operation_id); end if;
 return jsonb_build_object('status',case when p_action='revoke' then 'revoked' else 'applied' end,'grantId',g,'targetUserId',p_target_user_id,'moduleKey',p_module_key,'permissionKey',p_permission_key,'resourceType',p_resource_type,'resourceId',p_resource_id);
end $$;

revoke all on function platform_private.create_permission_grant(uuid,uuid,uuid,text,text,text,text,uuid),platform_private.revoke_permission_grant(uuid,uuid,uuid,text,uuid),public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function platform_private.create_permission_grant(uuid,uuid,uuid,text,text,text,text,uuid),platform_private.revoke_permission_grant(uuid,uuid,uuid,text,uuid),public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text) to service_role;

drop function platform_private.revoke_permission_grant(uuid,uuid,uuid,text);

commit;
