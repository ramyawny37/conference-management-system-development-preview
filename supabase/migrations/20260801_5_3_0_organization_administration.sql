begin;

-- P0.2C: additive Organization administration. This migration does not use
-- conference ownership, conference roles, or conference creation permission.
alter table public.organization_members
  add column role text not null default 'member'
  check (role in ('organization_owner', 'organization_admin', 'member'));

create table public.organization_membership_operations (
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  target_user_id uuid null references auth.users(id) on delete set null,
  target_user_id_snapshot uuid not null,
  operation_id uuid not null,
  action text not null check (action in (
    'add_organization_member', 'remove_organization_member',
    'change_organization_role'
  )),
  requested_role text null check (requested_role is null or requested_role in (
    'organization_owner', 'organization_admin', 'member'
  )),
  outcome text not null check (outcome in (
    'applied', 'unchanged', 'denied', 'invalid_request'
  )),
  stored_result jsonb not null check (jsonb_typeof(stored_result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (organization_id, actor_user_id_snapshot, operation_id),
  check (
    (action = 'add_organization_member' and requested_role is null)
    or (action = 'remove_organization_member' and requested_role is null)
    or (action = 'change_organization_role' and requested_role is not null)
  )
);

create index organization_membership_operations_target_idx
  on public.organization_membership_operations(target_user_id_snapshot, created_at);

create table public.organization_membership_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid null,
  target_user_id uuid null references auth.users(id) on delete set null,
  target_user_id_snapshot uuid not null,
  action text not null check (action in (
    'bootstrap_organization_owner', 'add_organization_member',
    'remove_organization_member', 'change_organization_role'
  )),
  operation_id uuid not null,
  requested_role text null check (requested_role is null or requested_role in (
    'organization_owner', 'organization_admin', 'member'
  )),
  previous_role text null check (previous_role is null or previous_role in (
    'organization_owner', 'organization_admin', 'member'
  )),
  resulting_role text null check (resulting_role is null or resulting_role in (
    'organization_owner', 'organization_admin', 'member'
  )),
  outcome text not null check (outcome in (
    'applied', 'unchanged', 'denied', 'invalid_request',
    'operation_mismatch'
  )),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (action = 'bootstrap_organization_owner'
      and requested_role = 'organization_owner'
      and resulting_role = 'organization_owner')
    or (action = 'add_organization_member'
      and requested_role is null)
    or (action = 'remove_organization_member'
      and requested_role is null)
    or (action = 'change_organization_role'
      and requested_role is not null)
  )
);

create unique index organization_membership_audit_bootstrap_once_idx
  on public.organization_membership_audit_log(
    organization_id, target_user_id_snapshot, action
  ) where action = 'bootstrap_organization_owner';
create index organization_membership_audit_organization_idx
  on public.organization_membership_audit_log(organization_id, created_at);

-- Audit data is immutable. The sole exception preserves historical snapshots
-- when auth.users ON DELETE SET NULL performs its nested FK maintenance.
create or replace function public.prevent_organization_audit_mutation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and pg_trigger_depth() > 1
    and (new.actor_user_id is null or new.actor_user_id = old.actor_user_id)
    and (new.target_user_id is null or new.target_user_id = old.target_user_id)
    and new.actor_user_id_snapshot is not distinct from old.actor_user_id_snapshot
    and new.target_user_id_snapshot is not distinct from old.target_user_id_snapshot
    and new.organization_id is not distinct from old.organization_id
    and new.action is not distinct from old.action
    and new.operation_id is not distinct from old.operation_id
    and new.requested_role is not distinct from old.requested_role
    and new.previous_role is not distinct from old.previous_role
    and new.resulting_role is not distinct from old.resulting_role
    and new.outcome is not distinct from old.outcome
    and new.metadata is not distinct from old.metadata
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  raise exception 'organization membership audit records are immutable';
end;
$$;

create trigger organization_membership_audit_immutable
before update or delete on public.organization_membership_audit_log
for each row execute function public.prevent_organization_audit_mutation();

-- This trigger is a database-level backstop for final-owner protection.
create or replace function public.prevent_final_organization_owner_removal()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare owner_count integer;
begin
  if old.role = 'organization_owner'
    and (tg_op = 'DELETE' or new.role is distinct from 'organization_owner') then
    perform pg_advisory_xact_lock(
      hashtextextended('organization-owner:' || old.organization_id::text, 0)
    );
    select count(*) into owner_count
      from public.organization_members as members
     where members.organization_id = old.organization_id
       and members.role = 'organization_owner';
    if owner_count <= 1 then
      raise exception 'FINAL_ORGANIZATION_OWNER_REQUIRED' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger organization_members_prevent_final_owner_removal
before update or delete on public.organization_members
for each row execute function public.prevent_final_organization_owner_removal();

alter table public.organization_membership_operations enable row level security;
alter table public.organization_membership_audit_log enable row level security;
revoke all on table public.organization_membership_operations,
  public.organization_membership_audit_log from public, anon, authenticated;

-- Deployment-only, explicit bootstrap. No ownership inference is used.
do $$
declare default_organization_id uuid;
  bootstrap_user_id constant uuid := '630c56a1-f6b0-4e49-a4ab-ef426d8966d1';
  bootstrap_operation_id constant uuid := '00000000-0000-0000-0000-0000000002c0';
  previous_role text;
begin
  select id into default_organization_id from public.organizations
   where is_default;
  if not found then raise exception 'P0_2C_DEFAULT_ORGANIZATION_REQUIRED'; end if;
  if (select count(*) from public.organizations where is_default) <> 1 then
    raise exception 'P0_2C_DEFAULT_ORGANIZATION_INVALID';
  end if;
  if not exists (
    select 1 from auth.users as users
     join public.system_user_access as access on access.user_id = users.id
    where users.id = bootstrap_user_id
      and users.email = 'ramyawny37@yahoo.com'
      and access.account_status = 'approved'
  ) then raise exception 'P0_2C_BOOTSTRAP_IDENTITY_INVALID'; end if;
  select role into previous_role from public.organization_members
   where organization_id = default_organization_id and user_id = bootstrap_user_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (default_organization_id, bootstrap_user_id, 'organization_owner')
  on conflict (organization_id, user_id) do update
    set role = 'organization_owner';
  insert into public.organization_membership_audit_log (
    organization_id, target_user_id, target_user_id_snapshot, action,
    operation_id, requested_role, previous_role, resulting_role, outcome,
    metadata
  ) values (
    default_organization_id, bootstrap_user_id, bootstrap_user_id,
    'bootstrap_organization_owner', bootstrap_operation_id,
    'organization_owner', previous_role, 'organization_owner', 'applied',
    jsonb_build_object('source', 'deployment_bootstrap')
  ) on conflict (organization_id, target_user_id_snapshot, action)
    where action = 'bootstrap_organization_owner' do nothing;
end;
$$;

create or replace function public.store_organization_membership_result(
  p_organization_id uuid, p_actor_id uuid, p_target_id uuid,
  p_operation_id uuid, p_action text, p_requested_role text,
  p_previous_role text, p_resulting_role text, p_outcome text,
  p_result jsonb
)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.organization_membership_operations (
    organization_id, actor_user_id, actor_user_id_snapshot, target_user_id,
    target_user_id_snapshot, operation_id, action, requested_role, outcome,
    stored_result
  ) values (
    p_organization_id, p_actor_id, p_actor_id, p_target_id, p_target_id,
    p_operation_id, p_action, p_requested_role, p_outcome, p_result
  );
  insert into public.organization_membership_audit_log (
    organization_id, actor_user_id, actor_user_id_snapshot, target_user_id,
    target_user_id_snapshot, action, operation_id, requested_role,
    previous_role, resulting_role, outcome, metadata
  ) values (
    p_organization_id, p_actor_id, p_actor_id, p_target_id, p_target_id,
    p_action, p_operation_id, p_requested_role, p_previous_role,
    p_resulting_role, p_outcome, jsonb_build_object('source', 'rpc')
  );
end;
$$;

create or replace function public.manage_organization_member(
  p_organization_id uuid, p_target_user_id uuid, p_operation_id uuid,
  p_action text, p_requested_role text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  target_role text;
  target_exists boolean;
  target_approved boolean;
  existing public.organization_membership_operations%rowtype;
  result jsonb;
  outcome text;
  resulting_role text;
begin
  if actor_id is null then
    return jsonb_build_object('status', 'denied', 'errorCode', 'AUTH_REQUIRED');
  end if;
  if p_organization_id is null or p_target_user_id is null or p_operation_id is null
    or p_action not in (
      'add_organization_member', 'remove_organization_member',
      'change_organization_role'
    ) or (p_action = 'change_organization_role' and p_requested_role not in (
      'organization_owner', 'organization_admin', 'member'
    )) or (p_action <> 'change_organization_role' and p_requested_role is not null) then
    return jsonb_build_object('status', 'invalid_request', 'errorCode', 'INVALID_REQUEST');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('organization-membership:' || p_organization_id::text, 0)
  );

  select * into existing
    from public.organization_membership_operations as operations
   where operations.organization_id = p_organization_id
     and operations.actor_user_id_snapshot = actor_id
     and operations.operation_id = p_operation_id;
  if found then
    if existing.action = p_action
      and existing.target_user_id_snapshot = p_target_user_id
      and existing.requested_role is not distinct from p_requested_role then
      return existing.stored_result;
    end if;
    insert into public.organization_membership_audit_log (
      organization_id, actor_user_id, actor_user_id_snapshot, target_user_id,
      target_user_id_snapshot, action, operation_id, requested_role, outcome,
      metadata
    ) values (
      p_organization_id, actor_id, actor_id, p_target_user_id,
      p_target_user_id, p_action, p_operation_id, p_requested_role,
      'operation_mismatch', jsonb_build_object('source', 'rpc')
    );
    return jsonb_build_object('status', 'operation_mismatch',
      'errorCode', 'OPERATION_RESULT_MISMATCH');
  end if;

  select exists(select 1 from auth.users where id = p_target_user_id),
         public.is_account_approved(p_target_user_id)
    into target_exists, target_approved;
  select members.role into actor_role
    from public.organization_members as members
   where members.organization_id = p_organization_id
     and members.user_id = actor_id for update;
  select members.role into target_role
    from public.organization_members as members
   where members.organization_id = p_organization_id
     and members.user_id = p_target_user_id for update;

  if not public.is_account_approved(actor_id) or actor_role is null then
    outcome := 'denied'; resulting_role := target_role;
    result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_AUTHORIZATION_REQUIRED');
  elsif p_action = 'add_organization_member' then
    if actor_role not in ('organization_owner', 'organization_admin') then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_ROLE_REQUIRED');
    elsif target_role is not null then
      outcome := 'unchanged'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'role', target_role);
    elsif not target_exists or not target_approved then
      outcome := 'denied'; resulting_role := null;
      result := jsonb_build_object('status', outcome, 'errorCode', 'TARGET_ACCOUNT_NOT_APPROVED');
    else
      insert into public.organization_members (organization_id, user_id, role)
      values (p_organization_id, p_target_user_id, 'member');
      outcome := 'applied'; resulting_role := 'member';
      result := jsonb_build_object('status', outcome, 'role', resulting_role);
    end if;
  elsif p_action = 'remove_organization_member' then
    if actor_role not in ('organization_owner', 'organization_admin') then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_ROLE_REQUIRED');
    elsif actor_id = p_target_user_id then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'SELF_MUTATION_NOT_ALLOWED');
    elsif target_role is null then
      outcome := 'unchanged'; resulting_role := null;
      result := jsonb_build_object('status', outcome);
    elsif actor_role = 'organization_admin' and target_role <> 'member' then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_ROLE_REQUIRED');
    else
      delete from public.organization_members
       where organization_id = p_organization_id and user_id = p_target_user_id;
      outcome := 'applied'; resulting_role := null;
      result := jsonb_build_object('status', outcome);
    end if;
  else
    if actor_role <> 'organization_owner' then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_OWNER_REQUIRED');
    elsif actor_id = p_target_user_id then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'SELF_MUTATION_NOT_ALLOWED');
    elsif target_role is null then
      outcome := 'invalid_request'; resulting_role := null;
      result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_MEMBER_NOT_FOUND');
    elsif target_role = p_requested_role then
      outcome := 'unchanged'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'role', target_role);
    else
      update public.organization_members set role = p_requested_role
       where organization_id = p_organization_id and user_id = p_target_user_id;
      outcome := 'applied'; resulting_role := p_requested_role;
      result := jsonb_build_object('status', outcome, 'role', resulting_role);
    end if;
  end if;

  perform public.store_organization_membership_result(
    p_organization_id, actor_id,
    case when target_exists then p_target_user_id else null end,
    p_operation_id, p_action, p_requested_role, target_role,
    resulting_role, outcome, result
  );
  return result;
end;
$$;

create or replace function public.add_organization_member(
  p_organization_id uuid, p_target_user_id uuid, p_operation_id uuid
) returns jsonb language sql security definer
set search_path = pg_catalog, public
as $$ select public.manage_organization_member(
  p_organization_id, p_target_user_id, p_operation_id,
  'add_organization_member', null
); $$;

create or replace function public.remove_organization_member(
  p_organization_id uuid, p_target_user_id uuid, p_operation_id uuid
) returns jsonb language sql security definer
set search_path = pg_catalog, public
as $$ select public.manage_organization_member(
  p_organization_id, p_target_user_id, p_operation_id,
  'remove_organization_member', null
); $$;

create or replace function public.change_organization_role(
  p_organization_id uuid, p_target_user_id uuid, p_target_role text,
  p_operation_id uuid
) returns jsonb language sql security definer
set search_path = pg_catalog, public
as $$ select public.manage_organization_member(
  p_organization_id, p_target_user_id, p_operation_id,
  'change_organization_role', p_target_role
); $$;

-- Establish the intended execution boundary before verifying it below.
revoke all on function public.prevent_organization_audit_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_final_organization_owner_removal()
  from public, anon, authenticated;
revoke all on function public.store_organization_membership_result(
  uuid, uuid, uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.manage_organization_member(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.add_organization_member(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.remove_organization_member(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.change_organization_role(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.add_organization_member(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.remove_organization_member(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.change_organization_role(uuid, uuid, text, uuid)
  to authenticated;

-- Fail closed unless every SECURITY DEFINER function executes as the common
-- owner of every table it protects, with no required RLS bypass forced away.
do $$
declare
  protected_owner oid;
  protected_table_count integer;
  protected_owner_count integer;
  forced_rls_count integer;
  expected_function_count integer := 7;
  existing_function_count integer;
  mismatched_function_count integer;
  non_security_definer_count integer;
  invalid_search_path_count integer;
  invalid_browser_grant_count integer;
  invalid_internal_grant_count integer;
begin
  select
    min(classes.relowner::text)::oid,
    count(*),
    count(distinct classes.relowner),
    count(*) filter (where classes.relforcerowsecurity)
    into protected_owner, protected_table_count, protected_owner_count,
      forced_rls_count
    from pg_class as classes
    join pg_namespace as namespaces
      on namespaces.oid = classes.relnamespace
   where namespaces.nspname = 'public'
     and classes.relkind = 'r'
     and classes.relname in (
       'organizations', 'organization_members',
       'organization_membership_operations',
       'organization_membership_audit_log', 'system_user_access'
     );

  if protected_table_count <> 5 then
    raise exception 'P0_2C_PROTECTED_TABLE_MISSING';
  end if;
  if protected_owner_count <> 1 then
    raise exception 'P0_2C_PROTECTED_TABLE_OWNER_INVALID';
  end if;
  if forced_rls_count <> 0 then
    raise exception 'P0_2C_PROTECTED_TABLE_FORCE_RLS_INVALID';
  end if;

  select
    count(*),
    count(*) filter (where functions.proowner <> protected_owner),
    count(*) filter (where not functions.prosecdef),
    count(*) filter (where not (
      functions.proconfig @> array['search_path=pg_catalog, public']::text[]
    )),
    count(*) filter (
      where functions.oid in (
        to_regprocedure('public.add_organization_member(uuid,uuid,uuid)'),
        to_regprocedure('public.remove_organization_member(uuid,uuid,uuid)'),
        to_regprocedure('public.change_organization_role(uuid,uuid,text,uuid)')
      ) and (
        not has_function_privilege('authenticated', functions.oid, 'execute')
        or has_function_privilege('anon', functions.oid, 'execute')
        or has_function_privilege('public', functions.oid, 'execute')
      )
    ),
    count(*) filter (
      where functions.oid not in (
        to_regprocedure('public.add_organization_member(uuid,uuid,uuid)'),
        to_regprocedure('public.remove_organization_member(uuid,uuid,uuid)'),
        to_regprocedure('public.change_organization_role(uuid,uuid,text,uuid)')
      ) and (
        has_function_privilege('authenticated', functions.oid, 'execute')
        or has_function_privilege('anon', functions.oid, 'execute')
        or has_function_privilege('public', functions.oid, 'execute')
      )
    )
    into existing_function_count, mismatched_function_count,
      non_security_definer_count, invalid_search_path_count,
      invalid_browser_grant_count, invalid_internal_grant_count
    from pg_proc as functions
    join pg_namespace as namespaces
      on namespaces.oid = functions.pronamespace
   where namespaces.nspname = 'public'
     and functions.oid in (
       to_regprocedure('public.prevent_organization_audit_mutation()'),
       to_regprocedure('public.prevent_final_organization_owner_removal()'),
       to_regprocedure('public.store_organization_membership_result(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)'),
       to_regprocedure('public.manage_organization_member(uuid,uuid,uuid,text,text)'),
       to_regprocedure('public.add_organization_member(uuid,uuid,uuid)'),
       to_regprocedure('public.remove_organization_member(uuid,uuid,uuid)'),
       to_regprocedure('public.change_organization_role(uuid,uuid,text,uuid)')
     );

  if existing_function_count <> expected_function_count then
    raise exception 'P0_2C_SECURITY_DEFINER_FUNCTION_MISSING';
  end if;
  if mismatched_function_count <> 0 then
    raise exception 'P0_2C_SECURITY_DEFINER_OWNER_INVALID';
  end if;
  if non_security_definer_count <> 0 then
    raise exception 'P0_2C_SECURITY_DEFINER_MODE_INVALID';
  end if;
  if invalid_search_path_count <> 0 then
    raise exception 'P0_2C_SECURITY_DEFINER_SEARCH_PATH_INVALID';
  end if;
  if invalid_browser_grant_count <> 0 then
    raise exception 'P0_2C_BROWSER_RPC_GRANT_INVALID';
  end if;
  if invalid_internal_grant_count <> 0 then
    raise exception 'P0_2C_INTERNAL_FUNCTION_GRANT_INVALID';
  end if;
end;
$$;

commit;
