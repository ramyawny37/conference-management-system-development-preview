begin;

create table public.organization_templates (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_type text not null check (template_type in ('house','conference')),
  template_id text not null check (length(btrim(template_id)) between 1 and 160),
  payload jsonb null check (payload is null or jsonb_typeof(payload)='object'),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz null,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,template_type,template_id),
  check ((deleted_at is null and payload is not null) or
         (deleted_at is not null and payload is null))
);

create index organization_templates_changed
  on public.organization_templates(organization_id,updated_at,template_type,template_id);

create table public.organization_template_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_device_id uuid not null references public.devices(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_type text not null check (template_type in ('house','conference')),
  template_id text not null,
  action text not null check (action in ('upsert','delete')),
  base_revision bigint not null check (base_revision >= 0),
  intent_hash text not null,
  result_status text not null check (result_status in ('created','updated','deleted','unchanged')),
  resulting_revision bigint not null,
  stored_result jsonb not null check (jsonb_typeof(stored_result)='object'),
  created_at timestamptz not null default now()
);

create index organization_template_operations_scope
  on public.organization_template_operations(organization_id,template_type,template_id,created_at);

create table public.organization_template_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  template_type text not null check (template_type in ('house','conference')),
  template_id text not null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_device_id uuid null references public.devices(id) on delete set null,
  operation_id uuid not null unique,
  action text not null check (action in ('upsert','delete')),
  previous_revision bigint not null,
  resulting_revision bigint not null,
  created_at timestamptz not null default now()
);

alter table public.organization_templates enable row level security;
alter table public.organization_template_operations enable row level security;
alter table public.organization_template_audit_log enable row level security;

revoke all on public.organization_templates,
  public.organization_template_operations,
  public.organization_template_audit_log from public,anon,authenticated;

create or replace function public.list_organization_templates(
  p_actor_device_id uuid,
  p_organization_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); rows jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  if not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=actor_id) then
    raise exception 'ORGANIZATION_MEMBERSHIP_REQUIRED' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationId',t.organization_id,'templateType',t.template_type,
    'templateId',t.template_id,'payload',t.payload,'revision',t.revision,
    'deletedAt',t.deleted_at,'updatedAt',t.updated_at)
    order by t.template_type,t.template_id),'[]'::jsonb)
    into rows from public.organization_templates t
    where t.organization_id=p_organization_id;
  return jsonb_build_object('status','success','organizationId',p_organization_id,'templates',rows);
end;
$$;

create or replace function public.apply_organization_template_operation(
  p_actor_device_id uuid,
  p_organization_id uuid,
  p_operation_id uuid,
  p_template_type text,
  p_template_id text,
  p_action text,
  p_base_revision bigint,
  p_payload jsonb default null
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  actor_id uuid:=auth.uid(); actor_role text; org_status text;
  current_row public.organization_templates%rowtype;
  prior public.organization_template_operations%rowtype;
  normalized_id text:=btrim(coalesce(p_template_id,''));
  intent text; result jsonb; result_status text; next_revision bigint;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  select m.role,o.status into actor_role,org_status
    from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.organization_id=p_organization_id and m.user_id=actor_id;
  if actor_role not in ('organization_owner','organization_admin') then raise exception 'ORGANIZATION_ADMIN_REQUIRED' using errcode='42501'; end if;
  if org_status<>'active' then raise exception 'ARCHIVED_ORGANIZATION_READ_ONLY' using errcode='55000'; end if;
  if p_operation_id is null or p_template_type not in ('house','conference') or
     p_action not in ('upsert','delete') or length(normalized_id) not between 1 and 160 or
     p_base_revision is null or p_base_revision<0 or
     (p_action='upsert' and (p_payload is null or jsonb_typeof(p_payload)<>'object')) or
     (p_action='delete' and p_payload is not null) then
    raise exception 'INVALID_TEMPLATE_OPERATION' using errcode='22023';
  end if;
  intent:=encode(digest(actor_id::text||'|'||p_organization_id::text||'|'||p_template_type||'|'||normalized_id||'|'||p_action||'|'||p_base_revision::text||'|'||coalesce(p_payload::text,'null'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('organization-template-operation:'||p_operation_id::text,0));
  select * into prior from public.organization_template_operations where operation_id=p_operation_id;
  if found then
    if prior.actor_user_id<>actor_id or prior.intent_hash<>intent then raise exception 'TEMPLATE_OPERATION_INTENT_MISMATCH' using errcode='22023'; end if;
    return prior.stored_result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organization-template:'||p_organization_id::text||':'||p_template_type||':'||normalized_id,0));
  select * into current_row from public.organization_templates
    where organization_id=p_organization_id and template_type=p_template_type and template_id=normalized_id for update;
  if not found then
    if p_base_revision<>0 then
      return jsonb_build_object('status','conflict','organizationId',p_organization_id,'templateType',p_template_type,'templateId',normalized_id,'currentRevision',0,'currentPayload',null,'deletedAt',null);
    end if;
    if p_action='delete' then result_status:='unchanged';next_revision:=0;
    else
      insert into public.organization_templates(organization_id,template_type,template_id,payload,revision,created_by,updated_by)
      values(p_organization_id,p_template_type,normalized_id,p_payload,1,actor_id,actor_id);
      result_status:='created';next_revision:=1;
    end if;
  else
    if current_row.revision<>p_base_revision then
      return jsonb_build_object('status','conflict','organizationId',p_organization_id,'templateType',p_template_type,'templateId',normalized_id,'currentRevision',current_row.revision,'currentPayload',current_row.payload,'deletedAt',current_row.deleted_at);
    end if;
    if p_action='delete' and current_row.deleted_at is not null then result_status:='unchanged';next_revision:=current_row.revision;
    elsif p_action='upsert' and current_row.deleted_at is null and current_row.payload=p_payload then result_status:='unchanged';next_revision:=current_row.revision;
    else
      next_revision:=current_row.revision+1;
      update public.organization_templates set payload=case when p_action='upsert' then p_payload else null end,
        deleted_at=case when p_action='delete' then now() else null end,
        revision=next_revision,updated_by=actor_id,updated_at=now()
        where organization_id=p_organization_id and template_type=p_template_type and template_id=normalized_id;
      result_status:=case when p_action='delete' then 'deleted' else 'updated' end;
    end if;
  end if;
  result:=jsonb_build_object('status',result_status,'organizationId',p_organization_id,'templateType',p_template_type,'templateId',normalized_id,'operationId',p_operation_id,'revision',next_revision);
  insert into public.organization_template_operations(operation_id,actor_user_id,actor_device_id,organization_id,template_type,template_id,action,base_revision,intent_hash,result_status,resulting_revision,stored_result)
    values(p_operation_id,actor_id,p_actor_device_id,p_organization_id,p_template_type,normalized_id,p_action,p_base_revision,intent,result_status,next_revision,result);
  if result_status<>'unchanged' then
    insert into public.organization_template_audit_log(organization_id,template_type,template_id,actor_user_id,actor_device_id,operation_id,action,previous_revision,resulting_revision)
      values(p_organization_id,p_template_type,normalized_id,actor_id,p_actor_device_id,p_operation_id,p_action,p_base_revision,next_revision);
  end if;
  return result;
end;
$$;

revoke all on function public.list_organization_templates(uuid,uuid) from public,anon;
revoke all on function public.apply_organization_template_operation(uuid,uuid,uuid,text,text,text,bigint,jsonb) from public,anon;
grant execute on function public.list_organization_templates(uuid,uuid) to authenticated;
grant execute on function public.apply_organization_template_operation(uuid,uuid,uuid,text,text,text,bigint,jsonb) to authenticated;

commit;
