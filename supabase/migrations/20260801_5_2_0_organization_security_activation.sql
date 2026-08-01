begin;

-- P0.2B activates read-only Organization security. P0.2A must be deployed
-- and verified before this migration is applied.
-- This migration intentionally does not modify conference ownership,
-- conference membership, existing conference policies, or runtime behavior.

-- Current-user only. This SECURITY DEFINER helper intentionally bypasses RLS
-- solely to prevent recursive policy evaluation on organization_members.
-- Never expose arbitrary-user membership through this function and never
-- expand it into an authorization helper. Any future authority checks must
-- use dedicated audited RPCs.
create or replace function public.is_current_user_organization_member(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and public.is_account_approved(auth.uid())
    and exists (
      select 1
        from public.organization_members as members
       where members.organization_id = target_organization_id
         and members.user_id = auth.uid()
    );
$$;

-- The only browser-facing Organization listing is limited to the caller's
-- own approved memberships. It accepts no user ID or organization ID input.
create or replace function public.list_my_organizations()
returns table (
  id uuid,
  organization_key text,
  display_name text,
  is_default boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    organizations.id,
    organizations.organization_key,
    organizations.display_name,
    organizations.is_default,
    organizations.created_at
  from public.organizations as organizations
  join public.organization_members as members
    on members.organization_id = organizations.id
  where auth.uid() is not null
    and public.is_account_approved(auth.uid())
    and members.user_id = auth.uid()
  order by organizations.created_at, organizations.id;
$$;

-- SECURITY DEFINER avoids recursive policy evaluation only when the function
-- owner bypasses the Organization tables' RLS as their owner. Do not continue
-- under an unexpected deployment owner or forced-RLS configuration.
do $$
declare
  organization_table_owner oid;
  table_owner_count integer;
  forced_rls_table_count integer;
  helper_owner oid;
  list_owner oid;
begin
  select
    min(classes.relowner::text)::oid,
    count(distinct classes.relowner),
    count(*) filter (where classes.relforcerowsecurity)
    into organization_table_owner, table_owner_count, forced_rls_table_count
    from pg_class as classes
    join pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
   where namespaces.nspname = 'public'
     and classes.relname in ('organizations', 'organization_members');

  if table_owner_count <> 1 or forced_rls_table_count <> 0 then
    raise exception 'P0_2B_ORGANIZATION_RLS_OWNER_INVALID';
  end if;

  select functions.proowner into helper_owner
    from pg_proc as functions
   where functions.oid =
     'public.is_current_user_organization_member(uuid)'::regprocedure;

  select functions.proowner into list_owner
    from pg_proc as functions
   where functions.oid = 'public.list_my_organizations()'::regprocedure;

  if helper_owner is distinct from organization_table_owner
    or list_owner is distinct from organization_table_owner then
    raise exception 'P0_2B_SECURITY_DEFINER_OWNER_INVALID';
  end if;
end;
$$;

revoke all on function public.is_current_user_organization_member(uuid)
  from public, anon;
revoke all on function public.list_my_organizations()
  from public, anon;
grant execute on function public.is_current_user_organization_member(uuid)
  to authenticated;
grant execute on function public.list_my_organizations()
  to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create policy organizations_select_approved_member
on public.organizations for select
to authenticated
using (
  public.is_account_approved(auth.uid())
  and public.is_current_user_organization_member(id)
);

create policy organization_members_select_approved_member
on public.organization_members for select
to authenticated
using (
  public.is_account_approved(auth.uid())
  and public.is_current_user_organization_member(organization_id)
);

-- P0.2A revoked all browser access. P0.2B grants read-only table access so
-- the approved-member RLS policies can govern it; no write privilege exists.
grant select on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;

commit;
