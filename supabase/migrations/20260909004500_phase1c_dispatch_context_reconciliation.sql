-- Preserve strict Phase1C authority context inside the Conference dispatcher core.
begin;

do $$
begin
  if to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)') is null then
    raise exception 'PHASE1C_CONFERENCE_CORE_REQUIRED' using errcode='55000';
  end if;
end;
$$;

create or replace function platform.execute_conference_device_operation_phase1c_core(
  p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_operation text,p_args jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,platform,platform_private as $$
declare v_session platform_private.device_sessions%rowtype; v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'CONFERENCE_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_user_id is null or p_session_id is null or octet_length(p_token_hash)<>32 then raise exception 'DEVICE_SESSION_ARGUMENT_INVALID' using errcode='22023'; end if;
  select session.* into v_session from platform_private.device_sessions session
  join platform.device_key_bindings binding on binding.id=session.binding_id
  join platform.user_device_authorizations uda on uda.id=session.device_authorization_id
  join platform.devices device on device.id=session.device_id
  join platform.profiles profile on profile.user_id=session.user_id
  where session.id=p_session_id and session.user_id=p_user_id and session.token_hash=p_token_hash
    and session.revoked_at is null and session.expires_at>statement_timestamp()
    and binding.user_id=session.user_id and binding.device_id=session.device_id
    and binding.device_authorization_id=session.device_authorization_id
    and binding.public_key_thumbprint=session.public_key_thumbprint
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and uda.user_id=session.user_id and uda.device_id=session.device_id
    and uda.status='approved' and uda.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  if p_args ? 'p_actor_device_id' or (p_args ? 'p_device_id' and p_operation<>'approve_pending_device_authorization') then raise exception 'ACTOR_DEVICE_OVERRIDE_DENIED' using errcode='22023'; end if;
  perform set_config('platform.phase1c_context',jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH',
    'session_id',v_session.id,
    'user_id',v_session.user_id,
    'device_id',v_session.device_id,
    'authorization_id',v_session.device_authorization_id,
    'binding_id',v_session.binding_id,
    'token_hash',encode(p_token_hash,'hex')
  )::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','authenticated')::text,true);

  case p_operation
  when 'device_guarded_create_organization_conference_idempotent' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_requested_conference_id','p_organization_id','p_name','p_initial_metadata']);
    v_result:=public.device_guarded_create_organization_conference_idempotent(v_session.device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_requested_conference_id')::uuid,(p_args->>'p_organization_id')::uuid,p_args->>'p_name',p_args->'p_initial_metadata');
  when 'device_guarded_apply_conference_snapshot' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_operation_id','p_base_revision','p_snapshot','p_schema_version','p_app_version']);
    v_result:=public.device_guarded_apply_conference_snapshot(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_operation_id')::uuid,(p_args->>'p_base_revision')::bigint,p_args->'p_snapshot',p_args->>'p_schema_version',p_args->>'p_app_version');
  when 'device_guarded_resolve_sync_conflict' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conflict_id','p_conference_id','p_resolution_operation_id','p_expected_revision','p_strategy','p_resolved_snapshot','p_schema_version','p_app_version']);
    v_result:=public.device_guarded_resolve_sync_conflict(v_session.device_id,(p_args->>'p_conflict_id')::uuid,(p_args->>'p_conference_id')::uuid,(p_args->>'p_resolution_operation_id')::uuid,(p_args->>'p_expected_revision')::bigint,p_args->>'p_strategy',p_args->'p_resolved_snapshot',p_args->>'p_schema_version',p_args->>'p_app_version');
  when 'device_guarded_get_my_conference_access' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); v_result:=public.device_guarded_get_my_conference_access(v_session.device_id,(p_args->>'p_conference_id')::uuid);
  when 'device_guarded_list_conference_members' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from public.device_guarded_list_conference_members(v_session.device_id,(p_args->>'p_conference_id')::uuid) x;
  when 'device_guarded_lookup_conference_user_by_email' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_email']); v_result:=public.device_guarded_lookup_conference_user_by_email(v_session.device_id,(p_args->>'p_conference_id')::uuid,p_args->>'p_email');
  when 'device_guarded_manage_conference_member' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_target_user_id','p_operation_id','p_action'],array['p_requested_role']); v_result:=public.device_guarded_manage_conference_member(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_operation_id')::uuid,p_args->>'p_action',p_args->>'p_requested_role');
  when 'device_guarded_list_my_organizations' then
    perform platform_private.require_exact_jsonb_keys(p_args,'{}'); select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from public.device_guarded_list_my_organizations(v_session.device_id) x;
  when 'device_guarded_get_my_organization_access' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id']); v_result:=public.device_guarded_get_my_organization_access(v_session.device_id,(p_args->>'p_organization_id')::uuid);
  when 'device_guarded_list_organization_members' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id']); select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from public.device_guarded_list_organization_members(v_session.device_id,(p_args->>'p_organization_id')::uuid) x;
  when 'device_guarded_lookup_organization_candidate_by_email' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_email']); v_result:=public.device_guarded_lookup_organization_candidate_by_email(v_session.device_id,(p_args->>'p_organization_id')::uuid,p_args->>'p_email');
  when 'device_guarded_add_organization_member','device_guarded_remove_organization_member' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_target_user_id','p_operation_id']);
    if p_operation='device_guarded_add_organization_member' then v_result:=public.device_guarded_add_organization_member(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_operation_id')::uuid); else v_result:=public.device_guarded_remove_organization_member(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_operation_id')::uuid); end if;
  when 'device_guarded_change_organization_role' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_target_user_id','p_target_role','p_operation_id']); v_result:=public.device_guarded_change_organization_role(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,p_args->>'p_target_role',(p_args->>'p_operation_id')::uuid);
  when 'manage_organization' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_action','p_organization_id'],array['p_name','p_description']); v_result:=public.manage_organization(v_session.device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_action',(p_args->>'p_organization_id')::uuid,p_args->>'p_name',p_args->>'p_description');
  when 'get_organization_management_overview' then
    perform platform_private.require_exact_jsonb_keys(p_args,'{}'); v_result:=public.get_organization_management_overview(v_session.device_id);
  when 'device_guarded_manage_system_user' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_target_user_id','p_operation_id','p_action'],array['p_requested_value']); v_result:=public.device_guarded_manage_system_user(v_session.device_id,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_operation_id')::uuid,p_args->>'p_action',case when p_args ? 'p_requested_value' then (p_args->>'p_requested_value')::boolean else null end);
  when 'device_guarded_download_conference_snapshot' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); v_result:=public.device_guarded_download_conference_snapshot(v_session.device_id,(p_args->>'p_conference_id')::uuid);
  when 'device_guarded_get_my_conference_membership' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); v_result:=public.device_guarded_get_my_conference_membership(v_session.device_id,(p_args->>'p_conference_id')::uuid);
  when 'device_guarded_list_available_conferences' then perform platform_private.require_exact_jsonb_keys(p_args,'{}'); select coalesce(jsonb_agg(to_jsonb(x)),'[]') into v_result from public.device_guarded_list_available_conferences(v_session.device_id) x;
  when 'device_guarded_get_conference_snapshot_metadata' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); v_result:=public.device_guarded_get_conference_snapshot_metadata(v_session.device_id,(p_args->>'p_conference_id')::uuid);
  when 'device_guarded_get_conference_creation_operation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id']); v_result:=public.device_guarded_get_conference_creation_operation(v_session.device_id,(p_args->>'p_operation_id')::uuid);
  when 'device_guarded_get_sync_conflict' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conflict_id']); v_result:=public.device_guarded_get_sync_conflict(v_session.device_id,(p_args->>'p_conflict_id')::uuid);
  when 'device_guarded_list_sync_conflicts' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_status','p_limit']); v_result:=public.device_guarded_list_sync_conflicts(v_session.device_id,(p_args->>'p_conference_id')::uuid,p_args->>'p_status',(p_args->>'p_limit')::integer);
  when 'device_guarded_get_organization_membership_operation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id']); v_result:=public.device_guarded_get_organization_membership_operation(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_operation_id')::uuid);
  when 'device_guarded_list_eligible_legacy_conference_organizations' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); v_result:=public.device_guarded_list_eligible_legacy_conference_organizations(v_session.device_id,(p_args->>'p_conference_id')::uuid);
  when 'device_guarded_assign_legacy_conference_organization' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_organization_id']); v_result:=public.device_guarded_assign_legacy_conference_organization(v_session.device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_conference_id')::uuid,(p_args->>'p_organization_id')::uuid);
  when 'device_guarded_add_conference_manager','device_guarded_remove_conference_manager' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_target_user_id','p_operation_id']);
    if p_operation='device_guarded_add_conference_manager' then v_result:=public.device_guarded_add_conference_manager(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_operation_id')::uuid); else v_result:=public.device_guarded_remove_conference_manager(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_operation_id')::uuid); end if;
  when 'get_user_management_actor_capabilities' then perform platform_private.require_exact_jsonb_keys(p_args,'{}'); v_result:=public.get_user_management_actor_capabilities(v_session.device_id);
  when 'search_user_management_users' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_query','p_account_status','p_limit']); v_result:=public.search_user_management_users(v_session.device_id,p_args->>'p_query',p_args->>'p_account_status',(p_args->>'p_limit')::integer);
  when 'get_user_management_overview' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_target_user_id']); v_result:=public.get_user_management_overview(v_session.device_id,(p_args->>'p_target_user_id')::uuid);
  when 'get_user_management_devices' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_target_user_id']); v_result:=public.get_user_management_devices(v_session.device_id,(p_args->>'p_target_user_id')::uuid);
  when 'get_user_management_account' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_target_user_id']); v_result:=public.get_user_management_account(v_session.device_id,(p_args->>'p_target_user_id')::uuid);
  when 'list_member_device_authorizations' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_target_user_id']); v_result:=public.list_member_device_authorizations(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid);
  when 'approve_member_device','reject_member_pending_device','revoke_member_device' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_target_user_id','p_device_id','p_operation_id']);
    if p_operation='approve_member_device' then v_result:=public.approve_member_device(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_device_id')::uuid,(p_args->>'p_operation_id')::uuid); elsif p_operation='reject_member_pending_device' then v_result:=public.reject_member_pending_device(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_device_id')::uuid,(p_args->>'p_operation_id')::uuid); else v_result:=public.revoke_member_device(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_device_id')::uuid,(p_args->>'p_operation_id')::uuid); end if;
  when 'replace_member_active_device' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_target_user_id','p_active_device_id','p_replacement_device_id','p_operation_id']); v_result:=public.replace_member_active_device(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_target_user_id')::uuid,(p_args->>'p_active_device_id')::uuid,(p_args->>'p_replacement_device_id')::uuid,(p_args->>'p_operation_id')::uuid);
  when 'list_pending_device_authorizations' then perform platform_private.require_exact_jsonb_keys(p_args,'{}'); v_result:=platform.list_pending_device_authorizations();
  when 'approve_pending_device_authorization' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_authorization_id','p_device_id','p_reason']); v_result:=platform.approve_pending_device_authorization((p_args->>'p_authorization_id')::uuid,(p_args->>'p_device_id')::uuid,p_args->>'p_reason');
  when 'list_organization_templates' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id']); v_result:=public.list_organization_templates(v_session.device_id,(p_args->>'p_organization_id')::uuid);
  when 'list_shared_organization_templates' then perform platform_private.require_exact_jsonb_keys(p_args,'{}'); v_result:=public.list_shared_organization_templates(v_session.device_id);
  when 'apply_organization_template_operation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_organization_id','p_operation_id','p_template_type','p_template_id','p_action','p_base_revision','p_payload']); v_result:=public.apply_organization_template_operation(v_session.device_id,(p_args->>'p_organization_id')::uuid,(p_args->>'p_operation_id')::uuid,p_args->>'p_template_type',p_args->>'p_template_id',p_args->>'p_action',(p_args->>'p_base_revision')::bigint,p_args->'p_payload');
  when 'apply_library_template_content_operation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_template_type','p_template_id','p_action','p_base_revision','p_payload']); v_result:=public.apply_library_template_content_operation(v_session.device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_template_type',p_args->>'p_template_id',p_args->>'p_action',(p_args->>'p_base_revision')::bigint,p_args->'p_payload');
  when 'apply_organization_template_access_operation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_template_type','p_template_id','p_organization_id','p_action']); v_result:=public.apply_organization_template_access_operation(v_session.device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_template_type',p_args->>'p_template_id',(p_args->>'p_organization_id')::uuid,p_args->>'p_action');
  when 'list_module_permission_grants' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_module_key','p_target_user_id']); v_result:=public.list_module_permission_grants(v_session.device_id,p_args->>'p_module_key',(p_args->>'p_target_user_id')::uuid);
  when 'manage_foundation_module_grant' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_action','p_target_user_id','p_module_key','p_permission_key','p_grant_id','p_revocation_reason']); v_result:=public.manage_foundation_module_grant(v_session.device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_action',(p_args->>'p_target_user_id')::uuid,p_args->>'p_module_key',p_args->>'p_permission_key',(p_args->>'p_grant_id')::uuid,p_args->>'p_revocation_reason');
  when 'recover_revoke_final_module_manager' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_module_key','p_target_user_id','p_target_grant_id','p_recovery_reason']); v_result:=public.recover_revoke_final_module_manager(v_session.device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_module_key',(p_args->>'p_target_user_id')::uuid,(p_args->>'p_target_grant_id')::uuid,p_args->>'p_recovery_reason');
  when 'acquire_conference_lock','renew_conference_lock' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_lock_token','p_ttl_seconds']);
    if p_operation='acquire_conference_lock' then v_result:=public.device_guarded_acquire_conference_lock(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_lock_token')::uuid,(p_args->>'p_ttl_seconds')::integer); else v_result:=public.device_guarded_renew_conference_lock(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_lock_token')::uuid,(p_args->>'p_ttl_seconds')::integer); end if;
  when 'release_conference_lock' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_lock_token']); v_result:=public.device_guarded_release_conference_lock(v_session.device_id,(p_args->>'p_conference_id')::uuid,(p_args->>'p_lock_token')::uuid);
  when 'get_conference_lock' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']); v_result:=public.device_guarded_get_conference_lock(v_session.device_id,(p_args->>'p_conference_id')::uuid);
  when 'acquire_conference_section_lock','renew_conference_section_lock' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_section','p_lock_token','p_ttl_seconds']);
    if p_operation='acquire_conference_section_lock' then v_result:=public.acquire_conference_section_lock((p_args->>'p_conference_id')::uuid,p_args->>'p_section',v_session.device_id,(p_args->>'p_lock_token')::uuid,(p_args->>'p_ttl_seconds')::integer); else v_result:=public.renew_conference_section_lock((p_args->>'p_conference_id')::uuid,p_args->>'p_section',v_session.device_id,(p_args->>'p_lock_token')::uuid,(p_args->>'p_ttl_seconds')::integer); end if;
  when 'release_conference_section_lock' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_section','p_lock_token']); v_result:=public.release_conference_section_lock((p_args->>'p_conference_id')::uuid,p_args->>'p_section',v_session.device_id,(p_args->>'p_lock_token')::uuid);
  when 'get_conference_section_lock' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_section']); v_result:=public.get_conference_section_lock((p_args->>'p_conference_id')::uuid,p_args->>'p_section',v_session.device_id);
  else raise exception 'CONFERENCE_OPERATION_NOT_ALLOWED' using errcode='42501';
  end case;
  return v_result;
end; $$;

revoke all on function platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)
  from public,anon,authenticated,service_role;

commit;
