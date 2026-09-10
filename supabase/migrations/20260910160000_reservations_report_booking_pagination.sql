begin;

alter function reservations.read(uuid,text,jsonb)
  rename to read_pre_report_booking_pagination;

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
  v_event_id uuid;
  v_conference_id uuid;
  v_organization_id uuid;
  v_context jsonb;
  v_limit integer;
  v_after_created_at timestamptz;
  v_after_booking_id uuid;
  v_rows jsonb;
  v_has_more boolean;
  v_last_created_at timestamptz;
  v_last_booking_id uuid;
begin
  if p_operation <> 'get_report_booking_page' then
    return reservations.read_pre_report_booking_pagination(p_device_id,p_operation,p_args);
  end if;

  v_event_id := nullif(p_args->>'p_event_id','')::uuid;
  v_limit := (p_args->>'p_limit')::integer;
  v_after_created_at := nullif(p_args->>'p_after_created_at','')::timestamptz;
  v_after_booking_id := nullif(p_args->>'p_after_booking_id','')::uuid;
  if v_event_id is null or v_limit is null or v_limit < 1 or v_limit > 500
     or ((v_after_created_at is null) <> (v_after_booking_id is null)) then
    raise exception 'RESERVATIONS_REPORT_PAGE_ARGUMENTS_INVALID' using errcode='22023';
  end if;

  select e.conference_id,e.organization_id
    into v_conference_id,v_organization_id
  from reservations.events e
  where e.id=v_event_id;
  if not found or v_conference_id is null then
    raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode='42501';
  end if;
  v_context := reservations_private.conference_context(
    p_device_id,v_conference_id,'reservations.reports.view'
  );
  if (v_context->>'organizationId')::uuid <> v_organization_id then
    raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode='42501';
  end if;

  with candidates as materialized (
    select b.*
    from reservations.bookings b
    where b.organization_id=v_organization_id
      and b.event_id=v_event_id
      and (v_after_created_at is null
        or b.created_at > v_after_created_at
        or (b.created_at = v_after_created_at and b.id > v_after_booking_id))
    order by b.created_at,b.id
    limit v_limit+1
  ), page as materialized (
    select * from candidates order by created_at,id limit v_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'booking',to_jsonb(b),
        'participant',to_jsonb(p),
        'payments',coalesce((select jsonb_agg(to_jsonb(z) order by z.payment_date,z.id) from reservations.payments z where z.organization_id=b.organization_id and z.booking_id=b.id),'[]'::jsonb),
        'attendance',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from reservations.attendance_records a where a.organization_id=b.organization_id and a.booking_id=b.id),'[]'::jsonb),
        'operationalReview',(select to_jsonb(o) from reservations.operational_reviews o where o.organization_id=b.organization_id and o.booking_id=b.id)
      ) order by b.created_at,b.id
    ),'[]'::jsonb),
    (select count(*) > v_limit from candidates),
    (array_agg(b.created_at order by b.created_at desc,b.id desc))[1],
    (array_agg(b.id order by b.created_at desc,b.id desc))[1]
  into v_rows,v_has_more,v_last_created_at,v_last_booking_id
  from page b
  join reservations.participants p
    on (p.organization_id,p.id)=(b.organization_id,b.participant_id);

  return jsonb_build_object(
    'rows',v_rows,
    'hasMore',coalesce(v_has_more,false),
    'nextCursor',case when coalesce(v_has_more,false) then jsonb_build_object(
      'createdAt',v_last_created_at,
      'bookingId',v_last_booking_id
    ) else null end
  );
end
$$;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)
  rename to execute_device_operation_pre_report_booking_pagination;

create function platform.execute_device_operation(
  p_user_id uuid,
  p_session_id uuid,
  p_token_hash bytea,
  p_module text,
  p_operation text,
  p_args jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','platform','platform_private','reservations','reservations_private'
as $$
declare
  v_session platform_private.device_sessions%rowtype;
begin
  if p_module <> 'reservations' or p_operation <> 'get_report_booking_page' then
    return platform.execute_device_operation_pre_report_booking_pagination(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args);
  end if;
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object'
     or p_args ?| array['p_organization_id','organization_id','p_device_id','p_actor_device_id','p_actor_user_id','p_conference_id','p_conference_person_id','conference_person_id'] then
    raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  perform platform_private.require_exact_jsonb_keys(
    p_args,array['p_event_id','p_limit','p_after_created_at','p_after_booking_id']
  );
  select s.* into v_session
  from platform_private.device_sessions s
  join platform.device_key_bindings b on b.id=s.binding_id
  join platform.user_device_authorizations a on a.id=s.device_authorization_id
  join platform.devices d on d.id=s.device_id
  join platform.profiles p on p.user_id=s.user_id
  where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash
    and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null
    and s.expires_at>statement_timestamp() and b.user_id=s.user_id
    and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id
    and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256'
    and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null
    and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved'
    and a.revoked_at is null and d.lifecycle_status='active' and d.retired_at is null
    and d.compromised_at is null and p.account_status='approved';
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
  return reservations.read(v_session.device_id,p_operation,p_args);
end
$$;

revoke all on function reservations.read_pre_report_booking_pagination(uuid,text,jsonb),platform.execute_device_operation_pre_report_booking_pagination(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function reservations.read_pre_report_booking_pagination(uuid,text,jsonb),platform.execute_device_operation_pre_report_booking_pagination(uuid,uuid,bytea,text,text,jsonb) to postgres;
revoke all on function reservations.read(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb) to service_role;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) to service_role;

commit;
