-- NON-DESTRUCTIVE PRIVILEGE-FIRST DISABLE ASSET.
-- Precondition: apply only after the complete Phase 4E migration has committed.
-- Apply only if the Phase 4E entry points must be disabled after deployment.
-- This preserves tables, catalog history, grants, operations, audit history, and hardening.

begin;

revoke all on function public.recover_revoke_final_module_manager(
  uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;

revoke all on function public.manage_catalog_module_grant(
  uuid, uuid, text, uuid, text, text, text, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.require_effective_module_permission(
  uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.validate_module_permission_catalog(
  text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.protect_module_permission_catalog_history()
  from public, anon, authenticated;
revoke all on table public.module_permission_catalog
  from public, anon, authenticated;

commit;
