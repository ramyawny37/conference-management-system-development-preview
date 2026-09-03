-- Phase 1C: bridge the already-verified device session into legacy guarded RPCs.
-- No data is changed and no browser role receives a new execution grant.

alter function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)
  rename to execute_conference_device_operation_phase1c_core;

revoke all on function platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function platform_private.validated_phase1c_device_authorization(
  p_user_id uuid,p_device_id uuid
) returns uuid language plpgsql stable security definer set search_path='' as $$
declare
  v_claims jsonb;
  v_session_id uuid;
  v_authorization_id uuid;
  v_binding_id uuid;
  v_token_hash bytea;
begin
  begin
    v_claims:=nullif(pg_catalog.current_setting('platform.phase1c_context',true),'')::jsonb;
    if v_claims is null or v_claims->>'purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH'
      or (v_claims->>'user_id')::uuid is distinct from p_user_id
      or (v_claims->>'device_id')::uuid is distinct from p_device_id then return null; end if;
    v_session_id:=(v_claims->>'session_id')::uuid;
    v_authorization_id:=(v_claims->>'authorization_id')::uuid;
    v_binding_id:=(v_claims->>'binding_id')::uuid;
    v_token_hash:=pg_catalog.decode(v_claims->>'token_hash','hex');
  exception when others then return null;
  end;
  if pg_catalog.octet_length(v_token_hash)<>32 then return null; end if;
  if exists(select 1 from platform_private.device_sessions session
    join platform.device_key_bindings binding on binding.id=session.binding_id
    join platform.user_device_authorizations uda on uda.id=session.device_authorization_id
    join platform.devices device on device.id=session.device_id
    join platform.profiles profile on profile.user_id=session.user_id
    where session.id=v_session_id and session.user_id=p_user_id and session.device_id=p_device_id
      and session.device_authorization_id=v_authorization_id and session.binding_id=v_binding_id
      and session.token_hash=v_token_hash and session.purpose='PLATFORM_DEVICE_SESSION'
      and session.revoked_at is null and session.expires_at>pg_catalog.statement_timestamp()
      and binding.user_id=session.user_id and binding.device_id=session.device_id
      and binding.device_authorization_id=session.device_authorization_id
      and binding.public_key_thumbprint=session.public_key_thumbprint
      and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active'
      and binding.revoked_at is null and binding.retired_at is null
      and uda.user_id=session.user_id and uda.device_id=session.device_id
      and uda.status='approved' and uda.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
      and profile.account_status='approved') then return v_authorization_id; end if;
  return null;
end; $$;

revoke all on function platform_private.validated_phase1c_device_authorization(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function platform_private.phase1c_context_device_id()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_claims jsonb; v_device_id uuid;
begin
  begin
    v_claims:=nullif(pg_catalog.current_setting('platform.phase1c_context',true),'')::jsonb;
    if v_claims->>'purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH' then return null; end if;
    v_device_id:=(v_claims->>'device_id')::uuid;
  exception when others then return null;
  end;
  return v_device_id;
end; $$;

revoke all on function platform_private.phase1c_context_device_id()
  from public,anon,authenticated,service_role;

create or replace function public.require_current_approved_device(p_actor_device_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=auth.uid(); platform_authorization_id uuid;
begin
  if current_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_actor_device_id is null then raise exception 'DEVICE_REQUIRED' using errcode='22023'; end if;
  if not public.is_account_approved(current_user_id) then raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode='42501'; end if;
  platform_authorization_id:=platform_private.validated_phase1c_device_authorization(current_user_id,p_actor_device_id);
  if platform_authorization_id is not null then return current_user_id; end if;
  if exists(select 1 from public.user_device_authorizations uda
    where uda.user_id=current_user_id and uda.device_id=p_actor_device_id
      and uda.authorization_status='approved' and uda.revoked_at is null) then return current_user_id; end if;
  platform_authorization_id:=platform_private.current_device_authorization_id(current_user_id);
  if platform_authorization_id is null or platform_private.request_device_id() is distinct from p_actor_device_id then
    raise exception 'APPROVED_DEVICE_REQUIRED' using errcode='42501';
  end if;
  return current_user_id;
end; $$;

revoke all on function public.require_current_approved_device(uuid) from public,anon,authenticated,service_role;

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
    and p_scope_type in ('platform','inventory') and p_scope_id is null
    and exists(select 1 from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=p_user_id and assignment.scope_type=p_scope_type and assignment.scope_id is null
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and role.scope_type=assignment.scope_type and role.domain=permission.domain
        and permission.code=p_permission_code and permission.domain=p_scope_type);
$$;

revoke all on function platform_private.has_permission_for(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function platform.execute_conference_device_operation(
  p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_operation text,p_args jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,platform,platform_private as $$
declare v_session platform_private.device_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'CONFERENCE_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_user_id is null or p_session_id is null or pg_catalog.octet_length(p_token_hash)<>32 then raise exception 'DEVICE_SESSION_ARGUMENT_INVALID' using errcode='22023'; end if;
  select session.* into v_session from platform_private.device_sessions session
  join platform.device_key_bindings binding on binding.id=session.binding_id
  join platform.user_device_authorizations uda on uda.id=session.device_authorization_id
  join platform.devices device on device.id=session.device_id
  join platform.profiles profile on profile.user_id=session.user_id
  where session.id=p_session_id and session.user_id=p_user_id and session.token_hash=p_token_hash
    and session.purpose='PLATFORM_DEVICE_SESSION' and session.revoked_at is null and session.expires_at>statement_timestamp()
    and binding.user_id=session.user_id and binding.device_id=session.device_id
    and binding.device_authorization_id=session.device_authorization_id
    and binding.public_key_thumbprint=session.public_key_thumbprint
    and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active'
    and binding.revoked_at is null and binding.retired_at is null
    and uda.user_id=session.user_id and uda.device_id=session.device_id
    and uda.status='approved' and uda.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  perform pg_catalog.set_config('platform.phase1c_context',pg_catalog.jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,'user_id',v_session.user_id,
    'device_id',v_session.device_id,'authorization_id',v_session.device_authorization_id,
    'binding_id',v_session.binding_id,'token_hash',pg_catalog.encode(p_token_hash,'hex'))::text,true);
  return platform.execute_conference_device_operation_phase1c_core(p_user_id,p_session_id,p_token_hash,p_operation,p_args);
end; $$;

revoke all on function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb) to service_role;

-- Remove the device-specific transition restriction from the four live handoff
-- bodies while retaining their authenticated-current-device and challenge joins.
do $$
declare v_signature regprocedure; v_definition text; v_replaced text;
begin
  foreach v_signature in array array[
    'platform.begin_current_device_ownership_handoff(text)'::regprocedure,
    'platform.get_current_device_handoff_assertion_claims(uuid,text)'::regprocedure,
    'platform.complete_device_ownership_handoff(uuid,uuid,uuid,uuid,text,jsonb,uuid,bytea,timestamptz,timestamptz)'::regprocedure,
    'platform.complete_device_binding_recovery(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid,bytea,timestamptz,timestamptz)'::regprocedure
  ] loop
    v_definition:=pg_catalog.pg_get_functiondef(v_signature);
    v_replaced:=pg_catalog.regexp_replace(v_definition,
      E'\\n[[:space:]]*IF v_device[[:space:]]*<>[[:space:]]*''[0-9a-f-]{36}''::uuid[[:space:]]+THEN[[:space:]]*\\n[[:space:]]*RAISE EXCEPTION ''DEVICE_HANDOFF_CANONICAL_DEVICE_MISMATCH'' USING ERRCODE[[:space:]]*=[[:space:]]*''42501'';[[:space:]]*\\n[[:space:]]*END IF;', '', 'i');
    v_replaced:=pg_catalog.regexp_replace(v_replaced,
      E'[[:space:]]+OR challenge.device_id[[:space:]]*<>[[:space:]]*''[0-9a-f-]{36}''::uuid',
      ' OR challenge.device_id IS DISTINCT FROM platform_private.request_device_id()', 'i');
    v_replaced:=pg_catalog.regexp_replace(v_replaced,
      E'[[:space:]]+OR p_device_id[[:space:]]*<>[[:space:]]*''[0-9a-f-]{36}''::uuid', '', 'i');
    if v_replaced=v_definition or v_replaced ~* E'''[0-9a-f-]{36}''::uuid' then
      raise exception 'DEVICE_HANDOFF_DYNAMIC_RECONCILIATION_FAILED:%',v_signature using errcode='55000';
    end if;
    execute v_replaced;
  end loop;
end; $$;

revoke all on function platform.begin_current_device_ownership_handoff(text) from public,anon,authenticated,service_role;
revoke all on function platform.get_current_device_handoff_assertion_claims(uuid,text) from public,anon,authenticated,service_role;
revoke all on function platform.complete_device_ownership_handoff(uuid,uuid,uuid,uuid,text,jsonb,uuid,bytea,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function platform.complete_device_binding_recovery(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid,bytea,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function platform.begin_current_device_ownership_handoff(text) to authenticated;
grant execute on function platform.get_current_device_handoff_assertion_claims(uuid,text) to authenticated;
grant execute on function platform.complete_device_ownership_handoff(uuid,uuid,uuid,uuid,text,jsonb,uuid,bytea,timestamptz,timestamptz) to service_role;
grant execute on function platform.complete_device_binding_recovery(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid,bytea,timestamptz,timestamptz) to service_role;
