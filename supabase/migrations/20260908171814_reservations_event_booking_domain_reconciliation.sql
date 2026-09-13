begin;

do $$
begin
  if to_regclass('reservations.guests') is null or to_regclass('reservations.operations') is null then
    raise exception 'RESERVATIONS_PHASE1B_PREDECESSOR_REQUIRED' using errcode='55000';
  end if;
  if exists(select 1 from reservations.guests) or exists(select 1 from reservations.assignable_resources)
     or exists(select 1 from reservations.reservation_number_counters) or exists(select 1 from reservations.reservations)
     or exists(select 1 from reservations.assignments) or exists(select 1 from reservations.operations) then
    raise exception 'RESERVATIONS_PHASE1B_DATA_REQUIRES_MANUAL_RECONCILIATION' using errcode='55000';
  end if;
  if exists(select 1 from public.module_permission_grants where module_key='reservations') then
    raise exception 'RESERVATIONS_PERMISSION_GRANTS_REQUIRE_MANUAL_RECONCILIATION' using errcode='55000';
  end if;
end;
$$;

drop schema reservations cascade;
drop schema reservations_private cascade;
update public.module_permission_catalog
set status='retired',retired_at=statement_timestamp(),catalog_version=catalog_version+1
where permission_key in('reservations.booking.cancel','reservations.assignment.manage','reservations.stay.check_in','reservations.stay.check_out');

update public.module_permission_catalog
set display_name=case permission_key when 'reservations.booking.view' then 'View bookings' when 'reservations.booking.create' then 'Create bookings' else 'Update bookings' end,
    description=case permission_key when 'reservations.booking.view' then 'View organization participants and bookings.' when 'reservations.booking.create' then 'Create participants and event bookings.' else 'Update participant and booking details.' end,
    catalog_version=catalog_version+1
where permission_key in('reservations.booking.view','reservations.booking.create','reservations.booking.update');

create schema reservations;
create schema reservations_private;
revoke all on schema reservations,reservations_private from public,anon,authenticated;

create table reservations.events(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 name text not null check(name=btrim(name) and char_length(name) between 1 and 200), start_date date not null, end_date date not null,
 location text not null default '' check(char_length(location)<=300), capacity integer check(capacity is null or capacity>0),
 status text not null default 'draft' check(status in('open','closed','full','draft')), notes text not null default '' check(char_length(notes)<=4000),
 revision bigint not null default 1 check(revision>0), created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id),
 unique(organization_id,id), check(end_date>=start_date), check(updated_at>=created_at)
);
create table reservations.event_periods(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 event_id uuid not null, kind text not null check(kind in('conference','caravans')), starts_on date, ends_on date,
 display_order integer not null check(display_order>=0), revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id),
 unique(organization_id,id), unique(organization_id,event_id,id), constraint reservations_event_period_order_unique unique(event_id,display_order) deferrable initially deferred,
 foreign key(organization_id,event_id) references reservations.events(organization_id,id) on delete restrict,
 check((starts_on is null and ends_on is null) or (starts_on is not null and ends_on is not null and ends_on>=starts_on))
);
create table reservations.booking_types(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 event_id uuid not null, name text not null check(name=btrim(name) and char_length(name) between 1 and 160),
 code text not null check(code=btrim(code) and char_length(code) between 1 and 40), price numeric(18,2) not null check(price>=0),
 active boolean not null default true, display_order integer not null check(display_order>=0),
 eligible_attendance_segments text[] not null check(eligible_attendance_segments<@array['conference','caravans']::text[] and cardinality(eligible_attendance_segments) between 1 and 2 and (cardinality(eligible_attendance_segments)=1 or eligible_attendance_segments[1]<>eligible_attendance_segments[2])),
 revision bigint not null default 1 check(revision>0), created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id),
 unique(organization_id,id), unique(organization_id,event_id,id), unique(event_id,code), constraint reservations_booking_type_order_unique unique(event_id,display_order) deferrable initially deferred,
 foreign key(organization_id,event_id) references reservations.events(organization_id,id) on delete restrict
);
create table reservations.participants(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 full_name text not null check(full_name=btrim(full_name) and char_length(full_name) between 1 and 200),
 phone text not null check(phone=btrim(phone) and char_length(phone) between 7 and 20), age integer not null check(age between 1 and 120),
 church text not null default '' check(char_length(church)<=200), governorate text not null check(governorate=btrim(governorate) and char_length(governorate) between 1 and 120),
 city_or_village text not null default '' check(char_length(city_or_village)<=160),
 service_sector text not null check(service_sector in('widows','widows-daughters','discipleship-primary-prep','discipleship-secondary-university','worship','media','servant-preparation','administration','other')),
 service_sector_other text, notes text, revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id), unique(organization_id,id),
 check((service_sector='other' and nullif(btrim(service_sector_other),'') is not null) or (service_sector<>'other' and service_sector_other is null)),
 check(notes is null or char_length(notes)<=4000)
);
create table reservations.booking_number_counters(
 organization_id uuid not null references public.organizations(id) on delete restrict, booking_year integer not null check(booking_year between 2000 and 9999),
 next_value bigint not null default 1 check(next_value>0), updated_at timestamptz not null default statement_timestamp(), primary key(organization_id,booking_year)
);
create table reservations.bookings(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
 booking_number text not null check(booking_number~'^RES-[0-9]{4}-[0-9]{4,}$'), participant_id uuid not null, event_id uuid not null, booking_type_id uuid not null,
 booking_type_name_snapshot text not null, price_snapshot numeric(18,2) not null check(price_snapshot>=0),
 attendance_segments_snapshot text[] not null check(attendance_segments_snapshot<@array['conference','caravans']::text[] and cardinality(attendance_segments_snapshot) between 1 and 2 and (cardinality(attendance_segments_snapshot)=1 or attendance_segments_snapshot[1]<>attendance_segments_snapshot[2])),
 notes text, revision bigint not null default 1 check(revision>0), created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id),
 unique(organization_id,id), unique(organization_id,booking_number),
 foreign key(organization_id,participant_id) references reservations.participants(organization_id,id) on delete restrict,
 foreign key(organization_id,event_id) references reservations.events(organization_id,id) on delete restrict,
 foreign key(organization_id,event_id,booking_type_id) references reservations.booking_types(organization_id,event_id,id) on delete restrict,
 check(notes is null or char_length(notes)<=4000)
);
create table reservations.payments(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict, booking_id uuid not null,
 amount numeric(18,2) not null check(amount>0), payment_date date not null, payment_method text not null check(payment_method in('cash','instapay','e_wallet','bank_transfer','other')),
 payment_method_other text, reference text, notes text, status text not null default 'active' check(status in('active','voided')),
 voided_at timestamptz, void_reason text, voided_by uuid references platform.profiles(user_id), voided_by_device_id uuid references platform.devices(id),
 created_at timestamptz not null default statement_timestamp(), created_by uuid not null references platform.profiles(user_id), created_by_device_id uuid not null references platform.devices(id),
 unique(organization_id,id), foreign key(organization_id,booking_id) references reservations.bookings(organization_id,id) on delete restrict,
 check((payment_method='other' and nullif(btrim(payment_method_other),'') is not null) or (payment_method<>'other' and payment_method_other is null)),
 check(reference is null or char_length(reference)<=200), check(notes is null or char_length(notes)<=4000),
 check((status='active' and voided_at is null and void_reason is null and voided_by is null and voided_by_device_id is null) or
       (status='voided' and voided_at is not null and nullif(btrim(void_reason),'') is not null and voided_by is not null and voided_by_device_id is not null))
);
create table reservations.attendance_records(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict, booking_id uuid not null,
 segment text not null check(segment in('conference','caravans')), attended boolean not null, attendance_date date, notes text,
 revision bigint not null default 1 check(revision>0), created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id),
 unique(organization_id,id), unique(booking_id,segment), foreign key(organization_id,booking_id) references reservations.bookings(organization_id,id) on delete restrict,
 check((attended and attendance_date is not null) or (not attended and attendance_date is null)), check(notes is null or char_length(notes)<=4000)
);
create table reservations.operational_reviews(
 id uuid primary key default extensions.gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict, booking_id uuid not null,
 review_status text not null default 'pending' check(review_status in('pending','completed')), reviewed_at timestamptz,
 reviewed_by uuid references platform.profiles(user_id), reviewed_by_device_id uuid references platform.devices(id), revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id), updated_by uuid not null references platform.profiles(user_id),
 unique(organization_id,id), unique(booking_id), foreign key(organization_id,booking_id) references reservations.bookings(organization_id,id) on delete cascade,
 check((review_status='pending' and reviewed_at is null and reviewed_by is null and reviewed_by_device_id is null) or
       (review_status='completed' and reviewed_at is not null and reviewed_by is not null and reviewed_by_device_id is not null))
);
create table reservations.operations(
 operation_id uuid primary key, organization_id uuid not null references public.organizations(id), actor_user_id uuid not null references platform.profiles(user_id),
 device_id uuid not null references platform.devices(id), operation_name text not null, intent_hash text not null check(intent_hash~'^[0-9a-f]{64}$'),
 result jsonb not null check(jsonb_typeof(result)='object'), created_at timestamptz not null default statement_timestamp()
);

create index reservations_events_list_idx on reservations.events(organization_id,start_date,id);
create index reservations_participant_search_idx on reservations.participants(organization_id,full_name,phone,id);
create index reservations_bookings_list_idx on reservations.bookings(organization_id,event_id,created_at,id);
create index reservations_payment_booking_idx on reservations.payments(organization_id,booking_id,payment_date,id);
create index reservations_attendance_booking_idx on reservations.attendance_records(organization_id,booking_id,segment);

do $$ declare item text; begin foreach item in array array['events','event_periods','booking_types','participants','booking_number_counters','bookings','payments','attendance_records','operational_reviews','operations'] loop execute format('alter table reservations.%I enable row level security',item); execute format('alter table reservations.%I force row level security',item); end loop; end $$;
revoke all on all tables in schema reservations from public,anon,authenticated;

insert into public.module_permission_catalog(permission_key,module_key,display_name,description,status,allowed_scope_mode,allowed_resource_type,sensitive_mutation,catalog_version) values
('reservations.event.view','reservations','View reservation events','View organization reservation events and configuration.','active','module',null,false,2),
('reservations.event.manage','reservations','Manage reservation events','Create, update, and safely delete events, periods, and booking types.','active','module',null,true,2),
('reservations.booking.delete','reservations','Delete unused bookings','Delete bookings only before financial or attendance history exists.','active','module',null,true,2),
('reservations.payment.view','reservations','View payments','View payment ledger and derived balances.','active','module',null,false,2),
('reservations.payment.record','reservations','Record payments','Record immutable booking payments.','active','module',null,true,2),
('reservations.payment.void','reservations','Void payments','Void payments with preserved financial history.','active','module',null,true,2),
('reservations.attendance.view','reservations','View attendance','View event attendance records.','active','module',null,false,2),
('reservations.attendance.manage','reservations','Manage attendance','Record and correct event attendance.','active','module',null,true,2),
('reservations.operations.view','reservations','View operations','View operational review and readiness data.','active','module',null,false,2),
('reservations.operations.manage','reservations','Manage operations','Complete or correct operational reviews.','active','module',null,true,2),
('reservations.reports.view','reservations','View reports','View organization reservation reporting data.','active','module',null,false,2);

create function reservations_private.context(p_device_id uuid,p_organization_id uuid,p_permission text) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare v_context jsonb; v_actor uuid; begin
 v_context:=public.require_effective_module_permission(p_device_id,'reservations',p_permission,null,null); v_actor:=(v_context->>'actorUserId')::uuid;
 if not exists(select 1 from public.organizations o where o.id=p_organization_id and o.status='active')
    or not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=v_actor) then
  raise exception 'RESERVATIONS_ORGANIZATION_ACCESS_REQUIRED' using errcode='42501'; end if;
 return v_context||jsonb_build_object('organizationId',p_organization_id);
end $$;
create function reservations_private.intent(p_operation text,p_organization_id uuid,p_args jsonb) returns text
language sql immutable set search_path='' as $$ select encode(extensions.digest(convert_to(jsonb_build_object('operation',p_operation,'organizationId',p_organization_id,'args',p_args)::text,'UTF8'),'sha256'),'hex') $$;
create function reservations_private.begin_operation(p_operation_id uuid,p_context jsonb,p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ declare v_prior reservations.operations%rowtype; v_org uuid:=(p_context->>'organizationId')::uuid; v_actor uuid:=(p_context->>'actorUserId')::uuid; v_device uuid:=(p_context->>'actorDeviceId')::uuid; v_intent text; begin
 if p_operation_id is null then raise exception 'RESERVATIONS_OPERATION_ID_REQUIRED' using errcode='22023'; end if;
 v_intent:=reservations_private.intent(p_operation,v_org,p_args-'p_operation_id'); perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservations-operation:'||p_operation_id::text,0));
 select o.* into v_prior from reservations.operations o where o.operation_id=p_operation_id;
 if not found then return null; end if;
 if v_prior.organization_id<>v_org or v_prior.actor_user_id<>v_actor or v_prior.device_id<>v_device or v_prior.operation_name<>p_operation or v_prior.intent_hash<>v_intent then
  raise exception 'RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if; return v_prior.result;
end $$;
create function reservations_private.complete_operation(p_operation_id uuid,p_context jsonb,p_operation text,p_args jsonb,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 insert into reservations.operations(operation_id,organization_id,actor_user_id,device_id,operation_name,intent_hash,result)
 values(p_operation_id,(p_context->>'organizationId')::uuid,(p_context->>'actorUserId')::uuid,(p_context->>'actorDeviceId')::uuid,p_operation,reservations_private.intent(p_operation,(p_context->>'organizationId')::uuid,p_args-'p_operation_id'),p_result); return p_result;
end $$;
create function reservations_private.audit(p_context jsonb,p_action text,p_entity_type text,p_entity_id uuid,p_operation_id uuid,p_old jsonb,p_new jsonb) returns void
language plpgsql security definer set search_path='' as $$ declare v_actor uuid:=(p_context->>'actorUserId')::uuid; v_device uuid:=(p_context->>'actorDeviceId')::uuid; v_authorization uuid; begin
 v_authorization:=platform_private.validated_phase1c_device_authorization(v_actor,v_device); if v_authorization is null then raise exception 'RESERVATIONS_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
 values(v_actor,v_authorization,'platform','reservations',p_action,p_entity_type,p_entity_id,'platform',p_old,p_new,jsonb_build_object('organizationId',p_context->>'organizationId','deviceId',v_device),p_operation_id,'rpc');
end $$;
create function reservations_private.allocate_booking_number(p_organization_id uuid,p_year integer) returns text
language plpgsql security definer set search_path='' as $$ declare v_value bigint; begin
 insert into reservations.booking_number_counters(organization_id,booking_year,next_value) values(p_organization_id,p_year,2)
 on conflict(organization_id,booking_year) do update set next_value=reservations.booking_number_counters.next_value+1,updated_at=statement_timestamp() returning next_value-1 into v_value;
 return 'RES-'||p_year::text||'-'||lpad(v_value::text,4,'0'); end $$;
create function reservations_private.protect_payment_history() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_op='DELETE' then raise exception 'RESERVATIONS_PAYMENT_DELETE_DENIED' using errcode='55000'; end if;
 if old.organization_id<>new.organization_id or old.booking_id<>new.booking_id or old.amount<>new.amount or old.payment_date<>new.payment_date or old.payment_method<>new.payment_method
    or old.payment_method_other is distinct from new.payment_method_other or old.reference is distinct from new.reference or old.notes is distinct from new.notes
    or old.created_at<>new.created_at or old.created_by<>new.created_by or old.created_by_device_id<>new.created_by_device_id
    or old.status<>'active' or new.status<>'voided' then raise exception 'RESERVATIONS_PAYMENT_IMMUTABLE' using errcode='55000'; end if; return new; end $$;
create trigger reservations_payment_history_guard before update or delete on reservations.payments for each row execute function reservations_private.protect_payment_history();

create function reservations.read(p_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_org uuid:=(p_args->>'p_organization_id')::uuid; v_permission text; v_context jsonb; v_limit integer:=coalesce((p_args->>'p_limit')::integer,100); v_result jsonb;
begin
 v_permission:=case when p_operation in('list_events','get_event','list_event_periods','list_booking_types') then 'reservations.event.view'
  when p_operation in('list_bookings','get_booking_detail','search_participants_bookings') then 'reservations.booking.view'
  when p_operation='list_booking_payments' then 'reservations.payment.view' when p_operation='list_attendance' then 'reservations.attendance.view'
  when p_operation='get_operational_state' then 'reservations.operations.view' when p_operation in('get_dashboard_summary','get_report_source_data') then 'reservations.reports.view' end;
 if v_permission is null or v_org is null or v_limit<1 or v_limit>5000 then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
 v_context:=reservations_private.context(p_device_id,v_org,v_permission);
 if p_operation='list_events' then select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]') into v_result from (select e.* from reservations.events e where e.organization_id=v_org and ((p_args->>'p_status') is null or e.status=p_args->>'p_status') order by e.start_date desc,e.id limit v_limit) x;
 elsif p_operation='get_event' then select to_jsonb(e)||jsonb_build_object('periods',(select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order),'[]') from reservations.event_periods p where p.organization_id=v_org and p.event_id=e.id),'bookingTypes',(select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]') from reservations.booking_types t where t.organization_id=v_org and t.event_id=e.id)) into v_result from reservations.events e where e.organization_id=v_org and e.id=(p_args->>'p_event_id')::uuid;
 elsif p_operation='list_event_periods' then select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order),'[]') into v_result from reservations.event_periods p where p.organization_id=v_org and p.event_id=(p_args->>'p_event_id')::uuid;
 elsif p_operation='list_booking_types' then select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]') into v_result from reservations.booking_types t where t.organization_id=v_org and t.event_id=(p_args->>'p_event_id')::uuid;
 elsif p_operation in('list_bookings','search_participants_bookings') then select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into v_result from (select b.*,to_jsonb(p) participant,to_jsonb(e) event,coalesce(pay.total_paid,0) total_paid,greatest(b.price_snapshot-coalesce(pay.total_paid,0),0) remaining_balance,greatest(coalesce(pay.total_paid,0)-b.price_snapshot,0) overpaid_amount,case when coalesce(pay.total_paid,0)=0 then 'unpaid' when pay.total_paid>=b.price_snapshot then 'paid' else 'partial' end payment_status from reservations.bookings b join reservations.participants p on (p.organization_id,p.id)=(b.organization_id,b.participant_id) join reservations.events e on (e.organization_id,e.id)=(b.organization_id,b.event_id) left join lateral(select sum(amount) total_paid from reservations.payments z where z.organization_id=b.organization_id and z.booking_id=b.id and z.status='active') pay on true where b.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) and (p_operation='list_bookings' or lower(p.full_name||' '||p.phone||' '||b.booking_number) like '%'||lower(btrim(p_args->>'p_query'))||'%') order by b.created_at desc,b.id limit v_limit) x;
 elsif p_operation='get_booking_detail' then select to_jsonb(b)||jsonb_build_object('participant',to_jsonb(p),'event',to_jsonb(e),'payments',(select coalesce(jsonb_agg(to_jsonb(z) order by z.payment_date desc,z.id),'[]') from reservations.payments z where z.organization_id=v_org and z.booking_id=b.id),'attendance',(select coalesce(jsonb_agg(to_jsonb(a) order by a.segment),'[]') from reservations.attendance_records a where a.organization_id=v_org and a.booking_id=b.id),'operationalReview',(select to_jsonb(o) from reservations.operational_reviews o where o.organization_id=v_org and o.booking_id=b.id)) into v_result from reservations.bookings b join reservations.participants p on (p.organization_id,p.id)=(b.organization_id,b.participant_id) join reservations.events e on (e.organization_id,e.id)=(b.organization_id,b.event_id) where b.organization_id=v_org and b.id=(p_args->>'p_booking_id')::uuid;
 elsif p_operation='list_booking_payments' then select coalesce(jsonb_agg(to_jsonb(z) order by z.payment_date desc,z.id),'[]') into v_result from reservations.payments z where z.organization_id=v_org and z.booking_id=(p_args->>'p_booking_id')::uuid;
 elsif p_operation='list_attendance' then select coalesce(jsonb_agg(to_jsonb(x) order by x.full_name,x.booking_id,x.segment),'[]') into v_result from (select a.*,p.full_name,b.booking_number from reservations.attendance_records a join reservations.bookings b on (b.organization_id,b.id)=(a.organization_id,a.booking_id) join reservations.participants p on (p.organization_id,p.id)=(b.organization_id,b.participant_id) where a.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) limit v_limit) x;
 elsif p_operation='get_operational_state' then select to_jsonb(o)||jsonb_build_object('booking',to_jsonb(b),'participant',to_jsonb(p),'totalPaid',coalesce((select sum(z.amount) from reservations.payments z where z.organization_id=v_org and z.booking_id=b.id and z.status='active'),0)) into v_result from reservations.operational_reviews o join reservations.bookings b on (b.organization_id,b.id)=(o.organization_id,o.booking_id) join reservations.participants p on (p.organization_id,p.id)=(b.organization_id,b.participant_id) where o.organization_id=v_org and o.booking_id=(p_args->>'p_booking_id')::uuid;
 elsif p_operation='get_dashboard_summary' then select jsonb_build_object('events',(select count(*) from reservations.events e where e.organization_id=v_org),'bookings',(select count(*) from reservations.bookings b where b.organization_id=v_org),'bookingValue',(select coalesce(sum(b.price_snapshot),0) from reservations.bookings b where b.organization_id=v_org),'collected',(select coalesce(sum(z.amount),0) from reservations.payments z where z.organization_id=v_org and z.status='active')) into v_result;
 else select jsonb_build_object(
  'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date,x.id),'[]') from (select e.* from reservations.events e where e.organization_id=v_org and ((p_args->>'p_event_id') is null or e.id=(p_args->>'p_event_id')::uuid) order by e.start_date,e.id limit v_limit) x),
  'periods',(select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.id),'[]') from (select p.* from reservations.event_periods p where p.organization_id=v_org and ((p_args->>'p_event_id') is null or p.event_id=(p_args->>'p_event_id')::uuid) order by p.display_order,p.id limit v_limit) x),
  'bookingTypes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.id),'[]') from (select t.* from reservations.booking_types t where t.organization_id=v_org and ((p_args->>'p_event_id') is null or t.event_id=(p_args->>'p_event_id')::uuid) order by t.display_order,t.id limit v_limit) x),
  'participants',(select coalesce(jsonb_agg(to_jsonb(x) order by x.full_name,x.id),'[]') from (select distinct p.* from reservations.participants p join reservations.bookings b on (b.organization_id,b.participant_id)=(p.organization_id,p.id) where p.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) order by p.full_name,p.id limit v_limit) x),
  'bookings',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (select b.* from reservations.bookings b where b.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) order by b.created_at,b.id limit v_limit) x),
  'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_date,x.id),'[]') from (select z.* from reservations.payments z join reservations.bookings b on (b.organization_id,b.id)=(z.organization_id,z.booking_id) where z.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) order by z.payment_date,z.id limit v_limit) x),
  'attendance',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (select a.* from reservations.attendance_records a join reservations.bookings b on (b.organization_id,b.id)=(a.organization_id,a.booking_id) where a.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) order by a.created_at,a.id limit v_limit) x),
  'operationalReviews',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (select o.* from reservations.operational_reviews o join reservations.bookings b on (b.organization_id,b.id)=(o.organization_id,o.booking_id) where o.organization_id=v_org and ((p_args->>'p_event_id') is null or b.event_id=(p_args->>'p_event_id')::uuid) order by o.created_at,o.id limit v_limit) x)) into v_result; end if;
 if v_result is null then raise exception 'RESERVATIONS_RECORD_NOT_FOUND' using errcode='P0002'; end if; return v_result;
end $$;

create function reservations.mutate(p_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid:=(p_args->>'p_organization_id')::uuid; v_op uuid:=(p_args->>'p_operation_id')::uuid; v_permission text; v_context jsonb; v_actor uuid; v_replay jsonb; v_result jsonb; v_id uuid; v_revision bigint; v_event reservations.events%rowtype; v_type reservations.booking_types%rowtype; v_booking reservations.bookings%rowtype; v_payment reservations.payments%rowtype; v_year integer; v_number text; v_segments text[]; v_count integer;
begin
 v_permission:=case when p_operation in('create_event','update_event','delete_event','create_event_period','update_event_period','delete_event_period','reorder_event_periods','create_booking_type','update_booking_type') then 'reservations.event.manage' when p_operation='create_booking' then 'reservations.booking.create' when p_operation='update_participant_booking' then 'reservations.booking.update' when p_operation='delete_booking' then 'reservations.booking.delete' when p_operation='record_payment' then 'reservations.payment.record' when p_operation='void_payment' then 'reservations.payment.void' when p_operation='update_attendance' then 'reservations.attendance.manage' when p_operation='update_operational_review' then 'reservations.operations.manage' end;
 if v_permission is null or v_org is null or v_op is null then raise exception 'RESERVATIONS_MUTATION_ARGUMENTS_INVALID' using errcode='22023'; end if;
 v_context:=reservations_private.context(p_device_id,v_org,v_permission); v_actor:=(v_context->>'actorUserId')::uuid; v_replay:=reservations_private.begin_operation(v_op,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if;
 if p_operation='create_event' then
  insert into reservations.events(organization_id,name,start_date,end_date,location,capacity,status,notes,created_by,updated_by) values(v_org,btrim(p_args->>'p_name'),(p_args->>'p_start_date')::date,(p_args->>'p_end_date')::date,coalesce(p_args->>'p_location',''),(p_args->>'p_capacity')::integer,p_args->>'p_status',coalesce(p_args->>'p_notes',''),v_actor,v_actor) returning id,revision into v_id,v_revision;
  v_result:=jsonb_build_object('eventId',v_id,'revision',v_revision); perform reservations_private.audit(v_context,'event.created','event',v_id,v_op,null,v_result);
 elsif p_operation in('update_event','delete_event') then
  select e.* into v_event from reservations.events e where e.organization_id=v_org and e.id=(p_args->>'p_event_id')::uuid for update; if not found then raise exception 'RESERVATIONS_EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_event.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
  if p_operation='delete_event' then
   if exists(select 1 from reservations.bookings b where b.organization_id=v_org and b.event_id=v_event.id) then raise exception 'RESERVATIONS_EVENT_HAS_DEPENDENCIES' using errcode='55000'; end if;
   delete from reservations.event_periods p where p.organization_id=v_org and p.event_id=v_event.id; delete from reservations.booking_types t where t.organization_id=v_org and t.event_id=v_event.id; delete from reservations.events e where e.id=v_event.id;
   v_result:=jsonb_build_object('eventId',v_event.id,'deleted',true); perform reservations_private.audit(v_context,'event.deleted','event',v_event.id,v_op,to_jsonb(v_event),null);
  else
   update reservations.events e set name=btrim(p_args->>'p_name'),start_date=(p_args->>'p_start_date')::date,end_date=(p_args->>'p_end_date')::date,location=coalesce(p_args->>'p_location',''),capacity=(p_args->>'p_capacity')::integer,status=p_args->>'p_status',notes=coalesce(p_args->>'p_notes',''),revision=e.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where e.id=v_event.id returning e.revision into v_revision;
   if exists(select 1 from reservations.event_periods p where p.event_id=v_event.id and (p.starts_on<(p_args->>'p_start_date')::date or p.ends_on>(p_args->>'p_end_date')::date)) then raise exception 'RESERVATIONS_EVENT_PERIOD_OUT_OF_RANGE' using errcode='22023'; end if;
   v_result:=jsonb_build_object('eventId',v_event.id,'revision',v_revision); perform reservations_private.audit(v_context,'event.updated','event',v_event.id,v_op,to_jsonb(v_event),v_result);
  end if;
 elsif p_operation in('create_event_period','update_event_period','delete_event_period','reorder_event_periods') then
  select e.* into v_event from reservations.events e where e.organization_id=v_org and e.id=(p_args->>'p_event_id')::uuid for update; if not found then raise exception 'RESERVATIONS_EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_operation='reorder_event_periods' then
   if jsonb_typeof(p_args->'p_period_ids')<>'array' or (select count(*) from jsonb_array_elements_text(p_args->'p_period_ids'))<>(select count(*) from reservations.event_periods p where p.organization_id=v_org and p.event_id=v_event.id) or (select count(distinct value) from jsonb_array_elements_text(p_args->'p_period_ids') s(value))<>(select count(*) from jsonb_array_elements_text(p_args->'p_period_ids')) then raise exception 'RESERVATIONS_PERIOD_ORDER_INVALID' using errcode='22023'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_args->'p_period_ids') x left join reservations.event_periods p on p.organization_id=v_org and p.event_id=v_event.id and p.id=x::uuid where p.id is null) then raise exception 'RESERVATIONS_PERIOD_ORDER_INVALID' using errcode='22023'; end if;
   update reservations.event_periods p set display_order=x.ordinality-1,revision=p.revision+1,updated_at=statement_timestamp(),updated_by=v_actor from jsonb_array_elements_text(p_args->'p_period_ids') with ordinality x(id,ordinality) where p.organization_id=v_org and p.event_id=v_event.id and p.id=x.id::uuid;
   v_result:=jsonb_build_object('eventId',v_event.id,'reordered',true); perform reservations_private.audit(v_context,'event_periods.reordered','event',v_event.id,v_op,null,p_args->'p_period_ids');
  elsif p_operation='create_event_period' then
   if (p_args->>'p_starts_on')::date<v_event.start_date or (p_args->>'p_ends_on')::date>v_event.end_date then raise exception 'RESERVATIONS_EVENT_PERIOD_OUT_OF_RANGE' using errcode='22023'; end if;
   insert into reservations.event_periods(organization_id,event_id,kind,starts_on,ends_on,display_order,created_by,updated_by) values(v_org,v_event.id,p_args->>'p_kind',(p_args->>'p_starts_on')::date,(p_args->>'p_ends_on')::date,(p_args->>'p_display_order')::integer,v_actor,v_actor) returning id,revision into v_id,v_revision;
   v_result:=jsonb_build_object('periodId',v_id,'revision',v_revision); perform reservations_private.audit(v_context,'event_period.created','event_period',v_id,v_op,null,v_result);
  else
   select p.revision into v_revision from reservations.event_periods p where p.organization_id=v_org and p.event_id=v_event.id and p.id=(p_args->>'p_period_id')::uuid for update; if not found then raise exception 'RESERVATIONS_EVENT_PERIOD_NOT_FOUND' using errcode='P0002'; end if; if v_revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
   if p_operation='delete_event_period' then delete from reservations.event_periods p where p.id=(p_args->>'p_period_id')::uuid; v_result:=jsonb_build_object('periodId',p_args->>'p_period_id','deleted',true);
   else if (p_args->>'p_starts_on')::date<v_event.start_date or (p_args->>'p_ends_on')::date>v_event.end_date then raise exception 'RESERVATIONS_EVENT_PERIOD_OUT_OF_RANGE' using errcode='22023'; end if; update reservations.event_periods p set kind=p_args->>'p_kind',starts_on=(p_args->>'p_starts_on')::date,ends_on=(p_args->>'p_ends_on')::date,display_order=(p_args->>'p_display_order')::integer,revision=p.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where p.id=(p_args->>'p_period_id')::uuid returning p.revision into v_revision; v_result:=jsonb_build_object('periodId',p_args->>'p_period_id','revision',v_revision); end if;
   perform reservations_private.audit(v_context,'event_period.'||case when p_operation='delete_event_period' then 'deleted' else 'updated' end,'event_period',(p_args->>'p_period_id')::uuid,v_op,null,v_result);
  end if;
 elsif p_operation in('create_booking_type','update_booking_type') then
  select e.* into v_event from reservations.events e where e.organization_id=v_org and e.id=(p_args->>'p_event_id')::uuid for key share; if not found then raise exception 'RESERVATIONS_EVENT_NOT_FOUND' using errcode='P0002'; end if; select array_agg(value) into v_segments from jsonb_array_elements_text(p_args->'p_eligible_attendance_segments') s(value);
  if p_operation='create_booking_type' then insert into reservations.booking_types(organization_id,event_id,name,code,price,active,display_order,eligible_attendance_segments,created_by,updated_by) values(v_org,v_event.id,btrim(p_args->>'p_name'),btrim(p_args->>'p_code'),(p_args->>'p_price')::numeric,(p_args->>'p_active')::boolean,(p_args->>'p_display_order')::integer,v_segments,v_actor,v_actor) returning id,revision into v_id,v_revision;
  else select t.* into v_type from reservations.booking_types t where t.organization_id=v_org and t.event_id=v_event.id and t.id=(p_args->>'p_booking_type_id')::uuid for update; if not found then raise exception 'RESERVATIONS_BOOKING_TYPE_NOT_FOUND' using errcode='P0002'; end if; if v_type.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if; update reservations.booking_types t set name=btrim(p_args->>'p_name'),code=btrim(p_args->>'p_code'),price=(p_args->>'p_price')::numeric,active=(p_args->>'p_active')::boolean,display_order=(p_args->>'p_display_order')::integer,eligible_attendance_segments=v_segments,revision=t.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where t.id=v_type.id returning t.id,t.revision into v_id,v_revision; end if;
  v_result:=jsonb_build_object('bookingTypeId',v_id,'revision',v_revision); perform reservations_private.audit(v_context,'booking_type.'||case when p_operation='create_booking_type' then 'created' else 'updated' end,'booking_type',v_id,v_op,case when v_type.id is null then null else to_jsonb(v_type) end,v_result);
 elsif p_operation='create_booking' then
  select e.* into v_event from reservations.events e where e.organization_id=v_org and e.id=(p_args->>'p_event_id')::uuid for update; if not found or v_event.status in('closed','full') then raise exception 'RESERVATIONS_EVENT_NOT_ACCEPTING_BOOKINGS' using errcode='22023'; end if;
  select t.* into v_type from reservations.booking_types t where t.organization_id=v_org and t.event_id=v_event.id and t.id=(p_args->>'p_booking_type_id')::uuid for key share; if not found or not v_type.active then raise exception 'RESERVATIONS_BOOKING_TYPE_INACTIVE' using errcode='22023'; end if;
  select count(*) into v_count from reservations.bookings b where b.organization_id=v_org and b.event_id=v_event.id; if v_event.capacity is not null and v_count>=v_event.capacity then raise exception 'RESERVATIONS_EVENT_CAPACITY_REACHED' using errcode='22023'; end if;
  insert into reservations.participants(organization_id,full_name,phone,age,church,governorate,city_or_village,service_sector,service_sector_other,notes,created_by,updated_by) values(v_org,btrim(p_args->>'p_full_name'),btrim(p_args->>'p_phone'),(p_args->>'p_age')::integer,coalesce(p_args->>'p_church',''),btrim(p_args->>'p_governorate'),coalesce(p_args->>'p_city_or_village',''),p_args->>'p_service_sector',nullif(btrim(p_args->>'p_service_sector_other'),''),nullif(p_args->>'p_notes',''),v_actor,v_actor) returning id into v_id;
  v_year:=extract(year from v_event.start_date); v_number:=reservations_private.allocate_booking_number(v_org,v_year); insert into reservations.bookings(organization_id,booking_number,participant_id,event_id,booking_type_id,booking_type_name_snapshot,price_snapshot,attendance_segments_snapshot,notes,created_by,updated_by) values(v_org,v_number,v_id,v_event.id,v_type.id,v_type.name,v_type.price,v_type.eligible_attendance_segments,nullif(p_args->>'p_notes',''),v_actor,v_actor) returning id,revision into v_booking.id,v_revision; insert into reservations.operational_reviews(organization_id,booking_id,created_by,updated_by) values(v_org,v_booking.id,v_actor,v_actor);
  v_result:=jsonb_build_object('participantId',v_id,'bookingId',v_booking.id,'bookingNumber',v_number,'revision',v_revision); perform reservations_private.audit(v_context,'booking.created','booking',v_booking.id,v_op,null,v_result);
 elsif p_operation in('update_participant_booking','delete_booking') then
  select b.* into v_booking from reservations.bookings b where b.organization_id=v_org and b.id=(p_args->>'p_booking_id')::uuid for update; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; if v_booking.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
  if p_operation='delete_booking' then if exists(select 1 from reservations.payments z where z.organization_id=v_org and z.booking_id=v_booking.id) or exists(select 1 from reservations.attendance_records a where a.organization_id=v_org and a.booking_id=v_booking.id) then raise exception 'RESERVATIONS_BOOKING_HAS_HISTORY' using errcode='55000'; end if; delete from reservations.bookings b where b.id=v_booking.id; v_result:=jsonb_build_object('bookingId',v_booking.id,'deleted',true); perform reservations_private.audit(v_context,'booking.deleted','booking',v_booking.id,v_op,to_jsonb(v_booking),null);
  else update reservations.participants p set full_name=btrim(p_args->>'p_full_name'),phone=btrim(p_args->>'p_phone'),age=(p_args->>'p_age')::integer,church=coalesce(p_args->>'p_church',''),governorate=btrim(p_args->>'p_governorate'),city_or_village=coalesce(p_args->>'p_city_or_village',''),service_sector=p_args->>'p_service_sector',service_sector_other=nullif(btrim(p_args->>'p_service_sector_other'),''),notes=nullif(p_args->>'p_notes',''),revision=p.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where p.organization_id=v_org and p.id=v_booking.participant_id; update reservations.bookings b set notes=nullif(p_args->>'p_notes',''),revision=b.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where b.id=v_booking.id returning b.revision into v_revision; v_result:=jsonb_build_object('bookingId',v_booking.id,'revision',v_revision); perform reservations_private.audit(v_context,'booking.updated','booking',v_booking.id,v_op,to_jsonb(v_booking),v_result); end if;
 elsif p_operation='record_payment' then
  perform 1 from reservations.bookings b where b.organization_id=v_org and b.id=(p_args->>'p_booking_id')::uuid for key share; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  insert into reservations.payments(organization_id,booking_id,amount,payment_date,payment_method,payment_method_other,reference,notes,created_by,created_by_device_id) values(v_org,(p_args->>'p_booking_id')::uuid,(p_args->>'p_amount')::numeric,(p_args->>'p_payment_date')::date,p_args->>'p_payment_method',nullif(btrim(p_args->>'p_payment_method_other'),''),nullif(p_args->>'p_reference',''),nullif(p_args->>'p_notes',''),v_actor,p_device_id) returning id into v_id; v_result:=jsonb_build_object('paymentId',v_id,'status','active'); perform reservations_private.audit(v_context,'payment.recorded','payment',v_id,v_op,null,v_result);
 elsif p_operation='void_payment' then
  select z.* into v_payment from reservations.payments z where z.organization_id=v_org and z.id=(p_args->>'p_payment_id')::uuid for update; if not found then raise exception 'RESERVATIONS_PAYMENT_NOT_FOUND' using errcode='P0002'; end if; if v_payment.status<>'active' or nullif(btrim(p_args->>'p_void_reason'),'') is null then raise exception 'RESERVATIONS_PAYMENT_VOID_INVALID' using errcode='22023'; end if; update reservations.payments z set status='voided',voided_at=statement_timestamp(),void_reason=btrim(p_args->>'p_void_reason'),voided_by=v_actor,voided_by_device_id=p_device_id where z.id=v_payment.id; v_result:=jsonb_build_object('paymentId',v_payment.id,'status','voided'); perform reservations_private.audit(v_context,'payment.voided','payment',v_payment.id,v_op,to_jsonb(v_payment),v_result);
 elsif p_operation='update_attendance' then
  select b.* into v_booking from reservations.bookings b where b.organization_id=v_org and b.id=(p_args->>'p_booking_id')::uuid for key share; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; if not (p_args->>'p_segment'=any(v_booking.attendance_segments_snapshot)) then raise exception 'RESERVATIONS_ATTENDANCE_SEGMENT_INELIGIBLE' using errcode='22023'; end if;
  insert into reservations.attendance_records(organization_id,booking_id,segment,attended,attendance_date,notes,created_by,updated_by) values(v_org,v_booking.id,p_args->>'p_segment',(p_args->>'p_attended')::boolean,case when (p_args->>'p_attended')::boolean then coalesce((p_args->>'p_attendance_date')::date,current_date) end,nullif(p_args->>'p_notes',''),v_actor,v_actor) on conflict(booking_id,segment) do update set attended=excluded.attended,attendance_date=excluded.attendance_date,notes=excluded.notes,revision=reservations.attendance_records.revision+1,updated_at=statement_timestamp(),updated_by=v_actor returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('attendanceId',v_id,'revision',v_revision,'attended',(p_args->>'p_attended')::boolean); perform reservations_private.audit(v_context,'attendance.corrected','attendance',v_id,v_op,null,v_result);
 else
  update reservations.operational_reviews o set review_status=p_args->>'p_review_status',reviewed_at=case when p_args->>'p_review_status'='completed' then statement_timestamp() end,reviewed_by=case when p_args->>'p_review_status'='completed' then v_actor end,reviewed_by_device_id=case when p_args->>'p_review_status'='completed' then p_device_id end,revision=o.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where o.organization_id=v_org and o.booking_id=(p_args->>'p_booking_id')::uuid and o.revision=(p_args->>'p_expected_revision')::bigint returning o.id,o.revision into v_id,v_revision; if not found then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if; v_result:=jsonb_build_object('operationalReviewId',v_id,'revision',v_revision,'status',p_args->>'p_review_status'); perform reservations_private.audit(v_context,'operational_review.updated','operational_review',v_id,v_op,null,v_result);
 end if;
 return reservations_private.complete_operation(v_op,v_context,p_operation,p_args,v_result);
end $$;

revoke all on all functions in schema reservations_private from public,anon,authenticated,service_role;
revoke all on all functions in schema reservations from public,anon,authenticated,service_role;
grant usage on schema reservations to service_role;
grant execute on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) to service_role;

commit;
