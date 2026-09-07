-- Phase 1C: cryptographic device-session boundary for Conference operations.

drop index if exists platform_private.device_sessions_one_active_binding_idx;
create index device_sessions_active_binding_lookup_idx
  on platform_private.device_sessions(binding_id,expires_at)
  where revoked_at is null;

create or replace function platform.complete_device_session(
  p_challenge_id uuid,p_user_id uuid,p_device_id uuid,p_authorization_id uuid,p_binding_id uuid,
  p_public_key_thumbprint text,p_session_id uuid,p_token_hash bytea
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_challenge platform_private.device_session_challenges%rowtype; v_now timestamptz:=statement_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'DEVICE_SESSION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_session_id is null or octet_length(p_token_hash)<>32 then raise exception 'DEVICE_SESSION_ARGUMENT_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('device-session:'||p_challenge_id::text,0));
  select * into v_challenge from platform_private.device_session_challenges where id=p_challenge_id for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.failed_at is not null or v_challenge.expires_at<=v_now
    or v_challenge.user_id<>p_user_id or v_challenge.device_id<>p_device_id
    or v_challenge.device_authorization_id<>p_authorization_id or v_challenge.binding_id<>p_binding_id
    or v_challenge.public_key_thumbprint<>p_public_key_thumbprint
    or v_challenge.purpose<>'PLATFORM_DEVICE_SESSION_ESTABLISH'
    or v_challenge.origin<>'https://ramyawny37.github.io' then raise exception 'DEVICE_SESSION_CHALLENGE_INVALID' using errcode='42501'; end if;
  if not exists(select 1 from platform.device_key_bindings binding
    join platform.user_device_authorizations uda on uda.id=binding.device_authorization_id
    join platform.devices device on device.id=binding.device_id join platform.profiles profile on profile.user_id=binding.user_id
    where binding.id=p_binding_id and binding.user_id=p_user_id and binding.device_id=p_device_id
      and binding.device_authorization_id=p_authorization_id and binding.public_key_thumbprint=p_public_key_thumbprint
      and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
      and uda.user_id=p_user_id and uda.device_id=p_device_id and uda.status='approved' and uda.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null and profile.account_status='approved')
    then raise exception 'DEVICE_SESSION_AUTHORITY_INVALID' using errcode='42501'; end if;
  delete from platform_private.device_sessions where expires_at<v_now-interval '7 days';
  insert into platform_private.device_sessions(id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,token_hash,purpose,created_at,expires_at,challenge_id)
  values(p_session_id,p_user_id,p_device_id,p_authorization_id,p_binding_id,p_public_key_thumbprint,p_token_hash,'PLATFORM_DEVICE_SESSION',v_now,v_now+interval '5 minutes',p_challenge_id);
  update platform_private.device_session_challenges set consumed_at=v_now,session_id=p_session_id where id=p_challenge_id;
  insert into platform_private.device_session_audit(event,session_id,challenge_id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,purpose)
  values('established',p_session_id,p_challenge_id,p_user_id,p_device_id,p_authorization_id,p_binding_id,p_public_key_thumbprint,'PLATFORM_DEVICE_SESSION');
  return jsonb_build_object('sessionId',p_session_id,'userId',p_user_id,'deviceId',p_device_id,'authorizationId',p_authorization_id,'bindingId',p_binding_id,'purpose','PLATFORM_DEVICE_SESSION','issuedAt',v_now,'expiresAt',v_now+interval '5 minutes');
end; $$;

create or replace function platform_private.require_exact_jsonb_keys(
  p_args jsonb,p_required text[],p_optional text[] default '{}'::text[]
) returns void language plpgsql immutable set search_path='' as $$
declare v_key text;
begin
  if p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'CONFERENCE_OPERATION_ARGUMENTS_INVALID' using errcode='22023'; end if;
  foreach v_key in array p_required loop
    if not p_args ? v_key then raise exception 'CONFERENCE_OPERATION_ARGUMENT_MISSING' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(p_args) key where not (key=any(p_required) or key=any(p_optional))) then
    raise exception 'CONFERENCE_OPERATION_ARGUMENT_UNKNOWN' using errcode='22023';
  end if;
end; $$;

create or replace function platform.execute_conference_device_operation(
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

revoke all on function platform_private.require_exact_jsonb_keys(jsonb,text[],text[]) from public,anon,authenticated,service_role;
revoke all on function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb) to service_role;

-- Exact Phase 1C browser boundary.  The regprocedure cast deliberately makes an
-- overload/signature drift fail the migration instead of leaving a bypass.
do $$ declare v_signature text; begin
  foreach v_signature in array array[
    'public.device_guarded_list_my_organizations(uuid)','public.device_guarded_get_my_organization_access(uuid,uuid)','public.device_guarded_list_organization_members(uuid,uuid)','public.device_guarded_lookup_organization_candidate_by_email(uuid,uuid,text)','public.device_guarded_get_organization_membership_operation(uuid,uuid,uuid)','public.device_guarded_add_organization_member(uuid,uuid,uuid,uuid)','public.device_guarded_remove_organization_member(uuid,uuid,uuid,uuid)','public.device_guarded_change_organization_role(uuid,uuid,uuid,text,uuid)',
    'public.device_guarded_get_my_conference_access(uuid,uuid)','public.device_guarded_get_my_conference_membership(uuid,uuid)','public.device_guarded_list_conference_members(uuid,uuid)','public.device_guarded_lookup_conference_user_by_email(uuid,uuid,text)','public.device_guarded_manage_conference_member(uuid,uuid,uuid,uuid,text,text)','public.device_guarded_add_conference_manager(uuid,uuid,uuid,uuid)','public.device_guarded_remove_conference_manager(uuid,uuid,uuid,uuid)','public.device_guarded_list_available_conferences(uuid)',
    'public.device_guarded_create_organization_conference_idempotent(uuid,uuid,uuid,uuid,text,jsonb)','public.device_guarded_get_conference_creation_operation(uuid,uuid)','public.device_guarded_list_eligible_legacy_conference_organizations(uuid,uuid)','public.device_guarded_assign_legacy_conference_organization(uuid,uuid,uuid,uuid)','public.device_guarded_get_conference_snapshot_metadata(uuid,uuid)','public.device_guarded_download_conference_snapshot(uuid,uuid)','public.device_guarded_apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)','public.device_guarded_get_sync_conflict(uuid,uuid)','public.device_guarded_list_sync_conflicts(uuid,uuid,text,integer)','public.device_guarded_resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)',
    'public.get_organization_management_overview(uuid)','public.manage_organization(uuid,uuid,text,uuid,text,text)','public.get_user_management_actor_capabilities(uuid)','public.search_user_management_users(uuid,text,text,integer)','public.get_user_management_overview(uuid,uuid)','public.get_user_management_devices(uuid,uuid)','public.get_user_management_account(uuid,uuid)','public.device_guarded_manage_system_user(uuid,uuid,uuid,text,boolean)',
    'public.list_member_device_authorizations(uuid,uuid,uuid)','public.approve_member_device(uuid,uuid,uuid,uuid,uuid)','public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid)','public.revoke_member_device(uuid,uuid,uuid,uuid,uuid)','public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid)','platform.list_pending_device_authorizations()','platform.approve_pending_device_authorization(uuid,uuid,text)',
    'public.list_organization_templates(uuid,uuid)','public.list_shared_organization_templates(uuid)','public.apply_organization_template_operation(uuid,uuid,uuid,text,text,text,bigint,jsonb)','public.apply_library_template_content_operation(uuid,uuid,text,text,text,bigint,jsonb)','public.apply_organization_template_access_operation(uuid,uuid,text,text,uuid,text)','public.list_module_permission_grants(uuid,text,uuid)','public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)','public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)',
    'public.device_guarded_acquire_conference_lock(uuid,uuid,uuid,integer)','public.device_guarded_renew_conference_lock(uuid,uuid,uuid,integer)','public.device_guarded_release_conference_lock(uuid,uuid,uuid)','public.device_guarded_get_conference_lock(uuid,uuid)','public.acquire_conference_section_lock(uuid,text,uuid,uuid,integer)','public.renew_conference_section_lock(uuid,text,uuid,uuid,integer)','public.release_conference_section_lock(uuid,text,uuid,uuid)','public.get_conference_section_lock(uuid,text,uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated',v_signature::regprocedure);
  end loop;
end $$;

-- The only browser calls that may precede a device session.  Exact grants are
-- restated so a previous broad revoke cannot break session establishment.
grant execute on function public.get_first_system_bootstrap_status() to authenticated;
grant execute on function public.complete_first_system_bootstrap(text,text,text,uuid,text,text,uuid) to authenticated;
grant execute on function public.get_my_device_authorization(uuid),public.get_my_device_aware_system_access(uuid),public.register_or_refresh_current_device(uuid,text,text),public.request_current_device_authorization(uuid,uuid) to authenticated;
grant execute on function platform.begin_current_device_ownership_handoff(text),platform.get_current_device_handoff_assertion_claims(uuid,text),platform.get_my_device_key_binding_status(),platform.begin_device_session_challenge(uuid) to authenticated;
grant execute on function platform.get_my_access_context(text,text,uuid),platform.get_my_device_authorization(),platform.register_current_device(text,text,text) to authenticated;

-- Superseded mutation entry points are backend/internal only.  Current browser
-- behavior uses the exact guarded/session operations declared above.
revoke execute on function platform.approve_device_authorization(uuid,text),platform.block_device_authorization(uuid,text),platform.revoke_device_authorization(uuid,text),platform.set_account_status(uuid,text,text),platform.grant_user_role(uuid,text,text,text,uuid),platform.revoke_user_role(uuid),platform.grant_role_permission(text,text,text),platform.revoke_role_permission(text,text,text),public.grant_system_role(uuid,text),public.revoke_system_role(uuid,text) from public,anon,authenticated;

-- Bounded cleanup is performed opportunistically without affecting valid sessions.
delete from platform_private.device_sessions where expires_at<statement_timestamp()-interval '7 days';
