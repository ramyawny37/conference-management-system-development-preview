begin;
-- Restore the existing canonical booking context reader through the active
-- reservations.read entry point. No parallel read path or permission bypass.
do $$
declare
  v_definition text;
  v_old text := 'return reservations_private.read_scoped(p_device_id,p_operation,p_args);';
  v_new text := 'if p_operation = ''get_booking_creation_context'' then
    return reservations_private.booking_creation_context(p_device_id,p_args);
  end if;
  return reservations_private.read_scoped(p_device_id,p_operation,p_args);';
begin
  select pg_get_functiondef('reservations.read(uuid,text,jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'RESERVATIONS_READ_MISSING' using errcode='55000';
  end if;
  if position('return reservations_private.booking_creation_context(p_device_id,p_args)' in v_definition)>0 then return; end if;
  if position(v_old in v_definition)=0 then
    raise exception 'RESERVATIONS_READ_DISPATCH_PRECONDITION_FAILED' using errcode='55000';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;
commit;
