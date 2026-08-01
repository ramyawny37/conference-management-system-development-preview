begin;

-- P0.2C corrective migration. System Access rows are locked after the
-- organization lock and before organization role authorization.
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
  actor_access_status text;
  target_access_status text;
  access_row record;
  membership_row record;
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

  target_exists := exists (
    select 1 from auth.users where id = p_target_user_id
  );
  for access_row in
    select access.user_id, access.account_status
      from public.system_user_access as access
     where access.user_id = actor_id
        or (
          p_action = 'add_organization_member'
          and access.user_id = p_target_user_id
        )
     order by access.user_id
     for update
  loop
    if access_row.user_id = actor_id then
      actor_access_status := access_row.account_status;
    end if;
    if access_row.user_id = p_target_user_id then
      target_access_status := access_row.account_status;
    end if;
  end loop;

  if actor_access_status is distinct from 'approved' then
    return jsonb_build_object(
      'status', 'denied', 'errorCode', 'ORGANIZATION_AUTHORIZATION_REQUIRED'
    );
  end if;

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
  for membership_row in
    select members.user_id, members.role
      from public.organization_members as members
     where members.organization_id = p_organization_id
       and members.user_id in (actor_id, p_target_user_id)
     order by members.user_id
     for update
  loop
    if membership_row.user_id = actor_id then
      actor_role := membership_row.role;
    end if;
    if membership_row.user_id = p_target_user_id then
      target_role := membership_row.role;
    end if;
  end loop;

  if actor_access_status is distinct from 'approved' or actor_role is null then
    outcome := 'denied'; resulting_role := target_role;
    result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_AUTHORIZATION_REQUIRED');
  elsif p_action = 'add_organization_member' then
    if actor_role not in ('organization_owner', 'organization_admin') then
      outcome := 'denied'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'errorCode', 'ORGANIZATION_ROLE_REQUIRED');
    elsif target_role is not null then
      outcome := 'unchanged'; resulting_role := target_role;
      result := jsonb_build_object('status', outcome, 'role', target_role);
    elsif target_access_status is distinct from 'approved' then
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

commit;

