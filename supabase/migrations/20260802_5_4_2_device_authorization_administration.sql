begin;

-- P0.3E-1 only: additive operational administration while legacy runtime
-- access remains present and device enforcement remains disabled.
create table public.device_authorization_admin_operations (
  operation_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_user_id_snapshot uuid not null,
  actor_device_id uuid not null,
  target_user_id uuid null references auth.users(id) on delete set null,
  target_user_id_snapshot uuid not null,
  device_id uuid not null,
  replacement_device_id uuid null,
  action text not null check (action in (
    'approve_member_device','reject_member_pending_device',
    'revoke_member_device','replace_member_active_device'
  )),
  outcome text not null check (outcome in ('applied','unchanged')),
  stored_result jsonb not null check (jsonb_typeof(stored_result)='object'),
  created_at timestamptz not null default now(),
  constraint device_authorization_admin_actor_device_fk
    foreign key (actor_user_id_snapshot,actor_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_authorization_admin_target_device_fk
    foreign key (target_user_id_snapshot,device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  constraint device_authorization_admin_replacement_device_fk
    foreign key (target_user_id_snapshot,replacement_device_id)
    references public.user_device_authorizations(user_id,device_id)
    on delete restrict,
  check ((action='replace_member_active_device')=(replacement_device_id is not null)),
  unique (actor_user_id_snapshot,operation_id)
);

create index device_authorization_admin_target_created_idx
  on public.device_authorization_admin_operations(target_user_id_snapshot,created_at desc);
alter table public.device_authorization_admin_operations enable row level security;
revoke all on table public.device_authorization_admin_operations
  from public,anon,authenticated;

create or replace function public.require_device_authorization_manager(
  p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog, public
as $$
declare
  actor_id uuid;
  actor_role text;
  target_role text;
begin
  if p_organization_id is null or p_target_user_id is null then
    raise exception 'DEVICE_ADMINISTRATION_IDENTITY_REQUIRED' using errcode='22023';
  end if;
  actor_id:=public.require_current_approved_device(p_actor_device_id);
  select members.role into actor_role from public.organization_members members
   where members.organization_id=p_organization_id and members.user_id=actor_id;
  select members.role into target_role from public.organization_members members
   where members.organization_id=p_organization_id and members.user_id=p_target_user_id;
  if actor_role not in ('organization_owner','organization_admin') then
    raise exception 'DEVICE_ADMINISTRATION_ROLE_REQUIRED' using errcode='42501';
  end if;
  if target_role is null then
    raise exception 'DEVICE_ADMINISTRATION_TARGET_MEMBER_REQUIRED' using errcode='42501';
  end if;
  if actor_role='organization_admin' and target_role<>'member' then
    raise exception 'DEVICE_ADMINISTRATION_TARGET_ROLE_DENIED' using errcode='42501';
  end if;
  return target_role;
end;
$$;

create or replace function public.list_member_device_authorizations(
  p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog, public
as $$
declare
  target_role text;
begin
  target_role:=public.require_device_authorization_manager(
    p_actor_device_id,p_organization_id,p_target_user_id);
  return jsonb_build_object(
    'status','success','organizationId',p_organization_id,
    'targetUserId',p_target_user_id,'targetRole',target_role,
    'devices',coalesce((select jsonb_agg(jsonb_build_object(
      'deviceId',authorizations.device_id,
      'deviceName',devices.device_name,'platform',devices.platform,
      'authorizationStatus',authorizations.authorization_status,
      'requestedAt',authorizations.requested_at,
      'approvedAt',authorizations.approved_at,
      'approvedBy',authorizations.approved_by,
      'revokedAt',authorizations.revoked_at,
      'revokedBy',authorizations.revoked_by,
      'lastRegisteredAt',authorizations.last_registered_at,
      'isSoleApprovedDevice',authorizations.authorization_status='approved'
        and authorizations.revoked_at is null
        and (select count(*) from public.user_device_authorizations approved
          where approved.user_id=p_target_user_id
            and approved.authorization_status='approved'
            and approved.revoked_at is null)=1
    ) order by authorizations.created_at,authorizations.device_id)
    from public.user_device_authorizations authorizations
    join public.devices devices on devices.id=authorizations.device_id
      and devices.user_id=authorizations.user_id
    where authorizations.user_id=p_target_user_id),'[]'::jsonb)
  );
end;
$$;

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
     or not exists(select 1 from public.system_user_access where user_id=p_target_user_id and account_status='approved')
     or exists(select 1 from public.user_device_authorizations where user_id=p_target_user_id
       and authorization_status='approved' and revoked_at is null) then
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

create or replace function public.reject_member_pending_device(
  p_actor_device_id uuid,p_organization_id uuid,p_target_user_id uuid,
  p_device_id uuid,p_operation_id uuid
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog, public
as $$
declare actor_id uuid:=auth.uid(); existing public.device_authorization_admin_operations%rowtype;
  target_row public.user_device_authorizations%rowtype; result jsonb;
begin
  if p_device_id is null or p_operation_id is null then raise exception 'DEVICE_ADMINISTRATION_ARGUMENT_REQUIRED' using errcode='22023'; end if;
  perform public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-user:'||p_target_user_id::text,0));
  perform public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  select * into existing from public.device_authorization_admin_operations where operation_id=p_operation_id;
  if found then
    if existing.actor_user_id_snapshot=actor_id and existing.actor_device_id=p_actor_device_id
      and existing.organization_id=p_organization_id and existing.target_user_id_snapshot=p_target_user_id
      and existing.device_id=p_device_id and existing.replacement_device_id is null
      and existing.action='reject_member_pending_device' then return existing.stored_result; end if;
    raise exception 'DEVICE_ADMINISTRATION_OPERATION_MISMATCH' using errcode='22023';
  end if;
  select * into target_row from public.user_device_authorizations where user_id=p_target_user_id and device_id=p_device_id for update;
  if not found or target_row.authorization_status<>'pending' or target_row.revoked_at is not null or target_row.revoked_by is not null then
    raise exception 'PENDING_UNREVOKED_DEVICE_REQUIRED' using errcode='42501';
  end if;
  update public.user_device_authorizations set authorization_status='revoked',revoked_at=now(),revoked_by=actor_id
   where user_id=p_target_user_id and device_id=p_device_id;
  insert into public.device_authorization_audit_log(actor_user_id,target_user_id,device_id,action,operation_id,old_values,new_values)
  values(actor_id,p_target_user_id,p_device_id,'device_authorization_rejected',p_operation_id,
    jsonb_build_object('authorizationStatus','pending'),
    jsonb_build_object('authorizationStatus','revoked','revokedBy',actor_id,'organizationId',p_organization_id,'deviceId',p_device_id));
  result:=jsonb_build_object('status','applied','authorizationStatus','revoked','organizationId',p_organization_id,'targetUserId',p_target_user_id,'deviceId',p_device_id);
  insert into public.device_authorization_admin_operations(operation_id,organization_id,actor_user_id,actor_user_id_snapshot,
    actor_device_id,target_user_id,target_user_id_snapshot,device_id,action,outcome,stored_result)
  values(p_operation_id,p_organization_id,actor_id,actor_id,p_actor_device_id,p_target_user_id,p_target_user_id,p_device_id,
    'reject_member_pending_device','applied',result);
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
  if target_role='organization_owner' or actor_id=p_target_user_id then
    raise exception 'DEVICE_REVOCATION_REPLACEMENT_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organization-membership:'||p_organization_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('device-authorization-user:'||p_target_user_id::text,0));
  target_role:=public.require_device_authorization_manager(p_actor_device_id,p_organization_id,p_target_user_id);
  if target_role='organization_owner' or actor_id=p_target_user_id then
    raise exception 'DEVICE_REVOCATION_REPLACEMENT_REQUIRED' using errcode='42501';
  end if;
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
     or (select count(*) from public.user_device_authorizations where user_id=p_target_user_id and authorization_status='approved' and revoked_at is null)<>1
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

revoke all on function public.require_device_authorization_manager(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_member_device_authorizations(uuid,uuid,uuid) from public,anon;
revoke all on function public.approve_member_device(uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.revoke_member_device(uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.list_member_device_authorizations(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_member_device(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.revoke_member_device(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;

do $$
declare protected_owner oid; function_count integer;
begin
  select relowner into protected_owner from pg_class where oid='public.device_authorization_enforcement'::regclass;
  if (select count(*) from public.device_authorization_enforcement where singleton_id=1)<>1
     or exists(select 1 from public.device_authorization_enforcement where enforcement_enabled) then
    raise exception 'P0_3E_1_ENFORCEMENT_MUST_REMAIN_DISABLED';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='device_authorization_admin_operations'
        and c.relowner=protected_owner and c.relrowsecurity and not c.relforcerowsecurity)<>1 then
    raise exception 'P0_3E_1_ADMIN_TABLE_INVARIANT_INVALID';
  end if;
  select count(*) into function_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.oid in (
    to_regprocedure('public.require_device_authorization_manager(uuid,uuid,uuid)'),
    to_regprocedure('public.list_member_device_authorizations(uuid,uuid,uuid)'),
    to_regprocedure('public.approve_member_device(uuid,uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.revoke_member_device(uuid,uuid,uuid,uuid,uuid)'),
    to_regprocedure('public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid)'))
    and p.proowner=protected_owner and p.prosecdef
    and p.proconfig @> array['search_path=pg_catalog, public']::text[];
  if function_count<>6 then raise exception 'P0_3E_1_FUNCTION_INVARIANT_INVALID'; end if;
  if has_function_privilege('public','public.require_device_authorization_manager(uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.require_device_authorization_manager(uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.require_device_authorization_manager(uuid,uuid,uuid)','execute') then
    raise exception 'P0_3E_1_HELPER_ISOLATION_INVALID';
  end if;
  if not has_function_privilege('authenticated','public.list_member_device_authorizations(uuid,uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.approve_member_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.revoke_member_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('public','public.list_member_device_authorizations(uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.list_member_device_authorizations(uuid,uuid,uuid)','execute')
    or has_function_privilege('public','public.approve_member_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.approve_member_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('public','public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.reject_member_pending_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('public','public.revoke_member_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.revoke_member_device(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('public','public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.replace_member_active_device(uuid,uuid,uuid,uuid,uuid,uuid)','execute') then
    raise exception 'P0_3E_1_RPC_GRANT_INVALID';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'device_guarded_%'
        or p.proname='get_my_device_aware_system_access'))<>27 then
    raise exception 'P0_3E_1_GUARDED_FOUNDATION_INVALID';
  end if;
  if exists (
    with expected(signature,expected_public_execute,expected_anon_execute,
      expected_authenticated_execute) as (values
      ('public.list_my_organizations()',false,false,true),
      ('public.get_my_organization_access(uuid)',false,false,true),
      ('public.list_organization_members(uuid)',false,false,true),
      ('public.lookup_organization_candidate_by_email(uuid,text)',false,false,true),
      ('public.get_my_conference_access(uuid)',false,false,true),
      ('public.list_conference_members(uuid)',false,false,true),
      ('public.lookup_conference_user_by_email(uuid,text)',false,false,true),
      ('public.get_conference_lock(uuid,uuid)',false,true,true),
      ('public.add_organization_member(uuid,uuid,uuid)',false,false,true),
      ('public.remove_organization_member(uuid,uuid,uuid)',false,false,true),
      ('public.change_organization_role(uuid,uuid,text,uuid)',false,false,true),
      ('public.add_conference_manager(uuid,uuid,uuid)',false,false,true),
      ('public.remove_conference_manager(uuid,uuid,uuid)',false,false,true),
      ('public.create_conference_idempotent(uuid,uuid,text,jsonb)',false,false,true),
      ('public.apply_conference_snapshot(uuid,uuid,uuid,bigint,jsonb,text,text)',false,true,true),
      ('public.acquire_conference_lock(uuid,uuid,uuid,integer)',false,true,true),
      ('public.renew_conference_lock(uuid,uuid,uuid,integer)',false,true,true),
      ('public.release_conference_lock(uuid,uuid,uuid)',false,true,true),
      ('public.resolve_sync_conflict(uuid,uuid,uuid,uuid,bigint,text,jsonb,text,text)',false,true,true)
    ), resolved as (
      select expected.*,to_regprocedure(expected.signature) as routine_oid from expected
    ), actual as (
      select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in (
        'list_my_organizations','get_my_organization_access','list_organization_members',
        'lookup_organization_candidate_by_email','get_my_conference_access','list_conference_members',
        'lookup_conference_user_by_email','get_conference_lock','add_organization_member',
        'remove_organization_member','change_organization_role','add_conference_manager',
        'remove_conference_manager','create_conference_idempotent','apply_conference_snapshot',
        'acquire_conference_lock','renew_conference_lock','release_conference_lock','resolve_sync_conflict')
    ), deviations as (
      select 1 from resolved where routine_oid is null
        or has_function_privilege('public',routine_oid,'execute') is distinct from expected_public_execute
        or has_function_privilege('anon',routine_oid,'execute') is distinct from expected_anon_execute
        or has_function_privilege('authenticated',routine_oid,'execute') is distinct from expected_authenticated_execute
      union all
      select 1 from actual left join resolved on resolved.routine_oid=actual.oid
       where resolved.routine_oid is null
    ) select 1 from deviations) then
    raise exception 'P0_3E_1_LEGACY_GRANTS_MUST_REMAIN_UNCHANGED';
  end if;
end;
$$;

commit;
