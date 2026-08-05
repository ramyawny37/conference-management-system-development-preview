begin;

drop index if exists public.user_device_authorizations_one_approved_per_user_idx;

create index if not exists user_device_authorizations_approved_user_idx
  on public.user_device_authorizations (user_id, device_id)
  where authorization_status = 'approved' and revoked_at is null;

create or replace function public.approve_member_device(
  p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,
  p_device_id uuid,p_operation_id uuid
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog, public
as $$
declare
  actor_id uuid:=auth.uid();
  existing public.device_authorization_admin_operations%rowtype;
  target_row public.user_device_authorizations%rowtype;
  result jsonb;
begin
  if p_device_id is null or p_operation_id is null then
    raise exception 'DEVICE_ADMINISTRATION_ARGUMENT_REQUIRED' using errcode='22023';
  end if;
  perform public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-user:'||p_target_user_id::text,0));
  perform public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  select * into existing from public.device_authorization_admin_operations where operation_id=p_operation_id;
  if found then
    if existing.actor_user_id_snapshot=actor_id and existing.actor_device_id=p_actor_device_id
      and existing.organization_id=p_organization_id and existing.target_user_id_snapshot=p_target_user_id
      and existing.device_id=p_device_id and existing.replacement_device_id is null
      and existing.action='approve_member_device' then return existing.stored_result; end if;
    raise exception 'DEVICE_ADMINISTRATION_OPERATION_MISMATCH' using errcode='22023';
  end if;
  select * into target_row from public.user_device_authorizations
   where user_id=p_target_user_id and device_id=p_device_id for update;
  if not found or target_row.authorization_status<>'pending'
     or target_row.revoked_at is not null or target_row.revoked_by is not null then
    raise exception 'PENDING_UNREVOKED_DEVICE_REQUIRED' using errcode='42501';
  end if;
  if not exists(select 1 from public.devices where id=p_device_id and user_id=p_target_user_id)
     or not exists(select 1 from public.system_user_access where user_id=p_target_user_id and account_status='approved') then
    raise exception 'DEVICE_APPROVAL_PRECONDITION_INVALID' using errcode='42501';
  end if;
  update public.user_device_authorizations set authorization_status='approved',
    approved_at=now(),approved_by=actor_id
   where user_id=p_target_user_id and device_id=p_device_id;
  insert into public.device_authorization_audit_log(actor_user_id,target_user_id,device_id,
    action,operation_id,old_values,new_values) values(actor_id,p_target_user_id,p_device_id,
    'device_authorization_approved',p_operation_id,
    jsonb_build_object('authorizationStatus','pending'),
    jsonb_build_object('authorizationStatus','approved','approvedBy',actor_id,
      'organizationId',p_organization_id,'deviceId',p_device_id));
  result:=jsonb_build_object('status','applied','authorizationStatus','approved',
    'organizationId',p_organization_id,'targetUserId',p_target_user_id,'deviceId',p_device_id);
  insert into public.device_authorization_admin_operations(operation_id,organization_id,
    actor_user_id,actor_user_id_snapshot,actor_device_id,target_user_id,target_user_id_snapshot,
    device_id,action,outcome,stored_result) values(p_operation_id,p_organization_id,
    actor_id,actor_id,p_actor_device_id,p_target_user_id,p_target_user_id,p_device_id,
    'approve_member_device','applied',result);
  return result;
end;
$$;

create or replace function public.revoke_member_device(
  p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,
  p_device_id uuid,p_operation_id uuid
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog, public
as $$
declare actor_id uuid:=auth.uid(); target_role text; existing public.device_authorization_admin_operations%rowtype;
  target_row public.user_device_authorizations%rowtype; result jsonb;
begin
  if p_device_id is null or p_operation_id is null then raise exception 'DEVICE_ADMINISTRATION_ARGUMENT_REQUIRED' using errcode='22023'; end if;
  target_role:=public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-user:'||p_target_user_id::text,0));
  target_role:=public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  select * into existing from public.device_authorization_admin_operations where operation_id=p_operation_id;
  if found then
    if existing.actor_user_id_snapshot=actor_id and existing.actor_device_id=p_actor_device_id
      and existing.organization_id=p_organization_id and existing.target_user_id_snapshot=p_target_user_id
      and existing.device_id=p_device_id and existing.replacement_device_id is null
      and existing.action='revoke_member_device' then return existing.stored_result; end if;
    raise exception 'DEVICE_ADMINISTRATION_OPERATION_MISMATCH' using errcode='22023';
  end if;
  select * into target_row from public.user_device_authorizations where user_id=p_target_user_id and device_id=p_device_id for update;
  if not found or target_row.authorization_status<>'approved' or target_row.revoked_at is not null or target_row.revoked_by is not null then
    raise exception 'APPROVED_UNREVOKED_DEVICE_REQUIRED' using errcode='42501';
  end if;
  if (target_role='organization_owner' or actor_id=p_target_user_id)
     and (select count(*) from public.user_device_authorizations
           where user_id=p_target_user_id and authorization_status='approved' and revoked_at is null)<=1 then
    raise exception 'DEVICE_REVOCATION_REPLACEMENT_REQUIRED' using errcode='42501';
  end if;
  update public.user_device_authorizations set authorization_status='revoked',revoked_at=now(),revoked_by=actor_id
   where user_id=p_target_user_id and device_id=p_device_id;
  insert into public.device_authorization_audit_log(actor_user_id,target_user_id,device_id,action,operation_id,old_values,new_values)
  values(actor_id,p_target_user_id,p_device_id,'device_authorization_revoked',p_operation_id,
    jsonb_build_object('authorizationStatus','approved'),
    jsonb_build_object('authorizationStatus','revoked','revokedBy',actor_id,'organizationId',p_organization_id,'deviceId',p_device_id));
  result:=jsonb_build_object('status','applied','authorizationStatus','revoked','organizationId',p_organization_id,'targetUserId',p_target_user_id,'deviceId',p_device_id);
  insert into public.device_authorization_admin_operations(operation_id,organization_id,actor_user_id,actor_user_id_snapshot,
    actor_device_id,target_user_id,target_user_id_snapshot,device_id,action,outcome,stored_result)
  values(p_operation_id,p_organization_id,actor_id,actor_id,p_actor_device_id,p_target_user_id,p_target_user_id,p_device_id,
    'revoke_member_device','applied',result);
  return result;
end;
$$;

create or replace function public.replace_member_active_device(
  p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,
  p_active_device_id uuid,p_replacement_device_id uuid,p_operation_id uuid
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog, public
as $$
declare actor_id uuid:=auth.uid(); existing public.device_authorization_admin_operations%rowtype;
  active_row public.user_device_authorizations%rowtype; replacement_row public.user_device_authorizations%rowtype; result jsonb;
begin
  if p_active_device_id is null or p_replacement_device_id is null or p_operation_id is null
     or p_active_device_id=p_replacement_device_id then raise exception 'DEVICE_REPLACEMENT_ARGUMENT_INVALID' using errcode='22023'; end if;
  perform public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-user:'||p_target_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-device:'||least(p_active_device_id,p_replacement_device_id)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-device:'||greatest(p_active_device_id,p_replacement_device_id)::text,0));
  perform public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  select * into existing from public.device_authorization_admin_operations where operation_id=p_operation_id;
  if found then
    if existing.actor_user_id_snapshot=actor_id and existing.actor_device_id=p_actor_device_id
      and existing.organization_id=p_organization_id and existing.target_user_id_snapshot=p_target_user_id
      and existing.device_id=p_active_device_id and existing.replacement_device_id=p_replacement_device_id
      and existing.action='replace_member_active_device' then return existing.stored_result; end if;
    raise exception 'DEVICE_ADMINISTRATION_OPERATION_MISMATCH' using errcode='22023';
  end if;
  select * into active_row from public.user_device_authorizations where user_id=p_target_user_id and device_id=p_active_device_id for update;
  select * into replacement_row from public.user_device_authorizations where user_id=p_target_user_id and device_id=p_replacement_device_id for update;
  if active_row.authorization_status is distinct from 'approved' or active_row.revoked_at is not null or active_row.revoked_by is not null
     or replacement_row.authorization_status is distinct from 'pending' or replacement_row.revoked_at is not null or replacement_row.revoked_by is not null
     or not exists(select 1 from public.devices where id=p_active_device_id and user_id=p_target_user_id)
     or not exists(select 1 from public.devices where id=p_replacement_device_id and user_id=p_target_user_id) then
    raise exception 'DEVICE_REPLACEMENT_PRECONDITION_INVALID' using errcode='42501';
  end if;
  update public.user_device_authorizations set authorization_status='revoked',revoked_at=now(),revoked_by=actor_id
   where user_id=p_target_user_id and device_id=p_active_device_id;
  update public.user_device_authorizations set authorization_status='approved',approved_at=now(),approved_by=actor_id
   where user_id=p_target_user_id and device_id=p_replacement_device_id;
  insert into public.device_authorization_audit_log(actor_user_id,target_user_id,device_id,action,operation_id,old_values,new_values)
  values(actor_id,p_target_user_id,p_active_device_id,'device_authorization_revoked',p_operation_id,
    jsonb_build_object('authorizationStatus','approved'),jsonb_build_object('authorizationStatus','revoked','revokedBy',actor_id,
      'organizationId',p_organization_id,'replacementDeviceId',p_replacement_device_id,'source','device_replacement'));
  insert into public.device_authorization_audit_log(actor_user_id,target_user_id,device_id,action,operation_id,old_values,new_values)
  values(actor_id,p_target_user_id,p_replacement_device_id,'device_authorization_approved',p_operation_id,
    jsonb_build_object('authorizationStatus','pending'),jsonb_build_object('authorizationStatus','approved','approvedBy',actor_id,
      'organizationId',p_organization_id,'replacedDeviceId',p_active_device_id,'source','device_replacement'));
  result:=jsonb_build_object('status','applied','organizationId',p_organization_id,'targetUserId',p_target_user_id,
    'revokedDeviceId',p_active_device_id,'approvedDeviceId',p_replacement_device_id);
  insert into public.device_authorization_admin_operations(operation_id,organization_id,actor_user_id,actor_user_id_snapshot,
    actor_device_id,target_user_id,target_user_id_snapshot,device_id,replacement_device_id,action,outcome,stored_result)
  values(p_operation_id,p_organization_id,actor_id,actor_id,p_actor_device_id,p_target_user_id,p_target_user_id,
    p_active_device_id,p_replacement_device_id,'replace_member_active_device','applied',result);
  return result;
end;
$$;

revoke all on function public.approve_member_device(uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.revoke_member_device(uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.approve_member_device(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.revoke_member_device(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;

commit;
