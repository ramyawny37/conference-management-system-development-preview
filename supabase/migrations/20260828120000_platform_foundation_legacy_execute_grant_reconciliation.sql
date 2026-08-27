begin;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.enforce_launch_conference_member_contract() from public, anon, authenticated;
revoke execute on function public.prevent_null_conference_organization() from public, anon, authenticated;

revoke execute on function public.acquire_conference_lock(uuid, uuid, uuid, integer) from anon;
revoke execute on function public.renew_conference_lock(uuid, uuid, uuid, integer) from anon;
revoke execute on function public.release_conference_lock(uuid, uuid, uuid) from anon;
revoke execute on function public.get_conference_lock(uuid, uuid) from anon;
revoke execute on function public.get_conference_section_lock(uuid, text, uuid) from anon;
revoke execute on function public.is_conference_member(uuid) from anon;
revoke execute on function public.has_conference_role(uuid, text[]) from anon;
revoke execute on function public.is_conference_owner(uuid) from anon;

commit;
