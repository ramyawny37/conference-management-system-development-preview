begin;

create or replace function reservations.read(
  p_device_id uuid,
  p_operation text,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_context jsonb;
  v_actor uuid;
  v_conference_id uuid;
  v_event_id uuid;
  v_organization_id uuid;
  v_limit integer:=coalesce((p_args->>'p_limit')::integer,100);
begin
  if p_args is null or jsonb_typeof(p_args)<>'object' then
    raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
  end if;

  if p_operation='list_conference_options' then
    perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
    v_context:=reservations_private.booking_target_context(p_device_id);
    v_actor:=(v_context->>'actorUserId')::uuid;
    return (
      select coalesce(
        jsonb_agg(jsonb_build_object('conferenceId',c.id,'name',c.name) order by c.name,c.id),
        '[]'::jsonb
      )
      from public.conferences c
      join public.organizations o on o.id=c.organization_id and o.status='active'
      join public.organization_members om on om.organization_id=c.organization_id and om.user_id=v_actor
      where c.deleted_at is null
    );
  end if;

  if p_operation='list_events' then
    v_context:=reservations_private.booking_target_context(p_device_id);
    v_actor:=(v_context->>'actorUserId')::uuid;
    if v_limit<1 or v_limit>5000 then
      raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
    end if;

    if p_args ? 'p_conference_id' and not p_args ? 'p_scope_type' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_status','p_limit']);
      v_conference_id:=nullif(p_args->>'p_conference_id','')::uuid;
      if v_conference_id is null then
        raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
      end if;
      select c.organization_id into v_organization_id
      from public.conferences c
      join public.organizations o on o.id=c.organization_id and o.status='active'
      join public.organization_members om on om.organization_id=c.organization_id and om.user_id=v_actor
      where c.id=v_conference_id and c.deleted_at is null;
      if not found or v_organization_id is null then
        raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode='42501';
      end if;
      return (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]'::jsonb)
        from (
          select e.* from reservations.events e
          where e.scope_type='conference'
            and e.conference_id=v_conference_id
            and e.organization_id=v_organization_id
            and ((p_args->>'p_status') is null or e.status=p_args->>'p_status')
          order by e.start_date desc,e.id
          limit v_limit
        ) x
      );
    elsif p_args ? 'p_scope_type' and not p_args ? 'p_conference_id' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_scope_type','p_status','p_limit']);
      if p_args->>'p_scope_type'<>'standalone' then
        raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
      end if;
      return (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]'::jsonb)
        from (
          select e.* from reservations.events e
          where e.scope_type='standalone'
            and e.conference_id is null
            and e.organization_id is null
            and ((p_args->>'p_status') is null or e.status=p_args->>'p_status')
          order by e.start_date desc,e.id
          limit v_limit
        ) x
      );
    end if;
    raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
  end if;

  if p_operation='list_booking_types' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
    v_context:=reservations_private.booking_target_context(p_device_id);
    v_actor:=(v_context->>'actorUserId')::uuid;
    v_event_id:=nullif(p_args->>'p_event_id','')::uuid;
    if v_event_id is null then
      raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
    end if;
    if not exists(
      select 1
      from reservations.events e
      where e.id=v_event_id
        and (
          (e.scope_type='standalone' and e.conference_id is null and e.organization_id is null)
          or (
            e.scope_type='conference'
            and exists(
              select 1
              from public.organizations o
              join public.organization_members om on om.organization_id=o.id and om.user_id=v_actor
              where o.id=e.organization_id and o.status='active'
            )
          )
        )
    ) then
      raise exception 'RESERVATIONS_EVENT_ACCESS_REQUIRED' using errcode='42501';
    end if;
    return (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]'::jsonb)
      from reservations.booking_types t
      where t.event_id=v_event_id
    );
  end if;

  return reservations_private.read_scoped(p_device_id,p_operation,p_args);
end $$;

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
  v_created_booking jsonb;
  v_created_participant jsonb;
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
      where booking.id=v_booking_id and event.conference_id is not null
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

  if p_operation='create_booking' and v_booking_id is not null then
    select to_jsonb(booking),to_jsonb(participant)
      into v_created_booking,v_created_participant
    from reservations.bookings booking
    join reservations.participants participant on participant.id=booking.participant_id
    where booking.id=v_booking_id;
    if v_created_booking is null or v_created_participant is null then
      raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002';
    end if;
    v_result:=v_result||jsonb_build_object(
      'booking',v_created_booking,
      'participant',v_created_participant
    );
  end if;

  return v_result;
end $$;

create or replace function platform.execute_device_operation_pre_module_entry_access_gate(
  p_user_id uuid,
  p_session_id uuid,
  p_token_hash bytea,
  p_module text,
  p_operation text,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','platform','platform_private','reservations','reservations_private'
as $$
declare
  v_session platform_private.device_sessions%rowtype;
  v_intercept boolean:=false;
begin
  if p_module='reservations' then
    v_intercept:=case
      when p_operation in('list_conference_options','list_events','list_booking_types') then true
      when p_operation='get_dashboard_summary' then coalesce(p_args ? 'p_event_id',false)
      when p_operation='create_event' then coalesce(p_args ? 'p_scope_type',false)
      when p_operation='update_event' then coalesce(not p_args ? 'p_conference_id',false)
      when p_operation='link_standalone_event_to_conference' then true
      else false
    end;
  end if;

  if not v_intercept then
    return platform.execute_device_operation_pre_reservations_standalone_dispatch(
      p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args
    );
  end if;
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  if p_args is null or jsonb_typeof(p_args)<>'object'
     or p_args ?| array['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id','p_conference_person_id','conference_person_id'] then
    raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
  end if;

  case p_operation
    when 'list_conference_options' then
      perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
    when 'list_events' then
      if p_args ? 'p_scope_type' then
        perform platform_private.require_exact_jsonb_keys(p_args,array['p_scope_type','p_status','p_limit']);
        if p_args->>'p_scope_type'<>'standalone' then
          raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
        end if;
      else
        perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_status','p_limit']);
      end if;
    when 'list_booking_types' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
    when 'get_dashboard_summary' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
    when 'create_event' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_scope_type','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
      if p_args->>'p_scope_type'<>'standalone' then
        raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
      end if;
    when 'update_event' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
    when 'link_standalone_event_to_conference' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision','p_conference_id']);
  end case;

  select s.* into v_session
  from platform_private.device_sessions s
  join platform.device_key_bindings b on b.id=s.binding_id
  join platform.user_device_authorizations a on a.id=s.device_authorization_id
  join platform.devices d on d.id=s.device_id
  join platform.profiles p on p.user_id=s.user_id
  where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash
    and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null and s.expires_at>statement_timestamp()
    and b.user_id=s.user_id and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id
    and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256'
    and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null
    and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved' and a.revoked_at is null
    and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null
    and p.account_status='approved';
  if not found then
    raise exception 'DEVICE_SESSION_INVALID' using errcode='42501';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true);
  perform set_config('platform.phase1c_context',jsonb_build_object(
    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,
    'user_id',v_session.user_id,'device_id',v_session.device_id,
    'authorization_id',v_session.device_authorization_id,'binding_id',v_session.binding_id,
    'token_hash',encode(p_token_hash,'hex')
  )::text,true);

  if p_operation in('list_conference_options','list_events','list_booking_types','get_dashboard_summary') then
    return reservations.read(v_session.device_id,p_operation,p_args);
  end if;
  if p_operation='link_standalone_event_to_conference' then
    return reservations_private.link_standalone_event_to_conference(v_session.device_id,p_args);
  end if;
  return reservations.mutate(v_session.device_id,p_operation,p_args);
end $$;

revoke all on function reservations.read(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb) to service_role;
revoke all on function reservations.mutate(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.mutate(uuid,text,jsonb) to service_role;
revoke all on function platform.execute_device_operation_pre_module_entry_access_gate(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function platform.execute_device_operation_pre_module_entry_access_gate(uuid,uuid,bytea,text,text,jsonb) to postgres;

commit;