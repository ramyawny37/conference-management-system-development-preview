begin;
-- Extend the existing guarded booking operation, not a parallel writer.
-- Existing clients can omit p_person_id; an explicitly supplied identity must
-- exist in platform.people. Never infer identity from name or phone.
do $migration$
declare
  v_definition text;
  v_old_keys text := 'array[''p_operation_id'',''p_event_id'',''p_booking_type_id'',''p_full_name'',''p_phone'',''p_age'',''p_church'',''p_governorate'',''p_city_or_village'',''p_service_sector'',''p_service_sector_other'',''p_notes'']';
  v_new_keys text := 'array[''p_operation_id'',''p_event_id'',''p_booking_type_id'',''p_full_name'',''p_phone'',''p_age'',''p_church'',''p_governorate'',''p_city_or_village'',''p_service_sector'',''p_service_sector_other'',''p_notes'',''p_person_id'']';
  v_old_insert text := 'insert into reservations.participants(scope_partition_id,full_name,phone,age,church,governorate,city_or_village,service_sector,service_sector_other,notes,created_by,updated_by) values(v_event.scope_partition_id,btrim(p_args->>''p_full_name''),btrim(p_args->>''p_phone''),(p_args->>''p_age'')::integer,coalesce(p_args->>''p_church'',''''),btrim(p_args->>''p_governorate''),coalesce(p_args->>''p_city_or_village'',''''),p_args->>''p_service_sector'',nullif(btrim(p_args->>''p_service_sector_other''),''''),nullif(p_args->>''p_notes'',''''),v_actor,v_actor)';
  v_new_insert text;
  v_guard text := 'if p_args ? ''p_person_id'' and nullif(p_args->>''p_person_id'','''') is not null and not exists(select 1 from platform.people where id=(p_args->>''p_person_id'')::uuid) then raise exception ''PLATFORM_PERSON_NOT_FOUND'' using errcode=''23503''; end if; ';
begin
  select pg_get_functiondef('reservations_private.mutate_scoped(uuid,text,jsonb)'::regprocedure) into v_definition;
  if v_definition is null or position(v_old_insert in v_definition)=0 then
    raise exception 'RESERVATIONS_BOOKING_IDENTITY_SOURCE_CHANGED' using errcode='55000';
  end if;
  if position(v_old_keys in v_definition)=0 then
    raise exception 'RESERVATIONS_BOOKING_IDENTITY_KEYS_CHANGED' using errcode='55000';
  end if;
  v_new_insert := replace(v_old_insert,'(scope_partition_id,full_name','(scope_partition_id,person_id,full_name');
  v_new_insert := replace(v_new_insert,'values(v_event.scope_partition_id,btrim','values(v_event.scope_partition_id,nullif(p_args->>''p_person_id'','''')::uuid,btrim');
  -- Replace only the create_booking keys (the update contract stays unchanged).
  v_definition := replace(v_definition, v_old_keys||'); v_context:=reservations_private.resolve_event_scope',
    v_new_keys||'); v_context:=reservations_private.resolve_event_scope');
  if position(v_new_keys in v_definition)=0 then
    raise exception 'RESERVATIONS_BOOKING_IDENTITY_KEY_REWRITE_FAILED' using errcode='55000';
  end if;
  v_definition := replace(v_definition,v_old_insert,v_guard||v_new_insert);
  execute v_definition;
end $migration$;
commit;
