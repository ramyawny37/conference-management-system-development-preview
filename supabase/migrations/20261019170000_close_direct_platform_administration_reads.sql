-- Development: enforce the canonical device-operation boundary for platform administration reads.
-- Keep both RPCs intact for the service_role-backed Edge dispatcher.
revoke execute on function public.get_user_management_actor_capabilities(uuid)
  from public, anon, authenticated;
revoke execute on function public.search_user_management_users(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_user_management_actor_capabilities(uuid)
  to service_role;
grant execute on function public.search_user_management_users(uuid, text, text, integer)
  to service_role;
