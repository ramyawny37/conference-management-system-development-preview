-- Production-only Phase 1C context bridge for the verified device-session dispatcher.
begin;

do $$
declare outer_signature regprocedure:=to_regprocedure('platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)');
  core_signature regprocedure:=to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)');
begin
  if to_regclass('platform_private.device_sessions') is null
     or to_regclass('platform.device_key_bindings') is null
     or to_regclass('platform.user_device_authorizations') is null
     or to_regclass('platform.devices') is null
     or to_regclass('platform.profiles') is null then
    raise exception 'PHASE1C_PRODUCTION_SESSION_FOUNDATION_REQUIRED' using errcode='55000';
  end if;
  if outer_signature is null and core_signature is null then
    raise exception 'PHASE1C_VERIFIED_DISPATCHER_REQUIRED' using errcode='55000';
  end if;
  if outer_signature is not null and core_signature is null then
    alter function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)
      rename to execute_conference_device_operation_phase1c_core;
  elsif outer_signature is null and core_signature is not null then
    null;
  elsif outer_signature is not null and core_signature is not null then
    if pg_catalog.pg_get_functiondef(core_signature) not like '%DEVICE_SESSION_INVALID%'
       or pg_catalog.pg_get_functiondef(core_signature) not like '%ACTOR_DEVICE_OVERRIDE_DENIED%' then
      raise exception 'PHASE1C_CORE_CONTRACT_UNEXPECTED' using errcode='55000';
    end if;
  end if;
end;
$$;

do $$
declare core_signature regprocedure:=to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)');
begin
  if core_signature is null
     or pg_catalog.pg_get_functiondef(core_signature) not like '%DEVICE_SESSION_INVALID%'
     or pg_catalog.pg_get_functiondef(core_signature) not like '%ACTOR_DEVICE_OVERRIDE_DENIED%' then
    raise exception 'PHASE1C_CORE_CONTRACT_INVALID' using errcode='55000';
  end if;
end;
$$;

revoke all on function platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function platform_private.validated_phase1c_device_authorization(
  p_user_id uuid,p_device_id uuid
) returns uuid language plpgsql stable security definer set search_path='' as $$
declare claims jsonb; session_id uuid; authorization_id uuid; binding_id uuid; token_hash bytea;
begin
  begin
    claims:=nullif(pg_catalog.current_setting('platform.phase1c_context',true),'')::jsonb;
    if claims is null or claims->>'purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH'
      or (claims->>'user_id')::uuid is distinct from p_user_id
      or (claims->>'device_id')::uuid is distinct from p_device_id then return null; end if;
    session_id:=(claims->>'session_id')::uuid;
    authorization_id:=(claims->>'authorization_id')::uuid;
    binding_id:=(claims->>'binding_id')::uuid;
    token_hash:=pg_catalog.decode(claims->>'token_hash','hex');
  exception when others then return null;
  end;
  if pg_catalog.octet_length(token_hash)<>32 then return null; end if;
  if exists(
    select 1 from platform_private.device_sessions session
    join platform.device_key_bindings binding on binding.id=session.binding_id
    join platform.user_device_authorizations device_authorization on device_authorization.id=session.device_authorization_id
    join platform.devices device on device.id=session.device_id
    join platform.profiles profile on profile.user_id=session.user_id
    where session.id=session_id and session.user_id=p_user_id and session.device_id=p_device_id
      and session.device_authorization_id=authorization_id and session.binding_id=binding_id
      and session.token_hash=token_hash and session.purpose='PLATFORM_DEVICE_SESSION'
      and session.revoked_at is null and session.expires_at>pg_catalog.statement_timestamp()
      and binding.user_id=session.user_id and binding.device_id=session.device_id
      and binding.device_authorization_id=session.device_authorization_id
      and binding.public_key_thumbprint=session.public_key_thumbprint
      and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active'
      and binding.revoked_at is null and binding.retired_at is null
      and device_authorization.user_id=session.user_id and device_authorization.device_id=session.device_id
      and device_authorization.status='approved' and device_authorization.revoked_at is null
      and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
      and profile.account_status='approved'
  ) then return authorization_id; end if;
  return null;
end;
$$;

create or replace function platform_private.phase1c_context_device_id()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare claims jsonb;
begin
  begin
    claims:=nullif(pg_catalog.current_setting('platform.phase1c_context',true),'')::jsonb;
    if claims is null or claims->>'purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH' then return null; end if;
    return (claims->>'device_id')::uuid;
  exception when others then return null;
  end;
end;
$$;

create or replace function public.require_current_approved_device(p_actor_device_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor_user_id uuid:=auth.uid(); authorization_id uuid;
begin
  if actor_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_actor_device_id is null then raise exception 'DEVICE_REQUIRED' using errcode='22023'; end if;
  if not public.is_account_approved(actor_user_id) then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode='42501';
  end if;
  authorization_id:=platform_private.validated_phase1c_device_authorization(actor_user_id,p_actor_device_id);
  if authorization_id is null then raise exception 'APPROVED_DEVICE_REQUIRED' using errcode='42501'; end if;
  return actor_user_id;
end;
$$;

create or replace function platform_private.has_permission_for(
  p_user_id uuid,p_permission_code text,p_scope_type text,p_scope_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select platform_private.is_account_approved(p_user_id)
    and platform_private.validated_phase1c_device_authorization(
      p_user_id,platform_private.phase1c_context_device_id()
    ) is not null
    and p_scope_type in ('platform','inventory') and p_scope_id is null
    and exists(
      select 1 from platform.user_roles assignment
      join platform.roles role on role.id=assignment.role_id
      join platform.role_permissions role_permission on role_permission.role_id=role.id
      join platform.permissions permission on permission.id=role_permission.permission_id
      where assignment.user_id=p_user_id and assignment.scope_type=p_scope_type
        and assignment.scope_id is null and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at>pg_catalog.now())
        and role.scope_type=assignment.scope_type and role.domain=permission.domain
        and permission.code=p_permission_code and permission.domain=p_scope_type
    );
$$;

create or replace function platform.execute_conference_device_operation(
  p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_operation text,p_args jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,platform,platform_private as $$
declare verified_session platform_private.device_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'CONFERENCE_OPERATION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  if p_user_id is null or p_session_id is null or pg_catalog.octet_length(p_token_hash)<>32 then
    raise exception 'DEVICE_SESSION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  select session.* into verified_session from platform_private.device_sessions session
  join platform.device_key_bindings binding on binding.id=session.binding_id
  join platform.user_device_authorizations device_authorization on device_authorization.id=session.device_authorization_id
  join platform.devices device on device.id=session.device_id
  join platform.profiles profile on profile.user_id=session.user_id
  where session.id=p_session_id and session.user_id=p_user_id and session.token_hash=p_token_hash
    and session.purpose='PLATFORM_DEVICE_SESSION' and session.revoked_at is null
    and session.expires_at>pg_catalog.statement_timestamp()
    and binding.user_id=session.user_id and binding.device_id=session.device_id
    and binding.device_authorization_id=session.device_authorization_id
    and binding.public_key_thumbprint=session.public_key_thumbprint
    and binding.algorithm='ECDSA_P256_SHA256' and binding.lifecycle_status='active'
    and binding.revoked_at is null and binding.retired_at is null
    and device_authorization.user_id=session.user_id and device_authorization.device_id=session.device_id
    and device_authorization.status='approved' and device_authorization.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
    and profile.account_status='approved';
  if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
  perform pg_catalog.set_config('platform.phase1c_context',pg_catalog.jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',verified_session.id,
    'user_id',verified_session.user_id,'device_id',verified_session.device_id,
    'authorization_id',verified_session.device_authorization_id,'binding_id',verified_session.binding_id,
    'token_hash',pg_catalog.encode(p_token_hash,'hex')
  )::text,true);
  return platform.execute_conference_device_operation_phase1c_core(
    p_user_id,p_session_id,p_token_hash,p_operation,p_args
  );
end;
$$;

revoke all on function platform_private.validated_phase1c_device_authorization(uuid,uuid),platform_private.phase1c_context_device_id(),public.require_current_approved_device(uuid),platform_private.has_permission_for(uuid,text,text,uuid),platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb) to service_role;

commit;
