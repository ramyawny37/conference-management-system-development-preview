begin;

revoke execute on function public.acquire_conference_lock(uuid, uuid, uuid, integer)
  from authenticated;
revoke execute on function public.get_conference_lock(uuid, uuid)
  from authenticated;
revoke execute on function public.get_my_conference_access(uuid)
  from authenticated;
revoke execute on function public.get_my_organization_access(uuid)
  from authenticated;
revoke execute on function public.list_conference_members(uuid)
  from authenticated;
revoke execute on function public.list_my_organizations()
  from authenticated;
revoke execute on function public.list_organization_members(uuid)
  from authenticated;
revoke execute on function public.lookup_conference_user_by_email(uuid, text)
  from authenticated;
revoke execute on function public.lookup_organization_candidate_by_email(uuid, text)
  from authenticated;
revoke execute on function public.release_conference_lock(uuid, uuid, uuid)
  from authenticated;
revoke execute on function public.renew_conference_lock(uuid, uuid, uuid, integer)
  from authenticated;

commit;
