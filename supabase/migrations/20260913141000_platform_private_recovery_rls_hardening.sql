-- Defense-in-depth hardening for private recovery / ownership state.
-- These tables are internal-only and are accessed through narrowly granted SECURITY DEFINER entrypoints.
-- Match the existing platform_private device-session posture: FORCE RLS with no direct policies/grants.

begin;

alter table platform_private.stable_device_recovery_authorizations enable row level security;
alter table platform_private.stable_device_recovery_authorizations force row level security;
revoke all on platform_private.stable_device_recovery_authorizations from public, anon, authenticated, service_role;

alter table platform_private.stable_device_recovery_challenges enable row level security;
alter table platform_private.stable_device_recovery_challenges force row level security;
revoke all on platform_private.stable_device_recovery_challenges from public, anon, authenticated, service_role;

alter table platform_private.stable_device_recovery_audit enable row level security;
alter table platform_private.stable_device_recovery_audit force row level security;
revoke all on platform_private.stable_device_recovery_audit from public, anon, authenticated, service_role;

alter table platform_private.device_ownership_handoff_challenges enable row level security;
alter table platform_private.device_ownership_handoff_challenges force row level security;
revoke all on platform_private.device_ownership_handoff_challenges from public, anon, authenticated, service_role;

alter table platform_private.device_ownership_handoff_audit enable row level security;
alter table platform_private.device_ownership_handoff_audit force row level security;
revoke all on platform_private.device_ownership_handoff_audit from public, anon, authenticated, service_role;

alter table platform_private.zero_approved_owner_device_recovery_operations enable row level security;
alter table platform_private.zero_approved_owner_device_recovery_operations force row level security;
revoke all on platform_private.zero_approved_owner_device_recovery_operations from public, anon, authenticated, service_role;

commit;
