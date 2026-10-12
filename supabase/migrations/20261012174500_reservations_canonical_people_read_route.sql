begin;
CREATE OR REPLACE FUNCTION reservations.read(p_device_id uuid, p_operation text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_context jsonb; v_conference_id uuid; v_event_id uuid;
  v_limit integer:=coalesce((p_args->>'p_limit')::integer,100);
begin
  if p_args is null or jsonb_typeof(p_args)<>'object' then
    raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
  end if;
  if p_operation='search_people' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_query'],array['p_limit']);
    return public.search_reservations_people(p_device_id,p_args->>'p_query',(p_args->>'p_limit')::integer);
  end if;
  if p_operation='list_conference_options' then
    perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
    perform reservations_private.booking_target_context(p_device_id);
    return coalesce(public.list_accessible_conferences(p_device_id)->'conferences','[]'::jsonb);
  end if;
  if p_operation='list_events' then
    perform reservations_private.booking_target_context(p_device_id);
    if v_limit<1 or v_limit>5000 then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
    if p_args ? 'p_conference_id' and not p_args ? 'p_scope_type' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_status','p_limit']);
      v_conference_id:=nullif(p_args->>'p_conference_id','')::uuid;
      if v_conference_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
      perform reservations_private.conference_context(p_device_id,v_conference_id,'reservations.booking.create');
      return (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]'::jsonb)
        from (select e.* from reservations.events e where e.scope_type='conference'
          and e.conference_id=v_conference_id and e.scope_partition_id=v_conference_id
          and ((p_args->>'p_status') is null or e.status=p_args->>'p_status')
          order by e.start_date desc,e.id limit v_limit) x);
    elsif p_args ? 'p_scope_type' and not p_args ? 'p_conference_id' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_scope_type','p_status','p_limit']);
      if p_args->>'p_scope_type'<>'standalone' then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
      return (select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]'::jsonb)
        from (select e.* from reservations.events e where e.scope_type='standalone'
          and e.conference_id is null and ((p_args->>'p_status') is null or e.status=p_args->>'p_status')
          order by e.start_date desc,e.id limit v_limit) x);
    end if;
    raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
  end if;
  if p_operation='list_booking_types' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
    v_event_id:=nullif(p_args->>'p_event_id','')::uuid;
    if v_event_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
    v_context:=reservations_private.resolve_event_scope(p_device_id,v_event_id,'reservations.booking.create');
    return (select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]'::jsonb)
      from reservations.booking_types t where t.event_id=v_event_id
        and t.scope_partition_id=(v_context->>'scopePartitionId')::uuid);
  end if;
  if p_operation = 'get_booking_creation_context' then
    return reservations_private.booking_creation_context(p_device_id,p_args);
  end if;
  if p_operation = 'get_effective_capabilities' then
   return reservations_private.effective_capabilities(p_device_id,p_args);
 end if;
 return reservations_private.read_scoped(p_device_id,p_operation,p_args);
end $function$
;
commit;