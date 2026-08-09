begin;

do $$
begin
  if exists (
    select 1 from public.organization_templates
    group by template_type,template_id
    having count(distinct md5(coalesce(payload::text,'null')||'|'||
      (deleted_at is not null)::text))>1
  ) then
    raise exception 'SHARED_TEMPLATE_MIGRATION_IDENTITY_CONFLICT'
      using errcode='23505';
  end if;
end;
$$;

create table public.library_templates (
  template_type text not null check (template_type in ('house','conference')),
  template_id text not null check (length(btrim(template_id)) between 1 and 160),
  payload jsonb null check (payload is null or jsonb_typeof(payload)='object'),
  revision bigint not null default 1 check (revision>0),
  deleted_at timestamptz null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(template_type,template_id),
  check ((deleted_at is null and payload is not null) or
    (deleted_at is not null and payload is null))
);

create table public.organization_template_access (
  template_type text not null,
  template_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  primary key(template_type,template_id,organization_id),
  foreign key(template_type,template_id) references public.library_templates(template_type,template_id) on delete cascade
);

create table public.library_template_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_device_id uuid not null references public.devices(id) on delete restrict,
  template_type text not null,
  template_id text not null,
  action text not null check(action in ('upsert','delete')),
  base_revision bigint not null check(base_revision>=0),
  intent_hash text not null,
  result_status text not null check(result_status in ('created','updated','deleted','unchanged')),
  resulting_revision bigint not null,
  stored_result jsonb not null check(jsonb_typeof(stored_result)='object'),
  created_at timestamptz not null default now()
);

create table public.organization_template_access_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_device_id uuid not null references public.devices(id) on delete restrict,
  template_type text not null,
  template_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action text not null check(action in ('grant','revoke')),
  intent_hash text not null,
  result_status text not null check(result_status in ('granted','revoked','unchanged')),
  stored_result jsonb not null check(jsonb_typeof(stored_result)='object'),
  created_at timestamptz not null default now()
);

create table public.library_template_audit_log (
  id uuid primary key default gen_random_uuid(),
  template_type text not null,template_id text not null,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_device_id uuid null references public.devices(id) on delete set null,
  operation_id uuid not null unique,
  action text not null check(action in ('upsert','delete')),
  previous_revision bigint not null,resulting_revision bigint not null,
  created_at timestamptz not null default now()
);

create table public.organization_template_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  template_type text not null,template_id text not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_device_id uuid null references public.devices(id) on delete set null,
  operation_id uuid not null unique,
  action text not null check(action in ('grant','revoke')),
  result_status text not null,
  created_at timestamptz not null default now()
);

create table public.organization_template_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_type text not null check(template_type in ('house','conference')),
  template_id text not null,
  revision bigint not null check(revision>=0),
  event_type text not null check(event_type in ('content_changed','template_deleted','access_granted','access_revoked')),
  created_at timestamptz not null default now()
);

create index library_templates_changed on public.library_templates(updated_at,template_type,template_id);
create index organization_template_access_scope on public.organization_template_access(organization_id,revoked_at,template_type,template_id);
create index organization_template_events_scope on public.organization_template_events(organization_id,id);
create index library_template_operations_template on public.library_template_operations(template_type,template_id,created_at);
create index organization_template_access_operations_scope on public.organization_template_access_operations(organization_id,template_type,template_id,created_at);

insert into public.library_templates(template_type,template_id,payload,revision,deleted_at,owner_user_id,created_by,updated_by,created_at,updated_at)
select template_type,template_id,(array_agg(payload order by created_at))[1],max(revision),
  (array_agg(deleted_at order by created_at))[1],(array_agg(created_by order by created_at))[1],
  (array_agg(created_by order by created_at))[1],(array_agg(updated_by order by updated_at desc))[1],
  min(created_at),max(updated_at)
from public.organization_templates group by template_type,template_id;

insert into public.organization_template_access(template_type,template_id,organization_id,granted_by,granted_at,revoked_at)
select template_type,template_id,organization_id,created_by,created_at,null
from public.organization_templates;

alter table public.library_templates enable row level security;
alter table public.organization_template_access enable row level security;
alter table public.library_template_operations enable row level security;
alter table public.organization_template_access_operations enable row level security;
alter table public.library_template_audit_log enable row level security;
alter table public.organization_template_access_audit_log enable row level security;
alter table public.organization_template_events enable row level security;

revoke all on public.library_templates,public.organization_template_access,
  public.library_template_operations,public.organization_template_access_operations,
  public.library_template_audit_log,public.organization_template_access_audit_log,
  public.organization_template_events from public,anon,authenticated;

create policy organization_template_events_member_read on public.organization_template_events
for select to authenticated using(exists(select 1 from public.organization_members m
  where m.organization_id=organization_template_events.organization_id and m.user_id=auth.uid()));
grant select on public.organization_template_events to authenticated;

create or replace function public.list_shared_organization_templates(p_actor_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); rows jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  select coalesce(jsonb_agg(item order by item->>'templateType',item->>'templateId'),'[]'::jsonb) into rows
  from (
    select jsonb_build_object('templateType',t.template_type,'templateId',t.template_id,
      'payload',t.payload,'revision',t.revision,'deletedAt',t.deleted_at,
      'ownerUserId',t.owner_user_id,'accessibleOrganizationIds',
      jsonb_agg(a.organization_id order by a.organization_id)) item
    from public.library_templates t join public.organization_template_access a
      on (a.template_type,a.template_id)=(t.template_type,t.template_id)
    join public.organization_members m on m.organization_id=a.organization_id and m.user_id=actor_id
    where a.revoked_at is null
    group by t.template_type,t.template_id,t.payload,t.revision,t.deleted_at,t.owner_user_id
  ) visible;
  return jsonb_build_object('status','success','templates',rows);
end;$$;

create or replace function public.apply_library_template_content_operation(
  p_actor_device_id uuid,p_operation_id uuid,p_template_type text,p_template_id text,
  p_action text,p_base_revision bigint,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare actor_id uuid:=auth.uid(); current_row public.library_templates%rowtype;
  prior public.library_template_operations%rowtype; normalized_id text:=btrim(coalesce(p_template_id,''));
  intent text; result jsonb; result_status text; next_revision bigint;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  perform public.require_current_approved_device(p_actor_device_id);
  if p_operation_id is null or p_template_type not in ('house','conference') or p_action not in ('upsert','delete') or
    length(normalized_id) not between 1 and 160 or p_base_revision is null or p_base_revision<0 or
    (p_action='upsert' and (p_payload is null or jsonb_typeof(p_payload)<>'object')) or
    (p_action='delete' and p_payload is not null) then raise exception 'INVALID_TEMPLATE_OPERATION' using errcode='22023'; end if;
  intent:=encode(digest(actor_id::text||'|'||p_template_type||'|'||normalized_id||'|'||p_action||'|'||p_base_revision::text||'|'||coalesce(p_payload::text,'null'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('library-template-operation:'||p_operation_id::text,0));
  select * into prior from public.library_template_operations where operation_id=p_operation_id;
  if found then if prior.actor_user_id<>actor_id or prior.intent_hash<>intent then raise exception 'TEMPLATE_OPERATION_INTENT_MISMATCH' using errcode='22023'; end if;return prior.stored_result;end if;
  perform pg_advisory_xact_lock(hashtextextended('library-template:'||p_template_type||':'||normalized_id,0));
  select * into current_row from public.library_templates where template_type=p_template_type and template_id=normalized_id for update;
  if not found then
    if p_base_revision<>0 or p_action<>'upsert' then return jsonb_build_object('status','conflict','templateType',p_template_type,'templateId',normalized_id,'currentRevision',0);end if;
    insert into public.library_templates(template_type,template_id,payload,owner_user_id,created_by,updated_by) values(p_template_type,normalized_id,p_payload,actor_id,actor_id,actor_id);
    result_status:='created';next_revision:=1;
  else
    if current_row.owner_user_id<>actor_id and not public.is_system_owner(actor_id) then raise exception 'TEMPLATE_OWNER_REQUIRED' using errcode='42501';end if;
    if current_row.revision<>p_base_revision then return jsonb_build_object('status','conflict','templateType',p_template_type,'templateId',normalized_id,'currentRevision',current_row.revision);end if;
    if p_action='delete' and current_row.deleted_at is not null then result_status:='unchanged';next_revision:=current_row.revision;
    elsif p_action='upsert' and current_row.deleted_at is null and current_row.payload=p_payload then result_status:='unchanged';next_revision:=current_row.revision;
    else next_revision:=current_row.revision+1;update public.library_templates set payload=case when p_action='upsert' then p_payload else null end,deleted_at=case when p_action='delete' then now() else null end,revision=next_revision,updated_by=actor_id,updated_at=now() where template_type=p_template_type and template_id=normalized_id;result_status:=case when p_action='delete' then 'deleted' else 'updated' end;end if;
  end if;
  result:=jsonb_build_object('status',result_status,'templateType',p_template_type,'templateId',normalized_id,'operationId',p_operation_id,'revision',next_revision);
  insert into public.library_template_operations values(p_operation_id,actor_id,p_actor_device_id,p_template_type,normalized_id,p_action,p_base_revision,intent,result_status,next_revision,result,now());
  if result_status<>'unchanged' then
    insert into public.library_template_audit_log(template_type,template_id,actor_user_id,actor_device_id,operation_id,action,previous_revision,resulting_revision) values(p_template_type,normalized_id,actor_id,p_actor_device_id,p_operation_id,p_action,p_base_revision,next_revision);
    insert into public.organization_template_events(organization_id,template_type,template_id,revision,event_type)
      select organization_id,p_template_type,normalized_id,next_revision,case when p_action='delete' then 'template_deleted' else 'content_changed' end from public.organization_template_access where template_type=p_template_type and template_id=normalized_id and revoked_at is null;
  end if;
  return result;
end;$$;

create or replace function public.apply_organization_template_access_operation(
  p_actor_device_id uuid,p_operation_id uuid,p_template_type text,p_template_id text,
  p_organization_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare actor_id uuid:=auth.uid(); actor_role text;org_status text;owner_id uuid;template_revision bigint;
  prior public.organization_template_access_operations%rowtype;intent text;result jsonb;result_status text;current_revoked timestamptz;
  normalized_id text:=btrim(coalesce(p_template_id,''));
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
  perform public.require_current_approved_device(p_actor_device_id);
  if p_operation_id is null or p_template_type not in ('house','conference') or
    length(normalized_id) not between 1 and 160 or p_organization_id is null or
    p_action not in ('grant','revoke') then raise exception 'INVALID_TEMPLATE_ACCESS_OPERATION' using errcode='22023';end if;
  intent:=encode(digest(actor_id::text||'|'||p_template_type||'|'||normalized_id||'|'||p_organization_id::text||'|'||p_action,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('template-access-operation:'||p_operation_id::text,0));
  select * into prior from public.organization_template_access_operations where operation_id=p_operation_id;
  if found then if prior.actor_user_id<>actor_id or prior.intent_hash<>intent then raise exception 'TEMPLATE_ACCESS_OPERATION_INTENT_MISMATCH' using errcode='22023';end if;return prior.stored_result;end if;
  select owner_user_id,revision into owner_id,template_revision from public.library_templates where template_type=p_template_type and template_id=normalized_id;
  if not found then raise exception 'TEMPLATE_NOT_FOUND' using errcode='P0002';end if;
  if owner_id<>actor_id and not public.is_system_owner(actor_id) then raise exception 'TEMPLATE_OWNER_REQUIRED' using errcode='42501';end if;
  select m.role,o.status into actor_role,org_status from public.organization_members m join public.organizations o on o.id=m.organization_id where m.organization_id=p_organization_id and m.user_id=actor_id;
  if actor_role not in ('organization_owner','organization_admin') then raise exception 'ORGANIZATION_ADMIN_REQUIRED' using errcode='42501';end if;
  if p_action='grant' and org_status<>'active' then raise exception 'ARCHIVED_ORGANIZATION_READ_ONLY' using errcode='55000';end if;
  perform pg_advisory_xact_lock(hashtextextended('template-access:'||p_template_type||':'||normalized_id||':'||p_organization_id::text,0));
  select revoked_at into current_revoked from public.organization_template_access where template_type=p_template_type and template_id=normalized_id and organization_id=p_organization_id for update;
  if p_action='grant' then
    if found and current_revoked is null then result_status:='unchanged';else insert into public.organization_template_access(template_type,template_id,organization_id,granted_by,revoked_at) values(p_template_type,normalized_id,p_organization_id,actor_id,null) on conflict(template_type,template_id,organization_id) do update set granted_by=excluded.granted_by,granted_at=now(),revoked_at=null;result_status:='granted';end if;
  else
    if not found or current_revoked is not null then result_status:='unchanged';else update public.organization_template_access set revoked_at=now() where template_type=p_template_type and template_id=normalized_id and organization_id=p_organization_id;result_status:='revoked';end if;
  end if;
  result:=jsonb_build_object('status',result_status,'templateType',p_template_type,'templateId',normalized_id,'organizationId',p_organization_id,'operationId',p_operation_id);
  insert into public.organization_template_access_operations values(p_operation_id,actor_id,p_actor_device_id,p_template_type,normalized_id,p_organization_id,p_action,intent,result_status,result,now());
  if result_status<>'unchanged' then insert into public.organization_template_access_audit_log(template_type,template_id,organization_id,actor_user_id,actor_device_id,operation_id,action,result_status) values(p_template_type,normalized_id,p_organization_id,actor_id,p_actor_device_id,p_operation_id,p_action,result_status);insert into public.organization_template_events(organization_id,template_type,template_id,revision,event_type) values(p_organization_id,p_template_type,normalized_id,template_revision,case when p_action='grant' then 'access_granted' else 'access_revoked' end);end if;
  return result;
end;$$;

revoke all on function public.list_shared_organization_templates(uuid) from public,anon;
revoke all on function public.apply_library_template_content_operation(uuid,uuid,text,text,text,bigint,jsonb) from public,anon;
revoke all on function public.apply_organization_template_access_operation(uuid,uuid,text,text,uuid,text) from public,anon;
grant execute on function public.list_shared_organization_templates(uuid) to authenticated;
grant execute on function public.apply_library_template_content_operation(uuid,uuid,text,text,text,bigint,jsonb) to authenticated;
grant execute on function public.apply_organization_template_access_operation(uuid,uuid,text,text,uuid,text) to authenticated;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='organization_template_events') then
    execute 'alter publication supabase_realtime add table public.organization_template_events';
  end if;
end;$$;

commit;
