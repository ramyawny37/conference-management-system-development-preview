-- Reconcile the Conference legacy authorization guard with the authoritative
-- Platform device only when the request proves the HttpOnly device secret.
create or replace function public.require_current_approved_device(
  p_actor_device_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  platform_authorization_id uuid;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_actor_device_id is null then
    raise exception 'DEVICE_REQUIRED' using errcode = '22023';
  end if;
  if not public.is_account_approved(current_user_id) then
    raise exception 'SYSTEM_ACCESS_APPROVED_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.user_device_authorizations as authorizations
     where authorizations.user_id = current_user_id
       and authorizations.device_id = p_actor_device_id
       and authorizations.authorization_status = 'approved'
       and authorizations.revoked_at is null
  ) then
    return current_user_id;
  end if;

  platform_authorization_id := platform_private.current_device_authorization_id(current_user_id);
  if platform_authorization_id is null
     or platform_private.request_device_id() is distinct from p_actor_device_id then
    raise exception 'APPROVED_DEVICE_REQUIRED' using errcode = '42501';
  end if;

  return current_user_id;
end;
$$;

revoke all on function public.require_current_approved_device(uuid)
  from public, anon, authenticated;
