begin;
-- Repair the existing event-link operation in place. Never create a second path.
-- The canonical booking helper already handles one-to-one link identity.
do $$
declare
  v_definition text;
  v_old text := E'  select * into v_new_event from reservations.events where id=v_event_id;';
  v_new text := E'  -- Link all existing bookings in the same transaction, after scope re-keying.\n  -- A failed participation creation rolls back the event and every scope update.\n  for v_booking_id in\n    select b.id from reservations.bookings b\n    where b.event_id=v_event_id order by b.id\n  loop\n    perform reservations_private.link_booking_to_canonical_participation(\n      v_booking_id,extensions.gen_random_uuid(),v_context\n    );\n  end loop;\n  select * into v_new_event from reservations.events where id=v_event_id;';
begin
  select pg_get_functiondef('reservations_private.link_standalone_event_to_conference(uuid,jsonb)'::regprocedure)
  into v_definition;
  if v_definition is null or position(v_old in v_definition)=0
     or position('link_booking_to_canonical_participation' in v_definition)>0 then
    raise exception 'RESERVATIONS_LATE_LINK_BACKFILL_PRECONDITION_FAILED' using errcode='55000';
  end if;
  v_definition:=replace(v_definition,
    '  v_actor uuid; v_result jsonb;',
    '  v_actor uuid; v_result jsonb; v_booking_id uuid;'
  );
  if position('v_booking_id uuid;' in v_definition)=0 then
    raise exception 'RESERVATIONS_LATE_LINK_DECLARATION_PRECONDITION_FAILED' using errcode='55000';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
commit;
