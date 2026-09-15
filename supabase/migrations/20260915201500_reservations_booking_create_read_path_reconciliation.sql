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
      if v_conference_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
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
          order by e.start_date desc,e.id limit v_limit
        ) x
      );
    elsif p_args ? 'p_scope_type' and not p_args ? 'p_conference_id' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_scope_type','p_status','p_limit']);
      if p_args->>'p_scope_type'<>'standalone' then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
      return (
        select coalesce(jsonb_agg(to_jsonb(x) order by x.start_date desc,x.id),'[]'::jsonb)
        from (
          select e.* from reservations.events e
          where e.scope_type='standalone' and e.conference_id is null and e.organization_id is null
            and ((p_args->>'p_status') is null or e.status=p_args->>'p_status')
          order by e.start_date desc,e.id limit v_limit
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
    if v_event_id is null then raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023'; end if;
    if not exists(
      select 1 from reservations.events e
      where e.id=v_event_id and (
        (e.scope_type='standalone' and e.conference_id is null and e.organization_id is null)
        or
        (e.scope_type='conference' and exists(
          select 1 from public.organizations o
          join public.organization_members om on om.organization_id=o.id and om.user_id=v_actor
          where o.id=e.organization_id and o.status='active'
        ))
      )
    ) then raise exception 'RESERVATIONS_EVENT_ACCESS_REQUIRED' using errcode='42501'; end if;
    return (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.display_order),'[]'::jsonb)
      from reservations.booking_types t
      where t.event_id=v_event_id
    );
  end if;

  if p_operation='list_bookings' then
    begin
      return reservations_private.read_scoped(p_device_id,p_operation,p_args);
    exception when sqlstate '42501' then
      perform public.require_effective_module_permission(
        p_device_id,'reservations','reservations.booking.create',null,null
      );
      return '[]'::jsonb;
    end;
  end if;

  return reservations_private.read_scoped(p_device_id,p_operation,p_args);
end $$;

revoke all on function reservations.read(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb) to service_role;

commit;
