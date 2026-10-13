begin;

do $fix$
declare
  v_oid oid := 'platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure;
  v_definition text;
  v_expected_definition text;
  v_applied_definition text;
  v_before text := E'    case p_operation\n    when \'get_effective_capabilities\' then';
  v_after text := E'    case p_operation\n    when \'search_people\' then\n      perform platform_private.require_exact_jsonb_keys(p_args,array[\'p_query\',\'p_limit\']);\n      return reservations.read(v_session.device_id,p_operation,p_args);\n    when \'get_effective_capabilities\' then';
  v_operations_before text[];
  v_operations_after text[];
  v_owner name;
  v_security_definer boolean;
  v_language name;
  v_config text[];
begin
  perform pg_advisory_xact_lock(hashtext('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'));

  select pg_get_functiondef(procedure.oid),owner.rolname,procedure.prosecdef,language.lanname,
         procedure.proconfig
  into v_definition,v_owner,v_security_definer,v_language,v_config
  from pg_proc procedure
  join pg_roles owner on owner.oid=procedure.proowner
  join pg_language language on language.oid=procedure.prolang
  where procedure.oid=v_oid;

  if v_owner<>'postgres' or not v_security_definer or v_language<>'plpgsql'
     or v_config<>array['search_path=pg_catalog, public, platform, platform_private, reservations, reservations_private, warehouse, warehouse_private']
     or not has_function_privilege('service_role',v_oid,'execute')
     or has_function_privilege('anon',v_oid,'execute')
     or has_function_privilege('authenticated',v_oid,'execute') then
    raise exception 'RESERVATIONS_DISPATCH_SECURITY_CONTRACT_MISMATCH';
  end if;
  if v_definition not like '%PLATFORM_OPERATION_BACKEND_REQUIRED%'
     or v_definition not like '%from platform_private.device_sessions%'
     or v_definition not like '%session.token_hash=p_token_hash%'
     or v_definition not like '%device_auth.status=''approved''%'
     or v_definition not like '%profile.account_status=''approved''%'
     or v_definition not like '%DEVICE_SESSION_INVALID%'
     or v_definition not like '%ACTOR_DEVICE_OVERRIDE_DENIED%' then
    raise exception 'RESERVATIONS_DISPATCH_SESSION_GUARD_MISMATCH';
  end if;
  if length(v_definition)-length(replace(v_definition,v_before,''))<>length(v_before) then
    raise exception 'EXPECTED_RESERVATIONS_DISPATCH_ANCHOR_NOT_UNIQUE';
  end if;
  if position('when ''search_people'' then' in v_definition)>0 then
    raise exception 'SEARCH_PEOPLE_ALREADY_DISPATCHED';
  end if;

  select coalesce(array_agg(match[1] order by ordinal),'{}'::text[])
  into v_operations_before
  from regexp_matches(v_definition,E'when \'([^\']+)\'', 'g') with ordinality as found(match,ordinal);

  v_expected_definition:=replace(v_definition,v_before,v_after);
  execute v_expected_definition;

  select pg_get_functiondef(v_oid)
  into v_applied_definition
  from pg_proc procedure
  where procedure.oid=v_oid;

  select coalesce(array_agg(match[1] order by ordinal),'{}'::text[])
  into v_operations_after
  from regexp_matches(v_applied_definition,E'when \'([^\']+)\'', 'g') with ordinality as found(match,ordinal)
  where match[1]<>'search_people';

  if v_operations_after<>v_operations_before
     or position('when ''search_people'' then' in v_applied_definition)=0
     or position('return reservations.read(v_session.device_id,p_operation,p_args);' in v_applied_definition)=0
     or not has_function_privilege('service_role',v_oid,'execute')
     or has_function_privilege('anon',v_oid,'execute')
     or has_function_privilege('authenticated',v_oid,'execute') then
    raise exception 'RESERVATIONS_DISPATCH_POSTCONDITION_FAILED';
  end if;
end $fix$;

revoke all on function public.search_reservations_people(uuid,text,integer)
  from public,anon,authenticated;

commit;
