begin;

-- Reservations scope is an internal partition.  Organization remains present only
-- for Conference compatibility and is deliberately NULL for Standalone events.
do $$
begin
  if to_regclass('reservations.events') is null
     or to_regclass('reservations.operations') is null
     or to_regclass('reservations.booking_number_counters') is null then
    raise exception 'RESERVATIONS_SCOPE_PARTITION_PREDECESSOR_REQUIRED' using errcode='55000';
  end if;
end $$;

alter table reservations.events
  add column if not exists scope_type text,
  add column if not exists scope_partition_id uuid;

-- Existing data is Conference-linked.  Its old Organization value is retained as
-- the historical partition identifier so booking numbers and completed operation
-- replays keep their exact namespace.
update reservations.events
set scope_type='conference', scope_partition_id=organization_id
where scope_type is null and conference_id is not null and organization_id is not null;

do $$
begin
  if exists (
    select 1 from reservations.events
    where scope_type is null or scope_partition_id is null
       or (scope_type='conference' and (conference_id is null or organization_id is null))
       or (scope_type not in ('conference','standalone'))
  ) then
    raise exception 'RESERVATIONS_SCOPE_PARTITION_EVENT_BACKFILL_AMBIGUOUS' using errcode='55000';
  end if;
end $$;

alter table reservations.events
  alter column conference_id drop not null,
  alter column scope_type set not null,
  alter column scope_partition_id set not null,
  add constraint reservations_events_scope_type_check
    check ((scope_type='conference' and conference_id is not null and organization_id is not null)
        or (scope_type='standalone' and conference_id is null and organization_id is null)),
  add constraint reservations_events_scope_partition_unique unique(scope_partition_id,id);

create unique index reservations_one_canonical_event_per_conference_idx
  on reservations.events(conference_id) where scope_type='conference';
create index reservations_events_partition_list_idx
  on reservations.events(scope_partition_id,start_date,id);

-- The partition of an Event is immutable.  A Conference event may not be turned
-- into a Standalone event (or vice versa) after dependent Reservations data exists.
create or replace function reservations_private.enforce_event_scope_partition_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.scope_type,new.scope_partition_id,new.conference_id,new.organization_id)
       is distinct from (old.scope_type,old.scope_partition_id,old.conference_id,old.organization_id) then
    raise exception 'RESERVATIONS_EVENT_SCOPE_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists reservations_events_scope_partition_immutable on reservations.events;
create trigger reservations_events_scope_partition_immutable
before update on reservations.events
for each row execute function reservations_private.enforce_event_scope_partition_immutable();

-- Add and prove the partition value on every event-dependent relation before
-- replacing the Organization composite keys.  Participants must resolve to one
-- Event partition; the live proof supplied with this change establishes that
-- this is unambiguous for Development.
alter table reservations.event_periods add column if not exists scope_partition_id uuid;
alter table reservations.booking_types add column if not exists scope_partition_id uuid;
alter table reservations.participants add column if not exists scope_partition_id uuid;
alter table reservations.bookings add column if not exists scope_partition_id uuid;
alter table reservations.payments add column if not exists scope_partition_id uuid;
alter table reservations.attendance_records add column if not exists scope_partition_id uuid;
alter table reservations.operational_reviews add column if not exists scope_partition_id uuid;
alter table reservations.operations add column if not exists scope_partition_id uuid;

update reservations.event_periods d set scope_partition_id=e.scope_partition_id from reservations.events e where e.id=d.event_id and d.scope_partition_id is null;
update reservations.booking_types d set scope_partition_id=e.scope_partition_id from reservations.events e where e.id=d.event_id and d.scope_partition_id is null;
update reservations.bookings d set scope_partition_id=e.scope_partition_id from reservations.events e where e.id=d.event_id and d.scope_partition_id is null;
update reservations.payments d set scope_partition_id=b.scope_partition_id from reservations.bookings b where b.id=d.booking_id and d.scope_partition_id is null;
update reservations.attendance_records d set scope_partition_id=b.scope_partition_id from reservations.bookings b where b.id=d.booking_id and d.scope_partition_id is null;
update reservations.operational_reviews d set scope_partition_id=b.scope_partition_id from reservations.bookings b where b.id=d.booking_id and d.scope_partition_id is null;
update reservations.participants p
set scope_partition_id=x.scope_partition_id
from (select participant_id,min(scope_partition_id::text)::uuid scope_partition_id from reservations.bookings group by participant_id having count(distinct scope_partition_id)=1) x
where x.participant_id=p.id and p.scope_partition_id is null;
update reservations.operations o set scope_partition_id=o.organization_id where o.scope_partition_id is null and o.organization_id is not null;

do $$
begin
  if exists(select 1 from reservations.event_periods where scope_partition_id is null)
     or exists(select 1 from reservations.booking_types where scope_partition_id is null)
     or exists(select 1 from reservations.bookings where scope_partition_id is null)
     or exists(select 1 from reservations.payments where scope_partition_id is null)
     or exists(select 1 from reservations.attendance_records where scope_partition_id is null)
     or exists(select 1 from reservations.operational_reviews where scope_partition_id is null)
     or exists(select 1 from reservations.participants where scope_partition_id is null)
     or exists(select 1 from reservations.operations where scope_partition_id is null) then
    raise exception 'RESERVATIONS_SCOPE_PARTITION_BACKFILL_INCOMPLETE' using errcode='55000';
  end if;
  if exists(select 1 from reservations.participants p join reservations.bookings b on b.participant_id=p.id where p.scope_partition_id<>b.scope_partition_id) then
    raise exception 'RESERVATIONS_PARTICIPANT_SCOPE_PARTITION_AMBIGUOUS' using errcode='55000';
  end if;
end $$;

alter table reservations.event_periods alter column scope_partition_id set not null;
alter table reservations.booking_types alter column scope_partition_id set not null;
alter table reservations.participants alter column scope_partition_id set not null;
alter table reservations.bookings alter column scope_partition_id set not null;
alter table reservations.payments alter column scope_partition_id set not null;
alter table reservations.attendance_records alter column scope_partition_id set not null;
alter table reservations.operational_reviews alter column scope_partition_id set not null;
alter table reservations.operations alter column scope_partition_id set not null;

-- These are internal relationship columns now.  Keep Organization values for
-- historical Conference records, but do not require or reference one for a
-- Standalone partition.
alter table reservations.events alter column organization_id drop not null;
alter table reservations.event_periods alter column organization_id drop not null;
alter table reservations.booking_types alter column organization_id drop not null;
alter table reservations.participants alter column organization_id drop not null;
alter table reservations.bookings alter column organization_id drop not null;
alter table reservations.payments alter column organization_id drop not null;
alter table reservations.attendance_records alter column organization_id drop not null;
alter table reservations.operational_reviews alter column organization_id drop not null;
alter table reservations.operations alter column organization_id drop not null;

-- Drop only Reservations foreign keys that include Organization.  The Event to
-- Conference composite FK is deliberately retained because it verifies the
-- internal Organization relationship for Conference-linked events.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass rel, conname
    from pg_constraint
    where contype='f' and connamespace='reservations'::regnamespace
      and conname <> 'reservations_events_conference_organization_fk'
      and pg_get_constraintdef(oid) like '%organization_id%'
  loop
    execute format('alter table %s drop constraint %I',r.rel,r.conname);
  end loop;
end $$;

alter table reservations.event_periods add constraint reservations_event_periods_partition_event_fk foreign key(scope_partition_id,event_id) references reservations.events(scope_partition_id,id) on delete restrict;
alter table reservations.booking_types add constraint reservations_booking_types_partition_event_fk foreign key(scope_partition_id,event_id) references reservations.events(scope_partition_id,id) on delete restrict;
alter table reservations.participants add constraint reservations_participants_partition_id_unique unique(scope_partition_id,id);
alter table reservations.bookings add constraint reservations_bookings_partition_participant_fk foreign key(scope_partition_id,participant_id) references reservations.participants(scope_partition_id,id) on delete restrict;
alter table reservations.bookings add constraint reservations_bookings_partition_event_fk foreign key(scope_partition_id,event_id) references reservations.events(scope_partition_id,id) on delete restrict;
alter table reservations.booking_types add constraint reservations_booking_types_partition_id_unique unique(scope_partition_id,event_id,id);
alter table reservations.bookings add constraint reservations_bookings_partition_type_fk foreign key(scope_partition_id,event_id,booking_type_id) references reservations.booking_types(scope_partition_id,event_id,id) on delete restrict;
alter table reservations.bookings add constraint reservations_bookings_partition_id_unique unique(scope_partition_id,id);
alter table reservations.payments add constraint reservations_payments_partition_booking_fk foreign key(scope_partition_id,booking_id) references reservations.bookings(scope_partition_id,id) on delete restrict;
alter table reservations.attendance_records add constraint reservations_attendance_partition_booking_fk foreign key(scope_partition_id,booking_id) references reservations.bookings(scope_partition_id,id) on delete restrict;
alter table reservations.operational_reviews add constraint reservations_reviews_partition_booking_fk foreign key(scope_partition_id,booking_id) references reservations.bookings(scope_partition_id,id) on delete cascade;
alter table reservations.bookings add constraint reservations_bookings_partition_number_unique unique(scope_partition_id,booking_number);

drop index if exists reservations_events_list_idx;
drop index if exists reservations_bookings_list_idx;
drop index if exists reservations_participant_search_idx;
drop index if exists reservations_payment_booking_idx;
drop index if exists reservations_attendance_booking_idx;
create index reservations_bookings_partition_list_idx on reservations.bookings(scope_partition_id,event_id,created_at,id);
create index reservations_participant_partition_search_idx on reservations.participants(scope_partition_id,full_name,phone,id);
create index reservations_payment_partition_booking_idx on reservations.payments(scope_partition_id,booking_id,payment_date,id);
create index reservations_attendance_partition_booking_idx on reservations.attendance_records(scope_partition_id,booking_id,segment);

-- A Standalone booking type can explicitly opt out of attendance.  Snapshot
-- values remain immutable and retain the same allowed-value/duplicate rules.
alter table reservations.booking_types drop constraint if exists booking_types_eligible_attendance_segments_check;
alter table reservations.bookings drop constraint if exists bookings_attendance_segments_snapshot_check;
alter table reservations.booking_types add constraint booking_types_eligible_attendance_segments_check check(eligible_attendance_segments <@ array['conference','caravans']::text[] and cardinality(eligible_attendance_segments) between 0 and 2 and (cardinality(eligible_attendance_segments)<2 or eligible_attendance_segments[1]<>eligible_attendance_segments[2]));
alter table reservations.bookings add constraint bookings_attendance_segments_snapshot_check check(attendance_segments_snapshot <@ array['conference','caravans']::text[] and cardinality(attendance_segments_snapshot) between 0 and 2 and (cardinality(attendance_segments_snapshot)<2 or attendance_segments_snapshot[1]<>attendance_segments_snapshot[2]));

alter table reservations.booking_number_counters add column if not exists scope_partition_id uuid;
update reservations.booking_number_counters set scope_partition_id=organization_id where scope_partition_id is null;
do $$ begin if exists(select 1 from reservations.booking_number_counters where scope_partition_id is null) then raise exception 'RESERVATIONS_COUNTER_PARTITION_BACKFILL_INCOMPLETE' using errcode='55000'; end if; end $$;
alter table reservations.booking_number_counters alter column scope_partition_id set not null;
alter table reservations.booking_number_counters drop constraint if exists booking_number_counters_pkey;
alter table reservations.booking_number_counters alter column organization_id drop not null;
alter table reservations.booking_number_counters add primary key(scope_partition_id,booking_year);

create or replace function reservations_private.intent(p_operation text,p_scope_partition_id uuid,p_args jsonb)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('operation',p_operation,'scopePartitionId',p_scope_partition_id,'args',p_args)::text,'UTF8'),'sha256'),'hex'
); $$;

create or replace function reservations_private.allocate_booking_number(p_scope_partition_id uuid,p_year integer)
returns text language plpgsql security definer set search_path='' as $$
declare v_number bigint;
begin
  insert into reservations.booking_number_counters(scope_partition_id,booking_year,next_value)
  values(p_scope_partition_id,p_year,2)
  on conflict(scope_partition_id,booking_year) do update
    set next_value=reservations.booking_number_counters.next_value+1,updated_at=statement_timestamp()
  returning next_value-1 into v_number;
  return 'RES-'||lpad(p_year::text,4,'0')||'-'||lpad(v_number::text,4,'0');
end $$;

-- Existing ledger rows retain their stored historical hash.  New calls use the
-- partition namespace; replay first compares the old Organization hash for a
-- historical row and only then compares the new partition hash.
create or replace function reservations_private.begin_operation(p_operation_id uuid,p_context jsonb,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prior reservations.operations%rowtype; v_partition uuid:=(p_context->>'scopePartitionId')::uuid; v_org uuid:=(p_context->>'organizationId')::uuid; v_intent text; v_historical_intent text;
begin
  if p_operation_id is null then raise exception 'RESERVATIONS_OPERATION_ID_REQUIRED' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservations-operation:'||p_operation_id::text,0));
  select * into v_prior from reservations.operations where operation_id=p_operation_id;
  if not found then return null; end if;
  v_intent:=reservations_private.intent(p_operation,v_partition,p_args-'p_operation_id');
  v_historical_intent:=case when v_prior.organization_id is not null then encode(extensions.digest(convert_to(jsonb_build_object('operation',p_operation,'organizationId',v_prior.organization_id,'args',p_args-'p_operation_id')::text,'UTF8'),'sha256'),'hex') end;
  if v_prior.actor_user_id<>(p_context->>'actorUserId')::uuid or v_prior.device_id<>(p_context->>'actorDeviceId')::uuid or v_prior.operation_name<>p_operation
     or not ((v_prior.scope_partition_id=v_partition and v_prior.intent_hash=v_intent)
          or (v_prior.organization_id is not null and v_prior.scope_partition_id=v_prior.organization_id and v_prior.intent_hash=v_historical_intent)) then
    raise exception 'RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT' using errcode='40001';
  end if;
  return v_prior.result;
end $$;

create or replace function reservations_private.complete_operation(p_operation_id uuid,p_context jsonb,p_operation text,p_args jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform set_config('reservations.scope_partition_id',(p_context->>'scopePartitionId'),true);
  insert into reservations.operations(operation_id,scope_partition_id,organization_id,actor_user_id,device_id,operation_name,intent_hash,result)
  values(p_operation_id,(p_context->>'scopePartitionId')::uuid,nullif(p_context->>'organizationId','')::uuid,(p_context->>'actorUserId')::uuid,(p_context->>'actorDeviceId')::uuid,p_operation,reservations_private.intent(p_operation,(p_context->>'scopePartitionId')::uuid,p_args-'p_operation_id'),p_result);
  return p_result;
end $$;

-- Scope resolution intentionally contains no Platform Organization context.
create or replace function reservations_private.event_scope_context(p_device_id uuid,p_event_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event reservations.events%rowtype; v_context jsonb; v_conference jsonb;
begin
  v_context:=public.require_effective_module_permission(p_device_id,'reservations',p_permission,null,null);
  select * into v_event from reservations.events where id=p_event_id;
  if not found then raise exception 'RESERVATIONS_EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_event.scope_type='conference' then v_conference:=reservations_private.conference_context(p_device_id,v_event.conference_id,p_permission); v_context:=v_conference; end if;
  return v_context||jsonb_build_object('scopeType',v_event.scope_type,'scopePartitionId',v_event.scope_partition_id,'eventId',v_event.id,'organizationId',case when v_event.scope_type='conference' then v_event.organization_id end);
end $$;

create or replace function reservations_private.conference_context(p_device_id uuid,p_conference_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb; v_actor uuid; v_organization_id uuid; v_partition uuid;
begin
  v_context:=public.require_effective_module_permission(p_device_id,'reservations',p_permission,null,null);
  v_actor:=(v_context->>'actorUserId')::uuid;
  select c.organization_id into v_organization_id from public.conferences c join public.conference_members m on m.conference_id=c.id and m.user_id=v_actor where c.id=p_conference_id and c.deleted_at is null;
  if not found or v_organization_id is null then raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode='42501'; end if;
  v_partition:=coalesce(nullif(current_setting('reservations.scope_partition_id',true),'')::uuid,p_conference_id);
  return v_context||jsonb_build_object('conferenceId',p_conference_id,'organizationId',v_organization_id,'scopeType','conference','scopePartitionId',v_partition);
end $$;

-- Round A: inactive, side-effect-free authoritative resolvers for the scoped
-- dispatcher that will replace the legacy chain in a later migration revision.
create or replace function reservations_private.resolve_event_scope(p_device_id uuid,p_event_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event reservations.events%rowtype; v_context jsonb;
begin
  select * into v_event from reservations.events where id=p_event_id;
  if not found then raise exception 'RESERVATIONS_EVENT_NOT_FOUND' using errcode='P0002'; end if;
  if v_event.scope_type='conference' then
    v_context:=reservations_private.conference_context(p_device_id,v_event.conference_id,p_permission);
    if (v_context->>'organizationId')::uuid<>v_event.organization_id then raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode='42501'; end if;
  elsif v_event.scope_type='standalone' then
    v_context:=public.require_effective_module_permission(p_device_id,'reservations',p_permission,null,null);
  else raise exception 'RESERVATIONS_SCOPE_TYPE_INVALID' using errcode='22023'; end if;
  return v_context||jsonb_build_object('scopeType',v_event.scope_type,'scopePartitionId',v_event.scope_partition_id,'eventId',v_event.id,'conferenceId',v_event.conference_id,'organizationId',case when v_event.scope_type='conference' then v_event.organization_id end);
end $$;
create or replace function reservations_private.resolve_booking_scope(p_device_id uuid,p_booking_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event_id uuid; begin select event_id into v_event_id from reservations.bookings where id=p_booking_id; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; return reservations_private.resolve_event_scope(p_device_id,v_event_id,p_permission)||jsonb_build_object('bookingId',p_booking_id); end $$;
create or replace function reservations_private.resolve_payment_scope(p_device_id uuid,p_payment_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_booking_id uuid; begin select booking_id into v_booking_id from reservations.payments where id=p_payment_id; if not found then raise exception 'RESERVATIONS_PAYMENT_NOT_FOUND' using errcode='P0002'; end if; return reservations_private.resolve_booking_scope(p_device_id,v_booking_id,p_permission)||jsonb_build_object('paymentId',p_payment_id); end $$;
create or replace function reservations_private.resolve_event_period_scope(p_device_id uuid,p_period_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event_id uuid; begin select event_id into v_event_id from reservations.event_periods where id=p_period_id; if not found then raise exception 'RESERVATIONS_EVENT_PERIOD_NOT_FOUND' using errcode='P0002'; end if; return reservations_private.resolve_event_scope(p_device_id,v_event_id,p_permission)||jsonb_build_object('periodId',p_period_id); end $$;
create or replace function reservations_private.resolve_booking_type_scope(p_device_id uuid,p_booking_type_id uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_event_id uuid; begin select event_id into v_event_id from reservations.booking_types where id=p_booking_type_id; if not found then raise exception 'RESERVATIONS_BOOKING_TYPE_NOT_FOUND' using errcode='P0002'; end if; return reservations_private.resolve_event_scope(p_device_id,v_event_id,p_permission)||jsonb_build_object('bookingTypeId',p_booking_type_id); end $$;

-- Explicit Standalone response: accommodation is a Conference projection and is
-- never attempted for a Standalone booking.
create or replace function reservations_private.standalone_accommodation_not_applicable(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('bookingId',p_booking_id,'applicable',false,'reason','RESERVATIONS_ACCOMMODATION_NOT_APPLICABLE');
$$;

-- Authoritative insert-boundary derivation.  No client value is trusted: every
-- child receives its partition from the parent it references.  Compatibility
-- functions that predate this migration remain safe because these triggers are
-- part of the active write path, not a browser-side convention.
create or replace function reservations_private.derive_event_scope_partition()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.scope_type is null then
    if new.conference_id is null then
      new.scope_type:='standalone'; new.organization_id:=null; new.scope_partition_id:=extensions.gen_random_uuid();
    else
      new.scope_type:='conference'; new.scope_partition_id:=new.conference_id;
    end if;
  elsif new.scope_type='standalone' then
    new.conference_id:=null; new.organization_id:=null; new.scope_partition_id:=coalesce(new.scope_partition_id,extensions.gen_random_uuid());
  elsif new.scope_type='conference' then
    if new.conference_id is null or new.organization_id is null then raise exception 'RESERVATIONS_CONFERENCE_REQUIRED' using errcode='22023'; end if;
    new.scope_partition_id:=new.conference_id;
  else raise exception 'RESERVATIONS_SCOPE_TYPE_INVALID' using errcode='22023'; end if;
  return new;
end $$;

create or replace function reservations_private.derive_child_scope_partition()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_partition uuid; v_setting text;
begin
  if tg_table_name in ('event_periods','booking_types','bookings') then
    select scope_partition_id into v_partition from reservations.events where id=new.event_id;
  elsif tg_table_name in ('payments','attendance_records','operational_reviews') then
    select scope_partition_id into v_partition from reservations.bookings where id=new.booking_id;
  elsif tg_table_name='participants' then
    v_setting:=current_setting('reservations.scope_partition_id',true);
    v_partition:=nullif(v_setting,'')::uuid;
  elsif tg_table_name='operations' then
    v_setting:=current_setting('reservations.scope_partition_id',true);
    v_partition:=nullif(v_setting,'')::uuid;
  end if;
  if v_partition is null then raise exception 'RESERVATIONS_SCOPE_PARTITION_CONTEXT_REQUIRED' using errcode='22023'; end if;
  if new.scope_partition_id is not null and new.scope_partition_id<>v_partition then raise exception 'RESERVATIONS_SCOPE_PARTITION_OVERRIDE_DENIED' using errcode='42501'; end if;
  new.scope_partition_id:=v_partition;
  return new;
end $$;

drop trigger if exists reservations_events_derive_scope_partition on reservations.events;
create trigger reservations_events_derive_scope_partition before insert on reservations.events for each row execute function reservations_private.derive_event_scope_partition();
do $$ declare v_table text; begin
  foreach v_table in array array['event_periods','booking_types','participants','bookings','payments','attendance_records','operational_reviews','operations'] loop
    execute format('drop trigger if exists reservations_%I_derive_scope_partition on reservations.%I',v_table,v_table);
    execute format('create trigger reservations_%I_derive_scope_partition before insert on reservations.%I for each row execute function reservations_private.derive_child_scope_partition()',v_table,v_table);
  end loop;
end $$;

/* ROUND A deliberately does not switch public read/mutate or projection paths.
-- Keep the active compatibility implementation for Conference operations, while
-- making the two Conference-only side effects explicit for Standalone bookings.
-- The wrappers are intentionally additive: predecessor functions remain intact
-- for replay and for the still-active Conference API contract.
alter function reservations_private.project_booking_to_conference(uuid,uuid,jsonb)
  rename to project_booking_to_conference_pre_scope_partition;
create function reservations_private.project_booking_to_conference(p_booking_id uuid,p_operation_id uuid,p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scope_type text;
begin
  select e.scope_type into v_scope_type from reservations.bookings b join reservations.events e on e.id=b.event_id where b.id=p_booking_id;
  if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  if v_scope_type='standalone' then return jsonb_build_object('bookingId',p_booking_id,'applicable',false,'reason','RESERVATIONS_CONFERENCE_PROJECTION_NOT_APPLICABLE'); end if;
  return reservations_private.project_booking_to_conference_pre_scope_partition(p_booking_id,p_operation_id,p_context);
end $$;

alter function reservations.read(uuid,text,jsonb) rename to read_pre_scope_partition_integrity;
create function reservations.read(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_booking_id uuid; v_scope_type text;
begin
  if p_operation='get_booking_accommodation' then
    v_booking_id:=(p_args->>'p_booking_id')::uuid;
    select e.scope_type into v_scope_type from reservations.bookings b join reservations.events e on e.id=b.event_id where b.id=v_booking_id;
    if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
    perform reservations_private.event_scope_context(p_device_id,(select event_id from reservations.bookings where id=v_booking_id),'reservations.booking.view');
    if v_scope_type='standalone' then return reservations_private.standalone_accommodation_not_applicable(v_booking_id); end if;
  end if;
  return reservations.read_pre_scope_partition_integrity(p_device_id,p_operation,p_args);
end $$;

alter function reservations.mutate(uuid,text,jsonb) rename to mutate_pre_scope_partition_integrity;
create or replace function reservations_private.create_standalone_event(p_device_id uuid,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_partition uuid; v_actor uuid; v_replay jsonb; v_id uuid; v_revision bigint; v_result jsonb; v_operation_id uuid:=(p_args->>'p_operation_id')::uuid;
begin
  perform reservations_private.standalone_create_business_args(p_args);
  v_context:=public.require_effective_module_permission(p_device_id,'reservations','reservations.event.manage',null,null)||jsonb_build_object('scopeType','standalone');
  v_actor:=(v_context->>'actorUserId')::uuid;
  v_replay:=reservations_private.begin_standalone_create(v_operation_id,v_context,p_args);
  if v_replay is not null then return v_replay; end if;
  v_partition:=extensions.gen_random_uuid();
  v_context:=v_context||jsonb_build_object('scopePartitionId',v_partition);
  insert into reservations.events(scope_type,scope_partition_id,organization_id,conference_id,name,start_date,end_date,location,capacity,status,notes,created_by,updated_by)
  values('standalone',v_partition,null,null,btrim(p_args->>'p_name'),(p_args->>'p_start_date')::date,(p_args->>'p_end_date')::date,coalesce(p_args->>'p_location',''),(p_args->>'p_capacity')::integer,p_args->>'p_status',coalesce(p_args->>'p_notes',''),v_actor,v_actor)
  returning id,revision into v_id,v_revision;
  v_result:=jsonb_build_object('eventId',v_id,'revision',v_revision,'scopeType','standalone','scopePartitionId',v_partition);
  return reservations_private.complete_standalone_create(v_operation_id,v_context,p_args,v_result);
end $$;
create or replace function reservations_private.mutate_standalone(p_device_id uuid,p_operation text,p_args jsonb,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_permission text; v_context jsonb; v_actor uuid; v_replay jsonb; v_result jsonb; v_event reservations.events%rowtype; v_type reservations.booking_types%rowtype; v_booking reservations.bookings%rowtype; v_id uuid; v_revision bigint; v_segments text[]; v_number text;
begin
  v_permission:=case when p_operation in('update_event','delete_event','create_event_period','update_event_period','delete_event_period','reorder_event_periods','create_booking_type','update_booking_type') then 'reservations.event.manage' when p_operation='create_booking' then 'reservations.booking.create' when p_operation='update_participant_booking' then 'reservations.booking.update' when p_operation='delete_booking' then 'reservations.booking.delete' when p_operation='record_payment' then 'reservations.payment.record' when p_operation='void_payment' then 'reservations.payment.void' when p_operation='update_attendance' then 'reservations.attendance.manage' when p_operation='update_operational_review' then 'reservations.operations.manage' end;
  v_context:=reservations_private.event_scope_context(p_device_id,p_event_id,v_permission); v_actor:=(v_context->>'actorUserId')::uuid;
  v_replay:=reservations_private.begin_operation((p_args->>'p_operation_id')::uuid,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if;
  select * into v_event from reservations.events where id=p_event_id and scope_type='standalone' for update;
  if p_operation='create_event_period' then insert into reservations.event_periods(scope_partition_id,event_id,kind,starts_on,ends_on,display_order,created_by,updated_by) values(v_event.scope_partition_id,v_event.id,p_args->>'p_kind',(p_args->>'p_starts_on')::date,(p_args->>'p_ends_on')::date,(p_args->>'p_display_order')::int,v_actor,v_actor) returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('periodId',v_id,'revision',v_revision);
  elsif p_operation='create_booking_type' then select array_agg(value) into v_segments from jsonb_array_elements_text(p_args->'p_eligible_attendance_segments') s(value); insert into reservations.booking_types(scope_partition_id,event_id,name,code,price,active,display_order,eligible_attendance_segments,created_by,updated_by) values(v_event.scope_partition_id,v_event.id,btrim(p_args->>'p_name'),btrim(p_args->>'p_code'),(p_args->>'p_price')::numeric,(p_args->>'p_active')::boolean,(p_args->>'p_display_order')::int,v_segments,v_actor,v_actor) returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('bookingTypeId',v_id,'revision',v_revision);
  elsif p_operation='create_booking' then select * into v_type from reservations.booking_types where id=(p_args->>'p_booking_type_id')::uuid and event_id=v_event.id and scope_partition_id=v_event.scope_partition_id and active for key share; if not found then raise exception 'RESERVATIONS_BOOKING_TYPE_INACTIVE' using errcode='22023'; end if; insert into reservations.participants(scope_partition_id,full_name,phone,age,church,governorate,city_or_village,service_sector,service_sector_other,notes,created_by,updated_by) values(v_event.scope_partition_id,btrim(p_args->>'p_full_name'),btrim(p_args->>'p_phone'),(p_args->>'p_age')::int,coalesce(p_args->>'p_church',''),btrim(p_args->>'p_governorate'),coalesce(p_args->>'p_city_or_village',''),p_args->>'p_service_sector',nullif(btrim(p_args->>'p_service_sector_other'),''),nullif(p_args->>'p_notes',''),v_actor,v_actor) returning id into v_id; v_number:=reservations_private.allocate_booking_number(v_event.scope_partition_id,extract(year from v_event.start_date)); insert into reservations.bookings(scope_partition_id,booking_number,participant_id,event_id,booking_type_id,booking_type_name_snapshot,price_snapshot,attendance_segments_snapshot,notes,created_by,updated_by) values(v_event.scope_partition_id,v_number,v_id,v_event.id,v_type.id,v_type.name,v_type.price,v_type.eligible_attendance_segments,nullif(p_args->>'p_notes',''),v_actor,v_actor) returning id,revision into v_booking.id,v_revision; insert into reservations.operational_reviews(scope_partition_id,booking_id,created_by,updated_by) values(v_event.scope_partition_id,v_booking.id,v_actor,v_actor); v_result:=jsonb_build_object('participantId',v_id,'bookingId',v_booking.id,'bookingNumber',v_number,'revision',v_revision);
  elsif p_operation='record_payment' then select * into v_booking from reservations.bookings where id=(p_args->>'p_booking_id')::uuid and scope_partition_id=v_event.scope_partition_id for key share; insert into reservations.payments(scope_partition_id,booking_id,amount,payment_date,payment_method,payment_method_other,reference,notes,created_by,created_by_device_id) values(v_event.scope_partition_id,v_booking.id,(p_args->>'p_amount')::numeric,(p_args->>'p_payment_date')::date,p_args->>'p_payment_method',nullif(btrim(p_args->>'p_payment_method_other'),''),nullif(p_args->>'p_reference',''),nullif(p_args->>'p_notes',''),v_actor,p_device_id) returning id into v_id; v_result:=jsonb_build_object('paymentId',v_id,'status','active');
  elsif p_operation='update_attendance' then select * into v_booking from reservations.bookings where id=(p_args->>'p_booking_id')::uuid and scope_partition_id=v_event.scope_partition_id for key share; if cardinality(v_booking.attendance_segments_snapshot)=0 then raise exception 'RESERVATIONS_ATTENDANCE_NOT_APPLICABLE' using errcode='22023'; end if; if not (p_args->>'p_segment'=any(v_booking.attendance_segments_snapshot)) then raise exception 'RESERVATIONS_ATTENDANCE_SEGMENT_INELIGIBLE' using errcode='22023'; end if; insert into reservations.attendance_records(scope_partition_id,booking_id,segment,attended,attendance_date,notes,created_by,updated_by) values(v_event.scope_partition_id,v_booking.id,p_args->>'p_segment',(p_args->>'p_attended')::boolean,case when (p_args->>'p_attended')::boolean then coalesce((p_args->>'p_attendance_date')::date,current_date) end,nullif(p_args->>'p_notes',''),v_actor,v_actor) on conflict(booking_id,segment) do update set attended=excluded.attended,attendance_date=excluded.attendance_date,notes=excluded.notes,revision=reservations.attendance_records.revision+1,updated_at=statement_timestamp(),updated_by=v_actor returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('attendanceId',v_id,'revision',v_revision);
  else raise exception 'RESERVATIONS_STANDALONE_OPERATION_NOT_IMPLEMENTED' using errcode='0A000'; end if;
  return reservations_private.complete_operation((p_args->>'p_operation_id')::uuid,v_context,p_operation,p_args,v_result);
end $$;
create function reservations.mutate(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_booking reservations.bookings%rowtype; v_event_id uuid; v_partition uuid; v_scope_type text;
begin
  if p_operation='create_event' and coalesce(p_args->>'p_scope_type','conference')='standalone' then
    return reservations_private.create_standalone_event(p_device_id,p_args-'p_scope_type');
  end if;
  if p_operation='create_event' then
    v_partition:=(p_args->>'p_conference_id')::uuid; v_scope_type:='conference';
  elsif p_args ? 'p_event_id' then
    v_event_id:=(p_args->>'p_event_id')::uuid;
  elsif p_args ? 'p_booking_id' then
    select b.event_id into v_event_id from reservations.bookings b where b.id=(p_args->>'p_booking_id')::uuid;
  elsif p_operation='void_payment' then
    select b.event_id into v_event_id from reservations.payments z join reservations.bookings b on b.id=z.booking_id where z.id=(p_args->>'p_payment_id')::uuid;
  end if;
  if v_event_id is not null then select scope_partition_id,scope_type into v_partition,v_scope_type from reservations.events where id=v_event_id; end if;
  if v_partition is null then raise exception 'RESERVATIONS_SCOPE_TARGET_REQUIRED' using errcode='22023'; end if;
  perform set_config('reservations.scope_partition_id',v_partition::text,true);
  if v_scope_type='standalone' then return reservations_private.mutate_standalone(p_device_id,p_operation,p_args,v_event_id); end if;
  if p_operation='update_attendance' then
    select b.* into v_booking from reservations.bookings b where b.id=(p_args->>'p_booking_id')::uuid;
    if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
    perform reservations_private.event_scope_context(p_device_id,v_booking.event_id,'reservations.attendance.manage');
    if cardinality(v_booking.attendance_segments_snapshot)=0 then raise exception 'RESERVATIONS_ATTENDANCE_NOT_APPLICABLE' using errcode='22023'; end if;
  end if;
  return reservations.mutate_pre_scope_partition_integrity(p_device_id,p_operation,p_args);
end $$;

revoke all on function reservations_private.enforce_event_scope_partition_immutable(),reservations_private.event_scope_context(uuid,uuid,text),reservations_private.standalone_accommodation_not_applicable(uuid),reservations_private.project_booking_to_conference(uuid,uuid,jsonb),reservations_private.project_booking_to_conference_pre_scope_partition(uuid,uuid,jsonb),reservations.read_pre_scope_partition_integrity(uuid,text,jsonb),reservations.mutate_pre_scope_partition_integrity(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function reservations_private.enforce_event_scope_partition_immutable(),reservations_private.event_scope_context(uuid,uuid,text),reservations_private.standalone_accommodation_not_applicable(uuid),reservations_private.project_booking_to_conference(uuid,uuid,jsonb),reservations_private.project_booking_to_conference_pre_scope_partition(uuid,uuid,jsonb),reservations.read_pre_scope_partition_integrity(uuid,text,jsonb),reservations.mutate_pre_scope_partition_integrity(uuid,text,jsonb) to postgres;
revoke all on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) to service_role;
*/

-- Round B0: creation has no pre-existing partition, so its replay key is the
-- normalized browser intent.  The generated partition is persisted only after
-- the serialized first create, never supplied by the browser.
create or replace function reservations_private.standalone_create_business_args(p_args jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if p_args is null or jsonb_typeof(p_args)<>'object'
    or p_args ?| array['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id'] then
   raise exception 'RESERVATIONS_SCOPE_OVERRIDE_DENIED' using errcode='42501';
 end if;
 if not p_args ?& array['p_operation_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']
    or p_args - array['p_operation_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes'] <> '{}'::jsonb then
   raise exception 'RESERVATIONS_STANDALONE_CREATE_ARGUMENTS_INVALID' using errcode='22023';
 end if;
 return jsonb_build_object(
   'name',btrim(p_args->>'p_name'),
   'startDate',((p_args->>'p_start_date')::date)::text,
   'endDate',((p_args->>'p_end_date')::date)::text,
   'location',coalesce(p_args->>'p_location',''),
   'capacity',(p_args->>'p_capacity')::integer,
   'status',p_args->>'p_status',
   'notes',coalesce(p_args->>'p_notes','')
 );
end $$;
create or replace function reservations_private.standalone_create_intent(p_args jsonb)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('operation','create_event','scopeType','standalone','args',reservations_private.standalone_create_business_args(p_args))::text,'UTF8'),'sha256'),'hex');
$$;
create or replace function reservations_private.begin_standalone_create(p_operation_id uuid,p_context jsonb,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prior reservations.operations%rowtype; v_intent text:=reservations_private.standalone_create_intent(p_args);
begin
 if p_operation_id is null then raise exception 'RESERVATIONS_OPERATION_ID_REQUIRED' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservations-operation:'||p_operation_id::text,0));
 select * into v_prior from reservations.operations where operation_id=p_operation_id;
 if not found then return null; end if;
 if v_prior.actor_user_id<>(p_context->>'actorUserId')::uuid or v_prior.device_id<>(p_context->>'actorDeviceId')::uuid or v_prior.operation_name<>'create_event' or v_prior.intent_hash<>v_intent then raise exception 'RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
 return v_prior.result;
end $$;
create or replace function reservations_private.complete_standalone_create(p_operation_id uuid,p_context jsonb,p_args jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform set_config('reservations.scope_partition_id',(p_context->>'scopePartitionId'),true);
 insert into reservations.operations(operation_id,scope_partition_id,organization_id,actor_user_id,device_id,operation_name,intent_hash,result)
 values(p_operation_id,(p_context->>'scopePartitionId')::uuid,null,(p_context->>'actorUserId')::uuid,(p_context->>'actorDeviceId')::uuid,'create_event',reservations_private.standalone_create_intent(p_args),p_result);
 return p_result;
end $$;
create or replace function reservations_private.create_standalone_event_scoped(p_device_id uuid,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_partition uuid; v_actor uuid; v_replay jsonb; v_id uuid; v_revision bigint; v_result jsonb; v_operation_id uuid:=(p_args->>'p_operation_id')::uuid;
begin
 perform reservations_private.standalone_create_business_args(p_args);
 v_context:=public.require_effective_module_permission(p_device_id,'reservations','reservations.event.manage',null,null)||jsonb_build_object('scopeType','standalone');
 v_actor:=(v_context->>'actorUserId')::uuid;
 v_replay:=reservations_private.begin_standalone_create(v_operation_id,v_context,p_args);
 if v_replay is not null then return v_replay; end if;
 v_partition:=extensions.gen_random_uuid();
 v_context:=v_context||jsonb_build_object('scopePartitionId',v_partition);
 insert into reservations.events(scope_type,scope_partition_id,organization_id,conference_id,name,start_date,end_date,location,capacity,status,notes,created_by,updated_by)
 values('standalone',v_partition,null,null,btrim(p_args->>'p_name'),(p_args->>'p_start_date')::date,(p_args->>'p_end_date')::date,coalesce(p_args->>'p_location',''),(p_args->>'p_capacity')::integer,p_args->>'p_status',coalesce(p_args->>'p_notes',''),v_actor,v_actor)
 returning id,revision into v_id,v_revision;
 v_result:=jsonb_build_object('eventId',v_id,'revision',v_revision,'scopeType','standalone','scopePartitionId',v_partition);
 perform reservations_private.audit(v_context,'event.created','event',v_id,v_operation_id,null,v_result);
 return reservations_private.complete_standalone_create(v_operation_id,v_context,p_args,v_result);
end $$;

-- Round B0A: extend only the Platform audit scope invariant.  Historical
-- Platform and Inventory rows remain null-scoped; Reservations alone is a
-- partition-scoped audit domain.
do $$
declare v_constraint record;
begin
 for v_constraint in
   select conname
   from pg_constraint
   where conrelid='platform.audit_events'::regclass and contype='c'
     and (pg_get_constraintdef(oid) like '%scope_type%' or pg_get_constraintdef(oid) like '%scope_id%')
 loop
   execute format('alter table platform.audit_events drop constraint %I',v_constraint.conname);
 end loop;
end $$;
alter table platform.audit_events add constraint platform_audit_events_scope_invariant_check check (
  (scope_type is null and scope_id is null)
  or (scope_type in ('platform','inventory') and scope_id is null)
  or (scope_type='reservations' and scope_id is not null)
);

create or replace function platform_private.write_scoped_audit_event(
 p_actor_user_id uuid,p_subject_user_id uuid,p_domain text,p_module text,p_action text,p_entity_type text,p_entity_id uuid,
 p_scope_type text,p_scope_id uuid,p_old_values jsonb,p_new_values jsonb,p_metadata jsonb default '{}'::jsonb,
 p_request_id uuid default null,p_operation_id uuid default null,p_source text default 'rpc') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if p_scope_type<>'reservations' or p_scope_id is null then raise exception 'PLATFORM_AUDIT_SCOPE_INVALID' using errcode='22023'; end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,subject_user_id,domain,module,action,
 entity_type,entity_id,scope_type,scope_id,old_values,new_values,metadata,request_id,operation_id,source)
 values(p_actor_user_id,platform_private.current_device_authorization_id(p_actor_user_id),p_subject_user_id,p_domain,p_module,p_action,
 p_entity_type,p_entity_id,p_scope_type,p_scope_id,p_old_values,p_new_values,coalesce(p_metadata,'{}'::jsonb),p_request_id,p_operation_id,p_source)
 returning id into v_id;
 return v_id;
end $$;

create or replace function reservations_private.audit(p_context jsonb,p_action text,p_entity_type text,p_entity_id uuid,p_operation_id uuid,p_old jsonb,p_new jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(p_context->>'actorUserId')::uuid; v_device uuid:=(p_context->>'actorDeviceId')::uuid; v_authorization uuid; v_scope_type text:=p_context->>'scopeType'; v_partition uuid:=nullif(p_context->>'scopePartitionId','')::uuid; v_metadata jsonb;
begin
 v_authorization:=platform_private.validated_phase1c_device_authorization(v_actor,v_device);
 if v_authorization is null then raise exception 'RESERVATIONS_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
 if v_scope_type is null and v_partition is null then
   insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
   values(v_actor,v_authorization,'platform','reservations',p_action,p_entity_type,p_entity_id,'platform',p_old,p_new,jsonb_build_object('organizationId',p_context->>'organizationId','deviceId',v_device),p_operation_id,'rpc');
   return;
 end if;
 if v_scope_type not in ('conference','standalone') or v_partition is null then raise exception 'RESERVATIONS_AUDIT_SCOPE_CONTEXT_INVALID' using errcode='22023'; end if;
 v_metadata:=jsonb_strip_nulls(jsonb_build_object('reservationsScopeType',v_scope_type,'conferenceId',case when v_scope_type='conference' then p_context->>'conferenceId' end,'organizationId',case when v_scope_type='conference' then p_context->>'organizationId' end,'deviceId',v_device));
 perform platform_private.write_scoped_audit_event(v_actor,null,'platform','reservations',p_action,p_entity_type,p_entity_id,'reservations',v_partition,p_old,p_new,v_metadata,null,p_operation_id,'rpc');
end $$;

-- Round B1A remains private and inactive: Event and Event Period mutations only.
create or replace function reservations_private.mutate_scoped(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_replay jsonb; v_result jsonb; v_event reservations.events%rowtype; v_period reservations.event_periods%rowtype; v_type reservations.booking_types%rowtype; v_booking reservations.bookings%rowtype; v_payment reservations.payments%rowtype; v_operation reservations.operations%rowtype; v_id uuid; v_revision bigint; v_actor uuid; v_partition uuid; v_number text; v_operation_id uuid:=(p_args->>'p_operation_id')::uuid; v_count integer;
begin
 if p_args is null or jsonb_typeof(p_args)<>'object' or p_args ?| array['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id'] then raise exception 'RESERVATIONS_SCOPE_OVERRIDE_DENIED' using errcode='42501'; end if;
 if p_operation='delete_event' and v_operation_id is not null then
  select * into v_operation from reservations.operations where operation_id=v_operation_id;
  if found then
   v_context:=public.require_effective_module_permission(p_device_id,'reservations','reservations.event.manage',null,null)||jsonb_build_object('scopePartitionId',v_operation.scope_partition_id,'organizationId',v_operation.organization_id);
   return reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args);
  end if;
 end if;
 if p_operation='delete_event_period' and v_operation_id is not null then
  select * into v_operation from reservations.operations where operation_id=v_operation_id;
  if found then
   v_context:=public.require_effective_module_permission(p_device_id,'reservations','reservations.event.manage',null,null)||jsonb_build_object('scopePartitionId',v_operation.scope_partition_id,'organizationId',v_operation.organization_id);
   return reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args);
  end if;
 end if;
 if p_operation='delete_booking' and v_operation_id is not null then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision']);
  select * into v_operation from reservations.operations where operation_id=v_operation_id;
  if found then
   v_context:=public.require_effective_module_permission(p_device_id,'reservations','reservations.booking.delete',null,null)||jsonb_build_object('scopePartitionId',v_operation.scope_partition_id,'organizationId',v_operation.organization_id);
   return reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args);
  end if;
 end if;
 if p_operation='create_event' then
  if p_args->>'p_scope_type'='standalone' then
   return reservations_private.create_standalone_event_scoped(p_device_id,p_args-'p_scope_type');
  elsif p_args->>'p_scope_type'<>'conference' or (p_args->>'p_conference_id')::uuid is null then raise exception 'RESERVATIONS_CREATE_EVENT_SCOPE_INVALID' using errcode='22023'; end if;
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_scope_type','p_conference_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
  v_context:=reservations_private.conference_context(p_device_id,(p_args->>'p_conference_id')::uuid,'reservations.event.manage'); v_actor:=(v_context->>'actorUserId')::uuid; v_partition:=(v_context->>'scopePartitionId')::uuid;
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,'create_event',p_args); if v_replay is not null then return v_replay; end if;
  insert into reservations.events(scope_type,scope_partition_id,organization_id,conference_id,name,start_date,end_date,location,capacity,status,notes,created_by,updated_by) values('conference',v_partition,(v_context->>'organizationId')::uuid,(p_args->>'p_conference_id')::uuid,btrim(p_args->>'p_name'),(p_args->>'p_start_date')::date,(p_args->>'p_end_date')::date,coalesce(p_args->>'p_location',''),(p_args->>'p_capacity')::integer,p_args->>'p_status',coalesce(p_args->>'p_notes',''),v_actor,v_actor) returning id,revision into v_id,v_revision;
  v_result:=jsonb_build_object('eventId',v_id,'revision',v_revision,'scopeType','conference','scopePartitionId',v_partition); perform reservations_private.audit(v_context||jsonb_build_object('scopeType','conference','scopePartitionId',v_partition),'event.created','event',v_id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,'create_event',p_args,v_result);
 end if;
 if p_operation='update_event' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']); v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage');
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_event from reservations.events where id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for update; if v_event.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
  update reservations.events set name=btrim(p_args->>'p_name'),start_date=(p_args->>'p_start_date')::date,end_date=(p_args->>'p_end_date')::date,location=coalesce(p_args->>'p_location',''),capacity=(p_args->>'p_capacity')::integer,status=p_args->>'p_status',notes=coalesce(p_args->>'p_notes',''),revision=revision+1,updated_at=statement_timestamp(),updated_by=(v_context->>'actorUserId')::uuid where id=v_event.id returning revision into v_revision; if exists(select 1 from reservations.event_periods where event_id=v_event.id and (starts_on<(p_args->>'p_start_date')::date or ends_on>(p_args->>'p_end_date')::date)) then raise exception 'RESERVATIONS_EVENT_PERIOD_OUT_OF_RANGE' using errcode='22023'; end if; v_result:=jsonb_build_object('eventId',v_event.id,'revision',v_revision); perform reservations_private.audit(v_context,'event.updated','event',v_event.id,v_operation_id,to_jsonb(v_event),v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='delete_event' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision']); v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage'); v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_event from reservations.events where id=(v_context->>'eventId')::uuid for update; if v_event.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if; if exists(select 1 from reservations.bookings where event_id=v_event.id and scope_partition_id=v_event.scope_partition_id) then raise exception 'RESERVATIONS_EVENT_HAS_DEPENDENCIES' using errcode='55000'; end if; delete from reservations.event_periods where event_id=v_event.id and scope_partition_id=v_event.scope_partition_id; delete from reservations.booking_types where event_id=v_event.id and scope_partition_id=v_event.scope_partition_id; delete from reservations.events where id=v_event.id; v_result:=jsonb_build_object('eventId',v_event.id,'deleted',true); perform reservations_private.audit(v_context,'event.deleted','event',v_event.id,v_operation_id,to_jsonb(v_event),null); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='create_event_period' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_kind','p_starts_on','p_ends_on','p_display_order']); v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage'); v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_event from reservations.events where id=(v_context->>'eventId')::uuid for key share; if p_args->>'p_kind' not in ('conference','caravans') or (p_args->>'p_starts_on')::date<v_event.start_date or (p_args->>'p_ends_on')::date>v_event.end_date then raise exception 'RESERVATIONS_EVENT_PERIOD_OUT_OF_RANGE' using errcode='22023'; end if; insert into reservations.event_periods(scope_partition_id,organization_id,event_id,kind,starts_on,ends_on,display_order,created_by,updated_by) values(v_event.scope_partition_id,v_event.organization_id,v_event.id,p_args->>'p_kind',(p_args->>'p_starts_on')::date,(p_args->>'p_ends_on')::date,(p_args->>'p_display_order')::integer,(v_context->>'actorUserId')::uuid,(v_context->>'actorUserId')::uuid) returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('periodId',v_id,'revision',v_revision); perform reservations_private.audit(v_context,'event_period.created','event_period',v_id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation in ('update_event_period','delete_event_period') then
  perform platform_private.require_exact_jsonb_keys(p_args,case when p_operation='update_event_period' then array['p_operation_id','p_period_id','p_expected_revision','p_kind','p_starts_on','p_ends_on','p_display_order'] else array['p_operation_id','p_period_id','p_expected_revision'] end); v_context:=reservations_private.resolve_event_period_scope(p_device_id,(p_args->>'p_period_id')::uuid,'reservations.event.manage'); v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_period from reservations.event_periods where id=(v_context->>'periodId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for update; if v_period.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if; if p_operation='delete_event_period' then delete from reservations.event_periods where id=v_period.id; v_result:=jsonb_build_object('periodId',v_period.id,'deleted',true); else select * into v_event from reservations.events where id=v_period.event_id; if p_args->>'p_kind' not in ('conference','caravans') or (p_args->>'p_starts_on')::date<v_event.start_date or (p_args->>'p_ends_on')::date>v_event.end_date then raise exception 'RESERVATIONS_EVENT_PERIOD_OUT_OF_RANGE' using errcode='22023'; end if; update reservations.event_periods set kind=p_args->>'p_kind',starts_on=(p_args->>'p_starts_on')::date,ends_on=(p_args->>'p_ends_on')::date,display_order=(p_args->>'p_display_order')::integer,revision=revision+1,updated_at=statement_timestamp(),updated_by=(v_context->>'actorUserId')::uuid where id=v_period.id returning revision into v_revision; v_result:=jsonb_build_object('periodId',v_period.id,'revision',v_revision); end if; perform reservations_private.audit(v_context,'event_period.'||case when p_operation='delete_event_period' then 'deleted' else 'updated' end,'event_period',v_period.id,v_operation_id,to_jsonb(v_period),v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='create_booking_type' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_name','p_code','p_price','p_active','p_display_order','p_eligible_attendance_segments']); v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage'); v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_event from reservations.events where id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for key share; insert into reservations.booking_types(scope_partition_id,organization_id,event_id,name,code,price,active,display_order,eligible_attendance_segments,created_by,updated_by) values(v_event.scope_partition_id,v_event.organization_id,v_event.id,btrim(p_args->>'p_name'),btrim(p_args->>'p_code'),(p_args->>'p_price')::numeric,(p_args->>'p_active')::boolean,(p_args->>'p_display_order')::integer,coalesce((select array_agg(value) from jsonb_array_elements_text(p_args->'p_eligible_attendance_segments') s(value)),'{}'::text[]),(v_context->>'actorUserId')::uuid,(v_context->>'actorUserId')::uuid) returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('bookingTypeId',v_id,'revision',v_revision); perform reservations_private.audit(v_context,'booking_type.created','booking_type',v_id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='update_booking_type' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_type_id','p_expected_revision','p_name','p_code','p_price','p_active','p_display_order','p_eligible_attendance_segments']); v_context:=reservations_private.resolve_booking_type_scope(p_device_id,(p_args->>'p_booking_type_id')::uuid,'reservations.event.manage'); v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_type from reservations.booking_types where id=(v_context->>'bookingTypeId')::uuid and event_id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for update; if not found then raise exception 'RESERVATIONS_BOOKING_TYPE_NOT_FOUND' using errcode='P0002'; end if; if v_type.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
  update reservations.booking_types set name=btrim(p_args->>'p_name'),code=btrim(p_args->>'p_code'),price=(p_args->>'p_price')::numeric,active=(p_args->>'p_active')::boolean,display_order=(p_args->>'p_display_order')::integer,eligible_attendance_segments=coalesce((select array_agg(value) from jsonb_array_elements_text(p_args->'p_eligible_attendance_segments') s(value)),'{}'::text[]),revision=revision+1,updated_at=statement_timestamp(),updated_by=(v_context->>'actorUserId')::uuid where id=v_type.id and event_id=v_type.event_id and scope_partition_id=v_type.scope_partition_id returning revision into v_revision; v_result:=jsonb_build_object('bookingTypeId',v_type.id,'revision',v_revision); perform reservations_private.audit(v_context,'booking_type.updated','booking_type',v_type.id,v_operation_id,to_jsonb(v_type),v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='create_booking' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_booking_type_id','p_full_name','p_phone','p_age','p_church','p_governorate','p_city_or_village','p_service_sector','p_service_sector_other','p_notes']); v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.booking.create'); v_actor:=(v_context->>'actorUserId')::uuid;
  select * into v_event from reservations.events where id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for update; if not found or v_event.status in('closed','full') then raise exception 'RESERVATIONS_EVENT_NOT_ACCEPTING_BOOKINGS' using errcode='22023'; end if; select * into v_type from reservations.booking_types where id=(p_args->>'p_booking_type_id')::uuid and event_id=v_event.id and scope_partition_id=v_event.scope_partition_id for key share; if not found or not v_type.active then raise exception 'RESERVATIONS_BOOKING_TYPE_INACTIVE' using errcode='22023'; end if; select count(*) into v_count from reservations.bookings where event_id=v_event.id and scope_partition_id=v_event.scope_partition_id; if v_event.capacity is not null and v_count>=v_event.capacity then raise exception 'RESERVATIONS_EVENT_CAPACITY_REACHED' using errcode='22023'; end if;
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; v_number:=reservations_private.allocate_booking_number(v_event.scope_partition_id,extract(year from v_event.start_date)::integer); perform set_config('reservations.scope_partition_id',v_event.scope_partition_id::text,true); insert into reservations.participants(scope_partition_id,organization_id,full_name,phone,age,church,governorate,city_or_village,service_sector,service_sector_other,notes,created_by,updated_by) values(v_event.scope_partition_id,v_event.organization_id,btrim(p_args->>'p_full_name'),btrim(p_args->>'p_phone'),(p_args->>'p_age')::integer,coalesce(p_args->>'p_church',''),btrim(p_args->>'p_governorate'),coalesce(p_args->>'p_city_or_village',''),p_args->>'p_service_sector',nullif(btrim(p_args->>'p_service_sector_other'),''),nullif(p_args->>'p_notes',''),v_actor,v_actor) returning id into v_id; insert into reservations.bookings(scope_partition_id,organization_id,booking_number,participant_id,event_id,booking_type_id,booking_type_name_snapshot,price_snapshot,attendance_segments_snapshot,notes,created_by,updated_by) values(v_event.scope_partition_id,v_event.organization_id,v_number,v_id,v_event.id,v_type.id,v_type.name,v_type.price,v_type.eligible_attendance_segments,nullif(p_args->>'p_notes',''),v_actor,v_actor) returning id,revision into v_booking.id,v_revision; insert into reservations.operational_reviews(scope_partition_id,organization_id,booking_id,created_by,updated_by) values(v_event.scope_partition_id,v_event.organization_id,v_booking.id,v_actor,v_actor); v_result:=jsonb_build_object('participantId',v_id,'bookingId',v_booking.id,'bookingNumber',v_number,'revision',v_revision); perform reservations_private.audit(v_context,'booking.created','booking',v_booking.id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='update_participant_booking' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision','p_full_name','p_phone','p_age','p_church','p_governorate','p_city_or_village','p_service_sector','p_service_sector_other','p_notes']); v_context:=reservations_private.resolve_booking_scope(p_device_id,(p_args->>'p_booking_id')::uuid,'reservations.booking.update'); v_actor:=(v_context->>'actorUserId')::uuid;
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_booking from reservations.bookings where id=(v_context->>'bookingId')::uuid and event_id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for update; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; if v_booking.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
  update reservations.participants set full_name=btrim(p_args->>'p_full_name'),phone=btrim(p_args->>'p_phone'),age=(p_args->>'p_age')::integer,church=coalesce(p_args->>'p_church',''),governorate=btrim(p_args->>'p_governorate'),city_or_village=coalesce(p_args->>'p_city_or_village',''),service_sector=p_args->>'p_service_sector',service_sector_other=nullif(btrim(p_args->>'p_service_sector_other'),''),notes=nullif(p_args->>'p_notes',''),revision=revision+1,updated_at=statement_timestamp(),updated_by=v_actor where id=v_booking.participant_id and scope_partition_id=v_booking.scope_partition_id and organization_id is not distinct from v_booking.organization_id; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; update reservations.bookings set notes=nullif(p_args->>'p_notes',''),revision=revision+1,updated_at=statement_timestamp(),updated_by=v_actor where id=v_booking.id and event_id=v_booking.event_id and scope_partition_id=v_booking.scope_partition_id and organization_id is not distinct from v_booking.organization_id returning revision into v_revision; v_result:=jsonb_build_object('bookingId',v_booking.id,'revision',v_revision); perform reservations_private.audit(v_context,'booking.updated','booking',v_booking.id,v_operation_id,to_jsonb(v_booking),v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='delete_booking' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision']); v_context:=reservations_private.resolve_booking_scope(p_device_id,(p_args->>'p_booking_id')::uuid,'reservations.booking.delete');
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_booking from reservations.bookings where id=(v_context->>'bookingId')::uuid and event_id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for update; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; if v_booking.revision<>(p_args->>'p_expected_revision')::bigint then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if;
  if exists(select 1 from reservations.conference_person_links where booking_id=v_booking.id) then raise exception 'RESERVATIONS_CONFERENCE_PERSON_MANUAL_ACTION_REQUIRED' using errcode='55000'; end if; if exists(select 1 from reservations.payments where booking_id=v_booking.id and scope_partition_id=v_booking.scope_partition_id) or exists(select 1 from reservations.attendance_records where booking_id=v_booking.id and scope_partition_id=v_booking.scope_partition_id) then raise exception 'RESERVATIONS_BOOKING_HAS_HISTORY' using errcode='55000'; end if;
  delete from reservations.bookings where id=v_booking.id and event_id=v_booking.event_id and scope_partition_id=v_booking.scope_partition_id and organization_id is not distinct from v_booking.organization_id; v_result:=jsonb_build_object('bookingId',v_booking.id,'deleted',true); perform reservations_private.audit(v_context,'booking.deleted','booking',v_booking.id,v_operation_id,to_jsonb(v_booking),null); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='record_payment' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_amount','p_payment_date','p_payment_method','p_payment_method_other','p_reference','p_notes']); v_context:=reservations_private.resolve_booking_scope(p_device_id,(p_args->>'p_booking_id')::uuid,'reservations.payment.record'); v_actor:=(v_context->>'actorUserId')::uuid;
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_booking from reservations.bookings where id=(v_context->>'bookingId')::uuid and event_id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid for key share; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
  insert into reservations.payments(scope_partition_id,organization_id,booking_id,amount,payment_date,payment_method,payment_method_other,reference,notes,created_by,created_by_device_id) values(v_booking.scope_partition_id,v_booking.organization_id,v_booking.id,(p_args->>'p_amount')::numeric,(p_args->>'p_payment_date')::date,p_args->>'p_payment_method',nullif(btrim(p_args->>'p_payment_method_other'),''),nullif(p_args->>'p_reference',''),nullif(p_args->>'p_notes',''),v_actor,p_device_id) returning id into v_id; v_result:=jsonb_build_object('paymentId',v_id,'status','active'); perform reservations_private.audit(v_context,'payment.recorded','payment',v_id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='void_payment' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_payment_id','p_void_reason']); v_context:=reservations_private.resolve_payment_scope(p_device_id,(p_args->>'p_payment_id')::uuid,'reservations.payment.void'); v_actor:=(v_context->>'actorUserId')::uuid;
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; select * into v_payment from reservations.payments where id=(v_context->>'paymentId')::uuid and booking_id=(v_context->>'bookingId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid and organization_id is not distinct from nullif(v_context->>'organizationId','')::uuid for update; if not found then raise exception 'RESERVATIONS_PAYMENT_NOT_FOUND' using errcode='P0002'; end if; if v_payment.status<>'active' or nullif(btrim(p_args->>'p_void_reason'),'') is null then raise exception 'RESERVATIONS_PAYMENT_VOID_INVALID' using errcode='22023'; end if;
  update reservations.payments set status='voided',voided_at=statement_timestamp(),void_reason=btrim(p_args->>'p_void_reason'),voided_by=v_actor,voided_by_device_id=p_device_id where id=v_payment.id and booking_id=v_payment.booking_id and scope_partition_id=v_payment.scope_partition_id and organization_id is not distinct from v_payment.organization_id; v_result:=jsonb_build_object('paymentId',v_payment.id,'status','voided'); perform reservations_private.audit(v_context,'payment.voided','payment',v_payment.id,v_operation_id,to_jsonb(v_payment),v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='update_attendance' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_segment','p_attended','p_attendance_date','p_notes']); v_context:=reservations_private.resolve_booking_scope(p_device_id,(p_args->>'p_booking_id')::uuid,'reservations.attendance.manage'); v_actor:=(v_context->>'actorUserId')::uuid;
  select * into v_booking from reservations.bookings where id=(v_context->>'bookingId')::uuid and event_id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid and organization_id is not distinct from nullif(v_context->>'organizationId','')::uuid for key share; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if; if cardinality(v_booking.attendance_segments_snapshot)=0 then raise exception 'RESERVATIONS_ATTENDANCE_NOT_APPLICABLE' using errcode='22023'; end if; if not (p_args->>'p_segment'=any(v_booking.attendance_segments_snapshot)) then raise exception 'RESERVATIONS_ATTENDANCE_SEGMENT_INELIGIBLE' using errcode='22023'; end if;
  v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; insert into reservations.attendance_records(scope_partition_id,organization_id,booking_id,segment,attended,attendance_date,notes,created_by,updated_by) values(v_booking.scope_partition_id,v_booking.organization_id,v_booking.id,p_args->>'p_segment',(p_args->>'p_attended')::boolean,case when (p_args->>'p_attended')::boolean then coalesce((p_args->>'p_attendance_date')::date,current_date) end,nullif(p_args->>'p_notes',''),v_actor,v_actor) on conflict(booking_id,segment) do update set attended=excluded.attended,attendance_date=excluded.attendance_date,notes=excluded.notes,revision=reservations.attendance_records.revision+1,updated_at=statement_timestamp(),updated_by=v_actor returning id,revision into v_id,v_revision; v_result:=jsonb_build_object('attendanceId',v_id,'revision',v_revision,'attended',(p_args->>'p_attended')::boolean); perform reservations_private.audit(v_context,'attendance.corrected','attendance',v_id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='update_operational_review' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision','p_review_status']); v_context:=reservations_private.resolve_booking_scope(p_device_id,(p_args->>'p_booking_id')::uuid,'reservations.operations.manage'); v_actor:=(v_context->>'actorUserId')::uuid;
  select o.id,o.revision into v_id,v_revision from reservations.operational_reviews o where o.booking_id=(v_context->>'bookingId')::uuid and o.scope_partition_id=(v_context->>'scopePartitionId')::uuid and o.organization_id is not distinct from nullif(v_context->>'organizationId','')::uuid for update; if not found then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if; v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if;
  update reservations.operational_reviews o set review_status=p_args->>'p_review_status',reviewed_at=case when p_args->>'p_review_status'='completed' then statement_timestamp() end,reviewed_by=case when p_args->>'p_review_status'='completed' then v_actor end,reviewed_by_device_id=case when p_args->>'p_review_status'='completed' then p_device_id end,revision=o.revision+1,updated_at=statement_timestamp(),updated_by=v_actor where o.id=v_id and o.booking_id=(v_context->>'bookingId')::uuid and o.scope_partition_id=(v_context->>'scopePartitionId')::uuid and o.organization_id is not distinct from nullif(v_context->>'organizationId','')::uuid and o.revision=(p_args->>'p_expected_revision')::bigint returning o.id,o.revision into v_id,v_revision; if not found then raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001'; end if; v_result:=jsonb_build_object('operationalReviewId',v_id,'revision',v_revision,'status',p_args->>'p_review_status'); perform reservations_private.audit(v_context,'operational_review.updated','operational_review',v_id,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 if p_operation='reorder_event_periods' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_period_ids']); v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage'); v_replay:=reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args); if v_replay is not null then return v_replay; end if; if jsonb_typeof(p_args->'p_period_ids')<>'array' or (select count(*) from jsonb_array_elements_text(p_args->'p_period_ids'))<>(select count(*) from reservations.event_periods where event_id=(v_context->>'eventId')::uuid and scope_partition_id=(v_context->>'scopePartitionId')::uuid) or (select count(distinct value) from jsonb_array_elements_text(p_args->'p_period_ids') s(value))<>(select count(*) from jsonb_array_elements_text(p_args->'p_period_ids')) or exists(select 1 from jsonb_array_elements_text(p_args->'p_period_ids') x left join reservations.event_periods p on p.id=x::uuid and p.event_id=(v_context->>'eventId')::uuid and p.scope_partition_id=(v_context->>'scopePartitionId')::uuid where p.id is null) then raise exception 'RESERVATIONS_PERIOD_ORDER_INVALID' using errcode='22023'; end if; update reservations.event_periods p set display_order=x.ordinality-1,revision=p.revision+1,updated_at=statement_timestamp(),updated_by=(v_context->>'actorUserId')::uuid from jsonb_array_elements_text(p_args->'p_period_ids') with ordinality x(id,ordinality) where p.id=x.id::uuid and p.event_id=(v_context->>'eventId')::uuid and p.scope_partition_id=(v_context->>'scopePartitionId')::uuid; v_result:=jsonb_build_object('eventId',(v_context->>'eventId')::uuid,'reordered',true); perform reservations_private.audit(v_context,'event_periods.reordered','event',(v_context->>'eventId')::uuid,v_operation_id,null,v_result); return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
 end if;
 raise exception 'RESERVATIONS_SCOPED_OPERATION_NOT_IMPLEMENTED' using errcode='0A000';
end $$;

-- Round C1: complete private/inactive read path.  The public dispatcher remains
-- unchanged until the later activation round.
create or replace function reservations_private.read_scoped(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_permission text; v_context jsonb; v_event_id uuid; v_booking_id uuid; v_conference_id uuid;
 v_partition uuid; v_organization_id uuid; v_limit integer:=coalesce((p_args->>'p_limit')::integer,100);
 v_result jsonb; v_after_created_at timestamptz; v_after_booking_id uuid; v_rows jsonb;
 v_has_more boolean; v_last_created_at timestamptz; v_last_booking_id uuid;
 v_link reservations.conference_person_links%rowtype; v_snapshot jsonb; v_room jsonb; v_house jsonb; v_floor jsonb;
begin
 if p_args is null or jsonb_typeof(p_args)<>'object' then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
 if p_args ?| array['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id'] then raise exception 'RESERVATIONS_SCOPE_OVERRIDE_DENIED' using errcode='42501'; end if;
 v_permission:=case when p_operation in('list_conference_options','list_events','get_event','list_event_periods','list_booking_types') then 'reservations.event.view' when p_operation in('list_bookings','get_booking_detail','search_participants_bookings','get_booking_accommodation') then 'reservations.booking.view' when p_operation='list_booking_payments' then 'reservations.payment.view' when p_operation='list_attendance' then 'reservations.attendance.view' when p_operation='get_operational_state' then 'reservations.operations.view' when p_operation in('get_dashboard_summary','get_report_source_data','get_report_booking_page') then 'reservations.reports.view' end;
 if v_permission is null then raise exception 'RESERVATIONS_OPERATION_NOT_ALLOWED' using errcode='42501'; end if;

 if p_operation='list_conference_options' then
  perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]); v_context:=public.require_effective_module_permission(p_device_id,'reservations',v_permission,null,null);
  return (select coalesce(jsonb_agg(jsonb_build_object('conferenceId',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb) from public.conferences c join public.conference_members m on m.conference_id=c.id and m.user_id=(v_context->>'actorUserId')::uuid where c.deleted_at is null);
 end if;
 if p_operation='list_events' then
  if p_args ? 'p_conference_id' and not p_args ? 'p_scope_type' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_status','p_limit']); v_conference_id:=nullif(p_args->>'p_conference_id','')::uuid; if v_conference_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; v_context:=reservations_private.conference_context(p_device_id,v_conference_id,v_permission); v_organization_id:=(v_context->>'organizationId')::uuid;
  elsif p_args ? 'p_scope_type' and not p_args ? 'p_conference_id' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_scope_type','p_status','p_limit']); if p_args->>'p_scope_type'<>'standalone' then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; v_context:=public.require_effective_module_permission(p_device_id,'reservations',v_permission,null,null);
  else raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
  if v_limit<1 or v_limit>5000 then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]'::jsonb) into v_result from (select e.* from reservations.events e where ((v_conference_id is not null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) or (v_conference_id is null and e.scope_type='standalone' and e.conference_id is null and e.organization_id is null)) and ((p_args->>'p_status') is null or e.status=p_args->>'p_status') order by e.start_date desc,e.id limit v_limit) x; return v_result;
 end if;

 if p_operation in('list_bookings','search_participants_bookings','list_attendance','get_report_source_data') and p_args ? 'p_conference_id' and p_args ? 'p_event_id' and p_args->'p_event_id'='null'::jsonb then
  v_conference_id:=nullif(p_args->>'p_conference_id','')::uuid; if v_conference_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; v_context:=reservations_private.conference_context(p_device_id,v_conference_id,v_permission);
 elsif p_operation in('get_event','list_event_periods','list_booking_types','list_bookings','search_participants_bookings','list_attendance','get_report_source_data','get_report_booking_page') or (p_operation='get_dashboard_summary' and p_args ? 'p_event_id') then
  v_event_id:=nullif(p_args->>'p_event_id','')::uuid; if v_event_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; v_context:=reservations_private.resolve_event_scope(p_device_id,v_event_id,v_permission);
 elsif p_operation in('get_booking_detail','list_booking_payments','get_operational_state','get_booking_accommodation') then
  v_booking_id:=nullif(p_args->>'p_booking_id','')::uuid; if v_booking_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; v_context:=reservations_private.resolve_booking_scope(p_device_id,v_booking_id,v_permission);
 elsif p_operation='get_dashboard_summary' then
  v_conference_id:=nullif(p_args->>'p_conference_id','')::uuid; if v_conference_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; v_context:=reservations_private.conference_context(p_device_id,v_conference_id,v_permission);
 end if;
 v_partition:=nullif(v_context->>'scopePartitionId','')::uuid; v_organization_id:=nullif(v_context->>'organizationId','')::uuid;

 if p_operation='get_event' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']); select to_jsonb(e)||jsonb_build_object('periods',(select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order),'[]') from reservations.event_periods p where p.event_id=e.id and p.scope_partition_id=e.scope_partition_id),'bookingTypes',(select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]') from reservations.booking_types t where t.event_id=e.id and t.scope_partition_id=e.scope_partition_id)) into v_result from reservations.events e where e.id=v_event_id and e.scope_partition_id=v_partition;
 elsif p_operation='list_event_periods' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']); select coalesce(jsonb_agg(to_jsonb(p) order by p.display_order),'[]') into v_result from reservations.event_periods p where p.event_id=v_event_id and p.scope_partition_id=v_partition;
 elsif p_operation='list_booking_types' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']); select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]') into v_result from reservations.booking_types t where t.event_id=v_event_id and t.scope_partition_id=v_partition;
 elsif p_operation in('list_bookings','search_participants_bookings') then
  perform platform_private.require_exact_jsonb_keys(p_args,case when p_operation='list_bookings' and v_conference_id is not null then array['p_conference_id','p_event_id','p_limit'] when p_operation='list_bookings' then array['p_event_id','p_limit'] when v_conference_id is not null then array['p_conference_id','p_query','p_event_id','p_limit'] else array['p_event_id','p_query','p_limit'] end); if v_limit<1 or v_limit>5000 then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') into v_result from (select b.*,to_jsonb(p) participant,to_jsonb(e) event,coalesce(pay.total_paid,0) total_paid,greatest(b.price_snapshot-coalesce(pay.total_paid,0),0) remaining_balance,greatest(coalesce(pay.total_paid,0)-b.price_snapshot,0) overpaid_amount,case when coalesce(pay.total_paid,0)=0 then 'unpaid' when pay.total_paid>=b.price_snapshot then 'paid' else 'partial' end payment_status from reservations.bookings b join reservations.participants p on p.id=b.participant_id and p.scope_partition_id=b.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id left join lateral(select sum(z.amount) total_paid from reservations.payments z where z.booking_id=b.id and z.scope_partition_id=b.scope_partition_id and z.status='active') pay on true where ((v_event_id is not null and b.event_id=v_event_id and b.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id)) and (p_operation='list_bookings' or lower(p.full_name||' '||p.phone||' '||b.booking_number) like '%'||lower(btrim(p_args->>'p_query'))||'%') order by b.created_at desc,b.id limit v_limit) x;
 elsif p_operation='get_booking_detail' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_booking_id']); select to_jsonb(b)||jsonb_build_object('participant',to_jsonb(p),'event',to_jsonb(e),'payments',(select coalesce(jsonb_agg(to_jsonb(z) order by z.payment_date desc,z.id),'[]') from reservations.payments z where z.booking_id=b.id and z.scope_partition_id=b.scope_partition_id),'attendance',(select coalesce(jsonb_agg(to_jsonb(a) order by a.segment),'[]') from reservations.attendance_records a where a.booking_id=b.id and a.scope_partition_id=b.scope_partition_id),'operationalReview',(select to_jsonb(o) from reservations.operational_reviews o where o.booking_id=b.id and o.scope_partition_id=b.scope_partition_id)) into v_result from reservations.bookings b join reservations.participants p on p.id=b.participant_id and p.scope_partition_id=b.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where b.id=v_booking_id and b.scope_partition_id=v_partition;
 elsif p_operation='list_booking_payments' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_booking_id']); select coalesce(jsonb_agg(to_jsonb(z) order by z.payment_date desc,z.id),'[]') into v_result from reservations.payments z where z.booking_id=v_booking_id and z.scope_partition_id=v_partition;
 elsif p_operation='list_attendance' then
  perform platform_private.require_exact_jsonb_keys(p_args,case when v_conference_id is not null then array['p_conference_id','p_event_id','p_limit'] else array['p_event_id','p_limit'] end); if v_limit<1 or v_limit>5000 then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; select coalesce(jsonb_agg(to_jsonb(x) order by x.full_name,x.booking_id,x.segment),'[]') into v_result from (select a.*,p.full_name,b.booking_number from reservations.attendance_records a join reservations.bookings b on b.id=a.booking_id and b.scope_partition_id=a.scope_partition_id join reservations.participants p on p.id=b.participant_id and p.scope_partition_id=b.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and b.event_id=v_event_id and b.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) limit v_limit) x;
 elsif p_operation='get_operational_state' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_booking_id']); select to_jsonb(o)||jsonb_build_object('booking',to_jsonb(b),'participant',to_jsonb(p),'totalPaid',coalesce((select sum(z.amount) from reservations.payments z where z.booking_id=b.id and z.scope_partition_id=b.scope_partition_id and z.status='active'),0)) into v_result from reservations.operational_reviews o join reservations.bookings b on b.id=o.booking_id and b.scope_partition_id=o.scope_partition_id join reservations.participants p on p.id=b.participant_id and p.scope_partition_id=b.scope_partition_id where o.booking_id=v_booking_id and o.scope_partition_id=v_partition;
 elsif p_operation='get_booking_accommodation' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_booking_id']); if v_context->>'scopeType'='standalone' then return reservations_private.standalone_accommodation_not_applicable(v_booking_id); end if; select l.* into v_link from reservations.conference_person_links l where l.booking_id=v_booking_id; if not found then return jsonb_build_object('bookingId',v_booking_id,'linked',false,'readyForAccommodation',false,'accommodated',false); end if; select s.data into v_snapshot from public.conference_snapshots s where s.conference_id=v_link.conference_id; select h.value,f.value,r.value into v_house,v_floor,v_room from jsonb_array_elements(case when jsonb_typeof(v_snapshot->'houses')='array' then v_snapshot->'houses' else '[]'::jsonb end) h(value) cross join lateral jsonb_array_elements(case when jsonb_typeof(h.value->'floors')='array' then h.value->'floors' else '[]'::jsonb end) f(value) cross join lateral jsonb_array_elements(case when jsonb_typeof(f.value->'rooms')='array' then f.value->'rooms' else '[]'::jsonb end) r(value) where exists(select 1 from jsonb_array_elements((case when jsonb_typeof(r.value->'guests')='array' then r.value->'guests' else '[]'::jsonb end)||(case when jsonb_typeof(r.value->'children')='array' then r.value->'children' else '[]'::jsonb end)) occupant where occupant->>'personId'=v_link.conference_person_id::text) limit 1; return jsonb_strip_nulls(jsonb_build_object('bookingId',v_booking_id,'conferenceId',v_link.conference_id,'conferencePersonId',v_link.conference_person_id,'linked',true,'readyForAccommodation',true,'accommodated',v_room is not null,'roomId',v_room->>'id','roomNumber',v_room->>'number','houseLabel',v_house->>'name','floorLabel',v_floor->>'name'));
 elsif p_operation='get_dashboard_summary' then
  perform platform_private.require_exact_jsonb_keys(p_args,case when p_args ? 'p_event_id' and not p_args ? 'p_conference_id' then array['p_event_id'] when p_args ? 'p_conference_id' and not p_args ? 'p_event_id' then array['p_conference_id'] else array['__invalid__'] end); return jsonb_build_object('events',(select count(*) from reservations.events e where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id)),'bookings',(select count(*) from reservations.bookings b join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id)),'bookingValue',(select coalesce(sum(b.price_snapshot),0) from reservations.bookings b join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id)),'collected',(select coalesce(sum(z.amount),0) from reservations.payments z join reservations.bookings b on b.id=z.booking_id and b.scope_partition_id=z.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where z.status='active' and ((v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id))));
 elsif p_operation='get_report_source_data' then
  perform platform_private.require_exact_jsonb_keys(p_args,case when v_conference_id is not null then array['p_conference_id','p_event_id','p_limit'] else array['p_event_id','p_limit'] end); if v_limit<1 or v_limit>5000 then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if; return jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date,x.id),'[]') from (select e.* from reservations.events e where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by e.start_date,e.id limit v_limit) x),'periods',(select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.id),'[]') from (select p.* from reservations.event_periods p join reservations.events e on e.id=p.event_id and e.scope_partition_id=p.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by p.display_order,p.id limit v_limit) x),'bookingTypes',(select coalesce(jsonb_agg(to_jsonb(x) order by x.display_order,x.id),'[]') from (select t.* from reservations.booking_types t join reservations.events e on e.id=t.event_id and e.scope_partition_id=t.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by t.display_order,t.id limit v_limit) x),'participants',(select coalesce(jsonb_agg(to_jsonb(x) order by x.full_name,x.id),'[]') from (select distinct p.* from reservations.participants p join reservations.bookings b on b.participant_id=p.id and b.scope_partition_id=p.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by p.full_name,p.id limit v_limit) x),'bookings',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (select b.* from reservations.bookings b join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by b.created_at,b.id limit v_limit) x),'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_date,x.id),'[]') from (select z.* from reservations.payments z join reservations.bookings b on b.id=z.booking_id and b.scope_partition_id=z.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by z.payment_date,z.id limit v_limit) x),'attendance',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (select a.* from reservations.attendance_records a join reservations.bookings b on b.id=a.booking_id and b.scope_partition_id=a.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by a.created_at,a.id limit v_limit) x),'operationalReviews',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (select o.* from reservations.operational_reviews o join reservations.bookings b on b.id=o.booking_id and b.scope_partition_id=o.scope_partition_id join reservations.events e on e.id=b.event_id and e.scope_partition_id=b.scope_partition_id where (v_event_id is not null and e.id=v_event_id and e.scope_partition_id=v_partition) or (v_event_id is null and e.scope_type='conference' and e.conference_id=v_conference_id and e.organization_id=v_organization_id) order by o.created_at,o.id limit v_limit) x));
 elsif p_operation='get_report_booking_page' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id','p_limit','p_after_created_at','p_after_booking_id']); v_after_created_at:=nullif(p_args->>'p_after_created_at','')::timestamptz; v_after_booking_id:=nullif(p_args->>'p_after_booking_id','')::uuid; if not (p_args ? 'p_limit') or v_limit<1 or v_limit>500 or ((v_after_created_at is null)<>(v_after_booking_id is null)) then raise exception 'RESERVATIONS_REPORT_PAGE_ARGUMENTS_INVALID' using errcode='22023'; end if;
  with candidates as materialized(select b.* from reservations.bookings b where b.event_id=v_event_id and b.scope_partition_id=v_partition and (v_after_created_at is null or b.created_at>v_after_created_at or (b.created_at=v_after_created_at and b.id>v_after_booking_id)) order by b.created_at,b.id limit v_limit+1),page as materialized(select * from candidates order by created_at,id limit v_limit) select coalesce(jsonb_agg(jsonb_build_object('booking',to_jsonb(b),'participant',to_jsonb(p),'payments',coalesce((select jsonb_agg(to_jsonb(z) order by z.payment_date,z.id) from reservations.payments z where z.booking_id=b.id and z.scope_partition_id=b.scope_partition_id),'[]'),'attendance',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from reservations.attendance_records a where a.booking_id=b.id and a.scope_partition_id=b.scope_partition_id),'[]'),'operationalReview',(select to_jsonb(o) from reservations.operational_reviews o where o.booking_id=b.id and o.scope_partition_id=b.scope_partition_id)) order by b.created_at,b.id),'[]'),(select count(*)>v_limit from candidates),(array_agg(b.created_at order by b.created_at desc,b.id desc))[1],(array_agg(b.id order by b.created_at desc,b.id desc))[1] into v_rows,v_has_more,v_last_created_at,v_last_booking_id from page b join reservations.participants p on p.id=b.participant_id and p.scope_partition_id=b.scope_partition_id; return jsonb_build_object('rows',v_rows,'hasMore',coalesce(v_has_more,false),'nextCursor',case when coalesce(v_has_more,false) then jsonb_build_object('createdAt',v_last_created_at,'bookingId',v_last_booking_id) else null end);
 end if;
 if v_result is null then raise exception 'RESERVATIONS_RECORD_NOT_FOUND' using errcode='P0002'; end if; return v_result;
end $$;

-- Round C2: activate the complete scoped read contract through the established
-- public entry point.  Mutations and the Platform dispatcher remain unchanged.
create or replace function reservations.read(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
 select reservations_private.read_scoped(p_device_id,p_operation,p_args)
$$;

revoke all on function reservations.read(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb) to service_role;

-- Round C3: activate scoped mutations while normalizing only the redundant
-- Conference identifiers still emitted by the current Platform dispatcher.
create or replace function reservations.mutate(p_device_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_args jsonb:=p_args; v_context jsonb; v_stored_event_id uuid; v_operation_id uuid:=nullif(p_args->>'p_operation_id','')::uuid;
begin
 if p_operation='create_event' and not p_args ? 'p_scope_type' and p_args ? 'p_conference_id' then
  v_args:=p_args||jsonb_build_object('p_scope_type','conference');
 elsif p_operation='update_event' and p_args ? 'p_conference_id' then
  v_context:=reservations_private.resolve_event_scope(p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage');
  if nullif(p_args->>'p_conference_id','')::uuid is distinct from nullif(v_context->>'conferenceId','')::uuid then raise exception 'RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE' using errcode='55000'; end if;
 v_args:=p_args-'p_conference_id';
 elsif p_operation in('update_event_period','delete_event_period') and p_args ? 'p_event_id' then
  select event_id into v_stored_event_id from reservations.event_periods where id=(p_args->>'p_period_id')::uuid;
  if found then v_context:=reservations_private.resolve_event_period_scope(p_device_id,(p_args->>'p_period_id')::uuid,'reservations.event.manage'); v_stored_event_id:=(v_context->>'eventId')::uuid;
  elsif p_operation='delete_event_period' and v_operation_id is not null then select nullif(old_values->>'event_id','')::uuid into v_stored_event_id from platform.audit_events where operation_id=v_operation_id and module='reservations' and action='event_period.deleted' and entity_id=(p_args->>'p_period_id')::uuid;
  end if;
  if v_stored_event_id is null then perform reservations_private.resolve_event_period_scope(p_device_id,(p_args->>'p_period_id')::uuid,'reservations.event.manage'); end if;
  if nullif(p_args->>'p_event_id','')::uuid is distinct from v_stored_event_id then raise exception 'RESERVATIONS_EVENT_PERIOD_EVENT_IMMUTABLE' using errcode='55000'; end if;
  v_args:=p_args-'p_event_id';
 elsif p_operation='update_booking_type' and p_args ? 'p_event_id' then
  v_context:=reservations_private.resolve_booking_type_scope(p_device_id,(p_args->>'p_booking_type_id')::uuid,'reservations.event.manage'); v_stored_event_id:=(v_context->>'eventId')::uuid;
  if nullif(p_args->>'p_event_id','')::uuid is distinct from v_stored_event_id then raise exception 'RESERVATIONS_BOOKING_TYPE_EVENT_IMMUTABLE' using errcode='55000'; end if;
  v_args:=p_args-'p_event_id';
 end if;
 return reservations_private.mutate_scoped(p_device_id,p_operation,v_args);
end $$;

revoke all on function reservations.mutate(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.mutate(uuid,text,jsonb) to service_role;

-- Round C4: expose only the four missing canonical Standalone-capable Platform
-- contracts.  Every established contract continues through the predecessor.
alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
 rename to execute_device_operation_pre_reservations_standalone_dispatch;

create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','platform','platform_private','reservations','reservations_private' as $$
declare
 v_session platform_private.device_sessions%rowtype;
 v_intercept boolean:=false;
begin
 if p_module='reservations' then
  v_intercept:=case
   when p_operation='list_events' then coalesce(p_args ? 'p_scope_type',false)
   when p_operation='get_dashboard_summary' then coalesce(p_args ? 'p_event_id',false)
   when p_operation='create_event' then coalesce(p_args ? 'p_scope_type',false)
   when p_operation='update_event' then coalesce(not p_args ? 'p_conference_id',false)
   else false end;
 end if;
 if not v_intercept then
  return platform.execute_device_operation_pre_reservations_standalone_dispatch(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args);
 end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
 if p_args is null or jsonb_typeof(p_args)<>'object' or p_args ?| array['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id','p_conference_person_id','conference_person_id'] then
  raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
 end if;
 case p_operation
  when 'list_events' then
   perform platform_private.require_exact_jsonb_keys(p_args,array['p_scope_type','p_status','p_limit']);
   if p_args->>'p_scope_type'<>'standalone' then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
  when 'get_dashboard_summary' then
   perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
  when 'create_event' then
   perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_scope_type','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
   if p_args->>'p_scope_type'<>'standalone' then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
  when 'update_event' then
   perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
 end case;
 select s.* into v_session from platform_private.device_sessions s
 join platform.device_key_bindings b on b.id=s.binding_id
 join platform.user_device_authorizations a on a.id=s.device_authorization_id
 join platform.devices d on d.id=s.device_id
 join platform.profiles p on p.user_id=s.user_id
 where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash
  and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null and s.expires_at>statement_timestamp()
  and b.user_id=s.user_id and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id
  and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256'
  and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null
  and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved' and a.revoked_at is null
  and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null
  and p.account_status='approved';
 if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
 perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,'user_id',v_session.user_id,'device_id',v_session.device_id,'authorization_id',v_session.device_authorization_id,'binding_id',v_session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);
 if p_operation in('list_events','get_dashboard_summary') then return reservations.read(v_session.device_id,p_operation,p_args); end if;
 return reservations.mutate(v_session.device_id,p_operation,p_args);
end $$;

revoke all on function platform.execute_device_operation_pre_reservations_standalone_dispatch(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation_pre_reservations_standalone_dispatch(uuid,uuid,bytea,text,text,jsonb) to postgres;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) to service_role;

revoke all on function reservations_private.resolve_event_scope(uuid,uuid,text),reservations_private.resolve_booking_scope(uuid,uuid,text),reservations_private.resolve_payment_scope(uuid,uuid,text),reservations_private.resolve_event_period_scope(uuid,uuid,text),reservations_private.resolve_booking_type_scope(uuid,uuid,text),reservations_private.derive_event_scope_partition(),reservations_private.derive_child_scope_partition() from public,anon,authenticated,service_role;
grant execute on function reservations_private.resolve_event_scope(uuid,uuid,text),reservations_private.resolve_booking_scope(uuid,uuid,text),reservations_private.resolve_payment_scope(uuid,uuid,text),reservations_private.resolve_event_period_scope(uuid,uuid,text),reservations_private.resolve_booking_type_scope(uuid,uuid,text),reservations_private.derive_event_scope_partition(),reservations_private.derive_child_scope_partition() to postgres;
revoke all on function reservations_private.standalone_create_business_args(jsonb),reservations_private.standalone_create_intent(jsonb),reservations_private.begin_standalone_create(uuid,jsonb,jsonb),reservations_private.complete_standalone_create(uuid,jsonb,jsonb,jsonb),reservations_private.create_standalone_event_scoped(uuid,jsonb),reservations_private.audit(jsonb,text,text,uuid,uuid,jsonb,jsonb),reservations_private.mutate_scoped(uuid,text,jsonb),reservations_private.read_scoped(uuid,text,jsonb),platform_private.write_scoped_audit_event(uuid,uuid,text,text,text,text,uuid,text,uuid,jsonb,jsonb,jsonb,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function reservations_private.standalone_create_business_args(jsonb),reservations_private.standalone_create_intent(jsonb),reservations_private.begin_standalone_create(uuid,jsonb,jsonb),reservations_private.complete_standalone_create(uuid,jsonb,jsonb,jsonb),reservations_private.create_standalone_event_scoped(uuid,jsonb),reservations_private.audit(jsonb,text,text,uuid,uuid,jsonb,jsonb),reservations_private.mutate_scoped(uuid,text,jsonb),reservations_private.read_scoped(uuid,text,jsonb),platform_private.write_scoped_audit_event(uuid,uuid,text,text,text,text,uuid,text,uuid,jsonb,jsonb,jsonb,uuid,uuid,text) to postgres;

commit;
