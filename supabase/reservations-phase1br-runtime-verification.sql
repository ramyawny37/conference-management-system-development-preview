\set ON_ERROR_STOP on
begin;

do $$
declare
  v_org uuid := (select id from public.organizations limit 1);
  v_actor uuid := (select user_id from platform.profiles limit 1);
  v_device uuid := extensions.gen_random_uuid();
  v_event uuid;
  v_type uuid;
  v_participant uuid;
  v_booking uuid;
  v_payment uuid;
  v_first text;
  v_second text;
begin
  if v_org is null or v_actor is null then
    raise exception 'RESERVATIONS_RUNTIME_BASELINE_FIXTURE_MISSING';
  end if;

  insert into platform.devices(id,secret_hash,display_name)
  values(v_device,encode(extensions.digest(v_device::text,'sha256'),'hex'),'Reservations Phase 1B-R rehearsal');

  insert into reservations.events(organization_id,name,start_date,end_date,location,capacity,status,created_by,updated_by)
  values(v_org,'Runtime verification event',date '2026-10-01',date '2026-10-03','Cairo',1,'open',v_actor,v_actor)
  returning id into v_event;

  insert into reservations.event_periods(organization_id,event_id,kind,starts_on,ends_on,display_order,created_by,updated_by)
  values(v_org,v_event,'conference',date '2026-10-01',date '2026-10-02',0,v_actor,v_actor),
        (v_org,v_event,'caravans',date '2026-10-03',date '2026-10-03',1,v_actor,v_actor);

  insert into reservations.booking_types(organization_id,event_id,name,code,price,eligible_attendance_segments,display_order,created_by,updated_by)
  values(v_org,v_event,'Full event','FULL',500,array['conference','caravans'],0,v_actor,v_actor)
  returning id into v_type;

  insert into reservations.participants(organization_id,full_name,phone,age,governorate,service_sector,created_by,updated_by)
  values(v_org,'Runtime Participant','01000000000',30,'Cairo','administration',v_actor,v_actor)
  returning id into v_participant;

  v_first := reservations_private.allocate_booking_number(v_org,2026);
  v_second := reservations_private.allocate_booking_number(v_org,2026);
  if v_first !~ '^RES-2026-[0-9]{4,}$' or substring(v_second from '[0-9]+$')::bigint <> substring(v_first from '[0-9]+$')::bigint + 1 then
    raise exception 'RESERVATIONS_RUNTIME_NUMBERING_FAILED';
  end if;

  insert into reservations.bookings(organization_id,booking_number,participant_id,event_id,booking_type_id,booking_type_name_snapshot,price_snapshot,attendance_segments_snapshot,created_by,updated_by)
  values(v_org,v_first,v_participant,v_event,v_type,'Full event',500,array['conference','caravans'],v_actor,v_actor)
  returning id into v_booking;

  insert into reservations.payments(organization_id,booking_id,amount,payment_date,payment_method,status,created_by,created_by_device_id)
  values(v_org,v_booking,100,date '2026-09-08','cash','active',v_actor,v_device)
  returning id into v_payment;

  update reservations.payments
  set status='voided',void_reason='Runtime correction',voided_at=statement_timestamp(),voided_by=v_actor,voided_by_device_id=v_device
  where id=v_payment;

  begin
    update reservations.payments set amount=200 where id=v_payment;
    raise exception 'RESERVATIONS_RUNTIME_PAYMENT_MUTABILITY_FAILED';
  exception when sqlstate '55000' then null;
  end;

  insert into reservations.attendance_records(organization_id,booking_id,segment,attended,attendance_date,created_by,updated_by)
  values(v_org,v_booking,'conference',true,date '2026-10-01',v_actor,v_actor)
  on conflict(booking_id,segment) do update set attended=excluded.attended,updated_by=excluded.updated_by;

  if (select count(*) from reservations.attendance_records where booking_id=v_booking) <> 1 then
    raise exception 'RESERVATIONS_RUNTIME_ATTENDANCE_FAILED';
  end if;
end
$$;

rollback;
