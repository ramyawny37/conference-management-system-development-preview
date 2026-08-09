begin;

create or replace function public.enforce_launch_conference_member_contract()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare organization_id uuid; organization_status text;
begin
  if new.role in ('accommodation_viewer','transport_viewer') and
     (tg_op='INSERT' or new.role is distinct from old.role) then
    raise exception 'SECTION_VIEWER_ASSIGNMENT_DISABLED' using errcode='42501';
  end if;
  select c.organization_id,o.status into organization_id,organization_status
    from public.conferences c left join public.organizations o on o.id=c.organization_id
   where c.id=new.conference_id;
  if organization_id is null then
    raise exception 'CONFERENCE_ORGANIZATION_REQUIRED' using errcode='23514';
  end if;
  if organization_status<>'active' then
    raise exception 'CONFERENCE_ORGANIZATION_INACTIVE' using errcode='55000';
  end if;
  if not exists(select 1 from public.organization_members m
    where m.organization_id=organization_id and m.user_id=new.user_id) then
    raise exception 'CONFERENCE_MEMBER_ORGANIZATION_REQUIRED' using errcode='42501';
  end if;
  return new;
end; $$;

drop trigger if exists conference_members_launch_integrity on public.conference_members;
create trigger conference_members_launch_integrity before insert or update on public.conference_members
for each row execute function public.enforce_launch_conference_member_contract();

create or replace function public.prevent_null_conference_organization()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.organization_id is null then
    raise exception 'CONFERENCE_ORGANIZATION_REQUIRED' using errcode='23502';
  end if;
  return new;
end; $$;

drop trigger if exists conferences_require_organization_on_insert on public.conferences;
create trigger conferences_require_organization_on_insert before insert on public.conferences
for each row execute function public.prevent_null_conference_organization();

create or replace function public.create_organization_conference_idempotent(
  p_operation_id uuid,p_requested_conference_id uuid,p_organization_id uuid,
  p_name text,p_initial_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); prior public.conference_creation_operations%rowtype;
  normalized_name text:=btrim(coalesce(p_name,'')); access_status text;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_operation_id is null or p_requested_conference_id is null or p_organization_id is null
    or normalized_name='' or length(normalized_name)>500
    or jsonb_typeof(coalesce(p_initial_metadata,'{}'::jsonb))<>'object' then
    raise exception 'INVALID_CONFERENCE_REQUEST' using errcode='22023';
  end if;
  select account_status into access_status from public.system_user_access where user_id=actor_id;
  if access_status<>'approved' or not public.can_user_create_conferences(actor_id) then
    raise exception 'CONFERENCE_CREATION_NOT_ALLOWED' using errcode='42501';
  end if;
  if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active')
    or not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=actor_id) then
    raise exception 'ACTIVE_ORGANIZATION_MEMBERSHIP_REQUIRED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':conference-create:'||p_operation_id::text,0));
  select * into prior from public.conference_creation_operations where user_id=actor_id and operation_id=p_operation_id;
  if found then
    if prior.conference_id<>p_requested_conference_id then raise exception 'OPERATION_RESULT_MISMATCH' using errcode='22023'; end if;
    return jsonb_build_object('status','duplicate','operationId',p_operation_id,'conferenceId',prior.conference_id,'created',false);
  end if;
  if exists(select 1 from public.conferences where id=p_requested_conference_id) then
    raise exception 'CONFERENCE_ID_ALREADY_USED' using errcode='23505';
  end if;
  insert into public.conferences(id,name,owner_id,organization_id)
  values(p_requested_conference_id,normalized_name,actor_id,p_organization_id);
  insert into public.conference_creation_operations(user_id,operation_id,conference_id,initial_metadata)
  values(actor_id,p_operation_id,p_requested_conference_id,coalesce(p_initial_metadata,'{}'::jsonb));
  return jsonb_build_object('status','created','operationId',p_operation_id,'conferenceId',p_requested_conference_id,'created',true);
end; $$;

create or replace function public.device_guarded_create_organization_conference_idempotent(
  p_actor_device_id uuid,p_operation_id uuid,p_requested_conference_id uuid,
  p_organization_id uuid,p_name text,p_initial_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.require_current_approved_device(p_actor_device_id);
  return public.create_organization_conference_idempotent(p_operation_id,p_requested_conference_id,p_organization_id,p_name,p_initial_metadata);
end; $$;

create table if not exists public.legacy_conference_organization_assignments(
  operation_id uuid primary key,conference_id uuid not null unique references public.conferences(id),
  organization_id uuid not null references public.organizations(id),actor_user_id uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),stored_result jsonb not null);
alter table public.legacy_conference_organization_assignments enable row level security;
revoke all on table public.legacy_conference_organization_assignments from public,anon,authenticated;

create or replace function public.device_guarded_assign_legacy_conference_organization(
  p_actor_device_id uuid,p_operation_id uuid,p_conference_id uuid,p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); conference_row public.conferences%rowtype; prior public.legacy_conference_organization_assignments%rowtype; result jsonb;
begin
  perform public.require_current_approved_device(p_actor_device_id);
  if p_operation_id is null or p_conference_id is null or p_organization_id is null then raise exception 'INVALID_ASSIGNMENT_REQUEST' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legacy-conference-organization:'||p_conference_id::text,0));
  select * into prior from public.legacy_conference_organization_assignments where operation_id=p_operation_id;
  if found then
    if prior.conference_id<>p_conference_id or prior.organization_id<>p_organization_id or prior.actor_user_id<>actor_id then raise exception 'ASSIGNMENT_OPERATION_MISMATCH' using errcode='22023'; end if;
    return prior.stored_result;
  end if;
  select * into conference_row from public.conferences where id=p_conference_id for update;
  if not found then raise exception 'CONFERENCE_NOT_FOUND' using errcode='P0002'; end if;
  if conference_row.organization_id is not null then raise exception 'CONFERENCE_ALREADY_ASSIGNED' using errcode='23505'; end if;
  if not public.is_system_owner(actor_id) and not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=actor_id and m.role='organization_owner') then raise exception 'ASSIGNMENT_OWNER_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active')
    or not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=conference_row.owner_id) then raise exception 'CONFERENCE_OWNER_ORGANIZATION_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
  if exists(select 1 from public.conference_members cm where cm.conference_id=p_conference_id
    and not exists(select 1 from public.organization_members om where om.organization_id=p_organization_id and om.user_id=cm.user_id)) then
    raise exception 'CONFERENCE_MEMBERS_ORGANIZATION_MEMBERSHIP_REQUIRED' using errcode='42501';
  end if;
  update public.conferences set organization_id=p_organization_id where id=p_conference_id;
  result:=jsonb_build_object('status','assigned','conferenceId',p_conference_id,'organizationId',p_organization_id,'operationId',p_operation_id);
  insert into public.legacy_conference_organization_assignments(operation_id,conference_id,organization_id,actor_user_id,stored_result)
  values(p_operation_id,p_conference_id,p_organization_id,actor_id,result);
  return result;
end; $$;

revoke all on function public.create_organization_conference_idempotent(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.device_guarded_create_organization_conference_idempotent(uuid,uuid,uuid,uuid,text,jsonb),public.device_guarded_assign_legacy_conference_organization(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.device_guarded_create_organization_conference_idempotent(uuid,uuid,uuid,uuid,text,jsonb),public.device_guarded_assign_legacy_conference_organization(uuid,uuid,uuid,uuid) to authenticated;

commit;
