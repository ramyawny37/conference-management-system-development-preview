begin;

do $$
begin
  if to_regclass('public.platform_modules') is null
     or to_regclass('public.module_permission_catalog') is null
     or to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is null
     or to_regprocedure('platform_private.validated_phase1c_device_authorization(uuid,uuid)') is null
     or to_regclass('platform.audit_events') is null
     or not exists (select 1 from public.platform_modules where module_key='reservations' and status='active') then
    raise exception 'RESERVATIONS_PLATFORM_FOUNDATION_REQUIRED' using errcode='55000';
  end if;
end;
$$;

create extension if not exists btree_gist with schema extensions;
create schema reservations;
create schema reservations_private;
revoke all on schema reservations,reservations_private from public,anon,authenticated;

create table reservations.guests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  display_name text not null check (display_name=btrim(display_name) and char_length(display_name) between 1 and 160),
  phone text check (phone is null or (phone=btrim(phone) and char_length(phone) between 3 and 40)),
  email text check (email is null or (email=lower(btrim(email)) and char_length(email) between 3 and 254 and email like '%_@_%._%')),
  status text not null default 'active' check (status in ('active','inactive')),
  revision bigint not null default 1 check (revision>0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references platform.profiles(user_id) on delete restrict,
  updated_by uuid not null references platform.profiles(user_id) on delete restrict,
  unique(organization_id,id),
  check(updated_at>=created_at)
);

create table reservations.assignable_resources (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  parent_resource_id uuid,
  resource_type text not null check (resource_type in ('property','unit')),
  code text not null check (code=btrim(code) and char_length(code) between 1 and 64 and code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 160),
  capacity_adults integer not null check (capacity_adults>=1 and capacity_adults<=10000),
  capacity_children integer not null default 0 check (capacity_children>=0 and capacity_children<=10000),
  status text not null default 'active' check (status in ('active','inactive')),
  revision bigint not null default 1 check (revision>0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references platform.profiles(user_id) on delete restrict,
  updated_by uuid not null references platform.profiles(user_id) on delete restrict,
  unique(organization_id,id),
  unique(organization_id,code),
  foreign key(organization_id,parent_resource_id) references reservations.assignable_resources(organization_id,id) on delete restrict,
  check((resource_type='property' and parent_resource_id is null) or (resource_type='unit' and parent_resource_id is not null)),
  check(updated_at>=created_at)
);

create table reservations.reservation_number_counters (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  next_value bigint not null default 1 check(next_value>0),
  updated_at timestamptz not null default statement_timestamp()
);

create table reservations.reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reservation_number text not null check (reservation_number ~ '^RSV-[0-9]{8}$'),
  guest_id uuid not null,
  arrival_date date not null,
  departure_date date not null,
  adults integer not null check(adults>=1 and adults<=10000),
  children integer not null default 0 check(children>=0 and children<=10000),
  status text not null default 'draft' check(status in ('draft','confirmed','checked_in','checked_out','cancelled')),
  notes text check(notes is null or char_length(notes)<=4000),
  currency_code text check(currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  total_amount numeric(18,2) check(total_amount is null or total_amount>=0),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references platform.profiles(user_id) on delete restrict,
  updated_by uuid not null references platform.profiles(user_id) on delete restrict,
  created_by_device_id uuid not null references platform.devices(id) on delete restrict,
  updated_by_device_id uuid not null references platform.devices(id) on delete restrict,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text check(cancellation_reason is null or (cancellation_reason=btrim(cancellation_reason) and char_length(cancellation_reason) between 1 and 1000)),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  unique(organization_id,id),
  unique(organization_id,reservation_number),
  foreign key(organization_id,guest_id) references reservations.guests(organization_id,id) on delete restrict,
  check(departure_date>arrival_date),
  check(updated_at>=created_at),
  check((status='draft' and confirmed_at is null and cancelled_at is null and checked_in_at is null and checked_out_at is null)
     or (status='confirmed' and confirmed_at is not null and cancelled_at is null and checked_in_at is null and checked_out_at is null)
     or (status='checked_in' and confirmed_at is not null and cancelled_at is null and checked_in_at is not null and checked_out_at is null)
     or (status='checked_out' and confirmed_at is not null and cancelled_at is null and checked_in_at is not null and checked_out_at is not null)
     or (status='cancelled' and cancelled_at is not null and checked_in_at is null and checked_out_at is null))
);

create table reservations.assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reservation_id uuid not null,
  resource_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check(status in ('active','released')),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  created_by uuid not null references platform.profiles(user_id) on delete restrict,
  released_by uuid references platform.profiles(user_id) on delete restrict,
  created_by_device_id uuid not null references platform.devices(id) on delete restrict,
  released_by_device_id uuid references platform.devices(id) on delete restrict,
  unique(organization_id,id),
  foreign key(organization_id,reservation_id) references reservations.reservations(organization_id,id) on delete restrict,
  foreign key(organization_id,resource_id) references reservations.assignable_resources(organization_id,id) on delete restrict,
  check(ends_on>starts_on),
  check((status='active' and released_at is null and released_by is null and released_by_device_id is null)
     or (status='released' and released_at is not null and released_by is not null and released_by_device_id is not null))
);
create unique index reservations_one_active_assignment_idx on reservations.assignments(reservation_id) where status='active';
alter table reservations.assignments add constraint reservations_assignment_no_overlap
  exclude using gist (resource_id with =,daterange(starts_on,ends_on,'[)') with &&) where (status='active');

create table reservations.operations (
  operation_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null references platform.profiles(user_id) on delete restrict,
  device_id uuid not null references platform.devices(id) on delete restrict,
  operation_name text not null check(operation_name ~ '^[a-z][a-z0-9_]{2,79}$'),
  intent_hash text not null check(intent_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default statement_timestamp()
);

create index reservations_guest_search_idx on reservations.guests(organization_id,status,display_name,id);
create index reservations_list_idx on reservations.reservations(organization_id,arrival_date,id);
create index reservations_assignment_reservation_idx on reservations.assignments(organization_id,reservation_id,status);
create index reservations_audit_lookup_idx on platform.audit_events(module,entity_type,entity_id,occurred_at desc) where module='reservations';

alter table reservations.guests enable row level security;
alter table reservations.guests force row level security;
alter table reservations.assignable_resources enable row level security;
alter table reservations.assignable_resources force row level security;
alter table reservations.reservation_number_counters enable row level security;
alter table reservations.reservation_number_counters force row level security;
alter table reservations.reservations enable row level security;
alter table reservations.reservations force row level security;
alter table reservations.assignments enable row level security;
alter table reservations.assignments force row level security;
alter table reservations.operations enable row level security;
alter table reservations.operations force row level security;
revoke all on all tables in schema reservations from public,anon,authenticated;

insert into public.module_permission_catalog(permission_key,module_key,display_name,description,status,allowed_scope_mode,allowed_resource_type,sensitive_mutation,catalog_version)
values
 ('reservations.booking.view','reservations','View reservations','View organization-scoped reservation and guest information.','active','module',null,false,1),
 ('reservations.booking.create','reservations','Create reservations','Create organization-scoped reservations and guests.','active','module',null,true,1),
 ('reservations.booking.update','reservations','Update reservations','Update editable reservation booking details.','active','module',null,true,1),
 ('reservations.booking.cancel','reservations','Cancel reservations','Cancel eligible draft or confirmed reservations.','active','module',null,true,1),
 ('reservations.assignment.manage','reservations','Manage reservation assignments','Assign eligible resources without booking overlap.','active','module',null,true,1),
 ('reservations.stay.check_in','reservations','Check in reservations','Check in a confirmed and assigned reservation.','active','module',null,true,1),
 ('reservations.stay.check_out','reservations','Check out reservations','Check out an active stay.','active','module',null,true,1)
on conflict(permission_key) do nothing;

create function reservations_private.context(p_device_id uuid,p_organization_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb; actor uuid;
begin
  c:=public.require_effective_module_permission(p_device_id,'reservations',p_permission,null,null);
  actor:=(c->>'actorUserId')::uuid;
  if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active')
     or not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=actor) then
    raise exception 'RESERVATIONS_ORGANIZATION_ACCESS_REQUIRED' using errcode='42501';
  end if;
  return c||jsonb_build_object('organizationId',p_organization_id);
end;
$$;

create function reservations_private.intent(p_operation text,p_organization_id uuid,p_args jsonb)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('operation',p_operation,'organizationId',p_organization_id,'args',p_args)::text,'UTF8'),'sha256'),'hex');
$$;

create function reservations_private.replay(p_operation_id uuid,p_organization_id uuid,p_actor uuid,p_device uuid,p_operation text,p_intent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior reservations.operations%rowtype;
begin
  if p_operation_id is null then raise exception 'RESERVATIONS_OPERATION_ID_REQUIRED' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reservations-operation:'||p_operation_id::text,0));
  select * into prior from reservations.operations where operation_id=p_operation_id;
  if not found then return null; end if;
  if prior.organization_id<>p_organization_id or prior.actor_user_id<>p_actor or prior.device_id<>p_device
     or prior.operation_name<>p_operation or prior.intent_hash<>p_intent then
    raise exception 'RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT' using errcode='40001';
  end if;
  return prior.result;
end;
$$;

create function reservations_private.complete(p_operation_id uuid,p_organization_id uuid,p_actor uuid,p_device uuid,p_operation text,p_intent text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 insert into reservations.operations(operation_id,organization_id,actor_user_id,device_id,operation_name,intent_hash,result)
 values(p_operation_id,p_organization_id,p_actor,p_device,p_operation,p_intent,p_result);
 return p_result;
end;
$$;

create function reservations_private.audit(p_context jsonb,p_action text,p_entity_id uuid,p_operation_id uuid,p_old jsonb,p_new jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(p_context->>'actorUserId')::uuid; device uuid:=(p_context->>'actorDeviceId')::uuid; v_authorization_id uuid;
begin
 v_authorization_id:=platform_private.validated_phase1c_device_authorization(actor,device);
 if v_authorization_id is null then raise exception 'RESERVATIONS_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,old_values,new_values,metadata,operation_id,source)
 values(actor,v_authorization_id,null,'platform','reservations',p_action,'reservation',p_entity_id,'platform',null,p_old,p_new,
   jsonb_build_object('organizationId',p_context->>'organizationId','deviceId',device,'operation',p_action),p_operation_id,'rpc');
end;
$$;

create function reservations_private.allocate_number(p_organization_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare allocated bigint;
begin
 insert into reservations.reservation_number_counters(organization_id,next_value) values(p_organization_id,2)
 on conflict(organization_id) do update set next_value=reservations.reservation_number_counters.next_value+1,updated_at=statement_timestamp()
 returning next_value-1 into allocated;
 return 'RSV-'||lpad(allocated::text,8,'0');
end;
$$;

create function reservations.list_reservations(p_device_id uuid,p_organization_id uuid,p_status text,p_from date,p_to date,p_before_arrival date,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=reservations_private.context(p_device_id,p_organization_id,'reservations.booking.view');
 if p_limit is null or p_limit<1 or p_limit>100 or (p_status is not null and p_status not in ('draft','confirmed','checked_in','checked_out','cancelled'))
    or (p_from is not null and p_to is not null and p_to<p_from) then raise exception 'RESERVATIONS_LIST_ARGUMENTS_INVALID' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.arrival_date,x.id) from (
   select r.id,r.organization_id,r.reservation_number,r.arrival_date,r.departure_date,r.adults,r.children,r.status,r.currency_code,r.total_amount,r.revision,
     jsonb_build_object('id',g.id,'displayName',g.display_name,'phone',g.phone,'email',g.email) guest
   from reservations.reservations r join reservations.guests g on (g.organization_id,g.id)=(r.organization_id,r.guest_id)
   where r.organization_id=p_organization_id and (p_status is null or r.status=p_status)
     and (p_from is null or r.departure_date>p_from) and (p_to is null or r.arrival_date<p_to)
     and (p_before_arrival is null or (r.arrival_date,r.id)>(p_before_arrival,p_before_id))
   order by r.arrival_date,r.id limit p_limit) x),'[]'::jsonb);
end;
$$;

create function reservations.get_reservation(p_device_id uuid,p_organization_id uuid,p_reservation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb; result jsonb;
begin
 c:=reservations_private.context(p_device_id,p_organization_id,'reservations.booking.view');
 select to_jsonb(x) into result from (
   select r.*,jsonb_build_object('id',g.id,'displayName',g.display_name,'phone',g.phone,'email',g.email,'status',g.status) guest,
    (select to_jsonb(a) from reservations.assignments a where a.organization_id=r.organization_id and a.reservation_id=r.id and a.status='active') assignment
   from reservations.reservations r join reservations.guests g on (g.organization_id,g.id)=(r.organization_id,r.guest_id)
   where r.organization_id=p_organization_id and r.id=p_reservation_id) x;
 if result is null then raise exception 'RESERVATIONS_RESERVATION_NOT_FOUND' using errcode='P0002'; end if;
 return result;
end;
$$;

create function reservations.search_reservation_guests(p_device_id uuid,p_organization_id uuid,p_query text,p_before_name text,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb; q text:=lower(btrim(coalesce(p_query,'')));
begin
 c:=reservations_private.context(p_device_id,p_organization_id,'reservations.booking.view');
 if char_length(q)>160 or p_limit is null or p_limit<1 or p_limit>50 then raise exception 'RESERVATIONS_GUEST_SEARCH_INVALID' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.display_name,x.id) from (
  select id,display_name,phone,email,status,revision from reservations.guests
  where organization_id=p_organization_id and status='active'
    and (q='' or lower(display_name) like '%'||q||'%' or lower(coalesce(email,'')) like '%'||q||'%' or coalesce(phone,'') like '%'||q||'%')
    and (p_before_name is null or (display_name,id)>(p_before_name,p_before_id)) order by display_name,id limit p_limit) x),'[]'::jsonb);
end;
$$;

create function reservations.list_assignable_resources(p_device_id uuid,p_organization_id uuid,p_from date,p_to date,p_adults integer,p_children integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=reservations_private.context(p_device_id,p_organization_id,'reservations.booking.view');
 if p_from is null or p_to<=p_from or p_adults<1 or p_children<0 or p_limit is null or p_limit<1 or p_limit>100 then raise exception 'RESERVATIONS_RESOURCE_SEARCH_INVALID' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.code,x.id) from (
  select r.id,r.parent_resource_id,r.resource_type,r.code,r.name,r.capacity_adults,r.capacity_children,r.revision
  from reservations.assignable_resources r where r.organization_id=p_organization_id and r.resource_type='unit' and r.status='active'
   and r.capacity_adults>=p_adults and r.capacity_children>=p_children and not exists(select 1 from reservations.assignments a where a.resource_id=r.id and a.status='active' and daterange(a.starts_on,a.ends_on,'[)')&&daterange(p_from,p_to,'[)'))
  order by r.code,r.id limit p_limit) x),'[]'::jsonb);
end;
$$;

create function reservations.get_reservation_history(p_device_id uuid,p_organization_id uuid,p_reservation_id uuid,p_before timestamptz,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=reservations_private.context(p_device_id,p_organization_id,'reservations.booking.view');
 if p_limit is null or p_limit<1 or p_limit>100 or not exists(select 1 from reservations.reservations where organization_id=p_organization_id and id=p_reservation_id) then raise exception 'RESERVATIONS_HISTORY_ARGUMENTS_INVALID' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc) from (
  select id,action,old_values,new_values,metadata,operation_id,occurred_at from platform.audit_events
  where module='reservations' and entity_type='reservation' and entity_id=p_reservation_id and metadata->>'organizationId'=p_organization_id::text and (p_before is null or occurred_at<p_before)
  order by occurred_at desc,id desc limit p_limit) x),'[]'::jsonb);
end;
$$;

create function reservations.mutate(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,platform,platform_private,reservations,reservations_private as $$
declare
  v_organization_id uuid:=(p_args->>'p_organization_id')::uuid;
  v_reservation_id uuid:=(p_args->>'p_reservation_id')::uuid;
  v_operation_id uuid:=(p_args->>'p_operation_id')::uuid;
  v_expected_revision bigint:=(p_args->>'p_expected_revision')::bigint;
  v_permission text; v_context jsonb; v_actor uuid; v_intent text; v_replay jsonb; v_result jsonb;
  v_current reservations.reservations%rowtype;
  v_guest_id uuid:=(p_args->>'p_guest_id')::uuid;
  v_resource reservations.assignable_resources%rowtype;
  v_number text; v_new_revision bigint; v_guest jsonb:=p_args->'p_guest';
begin
  v_permission:=case p_operation
    when 'create_reservation' then 'reservations.booking.create'
    when 'update_reservation' then 'reservations.booking.update'
    when 'confirm_reservation' then 'reservations.booking.update'
    when 'cancel_reservation' then 'reservations.booking.cancel'
    when 'assign_reservation' then 'reservations.assignment.manage'
    when 'check_in_reservation' then 'reservations.stay.check_in'
    when 'check_out_reservation' then 'reservations.stay.check_out'
    else null end;
  if v_permission is null or v_organization_id is null or v_operation_id is null then raise exception 'RESERVATIONS_MUTATION_ARGUMENTS_INVALID' using errcode='22023'; end if;
  v_context:=reservations_private.context(p_device_id,v_organization_id,v_permission);
  v_actor:=(v_context->>'actorUserId')::uuid;
  v_intent:=reservations_private.intent(p_operation,v_organization_id,p_args-'p_operation_id');
  v_replay:=reservations_private.replay(v_operation_id,v_organization_id,v_actor,p_device_id,p_operation,v_intent);
  if v_replay is not null then return v_replay; end if;

  if p_operation='create_reservation' then
    if v_guest_id is null then
      if v_guest is null then raise exception 'RESERVATIONS_GUEST_REFERENCE_INVALID' using errcode='22023'; end if;
      perform platform_private.require_exact_jsonb_keys(v_guest,array['displayName','phone','email']);
      insert into reservations.guests(organization_id,display_name,phone,email,created_by,updated_by)
      values(v_organization_id,btrim(v_guest->>'displayName'),nullif(btrim(v_guest->>'phone'),''),nullif(lower(btrim(v_guest->>'email')),''),v_actor,v_actor) returning id into v_guest_id;
    elsif v_guest is not null then raise exception 'RESERVATIONS_GUEST_REFERENCE_INVALID' using errcode='22023';
    end if;
    if not exists(select 1 from reservations.guests g where g.organization_id=v_organization_id and g.id=v_guest_id and g.status='active') then raise exception 'RESERVATIONS_GUEST_NOT_FOUND' using errcode='P0002'; end if;
    v_number:=reservations_private.allocate_number(v_organization_id);
    insert into reservations.reservations(organization_id,reservation_number,guest_id,arrival_date,departure_date,adults,children,notes,currency_code,total_amount,created_by,updated_by,created_by_device_id,updated_by_device_id)
    values(v_organization_id,v_number,v_guest_id,(p_args->>'p_arrival_date')::date,(p_args->>'p_departure_date')::date,(p_args->>'p_adults')::integer,(p_args->>'p_children')::integer,nullif(p_args->>'p_notes',''),nullif(p_args->>'p_currency_code',''),(p_args->>'p_total_amount')::numeric,v_actor,v_actor,p_device_id,p_device_id)
    returning id,revision into v_reservation_id,v_new_revision;
    v_result:=jsonb_build_object('status','created','reservationId',v_reservation_id,'reservationNumber',v_number,'revision',v_new_revision,'guestId',v_guest_id);
    perform reservations_private.audit(v_context,'reservation.created',v_reservation_id,v_operation_id,null,jsonb_build_object('status','draft','revision',v_new_revision));

  else
    if v_reservation_id is null or v_expected_revision is null then raise exception 'RESERVATIONS_REVISION_REQUIRED' using errcode='22023'; end if;
    select r.* into v_current from reservations.reservations r where r.id=v_reservation_id and r.organization_id=v_organization_id for update;
    if not found then raise exception 'RESERVATIONS_RESERVATION_NOT_FOUND' using errcode='P0002'; end if;
    if v_current.revision<>v_expected_revision then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;

    if p_operation='update_reservation' then
      if v_current.status not in ('draft','confirmed') then raise exception 'RESERVATIONS_TERMINAL_STATE' using errcode='22023'; end if;
      if exists(select 1 from reservations.assignments a where a.organization_id=v_organization_id and a.reservation_id=v_reservation_id and a.status='active' and (a.starts_on<>(p_args->>'p_arrival_date')::date or a.ends_on<>(p_args->>'p_departure_date')::date)) then raise exception 'RESERVATIONS_ACTIVE_ASSIGNMENT_DATE_CHANGE_DENIED' using errcode='22023'; end if;
      v_guest_id:=coalesce(v_guest_id,v_current.guest_id);
      if not exists(select 1 from reservations.guests g where g.organization_id=v_organization_id and g.id=v_guest_id and g.status='active') then raise exception 'RESERVATIONS_GUEST_NOT_FOUND' using errcode='P0002'; end if;
      update reservations.reservations r set guest_id=v_guest_id,arrival_date=(p_args->>'p_arrival_date')::date,departure_date=(p_args->>'p_departure_date')::date,
        adults=(p_args->>'p_adults')::integer,children=(p_args->>'p_children')::integer,notes=nullif(p_args->>'p_notes',''),currency_code=nullif(p_args->>'p_currency_code',''),total_amount=(p_args->>'p_total_amount')::numeric,
        revision=r.revision+1,updated_at=statement_timestamp(),updated_by=v_actor,updated_by_device_id=p_device_id
      where r.id=v_reservation_id and r.organization_id=v_organization_id and r.revision=v_expected_revision returning r.revision into v_new_revision;
      v_result:=jsonb_build_object('status','updated','reservationId',v_reservation_id,'revision',v_new_revision);
      perform reservations_private.audit(v_context,'reservation.updated',v_reservation_id,v_operation_id,jsonb_build_object('revision',v_current.revision,'status',v_current.status),jsonb_build_object('revision',v_new_revision,'status',v_current.status));

    elsif p_operation='confirm_reservation' then
      if v_current.status<>'draft' then raise exception 'RESERVATIONS_TRANSITION_INVALID' using errcode='22023'; end if;
      update reservations.reservations r set status='confirmed',confirmed_at=statement_timestamp(),revision=r.revision+1,updated_at=statement_timestamp(),updated_by=v_actor,updated_by_device_id=p_device_id where r.id=v_reservation_id and r.revision=v_expected_revision returning r.revision into v_new_revision;
      v_result:=jsonb_build_object('status','confirmed','reservationId',v_reservation_id,'revision',v_new_revision);
      perform reservations_private.audit(v_context,'reservation.confirmed',v_reservation_id,v_operation_id,jsonb_build_object('status','draft','revision',v_current.revision),jsonb_build_object('status','confirmed','revision',v_new_revision));

    elsif p_operation='cancel_reservation' then
      if v_current.status not in ('draft','confirmed') or nullif(btrim(p_args->>'p_reason'),'') is null then raise exception 'RESERVATIONS_CANCELLATION_INVALID' using errcode='22023'; end if;
      update reservations.assignments a set status='released',revision=a.revision+1,released_at=statement_timestamp(),released_by=v_actor,released_by_device_id=p_device_id where a.organization_id=v_organization_id and a.reservation_id=v_reservation_id and a.status='active';
      update reservations.reservations r set status='cancelled',cancelled_at=statement_timestamp(),cancellation_reason=btrim(p_args->>'p_reason'),revision=r.revision+1,updated_at=statement_timestamp(),updated_by=v_actor,updated_by_device_id=p_device_id where r.id=v_reservation_id and r.revision=v_expected_revision returning r.revision into v_new_revision;
      v_result:=jsonb_build_object('status','cancelled','reservationId',v_reservation_id,'revision',v_new_revision);
      perform reservations_private.audit(v_context,'reservation.cancelled',v_reservation_id,v_operation_id,jsonb_build_object('status',v_current.status,'revision',v_current.revision),jsonb_build_object('status','cancelled','revision',v_new_revision));

    elsif p_operation='assign_reservation' then
      if v_current.status not in ('draft','confirmed') then raise exception 'RESERVATIONS_ASSIGNMENT_STATE_INVALID' using errcode='22023'; end if;
      select r.* into v_resource from reservations.assignable_resources r where r.organization_id=v_organization_id and r.id=(p_args->>'p_resource_id')::uuid for update;
      if not found or v_resource.status<>'active' or v_resource.resource_type<>'unit' then raise exception 'RESERVATIONS_RESOURCE_INACTIVE' using errcode='22023'; end if;
      if v_resource.capacity_adults<v_current.adults or v_resource.capacity_children<v_current.children then raise exception 'RESERVATIONS_RESOURCE_CAPACITY_EXCEEDED' using errcode='22023'; end if;
      update reservations.assignments a set status='released',revision=a.revision+1,released_at=statement_timestamp(),released_by=v_actor,released_by_device_id=p_device_id where a.organization_id=v_organization_id and a.reservation_id=v_reservation_id and a.status='active';
      begin
        insert into reservations.assignments(organization_id,reservation_id,resource_id,starts_on,ends_on,created_by,created_by_device_id)
        values(v_organization_id,v_reservation_id,v_resource.id,v_current.arrival_date,v_current.departure_date,v_actor,p_device_id);
      exception when exclusion_violation or unique_violation then raise exception 'RESERVATIONS_ASSIGNMENT_OVERLAP' using errcode='40001'; end;
      update reservations.reservations r set revision=r.revision+1,updated_at=statement_timestamp(),updated_by=v_actor,updated_by_device_id=p_device_id where r.id=v_reservation_id and r.revision=v_expected_revision returning r.revision into v_new_revision;
      v_result:=jsonb_build_object('status','assigned','reservationId',v_reservation_id,'resourceId',v_resource.id,'revision',v_new_revision);
      perform reservations_private.audit(v_context,'reservation.assigned',v_reservation_id,v_operation_id,jsonb_build_object('revision',v_current.revision),jsonb_build_object('revision',v_new_revision,'resourceId',v_resource.id));

    elsif p_operation='check_in_reservation' then
      if v_current.status<>'confirmed' or not exists(select 1 from reservations.assignments a where a.organization_id=v_organization_id and a.reservation_id=v_reservation_id and a.status='active') then raise exception 'RESERVATIONS_CHECK_IN_REQUIRES_ASSIGNMENT' using errcode='22023'; end if;
      update reservations.reservations r set status='checked_in',checked_in_at=statement_timestamp(),revision=r.revision+1,updated_at=statement_timestamp(),updated_by=v_actor,updated_by_device_id=p_device_id where r.id=v_reservation_id and r.revision=v_expected_revision returning r.revision into v_new_revision;
      v_result:=jsonb_build_object('status','checked_in','reservationId',v_reservation_id,'revision',v_new_revision);
      perform reservations_private.audit(v_context,'reservation.checked_in',v_reservation_id,v_operation_id,jsonb_build_object('status','confirmed','revision',v_current.revision),jsonb_build_object('status','checked_in','revision',v_new_revision));

    elsif p_operation='check_out_reservation' then
      if v_current.status<>'checked_in' then raise exception 'RESERVATIONS_TRANSITION_INVALID' using errcode='22023'; end if;
      update reservations.reservations r set status='checked_out',checked_out_at=statement_timestamp(),revision=r.revision+1,updated_at=statement_timestamp(),updated_by=v_actor,updated_by_device_id=p_device_id where r.id=v_reservation_id and r.revision=v_expected_revision returning r.revision into v_new_revision;
      update reservations.assignments a set status='released',revision=a.revision+1,released_at=statement_timestamp(),released_by=v_actor,released_by_device_id=p_device_id where a.organization_id=v_organization_id and a.reservation_id=v_reservation_id and a.status='active';
      v_result:=jsonb_build_object('status','checked_out','reservationId',v_reservation_id,'revision',v_new_revision);
      perform reservations_private.audit(v_context,'reservation.checked_out',v_reservation_id,v_operation_id,jsonb_build_object('status','checked_in','revision',v_current.revision),jsonb_build_object('status','checked_out','revision',v_new_revision));
    end if;
  end if;
  return reservations_private.complete(v_operation_id,v_organization_id,v_actor,p_device_id,p_operation,v_intent,v_result);
end;
$$;

revoke all on all functions in schema reservations_private from public,anon,authenticated,service_role;
revoke all on all functions in schema reservations from public,anon,authenticated,service_role;
grant usage on schema reservations to service_role;
grant execute on function reservations.list_reservations(uuid,uuid,text,date,date,date,uuid,integer),reservations.get_reservation(uuid,uuid,uuid),reservations.search_reservation_guests(uuid,uuid,text,text,uuid,integer),reservations.list_assignable_resources(uuid,uuid,date,date,integer,integer,integer),reservations.get_reservation_history(uuid,uuid,uuid,timestamptz,integer) to service_role;
grant execute on function reservations.mutate(uuid,text,jsonb) to service_role;

commit;
