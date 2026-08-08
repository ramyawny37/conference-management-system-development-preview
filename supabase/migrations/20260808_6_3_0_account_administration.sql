begin;

create table public.system_access_admin_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id),
  actor_device_id uuid not null,
  target_user_id uuid not null references auth.users(id),
  action text not null check (action in (
    'approve','block','unblock','set_conference_creation_permission'
  )),
  requested_value boolean,
  result_status text not null,
  stored_result jsonb not null,
  created_at timestamptz not null default now(),
  constraint system_access_admin_operations_intent_check check (
    (action in ('approve','set_conference_creation_permission') and requested_value is not null)
    or (action in ('block','unblock') and requested_value is null)
  )
);
create index system_access_admin_operations_target_idx
  on public.system_access_admin_operations(target_user_id,created_at);
alter table public.system_access_admin_operations enable row level security;
revoke all on table public.system_access_admin_operations from public,anon,authenticated;

create or replace function public.device_guarded_manage_system_user(
  p_actor_device_id uuid,p_target_user_id uuid,p_operation_id uuid,
  p_action text,p_requested_value boolean default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog, public as $$
declare
  actor_id uuid;
  existing public.system_access_admin_operations%rowtype;
  result jsonb;
begin
  if p_target_user_id is null or p_operation_id is null or
     p_action not in ('approve','block','unblock','set_conference_creation_permission') or
     (p_action in ('approve','set_conference_creation_permission') and p_requested_value is null) or
     (p_action in ('block','unblock') and p_requested_value is not null) then
    raise exception 'INVALID_SYSTEM_ACCESS_OPERATION' using errcode='22023';
  end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  if not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('system-access-operation:'||p_operation_id::text,0));
  select * into existing from public.system_access_admin_operations
   where operation_id=p_operation_id;
  if found then
    if existing.actor_user_id=actor_id and
       existing.actor_device_id=p_actor_device_id and
       existing.target_user_id=p_target_user_id and
       existing.action=p_action and
       existing.requested_value is not distinct from p_requested_value then
      return existing.stored_result;
    end if;
    raise exception 'SYSTEM_ACCESS_OPERATION_MISMATCH' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('system-access-user:'||p_target_user_id::text,0));
  if p_action='approve' then
    result:=public.approve_system_user(p_target_user_id,p_requested_value);
  elsif p_action='block' then
    result:=public.block_system_user(p_target_user_id);
  elsif p_action='unblock' then
    result:=public.unblock_system_user(p_target_user_id);
  else
    result:=public.set_user_conference_creation_permission(
      p_target_user_id,p_requested_value);
  end if;
  insert into public.system_access_admin_operations(
    operation_id,actor_user_id,actor_device_id,target_user_id,action,
    requested_value,result_status,stored_result
  ) values (
    p_operation_id,actor_id,p_actor_device_id,p_target_user_id,p_action,
    p_requested_value,result->>'status',result
  );
  return result;
end;
$$;

create or replace function public.get_user_management_account(
  p_actor_device_id uuid,p_target_user_id uuid
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog, public as $$
declare actor_id uuid; access public.system_user_access%rowtype;
begin
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  if not public.is_system_owner(actor_id) then
    raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501';
  end if;
  select * into access from public.system_user_access
   where user_id=p_target_user_id;
  if not found then raise exception 'SYSTEM_ACCESS_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('status','success','account',jsonb_build_object(
    'accountStatus',access.account_status,
    'canCreateConferences',access.can_create_conferences,
    'systemRoles',coalesce((select jsonb_agg(roles.role order by roles.role)
      from public.system_user_roles roles where roles.user_id=p_target_user_id),'[]'::jsonb),
    'capabilities',jsonb_build_object(
      'canApprove',access.account_status='pending',
      'canBlock',access.account_status='approved' and not public.is_system_owner(p_target_user_id),
      'canUnblock',access.account_status='blocked',
      'canSetConferenceCreation',access.account_status='approved'
        and not public.is_system_owner(p_target_user_id)
    )));
end;
$$;

revoke all on function public.device_guarded_manage_system_user(
  uuid,uuid,uuid,text,boolean) from public,anon;
revoke all on function public.get_user_management_account(uuid,uuid)
  from public,anon;
grant execute on function public.device_guarded_manage_system_user(
  uuid,uuid,uuid,text,boolean) to authenticated;
grant execute on function public.get_user_management_account(uuid,uuid)
  to authenticated;

commit;
