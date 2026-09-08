-- One-time-condition, service-only recovery for a Platform Owner with no approved active device.
-- This is deliberately separate from normal device administration and creates no device session.
begin;

create table platform_private.zero_approved_owner_device_recovery_operations (
  operation_id uuid primary key,
  target_user_id uuid not null references platform.profiles(user_id) on delete restrict,
  target_device_id uuid not null references platform.devices(id) on delete restrict,
  target_authorization_id uuid not null references platform.user_device_authorizations(id) on delete restrict,
  target_binding_id uuid not null references platform.device_key_bindings(id) on delete restrict,
  action text not null check (action='zero_approved_platform_owner_device_recovery'),
  reason text not null check (length(reason) between 1 and 1000),
  result jsonb not null check (jsonb_typeof(result)='object'),
  audit_event_id uuid not null unique references platform.audit_events(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.statement_timestamp()
);

create or replace function platform_private.prevent_zero_approved_owner_device_recovery_operation_mutation()
returns trigger language plpgsql set search_path=''
as $$
begin
  raise exception 'ZERO_APPROVED_OWNER_RECOVERY_OPERATION_IMMUTABLE' using errcode='55000';
end;
$$;

create trigger zero_approved_owner_device_recovery_operations_immutable
before update or delete on platform_private.zero_approved_owner_device_recovery_operations
for each row execute function platform_private.prevent_zero_approved_owner_device_recovery_operation_mutation();

revoke all on platform_private.zero_approved_owner_device_recovery_operations
from public,anon,authenticated,service_role;

create or replace function platform.recover_zero_approved_owner_device(
  p_target_user_id uuid,
  p_target_device_id uuid,
  p_target_authorization_id uuid,
  p_target_binding_id uuid,
  p_operation_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_action constant text:='zero_approved_platform_owner_device_recovery';
  v_reason text:=nullif(pg_catalog.btrim(p_reason),'');
  v_prior platform_private.zero_approved_owner_device_recovery_operations%rowtype;
  v_approved_active_count integer;
  v_changed integer;
  v_audit_id uuid;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_BACKEND_REQUIRED' using errcode='42501';
  end if;
  if p_target_user_id is null or p_target_device_id is null
     or p_target_authorization_id is null or p_target_binding_id is null
     or p_operation_id is null or v_reason is null or length(v_reason)>1000 then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_ARGUMENT_INVALID' using errcode='22023';
  end if;

  -- Serialize operation replay/retargeting before taking the owner lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform-zero-owner-recovery-operation:'||p_operation_id::text,0)
  );
  select * into v_prior
  from platform_private.zero_approved_owner_device_recovery_operations operation
  where operation.operation_id=p_operation_id;
  if found then
    if v_prior.target_user_id is distinct from p_target_user_id
       or v_prior.target_device_id is distinct from p_target_device_id
       or v_prior.target_authorization_id is distinct from p_target_authorization_id
       or v_prior.target_binding_id is distinct from p_target_binding_id
       or v_prior.action is distinct from v_action
       or v_prior.reason is distinct from v_reason then
      raise exception 'ZERO_APPROVED_OWNER_RECOVERY_OPERATION_RETARGET_DENIED' using errcode='22023';
    end if;
    return v_prior.result;
  end if;

  -- Only one zero-device recovery may evaluate an owner at a time.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform-zero-owner-recovery-user:'||p_target_user_id::text,0)
  );

  perform 1 from platform.profiles profile
  where profile.user_id=p_target_user_id and profile.account_status='approved'
  for update;
  if not found then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_APPROVED_ACCOUNT_REQUIRED' using errcode='42501';
  end if;

  perform 1
  from platform.user_roles assignment
  join platform.roles role on role.id=assignment.role_id
  where assignment.user_id=p_target_user_id
    and assignment.scope_type='platform' and assignment.scope_id is null
    and assignment.revoked_at is null
    and (assignment.expires_at is null or assignment.expires_at>pg_catalog.statement_timestamp())
    and role.domain='platform' and role.scope_type='platform' and role.code='platform_owner'
  for update of assignment,role;
  if not found then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;

  -- Lock every authorization owned by the target before evaluating the zero-device invariant.
  perform 1 from platform.user_device_authorizations owned
  where owned.user_id=p_target_user_id
  order by owned.id
  for update;

  select count(*)::integer into v_approved_active_count
  from platform.user_device_authorizations approved
  join platform.devices approved_device on approved_device.id=approved.device_id
  where approved.user_id=p_target_user_id
    and approved.status='approved'
    and approved_device.lifecycle_status='active';
  if v_approved_active_count<>0 then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_APPROVED_DEVICE_EXISTS' using errcode='55000';
  end if;

  perform 1
  from platform.user_device_authorizations target_authorization
  join platform.devices device on device.id=target_authorization.device_id
  join platform.device_key_bindings binding
    on binding.id=p_target_binding_id
   and binding.user_id=target_authorization.user_id
   and binding.device_id=target_authorization.device_id
   and binding.device_authorization_id=target_authorization.id
  where target_authorization.id=p_target_authorization_id
    and target_authorization.user_id=p_target_user_id
    and target_authorization.device_id=p_target_device_id
    and target_authorization.status='pending'
    and device.id=p_target_device_id
    and device.lifecycle_status='active'
    and binding.lifecycle_status='active'
  for update of target_authorization,device,binding;
  if not found then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_TARGET_INVALID' using errcode='42501';
  end if;

  update platform.user_device_authorizations as target_row set
    status='approved',
    status_reason=v_reason,
    approved_by=null,
    approved_at=pg_catalog.statement_timestamp()
  where target_row.id=p_target_authorization_id
    and target_row.user_id=p_target_user_id
    and target_row.device_id=p_target_device_id
    and target_row.status='pending';
  get diagnostics v_changed=row_count;
  if v_changed<>1 then
    raise exception 'ZERO_APPROVED_OWNER_RECOVERY_EXACT_MUTATION_FAILED' using errcode='55000';
  end if;

  v_audit_id:=platform_private.write_audit_event(
    null,p_target_user_id,'platform','devices','device_authorization.zero_approved_owner_recovery',
    'user_device_authorization',p_target_authorization_id,'platform',
    pg_catalog.jsonb_build_object('status','pending'),
    pg_catalog.jsonb_build_object('status','approved','approvedBy',null),
    pg_catalog.jsonb_build_object(
      'action',v_action,'recoveryMode','zero_approved_platform_owner_device',
      'backendContext','service_role_system_recovery','deviceId',p_target_device_id,
      'authorizationId',p_target_authorization_id,'bindingId',p_target_binding_id,
      'operationId',p_operation_id,'reason',v_reason,
      'approvedActiveDeviceCountBefore',v_approved_active_count
    ),null,p_operation_id,'system'
  );

  v_result:=pg_catalog.jsonb_build_object(
    'status','applied','recoveryMode','zero_approved_platform_owner_device',
    'userId',p_target_user_id,'deviceId',p_target_device_id,
    'authorizationId',p_target_authorization_id,'bindingId',p_target_binding_id,
    'operationId',p_operation_id,'authorizationStatus','approved','auditEventId',v_audit_id
  );
  insert into platform_private.zero_approved_owner_device_recovery_operations(
    operation_id,target_user_id,target_device_id,target_authorization_id,target_binding_id,
    action,reason,result,audit_event_id
  ) values(
    p_operation_id,p_target_user_id,p_target_device_id,p_target_authorization_id,p_target_binding_id,
    v_action,v_reason,v_result,v_audit_id
  );
  return v_result;
end;
$$;

alter function platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text) owner to postgres;
revoke all on function platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function platform.recover_zero_approved_owner_device(uuid,uuid,uuid,uuid,uuid,text)
to service_role;

commit;
