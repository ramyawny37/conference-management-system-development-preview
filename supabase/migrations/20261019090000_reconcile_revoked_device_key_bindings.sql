begin;

-- Reconcile historical key bindings that predate the canonical revocation
-- lifecycle. Never modify approved/pending device bindings.
update platform.device_key_bindings as binding
set lifecycle_status = 'revoked',
    revoked_at = coalesce(authz.revoked_at, statement_timestamp())
from platform.user_device_authorizations as authz
where authz.id = binding.device_authorization_id
  and authz.user_id = binding.user_id
  and authz.device_id = binding.device_id
  and authz.status = 'revoked'
  and binding.lifecycle_status = 'active'
  and binding.revoked_at is null;

-- The canonical dispatcher also verifies authorization status on each call.
-- Guard against any future binding that would contradict a revoked approval.
create or replace function platform_private.prevent_active_binding_for_revoked_device()
returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.lifecycle_status = 'active' and exists (
    select 1 from platform.user_device_authorizations as authz
    where authz.id = new.device_authorization_id
      and authz.user_id = new.user_id
      and authz.device_id = new.device_id
      and (authz.status = 'revoked' or authz.revoked_at is not null)
  ) then
    raise exception 'DEVICE_AUTHORIZATION_REVOKED'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_active_binding_for_revoked_device
on platform.device_key_bindings;

create trigger prevent_active_binding_for_revoked_device
before insert or update of lifecycle_status,device_authorization_id,user_id,device_id
on platform.device_key_bindings
for each row execute function platform_private.prevent_active_binding_for_revoked_device();

commit;
