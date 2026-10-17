begin;

create or replace function public.require_system_owner_webauthn_actor(
  p_actor_user_id uuid,p_actor_device_id uuid,p_credential_id uuid
) returns public.device_security_credentials language plpgsql security definer
set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if not platform_private.is_canonical_platform_owner(p_actor_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  perform platform_private.require_canonical_device_authorization(
    p_actor_user_id,p_actor_device_id,true);
  select * into credential from public.device_security_credentials stored
  where stored.id=p_credential_id and stored.user_id=p_actor_user_id
    and stored.device_id=p_actor_device_id and stored.credential_kind='platform_primary'
    and stored.lifecycle_status='active'
    and stored.user_verification_policy='required'
    and (not stored.backup_state or stored.backup_eligible)
  for update;
  if not found then
    raise exception 'ACTIVE_PLATFORM_CREDENTIAL_REQUIRED' using errcode='42501';
  end if;
  return credential;
end; $$;
revoke all on function public.require_system_owner_webauthn_actor(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.require_system_owner_webauthn_actor(uuid,uuid,uuid)
  to service_role;

create or replace function public.get_system_owner_platform_device_administration_state(
  p_actor_user_id uuid,p_actor_device_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  if not platform_private.is_canonical_platform_owner(p_actor_user_id) then
    raise exception 'APPROVED_SYSTEM_OWNER_DEVICE_REQUIRED' using errcode='42501';
  end if;
  perform platform_private.require_canonical_device_authorization(
    p_actor_user_id,p_actor_device_id,true);
  select * into credential from public.device_security_credentials stored
  where stored.user_id=p_actor_user_id and stored.device_id=p_actor_device_id
    and stored.credential_kind='platform_primary' and stored.lifecycle_status='active'
    and stored.user_verification_policy='required'
    and (not stored.backup_state or stored.backup_eligible)
  order by stored.activated_at desc limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('status','enrollment_required');
  end if;
  return pg_catalog.jsonb_build_object('status','ready','credentialId',credential.id,
    'credentialExternalId',pg_catalog.encode(credential.webauthn_credential_id,'base64'),
    'transports',credential.transports);
end; $$;
revoke all on function public.get_system_owner_platform_device_administration_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_system_owner_platform_device_administration_state(uuid,uuid)
  to service_role;

commit;
