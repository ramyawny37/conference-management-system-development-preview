# System Owner Bootstrap

Use these instructions only after applying:

`20260730_5_0_0_system_access_foundation.sql`

Run the commands from the Supabase SQL Editor with an administrator account.
Do not put a service-role key, password, email address, or fixed user UUID in
application source code or an RLS policy.

## 1. Find the intended user's UUID

Replace the email parameter only in the SQL Editor:

```sql
select id, email, created_at
from auth.users
where lower(email) = lower('OWNER_EMAIL_HERE');
```

Confirm that exactly one expected account is returned. Copy its `id`.

## 2. Bootstrap the first System Owner

Replace `OWNER_USER_UUID_HERE` in all three locations below. Run the complete
transaction as one command:

```sql
begin;

insert into public.system_user_access (
  user_id,
  account_status,
  can_create_conferences,
  approved_by,
  approved_at,
  blocked_by,
  blocked_at
)
values (
  'OWNER_USER_UUID_HERE'::uuid,
  'approved',
  true,
  'OWNER_USER_UUID_HERE'::uuid,
  now(),
  null,
  null
)
on conflict (user_id) do update
set account_status = 'approved',
    can_create_conferences = true,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    blocked_by = null,
    blocked_at = null;

insert into public.system_user_roles (
  user_id,
  role,
  granted_by
)
values (
  'OWNER_USER_UUID_HERE'::uuid,
  'system_owner',
  'OWNER_USER_UUID_HERE'::uuid
)
on conflict (user_id, role) do nothing;

insert into public.system_access_audit_log (
  actor_user_id,
  target_user_id,
  action,
  old_values,
  new_values
)
values (
  'OWNER_USER_UUID_HERE'::uuid,
  'OWNER_USER_UUID_HERE'::uuid,
  'bootstrap_system_owner',
  '{}'::jsonb,
  jsonb_build_object(
    'account_status', 'approved',
    'can_create_conferences', true,
    'role', 'system_owner'
  )
);

commit;
```

If any statement fails, run `rollback;` if the transaction remains open, fix
the UUID, and rerun the complete transaction.

## 3. Verify the result

```sql
select
  access.user_id,
  access.account_status,
  access.can_create_conferences,
  roles.role
from public.system_user_access as access
left join public.system_user_roles as roles
  on roles.user_id = access.user_id
where access.user_id = 'OWNER_USER_UUID_HERE'::uuid;
```

Expected result:

- `account_status = approved`
- `can_create_conferences = true`
- one row with `role = system_owner`

Also verify the audit entry:

```sql
select actor_user_id, target_user_id, action, created_at
from public.system_access_audit_log
where target_user_id = 'OWNER_USER_UUID_HERE'::uuid
order by created_at desc
limit 5;
```

## 4. Read-only post-migration audit

The following query returns aggregate checks without modifying data:

```sql
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
```

After migration and bootstrap, both of these must be zero:

- `conference_owners_not_approved`
- `conference_owners_cannot_create`
