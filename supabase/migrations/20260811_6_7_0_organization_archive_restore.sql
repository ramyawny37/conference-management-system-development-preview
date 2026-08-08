begin;

alter table public.organization_management_operations
  drop constraint if exists organization_management_operations_action_check,
  drop constraint if exists organization_management_operations_result_status_check;
alter table public.organization_management_operations
  add constraint organization_management_operations_action_check
    check (action in ('create','update','archive','restore')),
  add constraint organization_management_operations_result_status_check
    check (result_status in ('created','updated','archived','restored','unchanged'));

alter table public.organization_management_audit_log
  drop constraint if exists organization_management_audit_log_action_check;
alter table public.organization_management_audit_log
  add constraint organization_management_audit_log_action_check
    check (action in ('create','update','archive','restore'));

create or replace function public.prevent_archived_organization_membership_mutation()
returns trigger language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if exists(select 1 from public.organizations o where o.id=new.organization_id and o.status='archived') then
    raise exception 'ARCHIVED_ORGANIZATION_READ_ONLY' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists organization_members_reject_archived_mutation on public.organization_members;
create trigger organization_members_reject_archived_mutation
before insert or update on public.organization_members
for each row execute function public.prevent_archived_organization_membership_mutation();

create or replace function public.get_organization_management_overview(p_actor_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); rows jsonb; can_create boolean;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  can_create:=public.is_system_owner(actor_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationId',o.id,'organizationKey',o.organization_key,
    'displayName',o.display_name,'description',o.description,
    'status',o.status,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'role',mine.role,'ownerId',owner_row.user_id,'ownerName',owner_profile.display_name,
    'conferenceCount',(select count(*) from public.conferences c where c.organization_id=o.id),
    'memberCount',(select count(*) from public.organization_members m where m.organization_id=o.id),
    'deviceCount',(select count(*) from public.user_device_authorizations a where exists(select 1 from public.organization_members m where m.organization_id=o.id and m.user_id=a.user_id)),
    'capabilities',jsonb_build_object(
      'canOpen',true,
      'canManageMembers',o.status='active' and mine.role in ('organization_owner','organization_admin'),
      'canEdit',o.status='active' and mine.role='organization_owner',
      'canArchive',o.status='active' and mine.role='organization_owner',
      'canRestore',o.status='archived' and mine.role='organization_owner',
      'canDelete',false)
  ) order by o.created_at,o.id),'[]'::jsonb) into rows
  from public.organizations o
  join public.organization_members mine on mine.organization_id=o.id and mine.user_id=actor_id
  left join lateral (select m.user_id from public.organization_members m where m.organization_id=o.id and m.role='organization_owner' order by m.created_at,m.user_id limit 1) owner_row on true
  left join public.profiles owner_profile on owner_profile.id=owner_row.user_id;
  return jsonb_build_object('status','success','canCreate',can_create,'organizations',rows);
end;
$$;

create or replace function public.manage_organization(p_actor_device_id uuid,p_operation_id uuid,p_action text,p_organization_id uuid,p_name text default null,p_description text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare actor_id uuid:=auth.uid(); normalized_name text:=nullif(btrim(coalesce(p_name,'')),''); normalized_description text:=nullif(btrim(coalesce(p_description,'')),''); intent text; old_row public.organizations%rowtype; prior public.organization_management_operations%rowtype; result jsonb; result_status text;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  if p_operation_id is null or p_organization_id is null or p_action is null or p_action not in ('create','update','archive','restore') or length(coalesce(normalized_name,''))>160 or length(coalesce(normalized_description,''))>1000 or (p_action in ('create','update') and normalized_name is null) then raise exception 'INVALID_ORGANIZATION_REQUEST' using errcode='22023'; end if;
  intent:=encode(digest(actor_id::text||'|'||p_action||'|'||p_organization_id::text||'|'||coalesce(normalized_name,'')||'|'||coalesce(normalized_description,''),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('organization-management:'||p_operation_id::text,0));
  select * into prior from public.organization_management_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_user_id<>actor_id or prior.intent_hash<>intent then raise exception 'ORGANIZATION_OPERATION_MISMATCH' using errcode='22023'; end if;
    return prior.stored_result;
  end if;
  if p_action='create' then
    if not public.is_system_owner(actor_id) then raise exception 'SYSTEM_OWNER_REQUIRED' using errcode='42501'; end if;
    if exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'ORGANIZATION_ID_CONFLICT' using errcode='23505'; end if;
    insert into public.organizations(id,organization_key,display_name,description,is_default,status) values(p_organization_id,'org-'||replace(p_organization_id::text,'-',''),normalized_name,normalized_description,false,'active');
    insert into public.organization_members(organization_id,user_id,role) values(p_organization_id,actor_id,'organization_owner');
    result_status:='created';
  else
    perform pg_advisory_xact_lock(hashtextextended('organization:'||p_organization_id::text,0));
    select * into old_row from public.organizations where id=p_organization_id for update;
    if not found then raise exception 'ORGANIZATION_NOT_FOUND' using errcode='P0002'; end if;
    if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=actor_id and role='organization_owner') then raise exception 'ORGANIZATION_OWNER_REQUIRED' using errcode='42501'; end if;
    if p_action='update' then
      if old_row.status<>'active' then raise exception 'ARCHIVED_ORGANIZATION_READ_ONLY' using errcode='55000'; end if;
      if old_row.display_name=normalized_name and old_row.description is not distinct from normalized_description then result_status:='unchanged';
      else update public.organizations set display_name=normalized_name,description=normalized_description where id=p_organization_id;result_status:='updated';end if;
    elsif p_action='archive' then
      if old_row.status='archived' then result_status:='unchanged';
      else update public.organizations set status='archived' where id=p_organization_id;result_status:='archived';end if;
    else
      if old_row.status='active' then result_status:='unchanged';
      else update public.organizations set status='active' where id=p_organization_id;result_status:='restored';end if;
    end if;
  end if;
  result:=jsonb_build_object('status',result_status,'organizationId',p_organization_id,'operationId',p_operation_id);
  insert into public.organization_management_audit_log(organization_id,actor_user_id,action,operation_id,old_values,new_values)
  select p_organization_id,actor_id,p_action,p_operation_id,
    case when p_action='create' then '{}'::jsonb else to_jsonb(old_row) end,
    to_jsonb(o) from public.organizations o where o.id=p_organization_id;
  insert into public.organization_management_operations(operation_id,actor_user_id,organization_id,action,intent_hash,result_status,stored_result) values(p_operation_id,actor_id,p_organization_id,p_action,intent,result_status,result);
  return result;
end;
$$;

revoke all on function public.prevent_archived_organization_membership_mutation() from public,anon,authenticated;
revoke all on function public.get_organization_management_overview(uuid) from public,anon;
revoke all on function public.manage_organization(uuid,uuid,text,uuid,text,text) from public,anon;
grant execute on function public.get_organization_management_overview(uuid) to authenticated;
grant execute on function public.manage_organization(uuid,uuid,text,uuid,text,text) to authenticated;

commit;
