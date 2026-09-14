begin;

create or replace function reservations.mutate(
  p_device_id uuid,
  p_operation text,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_args jsonb:=p_args;
  v_context jsonb;
  v_stored_event_id uuid;
  v_operation_id uuid:=nullif(p_args->>'p_operation_id','')::uuid;
  v_result jsonb;
  v_booking_id uuid;
  v_projection_permission text;
begin
  if p_operation='create_event' and not p_args ? 'p_scope_type' and p_args ? 'p_conference_id' then
    v_args:=p_args||jsonb_build_object('p_scope_type','conference');
  elsif p_operation='update_event' and p_args ? 'p_conference_id' then
    v_context:=reservations_private.resolve_event_scope(
      p_device_id,(p_args->>'p_event_id')::uuid,'reservations.event.manage'
    );
    if nullif(p_args->>'p_conference_id','')::uuid is distinct from nullif(v_context->>'conferenceId','')::uuid then
      raise exception 'RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE' using errcode='55000';
    end if;
    v_args:=p_args-'p_conference_id';
  elsif p_operation in('update_event_period','delete_event_period') and p_args ? 'p_event_id' then
    select event_id into v_stored_event_id
    from reservations.event_periods
    where id=(p_args->>'p_period_id')::uuid;
    if found then
      v_context:=reservations_private.resolve_event_period_scope(
        p_device_id,(p_args->>'p_period_id')::uuid,'reservations.event.manage'
      );
      v_stored_event_id:=(v_context->>'eventId')::uuid;
    elsif p_operation='delete_event_period' and v_operation_id is not null then
      select nullif(old_values->>'event_id','')::uuid into v_stored_event_id
      from platform.audit_events
      where operation_id=v_operation_id
        and module='reservations'
        and action='event_period.deleted'
        and entity_id=(p_args->>'p_period_id')::uuid;
    end if;
    if v_stored_event_id is null then
      perform reservations_private.resolve_event_period_scope(
        p_device_id,(p_args->>'p_period_id')::uuid,'reservations.event.manage'
      );
    end if;
    if nullif(p_args->>'p_event_id','')::uuid is distinct from v_stored_event_id then
      raise exception 'RESERVATIONS_EVENT_PERIOD_EVENT_IMMUTABLE' using errcode='55000';
    end if;
    v_args:=p_args-'p_event_id';
  elsif p_operation='update_booking_type' and p_args ? 'p_event_id' then
    v_context:=reservations_private.resolve_booking_type_scope(
      p_device_id,(p_args->>'p_booking_type_id')::uuid,'reservations.event.manage'
    );
    v_stored_event_id:=(v_context->>'eventId')::uuid;
    if nullif(p_args->>'p_event_id','')::uuid is distinct from v_stored_event_id then
      raise exception 'RESERVATIONS_BOOKING_TYPE_EVENT_IMMUTABLE' using errcode='55000';
    end if;
    v_args:=p_args-'p_event_id';
  end if;

  v_result:=reservations_private.mutate_scoped(p_device_id,p_operation,v_args);

  if p_operation in('create_booking','update_participant_booking') then
    v_booking_id:=nullif(v_result->>'bookingId','')::uuid;
    if v_booking_id is not null and exists(
      select 1
      from reservations.bookings booking
      join reservations.events event on event.id=booking.event_id
      where booking.id=v_booking_id
        and event.conference_id is not null
    ) then
      v_projection_permission:=case
        when p_operation='create_booking' then 'reservations.booking.create'
        else 'reservations.booking.update'
      end;
      v_context:=reservations_private.resolve_booking_scope(
        p_device_id,v_booking_id,v_projection_permission
      );
      v_result:=v_result||jsonb_build_object(
        'conferencePerson',
        reservations_private.project_booking_to_conference(
          v_booking_id,v_operation_id,v_context
        )
      );
    end if;
  end if;

  return v_result;
end $$;

revoke all on function reservations.mutate(uuid,text,jsonb)
from public,anon,authenticated;
grant execute on function reservations.mutate(uuid,text,jsonb) to service_role;

commit;
