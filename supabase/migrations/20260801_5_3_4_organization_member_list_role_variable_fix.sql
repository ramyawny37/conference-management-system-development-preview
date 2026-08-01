begin;

-- P0.2D corrective migration: CURRENT_ROLE is a PostgreSQL special value.
-- Replace only the existing Organization member-list RPC with an unambiguous
-- caller membership variable; preserve its signature, rows, and ordering.
create or replace function public.list_organization_members(p_organization_id uuid)
returns table (user_id uuid, display_name text, role text, created_at timestamptz,
  is_current_user boolean)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  caller_organization_role text;
begin
  if current_user_id is null or p_organization_id is null
    or not public.is_account_approved(current_user_id) then
    raise exception 'organization authorization required';
  end if;

  select members.role into caller_organization_role
  from public.organization_members as members
  where members.organization_id = p_organization_id
    and members.user_id = current_user_id;

  if caller_organization_role not in ('organization_owner', 'organization_admin') then
    raise exception 'organization administration role required';
  end if;

  return query
  select members.user_id, profiles.display_name, members.role,
    members.created_at, members.user_id = current_user_id
  from public.organization_members as members
  left join public.profiles as profiles on profiles.id = members.user_id
  where members.organization_id = p_organization_id
  order by case members.role when 'organization_owner' then 0
    when 'organization_admin' then 1 else 2 end, members.created_at, members.user_id;
end;
$$;

revoke all on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.list_organization_members(uuid) to authenticated;

-- Fail closed unless the corrected function remains within the P0.2D browser
-- RPC execution boundary and its persisted definition uses the member role.
do $$
declare
  protected_owner oid;
  protected_table_count integer;
  protected_owner_count integer;
  force_rls_count integer;
  function_owner oid;
  security_definer boolean;
  function_settings text[];
  authenticated_execute boolean;
  anon_execute boolean;
  public_execute boolean;
  function_definition text;
begin
  select min(classes.relowner::text)::oid, count(*), count(distinct classes.relowner),
    count(*) filter (where classes.relforcerowsecurity)
    into protected_owner, protected_table_count, protected_owner_count, force_rls_count
  from pg_class as classes
  join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
  where namespaces.nspname = 'public' and classes.relkind = 'r'
    and classes.relname in (
      'organizations', 'organization_members', 'system_user_access', 'profiles'
    );

  if protected_table_count <> 4 or protected_owner_count <> 1 or force_rls_count <> 0 then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_PROTECTED_TABLE_INVALID';
  end if;

  select functions.proowner, functions.prosecdef, functions.proconfig,
    has_function_privilege('authenticated', functions.oid, 'execute'),
    has_function_privilege('anon', functions.oid, 'execute'),
    has_function_privilege('public', functions.oid, 'execute'),
    pg_get_functiondef(functions.oid)
    into function_owner, security_definer, function_settings,
      authenticated_execute, anon_execute, public_execute, function_definition
  from pg_proc as functions
  join pg_namespace as namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.oid = to_regprocedure('public.list_organization_members(uuid)');

  if function_owner is null then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_FUNCTION_MISSING';
  end if;
  if function_owner <> protected_owner then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_OWNER_INVALID';
  end if;
  if not security_definer then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_SECURITY_DEFINER_INVALID';
  end if;
  if not (function_settings @> array['search_path=pg_catalog, public']::text[]) then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_SEARCH_PATH_INVALID';
  end if;
  if not authenticated_execute or anon_execute or public_execute then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_GRANT_INVALID';
  end if;
  if function_definition !~ $pattern$caller_organization_role[[:space:]]+text$pattern$
    or function_definition ~ $pattern$\mcurrent_role\M$pattern$
    or function_definition !~
      $pattern$select[[:space:]]+members\.role[[:space:]]+into[[:space:]]+caller_organization_role$pattern$
    or function_definition !~
      $pattern$caller_organization_role[[:space:]]+not[[:space:]]+in[[:space:]]*\([[:space:]]*'organization_owner'[[:space:]]*,[[:space:]]*'organization_admin'\)$pattern$
    or function_definition !~
      $pattern$order[[:space:]]+by[[:space:]]+case[[:space:]]+members\.role[[:space:]]+when[[:space:]]+'organization_owner'$pattern$ then
    raise exception 'P0_2D_MEMBER_LIST_ROLE_FIX_DEFINITION_INVALID';
  end if;
end;
$$;

commit;
