-- Align the canonical device dispatcher with reservations_private.mutate_scoped.
-- No changes to permission checks or booking mutation semantics.
DO $migration$
DECLARE
  v_definition text;
  v_before text := 'when ''create_booking'' then perform platform_private.require_exact_jsonb_keys(p_args,array[''p_operation_id'',''p_event_id'',''p_booking_type_id'',''p_full_name'',''p_phone'',''p_age'',''p_church'',''p_governorate'',''p_city_or_village'',''p_service_sector'',''p_service_sector_other'',''p_notes'']);';
  v_after text := 'when ''create_booking'' then perform platform_private.require_exact_jsonb_keys(p_args,array[''p_operation_id'',''p_event_id'',''p_booking_type_id'',''p_full_name'',''p_phone'',''p_age'',''p_church'',''p_governorate'',''p_city_or_village'',''p_service_sector'',''p_service_sector_other'',''p_notes''],array[''p_person_id'',''p_person_update_revision'']);';
BEGIN
  v_definition := pg_get_functiondef('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure);
  IF position(v_before IN v_definition) = 0 THEN
    IF position(v_after IN v_definition) > 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'EXPECTED_RESERVATIONS_BOOKING_CONTRACT_NOT_FOUND';
  END IF;
  EXECUTE replace(v_definition,v_before,v_after);
END
$migration$;
