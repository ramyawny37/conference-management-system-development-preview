-- PostgREST executes STABLE RPCs in a read-only transaction.
-- This recovery state RPC calls require_system_owner_webauthn_actor(), which intentionally
-- locks the active WebAuthn credential FOR UPDATE. Mark the wrapper VOLATILE so the
-- backend can execute that locking contract without weakening any authorization checks.

alter function public.get_stable_development_platform_device_recovery_state(uuid, uuid)
  volatile;

-- Preserve the existing backend-only execution boundary explicitly.
revoke all on function public.get_stable_development_platform_device_recovery_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_stable_development_platform_device_recovery_state(uuid, uuid)
  to service_role;
