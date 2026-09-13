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
