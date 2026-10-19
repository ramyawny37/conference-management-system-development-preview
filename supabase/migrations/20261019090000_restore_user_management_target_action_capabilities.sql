begin;
-- Restore target-specific action capabilities removed by the scoped-read cutover.
-- Keep the canonical Platform profile and role authority, and never expose an
-- actionable block permission for the acting account or a Platform owner.
create or replace function public.get_user_management_account(p_actor_device_id uuid,p_target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid;target_profile platform.profiles%rowtype;can_manage boolean;
begin
 if p_target_user_id is null then raise exception 'TARGET_USER_REQUIRED' using errcode='22023'; end if;
 actor_id:=public.require_current_approved_device(p_actor_device_id);
 if not platform_private.user_has_module_permission_for(actor_id,'platform.users.view',null,null)
 then raise exception 'ACCOUNT_READ_SCOPE_DENIED' using errcode='42501'; end if;
 select * into target_profile from platform.profiles where user_id=p_target_user_id;
 if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
 can_manage:=public.is_system_owner(actor_id) and actor_id<>p_target_user_id
             and not public.is_system_owner(p_target_user_id);
 return pg_catalog.jsonb_build_object(
  'status','success',
  'account',pg_catalog.jsonb_build_object(
   'accountStatus',target_profile.account_status,
   'capabilities',pg_catalog.jsonb_build_object(
    'canBlock',can_manage and target_profile.account_status='approved',
    'canUnblock',can_manage and target_profile.account_status='blocked'
   )
  )
 );
end $$;
revoke all on function public.get_user_management_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_user_management_account(uuid,uuid) to service_role;
commit;
