begin;

create or replace function public.get_user_management_overview(p_actor_device_id uuid,p_target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;target_user auth.users%rowtype;target_profile platform.profiles%rowtype;
begin
 if p_target_user_id is null then raise exception 'TARGET_USER_REQUIRED' using errcode='22023'; end if;
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null) then raise exception 'USER_MANAGEMENT_SCOPE_DENIED' using errcode='42501'; end if;
 select * into target_user from auth.users where id=p_target_user_id;
 if not found then raise exception 'TARGET_USER_NOT_FOUND' using errcode='P0002'; end if;
 select * into target_profile from platform.profiles where user_id=p_target_user_id;
 if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
 return jsonb_build_object('status','success','user',jsonb_build_object('userId',target_user.id,'displayName',target_profile.display_name,'email',target_user.email),'account',jsonb_build_object('accountStatus',target_profile.account_status),'capabilities',public.get_user_management_actor_capabilities(p_actor_device_id)-'status');
end $$;

create or replace function public.get_user_management_devices(p_actor_device_id uuid,p_target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;
begin
 if p_target_user_id is null then raise exception 'TARGET_USER_REQUIRED' using errcode='22023'; end if;
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not platform_private.user_has_module_permission_for(actor_id,'platform.devices.view',null,null) then raise exception 'DEVICE_READ_SCOPE_DENIED' using errcode='42501'; end if;
 return jsonb_build_object('status','success','devices',coalesce((select jsonb_agg(jsonb_build_object('deviceId',da.device_id,'deviceName',d.display_name,'platform',d.platform,'lastSeenAt',d.last_seen_at,'authorizationStatus',da.status,'requestedAt',da.requested_at,'approvedAt',da.approved_at,'revokedAt',da.revoked_at,'lastRegisteredAt',da.last_authorized_seen_at,'capabilities',jsonb_build_object('canApprove',platform_private.user_has_module_permission_for(actor_id,'platform.devices.approve',null,null) and da.status='pending','canReject',platform_private.user_has_module_permission_for(actor_id,'platform.devices.block',null,null) and da.status='pending','canRevoke',platform_private.user_has_module_permission_for(actor_id,'platform.devices.revoke',null,null) and da.status='approved')) order by da.created_at,da.device_id) from platform.user_device_authorizations da join platform.devices d on d.id=da.device_id where da.user_id=p_target_user_id),'[]'::jsonb));
end $$;

create or replace function public.get_user_management_account(p_actor_device_id uuid,p_target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;target_profile platform.profiles%rowtype;
begin
 if p_target_user_id is null then raise exception 'TARGET_USER_REQUIRED' using errcode='22023'; end if;
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null) then raise exception 'ACCOUNT_READ_SCOPE_DENIED' using errcode='42501'; end if;
 select * into target_profile from platform.profiles where user_id=p_target_user_id;
 if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
 return jsonb_build_object('status','success','account',jsonb_build_object('accountStatus',target_profile.account_status));
end $$;

revoke all on function public.get_user_management_overview(uuid,uuid),public.get_user_management_devices(uuid,uuid),public.get_user_management_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_user_management_overview(uuid,uuid),public.get_user_management_devices(uuid,uuid),public.get_user_management_account(uuid,uuid) to service_role;

commit;
