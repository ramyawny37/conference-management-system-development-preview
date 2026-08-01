begin;

-- P0.2A is intentionally additive.  It introduces an organization boundary
-- without changing the existing conference ownership contract.
-- Prerequisite: the approved P0.1 schema must already be deployed, including
-- public.conferences, public.system_user_access, auth.users, and
-- pgcrypto/gen_random_uuid().
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  organization_key text not null unique
    check (btrim(organization_key) <> ''),
  display_name text not null
    check (btrim(display_name) <> ''),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index organizations_single_default_idx
  on public.organizations ((is_default))
  where is_default;

-- This table records organization membership only.  It does not define or
-- replace conference ownership, conference roles, or System Access roles.
create table public.organization_members (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members(user_id, organization_id);

-- Nullable by design in P0.2A: existing runtime code remains compatible and
-- later phases may add enforcement only after the transition is approved.
alter table public.conferences
  add column organization_id uuid null
    references public.organizations(id);

create index conferences_organization_id_idx
  on public.conferences(organization_id);

-- Organization tables remain unavailable to browser roles until P0.2B.  This
-- does not enable RLS or create any Organization-scoped policy.
revoke all on table public.organizations
  from public, anon, authenticated;
revoke all on table public.organization_members
  from public, anon, authenticated;

-- The stable key makes this default-organization seed safe to repeat.
insert into public.organizations (
  organization_key,
  display_name,
  is_default
)
values (
  'default',
  'Default Organization',
  true
)
on conflict (organization_key) do update
set is_default = true;

-- Idempotent conference backfill.  It never changes a non-null assignment.
update public.conferences as conferences
   set organization_id = default_organization.id
  from public.organizations as default_organization
 where default_organization.organization_key = 'default'
   and default_organization.is_default
   and conferences.organization_id is null;

-- Idempotent approved-account backfill. Membership is deliberately
-- independent of conferences.owner_id and conference_members.role.
insert into public.organization_members (organization_id, user_id)
select default_organization.id, access.user_id
  from public.organizations as default_organization
  join public.system_user_access as access
    on access.account_status = 'approved'
 where default_organization.organization_key = 'default'
   and default_organization.is_default
on conflict (organization_id, user_id) do nothing;

-- Fail closed if a partial/manual execution cannot establish the P0.2A base.
do $$
declare
  default_organization_count integer;
  conferences_without_organization integer;
  conference_owners_without_membership integer;
begin
  select count(*)
    into default_organization_count
    from public.organizations
   where is_default;

  if default_organization_count <> 1 then
    raise exception 'P0_2A_DEFAULT_ORGANIZATION_INVALID';
  end if;

  select count(*)
    into conferences_without_organization
    from public.conferences
   where organization_id is null;

  if conferences_without_organization <> 0 then
    raise exception 'P0_2A_CONFERENCE_BACKFILL_INCOMPLETE';
  end if;

  select count(*)
    into conference_owners_without_membership
    from public.conferences as conferences
   where not exists (
     select 1
       from public.organization_members as members
      where members.organization_id = conferences.organization_id
        and members.user_id = conferences.owner_id
   );

  if conference_owners_without_membership <> 0 then
    raise exception 'P0_2A_OWNER_MEMBERSHIP_BACKFILL_INCOMPLETE';
  end if;
end;
$$;

commit;
