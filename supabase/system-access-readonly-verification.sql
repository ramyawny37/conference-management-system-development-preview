-- Read-only verification after the System Access migration and owner bootstrap.
select 'system_owners' as check_name, count(*)::bigint as result
from public.system_user_roles where role = 'system_owner'
union all
select 'approved_can_create', count(*)::bigint
from public.system_user_access
where account_status = 'approved' and can_create_conferences
union all
select 'approved_cannot_create', count(*)::bigint
from public.system_user_access
where account_status = 'approved' and not can_create_conferences
union all
select 'pending', count(*)::bigint
from public.system_user_access where account_status = 'pending'
union all
select 'blocked', count(*)::bigint
from public.system_user_access where account_status = 'blocked'
union all
select 'users_missing_system_access', count(*)::bigint
from auth.users as users
where not exists (
  select 1 from public.system_user_access as access
  where access.user_id = users.id
)
union all
select 'conference_owners_not_approved', count(*)::bigint
from (
  select distinct conferences.owner_id
  from public.conferences as conferences
  left join public.system_user_access as access
    on access.user_id = conferences.owner_id
  where access.user_id is null or access.account_status <> 'approved'
) as invalid_owners
union all
select 'conference_owners_cannot_create', count(*)::bigint
from (
  select distinct conferences.owner_id
  from public.conferences as conferences
  join public.system_user_access as access
    on access.user_id = conferences.owner_id
  where not access.can_create_conferences
) as invalid_permissions;
