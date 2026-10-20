begin;

create or replace function reservations_private.platform_dashboard_summary(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid;
begin
  v_actor:=public.require_current_approved_device(p_device_id);
  return (
    with authorized_events as (
      select e.id,e.name,e.start_date,e.end_date,e.status,e.scope_type,e.conference_id,
        platform_private.user_has_module_permission_for(v_actor,'reservations.event.view',null,null)
          or platform_private.user_has_module_permission_for(v_actor,'reservations.event.view','event',e.id::text)
          or platform_private.user_has_module_permission_for(v_actor,'reservations.booking.view',null,null)
          or platform_private.user_has_module_permission_for(v_actor,'reservations.booking.view','event',e.id::text)
          or platform_private.user_has_module_permission_for(v_actor,'reservations.reports.view',null,null) as can_view_event,
        platform_private.user_has_module_permission_for(v_actor,'reservations.booking.view',null,null)
          or platform_private.user_has_module_permission_for(v_actor,'reservations.booking.view','event',e.id::text)
          or platform_private.user_has_module_permission_for(v_actor,'reservations.reports.view',null,null) as can_view_bookings
      from reservations.events e
      where e.scope_type in('standalone','conference')
    ), visible_events as (
      select event_row.*,
        case when event_row.can_view_bookings then (
          select count(*)::bigint from reservations.bookings booking
          where booking.event_id=event_row.id
        ) end as booking_count
      from authorized_events event_row
      where event_row.can_view_event
    )
    select jsonb_build_object(
      'scope','platform',
      'events',count(*)::bigint,
      'standaloneEvents',count(*) filter (where scope_type='standalone'),
      'conferenceEvents',count(*) filter (where scope_type='conference'),
      'bookings',coalesce(sum(booking_count) filter (where can_view_bookings),0)::bigint,
      'bookingMetricsAvailable',coalesce(bool_or(can_view_bookings),false),
      'bookingMetricsComplete',coalesce(bool_and(can_view_bookings),false),
      'activities',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'eventId',id,'name',name,'startDate',start_date,'endDate',end_date,
        'status',status,'scopeType',scope_type,'conferenceId',conference_id,
        'bookings',booking_count
      )) order by start_date desc,id),'[]'::jsonb)
    )
    from visible_events
  );
end;
$$;

revoke all on function reservations_private.platform_dashboard_summary(uuid)
from public,anon,authenticated,service_role;
grant execute on function reservations_private.platform_dashboard_summary(uuid) to postgres;

do $$
declare
  v_definition text;
  v_marker text:=' return reservations_private.read_scoped(p_device_id,p_operation,p_args);';
  v_replacement text:=
    ' if p_operation=''get_dashboard_summary'' and p_args ? ''p_scope_type'' then'||chr(10)||
    '  perform platform_private.require_exact_jsonb_keys(p_args,array[''p_scope_type'']);'||chr(10)||
    '  if p_args->>''p_scope_type''<>''platform'' then raise exception ''RESERVATIONS_READ_ARGUMENTS_INVALID'' using errcode=''22023''; end if;'||chr(10)||
    '  return reservations_private.platform_dashboard_summary(p_device_id);'||chr(10)||
    ' end if;'||chr(10)||v_marker;
begin
  select pg_get_functiondef('reservations.read(uuid,text,jsonb)'::regprocedure) into v_definition;
  if position(v_marker in v_definition)=0
     or position('platform_dashboard_summary' in v_definition)>0 then
    raise exception 'RESERVATIONS_PLATFORM_DASHBOARD_READ_PRECONDITION_FAILED' using errcode='55000';
  end if;
  v_definition:=replace(v_definition,v_marker,v_replacement);
  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
  v_old text:=
    '    when ''get_dashboard_summary'' then'||chr(10)||
    '      if p_args ? ''p_event_id'' then perform platform_private.require_exact_jsonb_keys(p_args,array[''p_event_id'']);'||chr(10)||
    '      else perform platform_private.require_exact_jsonb_keys(p_args,array[''p_conference_id'']); end if;';
  v_new text:=
    '    when ''get_dashboard_summary'' then'||chr(10)||
    '      if p_args ? ''p_scope_type'' then'||chr(10)||
    '        perform platform_private.require_exact_jsonb_keys(p_args,array[''p_scope_type'']);'||chr(10)||
    '        if p_args->>''p_scope_type''<>''platform'' then raise exception ''PLATFORM_OPERATION_ARGUMENT_INVALID'' using errcode=''22023''; end if;'||chr(10)||
    '      elsif p_args ? ''p_event_id'' then perform platform_private.require_exact_jsonb_keys(p_args,array[''p_event_id'']);'||chr(10)||
    '      else perform platform_private.require_exact_jsonb_keys(p_args,array[''p_conference_id'']); end if;';
begin
  select pg_get_functiondef('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)'::regprocedure) into v_definition;
  if position(v_old in v_definition)=0
     or position('p_scope_type''<>''platform' in v_definition)>0 then
    raise exception 'RESERVATIONS_PLATFORM_DASHBOARD_DISPATCH_PRECONDITION_FAILED' using errcode='55000';
  end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute v_definition;
end;
$$;

revoke all on function reservations.read(uuid,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function reservations.read(uuid,text,jsonb) to postgres;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
from public,anon,authenticated;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
to service_role;

commit;
