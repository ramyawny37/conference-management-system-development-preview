begin;
-- Canonical bridge: a booking uses its explicitly selected platform person.
-- Never project a new snapshot person or guess identity from name/phone.
create or replace function reservations_private.link_booking_to_canonical_participation(
  p_booking_id uuid, p_operation_id uuid, p_context jsonb
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_booking reservations.bookings%rowtype;
  v_person_id uuid;
  v_conference_id uuid;
  v_device_id uuid;
  v_participation_id uuid;
  v_result jsonb;
begin
  if p_booking_id is null or p_operation_id is null or p_context is null then
    raise exception 'RESERVATIONS_CANONICAL_LINK_ARGUMENT_INVALID' using errcode='22023';
  end if;
  v_conference_id := nullif(p_context->>'conferenceId','')::uuid;
  v_device_id := nullif(p_context->>'actorDeviceId','')::uuid;
  if v_conference_id is null or v_device_id is null then
    raise exception 'RESERVATIONS_CANONICAL_LINK_CONTEXT_REQUIRED' using errcode='22023';
  end if;
  perform platform_private.require_conference_participation_context(
    v_device_id,v_conference_id,'conference.people.manage',true
  );
  select b.* into v_booking
  from reservations.bookings b
  join reservations.events e on e.id=b.event_id
    and e.scope_partition_id=b.scope_partition_id
  where b.id=p_booking_id and e.conference_id=v_conference_id
    and e.scope_type='conference'
  for key share of b;
  if not found then
    raise exception 'RESERVATIONS_CANONICAL_LINK_BOOKING_SCOPE_INVALID' using errcode='22023';
  end if;
  select p.person_id into v_person_id from reservations.participants p
  where p.id=v_booking.participant_id and p.scope_partition_id=v_booking.scope_partition_id
  for key share;
  if v_person_id is null then
    raise exception 'RESERVATIONS_BOOKING_PERSON_SELECTION_REQUIRED' using errcode='22023';
  end if;
  select cp.id into v_participation_id from public.conference_participations cp
  where cp.conference_id=v_conference_id and cp.person_id=v_person_id;
  if v_participation_id is not null then
    return jsonb_build_object('conferenceId',v_conference_id,'personId',v_person_id,
      'participationId',v_participation_id,'existing',true);
  end if;
  v_result := public.create_conference_participation(
    v_device_id,p_operation_id,v_conference_id,v_person_id
  );
  return v_result||jsonb_build_object('existing',false);
end
$function$;
revoke all on function reservations_private.link_booking_to_canonical_participation(uuid,uuid,jsonb)
  from public, anon, authenticated;
commit;
