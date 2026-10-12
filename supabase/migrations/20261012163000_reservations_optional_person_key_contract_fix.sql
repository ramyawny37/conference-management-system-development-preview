begin;
do $fix$
declare v_definition text;
v_required text := 'array[''p_operation_id'',''p_event_id'',''p_booking_type_id'',''p_full_name'',''p_phone'',''p_age'',''p_church'',''p_governorate'',''p_city_or_village'',''p_service_sector'',''p_service_sector_other'',''p_notes'',''p_person_id'']';
v_fixed text := 'array[''p_operation_id'',''p_event_id'',''p_booking_type_id'',''p_full_name'',''p_phone'',''p_age'',''p_church'',''p_governorate'',''p_city_or_village'',''p_service_sector'',''p_service_sector_other'',''p_notes''],array[''p_person_id'']';
begin
select pg_get_functiondef('reservations_private.mutate_scoped(uuid,text,jsonb)'::regprocedure) into v_definition;
if position(v_required in v_definition)=0 then raise exception 'RESERVATIONS_PERSON_OPTIONAL_PRECONDITION_FAILED' using errcode='55000'; end if;
v_definition:=replace(v_definition,v_required||'); v_context:=reservations_private.resolve_event_scope',v_fixed||'); v_context:=reservations_private.resolve_event_scope');
if position(v_fixed in v_definition)=0 then raise exception 'RESERVATIONS_PERSON_OPTIONAL_REWRITE_FAILED' using errcode='55000'; end if;
execute v_definition;
end $fix$;
commit;