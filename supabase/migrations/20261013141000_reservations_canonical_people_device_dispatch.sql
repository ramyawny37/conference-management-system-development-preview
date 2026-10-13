begin;
do $fix$
declare v_definition text; v_before text := E'    case p_operation\n    when \'get_effective_capabilities\' then'; v_after text := E'    case p_operation\n    when \'search_people\' then\n      perform platform_private.require_exact_jsonb_keys(p_args,array[\'p_query\',\'p_limit\']);\n      return reservations.read(v_session.device_id,p_operation,p_args);\n    when \'get_effective_capabilities\' then';
begin
  select pg_get_functiondef('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure) into v_definition;
  if length(v_definition)-length(replace(v_definition,v_before,''))<>length(v_before) then
    raise exception 'EXPECTED_RESERVATIONS_DISPATCH_ANCHOR_NOT_UNIQUE';
  end if;
  if position('when ''search_people'' then' in v_definition)>0 then
    raise exception 'SEARCH_PEOPLE_ALREADY_DISPATCHED';
  end if;
  execute replace(v_definition,v_before,v_after);
end $fix$;
commit;