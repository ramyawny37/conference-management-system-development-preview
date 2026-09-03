-- Phase W1: replace the legacy gateway-cookie handoff with Platform-native key enrollment.

alter table platform.device_key_bindings
  drop constraint device_key_bindings_migration_source_check,
  add constraint device_key_bindings_migration_source_check check (
    migration_source in ('current_http_only_device_secret','bound_key_rotation','privileged_recovery','native_device_enrollment')
  );

create table platform_private.device_enrollment_nonces (
  nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  binding_id uuid not null references platform.device_key_bindings(id) on delete restrict,
  enrolled_at timestamptz not null default statement_timestamp()
);
alter table platform_private.device_enrollment_nonces enable row level security;
alter table platform_private.device_enrollment_nonces force row level security;
revoke all on platform_private.device_enrollment_nonces from public,anon,authenticated,service_role;

create or replace function platform.enroll_new_device_key(
  p_user_id uuid,p_device_id uuid,p_device_secret_hash text,p_public_key_thumbprint text,
  p_public_key_jwk jsonb,p_nonce text,p_display_name text,p_platform text,p_browser text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,platform,platform_private as $$
declare v_authorization uuid; v_binding uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'DEVICE_ENROLLMENT_BACKEND_REQUIRED' using errcode='42501'; end if;
  if p_user_id is null or p_device_id is null or p_device_secret_hash !~ '^[0-9a-f]{64}$'
    or p_public_key_thumbprint !~ '^[0-9a-f]{64}$' or p_nonce !~ '^[A-Za-z0-9_-]{43}$'
    or p_public_key_jwk->>'kty'<>'EC' or p_public_key_jwk->>'crv'<>'P-256'
    or not (p_public_key_jwk ? 'x') or not (p_public_key_jwk ? 'y') or p_public_key_jwk ? 'd' then
    raise exception 'DEVICE_ENROLLMENT_ARGUMENT_INVALID' using errcode='22023';
  end if;
  if not exists(select 1 from platform.profiles where user_id=p_user_id) then
    raise exception 'DEVICE_ENROLLMENT_PROFILE_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('device-enrollment:'||p_user_id::text||':'||p_nonce,0));
  if exists(select 1 from platform_private.device_enrollment_nonces where nonce=p_nonce) then
    raise exception 'DEVICE_ENROLLMENT_REPLAY_DENIED' using errcode='42501';
  end if;
  insert into platform.devices(id,secret_hash,display_name,platform,browser)
  values(p_device_id,p_device_secret_hash,nullif(btrim(p_display_name),''),nullif(btrim(p_platform),''),nullif(btrim(p_browser),''));
  insert into platform.user_device_authorizations(user_id,device_id,status)
  values(p_user_id,p_device_id,'pending') returning id into v_authorization;
  insert into platform.device_key_bindings(user_id,device_id,device_authorization_id,public_key_jwk,
    public_key_thumbprint,algorithm,lifecycle_status,migration_source)
  values(p_user_id,p_device_id,v_authorization,p_public_key_jwk,p_public_key_thumbprint,
    'ECDSA_P256_SHA256','active','native_device_enrollment') returning id into v_binding;
  insert into platform_private.device_enrollment_nonces(nonce,user_id,device_id,binding_id)
  values(p_nonce,p_user_id,p_device_id,v_binding);
  insert into platform.audit_events(actor_user_id,subject_user_id,domain,module,action,entity_type,entity_id,
    scope_type,new_values,metadata,source)
  values(p_user_id,p_user_id,'platform','devices','device.enrolled','user_device_authorization',v_authorization,
    'platform',jsonb_build_object('status','pending'),jsonb_build_object('deviceId',p_device_id,'bindingId',v_binding,
    'publicKeyThumbprint',p_public_key_thumbprint,'enrollment','native_key_possession'),'system');
  return jsonb_build_object('deviceId',p_device_id,'authorizationId',v_authorization,'bindingId',v_binding,
    'publicKeyThumbprint',p_public_key_thumbprint,'status','pending');
end; $$;

create or replace function platform.get_device_key_enrollment_status(p_user_id uuid,p_binding_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,platform as $$
  select coalesce((select jsonb_build_object('deviceId',binding.device_id,'authorizationId',binding.device_authorization_id,
    'bindingId',binding.id,'publicKeyThumbprint',binding.public_key_thumbprint,'status',uda.status,
    'deviceLifecycle',device.lifecycle_status,'bindingLifecycle',binding.lifecycle_status)
    from platform.device_key_bindings binding
    join platform.user_device_authorizations uda on uda.id=binding.device_authorization_id
    join platform.devices device on device.id=binding.device_id
    where binding.id=p_binding_id and binding.user_id=p_user_id and uda.user_id=p_user_id
      and uda.device_id=binding.device_id),jsonb_build_object('status','missing'));
$$;

revoke all on function platform.enroll_new_device_key(uuid,uuid,text,text,jsonb,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function platform.get_device_key_enrollment_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function platform.enroll_new_device_key(uuid,uuid,text,text,jsonb,text,text,text,text) to service_role;
grant execute on function platform.get_device_key_enrollment_status(uuid,uuid) to service_role;

-- The legacy assertion/cookie handoff can no longer be initiated by a browser.
revoke execute on function platform.begin_current_device_ownership_handoff(text) from authenticated;
revoke execute on function platform.get_current_device_handoff_assertion_claims(uuid,text) from authenticated;
