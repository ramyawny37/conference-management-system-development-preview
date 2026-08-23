begin;

create or replace function public.device_guarded_get_organization_membership_operation(
  p_actor_device_id uuid,
  p_organization_id uuid,
  p_operation_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  operation_row public.organization_membership_operations%rowtype;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);

  if p_organization_id is null or p_operation_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if not exists (
    select 1
      from public.organization_members as members
     where members.organization_id = p_organization_id
       and members.user_id = actor_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select operations.* into operation_row
    from public.organization_membership_operations as operations
   where operations.organization_id = p_organization_id
     and operations.actor_user_id_snapshot = actor_id
     and operations.operation_id = p_operation_id;

  if not found or operation_row.outcome not in (
    'applied', 'unchanged', 'denied', 'invalid_request'
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'terminal',
    'organizationId', operation_row.organization_id,
    'operationId', operation_row.operation_id,
    'targetUserId', operation_row.target_user_id_snapshot,
    'action', operation_row.action,
    'requestedRole', operation_row.requested_role,
    'outcome', operation_row.outcome,
    'storedResult', operation_row.stored_result,
    'createdAt', operation_row.created_at
  );
end;
$$;

revoke all on table public.organization_membership_operations
  from public, anon, authenticated;
revoke all on function public.device_guarded_get_organization_membership_operation(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.device_guarded_get_organization_membership_operation(
  uuid, uuid, uuid
) to authenticated;

commit;
