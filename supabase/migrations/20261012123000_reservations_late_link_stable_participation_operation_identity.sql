begin;
-- The prior late-link migration was applied to Development before the
-- operation identity was made deterministic. Keep deployed databases aligned
-- with the corrected canonical source without introducing a new runtime path.
do $$
declare
  v_definition text;
  v_old text := 'v_booking_id, extensions.gen_random_uuid(), v_context';
  v_new text := 'v_booking_id, extensions.uuid_generate_v5(v_operation_id,v_booking_id::text), v_context';
begin
  select pg_get_functiondef('reservations_private.link_standalone_event_to_conference(uuid,jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'LATE_LINK_FUNCTION_MISSING' using errcode='55000';
  end if;
  if position(v_new in v_definition)>0 then return; end if;
  if position(v_old in v_definition)=0 then
    v_old := 'v_booking_id,extensions.gen_random_uuid(),v_context';
  end if;
  if position(v_old in v_definition)=0 then
    raise exception 'LATE_LINK_OPERATION_ID_PRECONDITION_FAILED' using errcode='55000';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
commit;
