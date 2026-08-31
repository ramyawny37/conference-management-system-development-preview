-- Recovery-specific state lookup. This does not create, consume, or mutate a recovery.
create or replace function public.get_stable_development_platform_device_recovery_state(
  p_actor_user_id uuid, p_actor_device_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare recovery platform_private.stable_device_recovery_authorizations%rowtype;
  credential public.device_security_credentials%rowtype;
begin
  perform public.require_platform_device_backend();
  select * into recovery
  from platform_private.stable_device_recovery_authorizations recovery_item
  where recovery_item.owner_user_id = p_actor_user_id
    and recovery_item.actor_public_device_id = p_actor_device_id
    and recovery_item.environment = 'development_preview'
    and recovery_item.expected_origin = 'https://ramyawny37.github.io'
    and recovery_item.expected_rp_id = 'ramyawny37.github.io'
    and recovery_item.consumed_at is null
    and pg_catalog.statement_timestamp() between recovery_item.issued_at and recovery_item.expires_at;
  if not found then
    raise exception 'STABLE_DEVICE_RECOVERY_AUTHORIZATION_INVALID' using errcode='42501';
  end if;
  credential := public.require_system_owner_webauthn_actor(
    p_actor_user_id,p_actor_device_id,recovery.credential_id
  );
  if (credential.backup_state and not credential.backup_eligible)
    or credential.user_verification_policy <> 'required' then
    raise exception 'STABLE_DEVICE_RECOVERY_CREDENTIAL_POLICY_INVALID' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('status','ready','credentialId',credential.id);
end;
$$;

revoke all on function public.get_stable_development_platform_device_recovery_state(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_stable_development_platform_device_recovery_state(uuid,uuid)
  to service_role;
