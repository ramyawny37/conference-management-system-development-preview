\set ON_ERROR_STOP on
begin;
set local role postgres;

do $$
declare
  actor_binding platform.device_key_bindings%rowtype;
  actor_authorization platform.user_device_authorizations%rowtype;
  v_challenge_id uuid:='a1913121-0000-4000-8000-000000000001';
  v_session_id uuid:='a1913121-0000-4000-8000-000000000002';
  target_id uuid:='a1913121-0000-4000-8000-000000000003';
  operation_grant uuid:='a1913121-0000-4000-8000-000000000004';
  operation_revoke uuid:='a1913121-0000-4000-8000-000000000006';
  token_hash bytea:=decode(repeat('19',32),'hex');
  grant_result jsonb;
  grant_id uuid;
  audit_count integer;
  catalog_count integer;
  listed_count integer;
begin
  select binding.* into actor_binding
  from platform.device_key_bindings binding
  join platform.user_device_authorizations authz on authz.id=binding.device_authorization_id
  join platform.devices device on device.id=binding.device_id
  where platform_private.is_canonical_platform_owner(binding.user_id)
    and binding.lifecycle_status='active' and binding.revoked_at is null and binding.retired_at is null
    and authz.status='approved' and authz.revoked_at is null
    and device.lifecycle_status='active' and device.retired_at is null and device.compromised_at is null
  order by binding.created_at limit 1;
  if actor_binding.id is null then raise exception 'DEVELOPMENT_OWNER_BINDING_FIXTURE_REQUIRED'; end if;
  select * into actor_authorization from platform.user_device_authorizations where id=actor_binding.device_authorization_id;

  insert into platform_private.device_session_challenges(
    id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,
    purpose,origin,nonce,signing_payload,signing_payload_hash,expires_at
  ) values(
    v_challenge_id,actor_binding.user_id,actor_binding.device_id,actor_binding.device_authorization_id,
    actor_binding.id,actor_binding.public_key_thumbprint,'PLATFORM_DEVICE_SESSION_ESTABLISH',
    'https://ramyawny37.github.io',repeat('A',43),'audit-closure-regression',decode(repeat('18',32),'hex'),statement_timestamp()+interval '2 minutes'
  );
  insert into platform_private.device_sessions(
    id,user_id,device_id,device_authorization_id,binding_id,public_key_thumbprint,
    token_hash,purpose,expires_at,challenge_id
  ) values(
    v_session_id,actor_binding.user_id,actor_binding.device_id,actor_binding.device_authorization_id,
    actor_binding.id,actor_binding.public_key_thumbprint,token_hash,'PLATFORM_DEVICE_SESSION',
    statement_timestamp()+interval '5 minutes',v_challenge_id
  );
  update platform_private.device_session_challenges set consumed_at=statement_timestamp(),session_id=v_session_id where id=v_challenge_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_binding.user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session_id,'user_id',actor_binding.user_id,
    'device_id',actor_binding.device_id,'authorization_id',actor_binding.device_authorization_id,
    'binding_id',actor_binding.id,'token_hash',encode(token_hash,'hex'))::text,true);

  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(target_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'audit-closure-regression@example.invalid','', '{}'::jsonb,'{}'::jsonb,statement_timestamp(),statement_timestamp());
  update platform.profiles set display_name='Audit Closure Regression',account_status='approved',
    approved_at=statement_timestamp(),approved_by=actor_binding.user_id where user_id=target_id;

  select jsonb_array_length(public.list_module_permission_catalog_for_administration(actor_binding.device_id,'reservations')) into catalog_count;
  if catalog_count<1 then raise exception 'CATALOG_LOAD_FAILED'; end if;
  select jsonb_array_length(public.list_module_permission_grants(actor_binding.device_id,'reservations',target_id)->'grants') into listed_count;
  if listed_count<>0 then raise exception 'FIXTURE_GRANTS_NOT_EMPTY'; end if;

  grant_result:=public.manage_catalog_module_grant(actor_binding.device_id,operation_grant,'grant',target_id,'reservations','reservations.module.access',null,null,null,null);
  grant_id:=(grant_result->>'grantId')::uuid;
  perform public.manage_catalog_module_grant(actor_binding.device_id,operation_grant,'grant',target_id,'reservations','reservations.module.access',null,null,null,null);
  select count(*) into audit_count from platform.audit_events where entity_id=grant_id and action='permission.granted';
  if audit_count<>1 then raise exception 'GRANT_AUDIT_COUNT_INVALID:%',audit_count; end if;
  select jsonb_array_length(public.list_module_permission_grants(actor_binding.device_id,'reservations',target_id)->'grants') into listed_count;
  if listed_count<>1 then raise exception 'GRANT_VISIBILITY_FAILED'; end if;

  perform public.manage_catalog_module_grant(actor_binding.device_id,operation_revoke,'revoke',target_id,'reservations','reservations.module.access',null,null,grant_id,'regression');
  perform public.manage_catalog_module_grant(actor_binding.device_id,operation_revoke,'revoke',target_id,'reservations','reservations.module.access',null,null,grant_id,'regression replay');
  select count(*) into audit_count from platform.audit_events where entity_id=grant_id and action='permission.revoked';
  if audit_count<>1 then raise exception 'REVOKE_AUDIT_COUNT_INVALID:%',audit_count; end if;
  if not exists(select 1 from platform.audit_events where entity_id=grant_id and actor_user_id=actor_binding.user_id
    and actor_device_authorization_id=actor_binding.device_authorization_id and subject_user_id=target_id
    and module='reservations' and operation_id=operation_revoke
    and old_values->>'permissionKey'='reservations.module.access'
    and old_values->>'grantScope'='module') then raise exception 'REVOKE_AUDIT_PAYLOAD_INVALID'; end if;

  begin
    perform platform.execute_device_operation(actor_binding.user_id,v_session_id,token_hash,'platform','manage_foundation_module_grant','{}'::jsonb);
    raise exception 'LEGACY_OPERATION_ACCEPTED';
  exception when insufficient_privilege then
    if sqlerrm<>'PLATFORM_OPERATION_NOT_ALLOWED' then raise; end if;
  end;
  begin
    perform platform.execute_device_operation(actor_binding.user_id,v_session_id,token_hash,'platform','list_module_permission_grants',jsonb_build_object(
      'p_module_key','reservations','p_target_user_id',target_id,'p_actor_device_id',actor_binding.device_id));
    raise exception 'FORGED_DEVICE_ACCEPTED';
  exception when invalid_parameter_value then
    if sqlerrm<>'ACTOR_DEVICE_OVERRIDE_DENIED' then raise; end if;
  end;
  begin
    perform public.list_module_permission_catalog_for_administration('00000000-0000-4000-8000-000000000099'::uuid,'reservations');
    raise exception 'UNAPPROVED_DEVICE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  raise notice 'platform permission audit Development regression: PASS (catalog %, grants %, audit grant/revoke 1/1)',catalog_count,listed_count;
end $$;

rollback;
