begin;

create or replace function platform_private.reconcile_system_user_access_profile(
  p_access public.system_user_access
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approved_at timestamptz;
  v_blocked_at timestamptz;
  v_status_changed_at timestamptz;
  v_status_changed_by uuid;
begin
  if p_access.user_id is null
     or p_access.account_status not in ('pending', 'approved', 'blocked') then
    raise exception 'SYSTEM_ACCESS_PROFILE_RECONCILIATION_INVALID'
      using errcode = '22023';
  end if;

  v_approved_at := case when p_access.account_status = 'approved'
    then coalesce(p_access.approved_at, p_access.updated_at, p_access.created_at)
    else p_access.approved_at end;
  v_blocked_at := case when p_access.account_status = 'blocked'
    then coalesce(p_access.blocked_at, p_access.updated_at, p_access.created_at)
    else p_access.blocked_at end;
  v_status_changed_at := coalesce(
    case p_access.account_status
      when 'approved' then v_approved_at
      when 'blocked' then v_blocked_at
      else p_access.updated_at
    end,
    p_access.updated_at,
    p_access.created_at,
    statement_timestamp()
  );
  v_status_changed_by := case p_access.account_status
    when 'approved' then p_access.approved_by
    when 'blocked' then p_access.blocked_by
    else null
  end;

  insert into platform.profiles (
    user_id, account_status, status_changed_at, status_changed_by,
    approved_at, approved_by, blocked_at, blocked_by
  ) values (
    p_access.user_id, p_access.account_status, v_status_changed_at,
    v_status_changed_by, v_approved_at, p_access.approved_by,
    v_blocked_at, p_access.blocked_by
  )
  on conflict (user_id) do update
    set account_status = excluded.account_status,
        status_changed_at = excluded.status_changed_at,
        status_changed_by = excluded.status_changed_by,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        blocked_at = excluded.blocked_at,
        blocked_by = excluded.blocked_by,
        updated_at = statement_timestamp()
  where platform.profiles.account_status is distinct from excluded.account_status
     or platform.profiles.status_changed_at is distinct from excluded.status_changed_at
     or platform.profiles.status_changed_by is distinct from excluded.status_changed_by
     or platform.profiles.approved_at is distinct from excluded.approved_at
     or platform.profiles.approved_by is distinct from excluded.approved_by
     or platform.profiles.blocked_at is distinct from excluded.blocked_at
     or platform.profiles.blocked_by is distinct from excluded.blocked_by;
end;
$$;

revoke all on function platform_private.reconcile_system_user_access_profile(
  public.system_user_access
) from public, anon, authenticated, service_role;

-- Establish profile identities first so copied legacy actor references always
-- satisfy the Platform profile foreign keys. Existing profile data is untouched.
insert into platform.profiles (user_id, display_name)
select users.id,
  nullif(btrim(coalesce(
    users.raw_user_meta_data->>'display_name',
    users.raw_user_meta_data->>'name',
    ''
  )), '')
from auth.users as users
on conflict (user_id) do nothing;

do $$
declare
  access_row public.system_user_access%rowtype;
begin
  for access_row in
    select access.* from public.system_user_access as access
    order by access.user_id
  loop
    perform platform_private.reconcile_system_user_access_profile(access_row);
  end loop;
end;
$$;

create or replace function platform_private.reconcile_system_user_access_profile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform platform_private.reconcile_system_user_access_profile(new);
  return new;
end;
$$;

revoke all on function platform_private.reconcile_system_user_access_profile_trigger()
  from public, anon, authenticated, service_role;

drop trigger if exists system_user_access_reconcile_platform_profile
  on public.system_user_access;
create trigger system_user_access_reconcile_platform_profile
after insert or update of
  account_status, approved_at, approved_by, blocked_at, blocked_by
on public.system_user_access
for each row execute function
  platform_private.reconcile_system_user_access_profile_trigger();

commit;
