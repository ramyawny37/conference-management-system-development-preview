begin;

-- P0.2D exposes the minimum browser-facing Organization reads as RPCs. The
-- browser never reads organization, membership, operation, or audit tables.
create or replace function public.get_my_organization_access(
  p_organization_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  current_role text;
begin
  if current_user_id is null or p_organization_id is null
    or not public.is_account_approved(current_user_id) then
    return jsonb_build_object('organization_id', p_organization_id,
      'current_user_role', null, 'can_manage_members', false,
      'can_manage_admins', false, 'can_manage_owners', false);
  end if;
  select members.role into current_role
  from public.organization_members as members
  where members.organization_id = p_organization_id
    and members.user_id = current_user_id;
  return jsonb_build_object('organization_id', p_organization_id,
    'current_user_role', current_role,
    'can_manage_members', current_role in ('organization_owner','organization_admin'),
    'can_manage_admins', current_role = 'organization_owner',
    'can_manage_owners', current_role = 'organization_owner');
end;
$$;

create or replace function public.list_organization_members(p_organization_id uuid)
returns table (user_id uuid, display_name text, role text, created_at timestamptz,
  is_current_user boolean)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare current_user_id uuid := auth.uid(); current_role text;
begin
  if current_user_id is null or p_organization_id is null
    or not public.is_account_approved(current_user_id) then
    raise exception 'organization authorization required';
  end if;
  select members.role into current_role from public.organization_members as members
  where members.organization_id = p_organization_id and members.user_id = current_user_id;
  if current_role not in ('organization_owner','organization_admin') then
    raise exception 'organization administration role required';
  end if;
  return query select members.user_id, profiles.display_name, members.role,
    members.created_at, members.user_id = current_user_id
  from public.organization_members members
  left join public.profiles profiles on profiles.id = members.user_id
  where members.organization_id = p_organization_id
  order by case members.role when 'organization_owner' then 0
    when 'organization_admin' then 1 else 2 end, members.created_at, members.user_id;
end;
$$;

create or replace function public.lookup_organization_candidate_by_email(
  p_organization_id uuid, p_email text
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid(); current_role text;
  candidate_id uuid; candidate_name text; candidate_membership_status text;
begin
  if current_user_id is null or p_organization_id is null
    or nullif(btrim(coalesce(p_email, '')), '') is null
    or not public.is_account_approved(current_user_id) then
    return jsonb_build_object('status','unavailable','organization_id',p_organization_id,
      'target_user_id',null,'display_name',null,'membership_status','not_member');
  end if;
  select members.role into current_role from public.organization_members members
  where members.organization_id = p_organization_id and members.user_id = current_user_id;
  if current_role not in ('organization_owner', 'organization_admin') then
    return jsonb_build_object('status','unavailable','organization_id',p_organization_id,
      'target_user_id',null,'display_name',null,'membership_status','not_member');
  end if;
  select users.id, profiles.display_name into candidate_id, candidate_name
  from auth.users users
  join public.system_user_access access on access.user_id = users.id
    and access.account_status = 'approved'
  left join public.profiles profiles on profiles.id = users.id
  where lower(users.email) = lower(btrim(p_email)) order by users.created_at limit 1;
  if not found then
    return jsonb_build_object('status','unavailable','organization_id',p_organization_id,
      'target_user_id',null,'display_name',null,'membership_status','not_member');
  end if;
  select case when exists (
    select 1 from public.organization_members as members
    where members.organization_id = p_organization_id and members.user_id = candidate_id
  ) then 'member' else 'not_member' end into candidate_membership_status;
  return jsonb_build_object('status','candidate','organization_id',p_organization_id,
    'target_user_id',candidate_id,'display_name',candidate_name,
    'membership_status',candidate_membership_status);
end;
$$;

revoke all on function public.get_my_organization_access(uuid) from public, anon;
revoke all on function public.list_organization_members(uuid) from public, anon;
revoke all on function public.lookup_organization_candidate_by_email(uuid,text) from public, anon;
grant execute on function public.get_my_organization_access(uuid) to authenticated;
grant execute on function public.list_organization_members(uuid) to authenticated;
grant execute on function public.lookup_organization_candidate_by_email(uuid,text) to authenticated;

-- Fail closed unless the new browser RPCs preserve the P0.2B/P0.2C
-- SECURITY DEFINER deployment boundary.
do $$
declare
  protected_owner oid;
  protected_table_count integer;
  protected_owner_count integer;
  forced_rls_count integer;
  expected_function_count integer := 3;
  existing_function_count integer;
  mismatched_function_count integer;
  non_security_definer_count integer;
  invalid_search_path_count integer;
  invalid_browser_grant_count integer;
begin
  select min(classes.relowner::text)::oid, count(*), count(distinct classes.relowner),
    count(*) filter (where classes.relforcerowsecurity)
    into protected_owner, protected_table_count, protected_owner_count, forced_rls_count
  from pg_class as classes
  join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
  where namespaces.nspname = 'public' and classes.relkind = 'r'
    and classes.relname in (
      'organizations', 'organization_members', 'system_user_access', 'profiles'
    );

  if protected_table_count <> 4 then
    raise exception 'P0_2D_PROTECTED_TABLE_MISSING';
  end if;
  if protected_owner_count <> 1 then
    raise exception 'P0_2D_PROTECTED_TABLE_OWNER_INVALID';
  end if;
  if forced_rls_count <> 0 then
    raise exception 'P0_2D_PROTECTED_TABLE_FORCE_RLS_INVALID';
  end if;

  select
    count(*),
    count(*) filter (where functions.proowner <> protected_owner),
    count(*) filter (where not functions.prosecdef),
    count(*) filter (where not (
      functions.proconfig @> array['search_path=pg_catalog, public']::text[]
    )),
    count(*) filter (where
      not has_function_privilege('authenticated', functions.oid, 'execute')
      or has_function_privilege('anon', functions.oid, 'execute')
      or has_function_privilege('public', functions.oid, 'execute')
    )
    into existing_function_count, mismatched_function_count,
      non_security_definer_count, invalid_search_path_count,
      invalid_browser_grant_count
  from pg_proc as functions
  join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public' and functions.oid in (
    to_regprocedure('public.get_my_organization_access(uuid)'),
    to_regprocedure('public.list_organization_members(uuid)'),
    to_regprocedure('public.lookup_organization_candidate_by_email(uuid,text)')
  );

  if existing_function_count <> expected_function_count then
    raise exception 'P0_2D_SECURITY_DEFINER_FUNCTION_MISSING';
  end if;
  if mismatched_function_count <> 0 then
    raise exception 'P0_2D_SECURITY_DEFINER_OWNER_INVALID';
  end if;
  if non_security_definer_count <> 0 then
    raise exception 'P0_2D_SECURITY_DEFINER_MODE_INVALID';
  end if;
  if invalid_search_path_count <> 0 then
    raise exception 'P0_2D_SECURITY_DEFINER_SEARCH_PATH_INVALID';
  end if;
  if invalid_browser_grant_count <> 0 then
    raise exception 'P0_2D_BROWSER_RPC_GRANT_INVALID';
  end if;
end;
$$;

commit;
