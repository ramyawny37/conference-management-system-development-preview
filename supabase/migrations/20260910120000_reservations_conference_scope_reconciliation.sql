begin;

create or replace function reservations_private.conference_context(
  p_device_id uuid,
  p_conference_id uuid,
  p_permission text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_actor uuid;
  v_organization_id uuid;
begin
  v_context := public.require_effective_module_permission(
    p_device_id,
    'reservations',
    p_permission,
    null,
    null
  );
  v_actor := (v_context->>'actorUserId')::uuid;

  select c.organization_id
    into v_organization_id
  from public.conferences c
  join public.conference_members m
    on m.conference_id = c.id
   and m.user_id = v_actor
  where c.id = p_conference_id
    and c.deleted_at is null;

  if not found or v_organization_id is null then
    raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  return v_context || jsonb_build_object(
    'conferenceId', p_conference_id,
    'organizationId', v_organization_id
  );
end
$$;

create or replace function reservations_private.context(
  p_device_id uuid,
  p_organization_id uuid,
  p_permission text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  v_context := public.require_effective_module_permission(
    p_device_id,
    'reservations',
    p_permission,
    null,
    null
  );
  if not exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.status = 'active'
  ) then
    raise exception 'RESERVATIONS_ORGANIZATION_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_context || jsonb_build_object('organizationId', p_organization_id);
end
$$;

alter function reservations.read(uuid,text,jsonb)
  rename to read_pre_conference_scope;
alter function reservations.mutate(uuid,text,jsonb)
  rename to mutate_pre_conference_scope;

create function reservations.read(
  p_device_id uuid,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_permission text;
  v_context jsonb;
  v_conference_id uuid;
  v_organization_id uuid;
  v_event_id uuid;
  v_booking_id uuid;
  v_result jsonb;
begin
  v_permission := case
    when p_operation in ('list_conference_options','list_events','get_event','list_event_periods','list_booking_types') then 'reservations.event.view'
    when p_operation in ('list_bookings','get_booking_detail','search_participants_bookings','get_booking_accommodation') then 'reservations.booking.view'
    when p_operation = 'list_booking_payments' then 'reservations.payment.view'
    when p_operation = 'list_attendance' then 'reservations.attendance.view'
    when p_operation = 'get_operational_state' then 'reservations.operations.view'
    when p_operation in ('get_dashboard_summary','get_report_source_data') then 'reservations.reports.view'
  end;
  if v_permission is null then
    raise exception 'RESERVATIONS_OPERATION_NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_operation = 'list_conference_options' then
    v_context := public.require_effective_module_permission(p_device_id,'reservations',v_permission,null,null);
    return (
      select coalesce(jsonb_agg(jsonb_build_object('conferenceId',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb)
      from public.conferences c
      join public.conference_members m
        on m.conference_id = c.id
       and m.user_id = (v_context->>'actorUserId')::uuid
      where c.deleted_at is null
    );
  end if;

  if p_operation in ('get_event','list_event_periods','list_booking_types')
     or (p_operation in ('list_bookings','search_participants_bookings','list_attendance','get_report_source_data')
         and nullif(p_args->>'p_event_id','') is not null) then
    v_event_id := (p_args->>'p_event_id')::uuid;
    select e.conference_id into v_conference_id
    from reservations.events e where e.id = v_event_id;
  elsif p_operation in ('get_booking_detail','list_booking_payments','get_operational_state','get_booking_accommodation') then
    v_booking_id := (p_args->>'p_booking_id')::uuid;
    select e.conference_id into v_conference_id
    from reservations.bookings b
    join reservations.events e on e.id = b.event_id
    where b.id = v_booking_id;
  else
    v_conference_id := (p_args->>'p_conference_id')::uuid;
  end if;

  if v_conference_id is null then
    raise exception 'RESERVATIONS_CONFERENCE_REQUIRED' using errcode = '22023';
  end if;
  v_context := reservations_private.conference_context(p_device_id,v_conference_id,v_permission);
  v_organization_id := (v_context->>'organizationId')::uuid;
  v_result := reservations.read_pre_conference_scope(
    p_device_id,
    p_operation,
    (p_args - 'p_conference_id') || jsonb_build_object('p_organization_id',v_organization_id)
  );

  if p_operation in ('list_events','list_bookings','search_participants_bookings','list_attendance')
     and nullif(p_args->>'p_event_id','') is null then
    return (
      select coalesce(jsonb_agg(item),'[]'::jsonb)
      from jsonb_array_elements(v_result) item
      where case p_operation
        when 'list_events' then (item->>'conference_id')::uuid = v_conference_id
        when 'list_attendance' then exists (
          select 1 from reservations.bookings b join reservations.events e on e.id=b.event_id
          where b.id=(item->>'booking_id')::uuid and e.conference_id=v_conference_id
        )
        else (item#>>'{event,conference_id}')::uuid = v_conference_id
      end
    );
  elsif p_operation = 'get_dashboard_summary' then
    return jsonb_build_object(
      'events',(select count(*) from reservations.events e where e.conference_id=v_conference_id),
      'bookings',(select count(*) from reservations.bookings b join reservations.events e on e.id=b.event_id where e.conference_id=v_conference_id),
      'bookingValue',(select coalesce(sum(b.price_snapshot),0) from reservations.bookings b join reservations.events e on e.id=b.event_id where e.conference_id=v_conference_id),
      'collected',(select coalesce(sum(z.amount),0) from reservations.payments z join reservations.bookings b on b.id=z.booking_id join reservations.events e on e.id=b.event_id where e.conference_id=v_conference_id and z.status='active')
    );
  elsif p_operation = 'get_report_source_data' and nullif(p_args->>'p_event_id','') is null then
    return jsonb_build_object(
      'events',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'events') x where (x->>'conference_id')::uuid=v_conference_id),
      'periods',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'periods') x where exists(select 1 from reservations.events e where e.id=(x->>'event_id')::uuid and e.conference_id=v_conference_id)),
      'bookingTypes',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'bookingTypes') x where exists(select 1 from reservations.events e where e.id=(x->>'event_id')::uuid and e.conference_id=v_conference_id)),
      'participants',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'participants') x where exists(select 1 from reservations.bookings b join reservations.events e on e.id=b.event_id where b.participant_id=(x->>'id')::uuid and e.conference_id=v_conference_id)),
      'bookings',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'bookings') x where exists(select 1 from reservations.events e where e.id=(x->>'event_id')::uuid and e.conference_id=v_conference_id)),
      'payments',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'payments') x where exists(select 1 from reservations.bookings b join reservations.events e on e.id=b.event_id where b.id=(x->>'booking_id')::uuid and e.conference_id=v_conference_id)),
      'attendance',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'attendance') x where exists(select 1 from reservations.bookings b join reservations.events e on e.id=b.event_id where b.id=(x->>'booking_id')::uuid and e.conference_id=v_conference_id)),
      'operationalReviews',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements(v_result->'operationalReviews') x where exists(select 1 from reservations.bookings b join reservations.events e on e.id=b.event_id where b.id=(x->>'booking_id')::uuid and e.conference_id=v_conference_id))
    );
  end if;
  return v_result;
end
$$;

create function reservations.mutate(
  p_device_id uuid,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text;
  v_context jsonb;
  v_conference_id uuid;
  v_organization_id uuid;
  v_event_id uuid;
  v_operation_id uuid := (p_args->>'p_operation_id')::uuid;
  v_actor uuid;
  v_replay jsonb;
  v_result jsonb;
  v_id uuid;
  v_revision bigint;
begin
  v_permission := case
    when p_operation in ('create_event','update_event','delete_event','create_event_period','update_event_period','delete_event_period','reorder_event_periods','create_booking_type','update_booking_type') then 'reservations.event.manage'
    when p_operation = 'create_booking' then 'reservations.booking.create'
    when p_operation = 'update_participant_booking' then 'reservations.booking.update'
    when p_operation = 'delete_booking' then 'reservations.booking.delete'
    when p_operation = 'record_payment' then 'reservations.payment.record'
    when p_operation = 'void_payment' then 'reservations.payment.void'
    when p_operation = 'update_attendance' then 'reservations.attendance.manage'
    when p_operation = 'update_operational_review' then 'reservations.operations.manage'
  end;
  if v_permission is null then raise exception 'RESERVATIONS_OPERATION_NOT_ALLOWED' using errcode='42501'; end if;

  if p_operation = 'create_event' then
    v_conference_id := (p_args->>'p_conference_id')::uuid;
  elsif p_args ? 'p_event_id' then
    select e.conference_id into v_conference_id from reservations.events e where e.id=(p_args->>'p_event_id')::uuid;
  elsif p_args ? 'p_booking_id' then
    select e.conference_id into v_conference_id from reservations.bookings b join reservations.events e on e.id=b.event_id where b.id=(p_args->>'p_booking_id')::uuid;
  elsif p_operation = 'void_payment' then
    select e.conference_id into v_conference_id from reservations.payments z join reservations.bookings b on b.id=z.booking_id join reservations.events e on e.id=b.event_id where z.id=(p_args->>'p_payment_id')::uuid;
  end if;
  if v_conference_id is null then raise exception 'RESERVATIONS_CONFERENCE_REQUIRED' using errcode='22023'; end if;
  v_context := reservations_private.conference_context(p_device_id,v_conference_id,v_permission);
  v_organization_id := (v_context->>'organizationId')::uuid;

  if p_operation = 'update_event'
     and (p_args->>'p_conference_id')::uuid is distinct from v_conference_id then
    raise exception 'RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE' using errcode='55000';
  end if;

  if p_operation = 'create_event' then
    v_actor := (v_context->>'actorUserId')::uuid;
    v_replay := reservations_private.begin_operation(v_operation_id,v_context,p_operation,p_args);
    if v_replay is not null then return v_replay; end if;
    insert into reservations.events(
      organization_id,conference_id,name,start_date,end_date,location,capacity,status,notes,created_by,updated_by
    ) values (
      v_organization_id,v_conference_id,btrim(p_args->>'p_name'),(p_args->>'p_start_date')::date,(p_args->>'p_end_date')::date,
      coalesce(p_args->>'p_location',''),(p_args->>'p_capacity')::integer,p_args->>'p_status',coalesce(p_args->>'p_notes',''),v_actor,v_actor
    ) returning id,revision into v_id,v_revision;
    v_result := jsonb_build_object('eventId',v_id,'revision',v_revision);
    perform reservations_private.audit(v_context,'event.created','event',v_id,v_operation_id,null,v_result);
    return reservations_private.complete_operation(v_operation_id,v_context,p_operation,p_args,v_result);
  end if;

  return reservations.mutate_pre_conference_scope(
    p_device_id,
    p_operation,
    (p_args - 'p_conference_id') || jsonb_build_object('p_organization_id',v_organization_id)
  );
end
$$;

alter table public.conferences
  add constraint conferences_id_organization_unique unique(id,organization_id);
alter table reservations.events
  add constraint reservations_events_conference_organization_fk
  foreign key(conference_id,organization_id)
  references public.conferences(id,organization_id)
  on delete restrict;
alter table reservations.events alter column conference_id set not null;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  rename to execute_device_operation_pre_reservations_conference_scope;

create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public','platform','platform_private','reservations','reservations_private' as $$
declare v_session platform_private.device_sessions%rowtype;
begin
 if p_module<>'reservations' then return platform.execute_device_operation_pre_reservations_conference_scope(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args); end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
 if p_args is null or jsonb_typeof(p_args)<>'object' or p_args ?| array['p_organization_id','organization_id','p_device_id','p_actor_device_id','p_actor_user_id','p_conference_person_id','conference_person_id'] then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
 select s.* into v_session from platform_private.device_sessions s join platform.device_key_bindings b on b.id=s.binding_id join platform.user_device_authorizations a on a.id=s.device_authorization_id join platform.devices d on d.id=s.device_id join platform.profiles p on p.user_id=s.user_id where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null and s.expires_at>statement_timestamp() and b.user_id=s.user_id and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256' and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved' and a.revoked_at is null and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null and p.account_status='approved';
 if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true); perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,'user_id',v_session.user_id,'device_id',v_session.device_id,'authorization_id',v_session.device_authorization_id,'binding_id',v_session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);
 case p_operation
  when 'list_conference_options' then perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
  when 'get_dashboard_summary' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']);
  when 'list_events' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id','p_status','p_limit']);
  when 'get_event','list_event_periods','list_booking_types' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
  when 'list_bookings' then perform platform_private.require_exact_jsonb_keys(p_args,case when nullif(p_args->>'p_event_id','') is null then array['p_conference_id','p_event_id','p_limit'] else array['p_event_id','p_limit'] end);
  when 'get_booking_detail','list_booking_payments','get_operational_state','get_booking_accommodation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_booking_id']);
  when 'search_participants_bookings' then perform platform_private.require_exact_jsonb_keys(p_args,case when nullif(p_args->>'p_event_id','') is null then array['p_conference_id','p_query','p_event_id','p_limit'] else array['p_query','p_event_id','p_limit'] end);
  when 'list_attendance','get_report_source_data' then perform platform_private.require_exact_jsonb_keys(p_args,case when nullif(p_args->>'p_event_id','') is null then array['p_conference_id','p_event_id','p_limit'] else array['p_event_id','p_limit'] end);
  when 'create_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
  when 'update_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision','p_conference_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']);
  when 'delete_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision']);
  when 'create_event_period' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_kind','p_starts_on','p_ends_on','p_display_order']);
  when 'update_event_period' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_period_id','p_expected_revision','p_kind','p_starts_on','p_ends_on','p_display_order']);
  when 'delete_event_period' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_period_id','p_expected_revision']);
  when 'reorder_event_periods' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_period_ids']);
  when 'create_booking_type' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_name','p_code','p_price','p_active','p_display_order','p_eligible_attendance_segments']);
  when 'update_booking_type' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_booking_type_id','p_expected_revision','p_name','p_code','p_price','p_active','p_display_order','p_eligible_attendance_segments']);
  when 'create_booking' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_booking_type_id','p_full_name','p_phone','p_age','p_church','p_governorate','p_city_or_village','p_service_sector','p_service_sector_other','p_notes']);
  when 'update_participant_booking' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision','p_full_name','p_phone','p_age','p_church','p_governorate','p_city_or_village','p_service_sector','p_service_sector_other','p_notes']);
  when 'delete_booking' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision']);
  when 'record_payment' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_amount','p_payment_date','p_payment_method','p_payment_method_other','p_reference','p_notes']);
  when 'void_payment' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_payment_id','p_void_reason']);
  when 'update_attendance' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_segment','p_attended','p_attendance_date','p_notes']);
  when 'update_operational_review' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_booking_id','p_expected_revision','p_review_status']);
  else raise exception 'RESERVATIONS_OPERATION_NOT_ALLOWED' using errcode='42501';
 end case;
 if p_operation in('list_conference_options','get_dashboard_summary','list_events','get_event','list_event_periods','list_booking_types','list_bookings','get_booking_detail','search_participants_bookings','list_booking_payments','list_attendance','get_operational_state','get_report_source_data','get_booking_accommodation') then return reservations.read(v_session.device_id,p_operation,p_args); end if;
 return reservations.mutate(v_session.device_id,p_operation,p_args);
end $$;

revoke all on function reservations_private.conference_context(uuid,uuid,text),reservations.read_pre_conference_scope(uuid,text,jsonb),reservations.mutate_pre_conference_scope(uuid,text,jsonb),platform.execute_device_operation_pre_reservations_conference_scope(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function reservations_private.conference_context(uuid,uuid,text),reservations.read_pre_conference_scope(uuid,text,jsonb),reservations.mutate_pre_conference_scope(uuid,text,jsonb),platform.execute_device_operation_pre_reservations_conference_scope(uuid,uuid,bytea,text,text,jsonb) to postgres;
revoke all on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) to service_role;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) to service_role;

commit;
