-- P0.2A read-only verification.  Run after applying
-- 20260801_5_1_0_organization_foundation.sql.
select 'organizations_total' as check_name, count(*)::bigint as result
from public.organizations
union all
select 'default_organizations', count(*)::bigint
from public.organizations
where is_default
union all
select 'conference_organization_missing', count(*)::bigint
from public.conferences
where organization_id is null
union all
select 'conference_owners_missing_organization_membership', count(*)::bigint
from public.conferences as conferences
where not exists (
  select 1
    from public.organization_members as members
   where members.organization_id = conferences.organization_id
     and members.user_id = conferences.owner_id
)
union all
select 'owner_id_membership_inconsistencies', count(*)::bigint
from public.conferences as conferences
where not exists (
  select 1
    from public.conference_members as members
   where members.conference_id = conferences.id
     and members.user_id = conferences.owner_id
     and members.role = 'owner'
)
union all
select 'extra_owner_memberships', count(*)::bigint
from public.conference_members as members
join public.conferences as conferences
  on conferences.id = members.conference_id
where members.role = 'owner'
  and members.user_id <> conferences.owner_id;

select
  organizations.id,
  organizations.organization_key,
  organizations.display_name,
  organizations.is_default,
  (
    select count(*)::bigint
    from public.organization_members as members
    where members.organization_id = organizations.id
  ) as member_count,
  (
    select count(*)::bigint
    from public.conferences as conferences
    where conferences.organization_id = organizations.id
  ) as conference_count
from public.organizations as organizations
group by
  organizations.id,
  organizations.organization_key,
  organizations.display_name,
  organizations.is_default
order by organizations.created_at, organizations.id;

-- Expected P0.2A values: one default organization and zero for every
-- inconsistency/missing-backfill aggregate above.
