begin;

-- Linking a previously-standalone Reservations Event to a Conference must also
-- project every pre-existing booking participant into the Conference snapshot.
-- Replaying the original successful link operation is intentionally supported:
-- missing projections are filled idempotently through conference_person_links,
-- while the original operation result remains unchanged.
create or replace function reservations_private.link_standalone_event_to_conference(
  p_device_id uuid,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_operation_id uuid:=nullif(p_args->>'p_operation_id','')::uuid;
  v_event_id uuid:=nullif(p_args->>'p_event_id','')::uuid;
  v_conference_id uuid:=nullif(p_args->>'p_conference_id','')::uuid;
  v_expected_revision bigint:=(p_args->>'p_expected_revision')::bigint;
  v_context jsonb;
  v_replay jsonb;
  v_event reservations.events%rowtype;
  v_new_event reservations.events%rowtype;
  v_booking record;
  v_old_partition uuid;
  v_new_partition uuid;
  v_organization_id uuid;
  v_actor uuid;
  v_result jsonb;
begin
  if p_args is null or jsonb_typeof(p_args)<>'object'
     or p_args ?| array[
       'organization_id','p_organization_id','scope_partition_id','p_scope_partition_id',
       'device_id','p_device_id','actor_user_id','p_actor_user_id',
       'actor_device_id','p_actor_device_id'
     ] then
    raise exception 'RESERVATIONS_SCOPE_OVERRIDE_DENIED' using errcode='42501';
  end if;

  perform platform_private.require_exact_jsonb_keys(
    p_args,
    array['p_operation_id','p_event_id','p_expected_revision','p_conference_id']
  );

  if v_operation_id is null or v_event_id is null or v_conference_id is null then
    raise exception 'RESERVATIONS_LINK_ARGUMENTS_REQUIRED' using errcode='22023';
  end if;

  v_context:=reservations_private.conference_context(
    p_device_id,v_conference_id,'reservations.event.manage'
  );
  v_new_partition:=v_conference_id;
  v_organization_id:=(v_context->>'organizationId')::uuid;
  v_actor:=(v_context->>'actorUserId')::uuid;
  v_context:=v_context||jsonb_build_object(
    'scopeType','conference',
    'scopePartitionId',v_new_partition,
    'conferenceId',v_conference_id,
    'eventId',v_event_id,
    'organizationId',v_organization_id
  );

  v_replay:=reservations_private.begin_operation(
    v_operation_id,v_context,'link_standalone_event_to_conference',p_args
  );
  if v_replay is not null then
    -- Compatibility recovery for links completed before participant projection
    -- was added. project_booking_to_conference() returns the existing link when
    -- already projected, so replay cannot duplicate Conference people.
    for v_booking in
      select b.id
      from reservations.bookings b
      where b.event_id=v_event_id
        and not exists(
          select 1
          from reservations.conference_person_links l
          where l.booking_id=b.id
        )
      order by b.created_at,b.id
    loop
      perform reservations_private.project_booking_to_conference(
        v_booking.id,extensions.gen_random_uuid(),v_context
      );
    end loop;
    return v_replay;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('reservations-link-event:'||v_event_id::text,0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('reservations-link-conference:'||v_conference_id::text,0)
  );

  select * into v_event
  from reservations.events
  where id=v_event_id
  for update;
  if not found then
    raise exception 'RESERVATIONS_EVENT_NOT_FOUND' using errcode='P0002';
  end if;

  if v_event.scope_type<>'standalone'
     or v_event.conference_id is not null
     or v_event.organization_id is not null then
    raise exception 'RESERVATIONS_EVENT_NOT_STANDALONE' using errcode='22023';
  end if;
  if v_event.revision<>v_expected_revision then
    raise exception 'RESERVATIONS_REVISION_CONFLICT' using errcode='40001';
  end if;

  if exists(
    select 1 from reservations.events
    where conference_id=v_conference_id and id<>v_event_id
  ) then
    raise exception 'RESERVATIONS_TARGET_CONFERENCE_ALREADY_HAS_EVENT' using errcode='40001';
  end if;

  v_old_partition:=v_event.scope_partition_id;
  if v_old_partition is null or v_old_partition=v_new_partition then
    raise exception 'RESERVATIONS_SCOPE_PARTITION_INVALID' using errcode='22023';
  end if;

  if exists(
    select 1 from reservations.scope_partition_links
    where old_scope_partition_id=v_old_partition
       or event_id=v_event_id
       or conference_id=v_conference_id
  ) then
    raise exception 'RESERVATIONS_SCOPE_LINK_CONFLICT' using errcode='40001';
  end if;

  if exists(
    select 1
    from reservations.booking_number_counters
    where scope_partition_id=v_new_partition
  ) and exists(
    select 1
    from reservations.booking_number_counters
    where scope_partition_id=v_old_partition
  ) then
    raise exception 'RESERVATIONS_TARGET_PARTITION_COUNTER_CONFLICT' using errcode='40001';
  end if;

  set constraints all deferred;

  perform set_config(
    'reservations.scope_relink_guard',
    v_event_id::text||':'||v_old_partition::text||':'||v_new_partition::text,
    true
  );

  update reservations.events
  set scope_type='conference',
      scope_partition_id=v_new_partition,
      conference_id=v_conference_id,
      organization_id=v_organization_id,
      revision=revision+1,
      updated_at=statement_timestamp(),
      updated_by=v_actor
  where id=v_event_id;

  update reservations.event_periods
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.booking_types
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.participants
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.bookings
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.payments
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.attendance_records
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.operational_reviews
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  update reservations.booking_number_counters
  set scope_partition_id=v_new_partition
  where scope_partition_id=v_old_partition;

  insert into reservations.scope_partition_links(
    old_scope_partition_id,new_scope_partition_id,event_id,conference_id,
    organization_id,operation_id,linked_by
  ) values(
    v_old_partition,v_new_partition,v_event_id,v_conference_id,
    v_organization_id,v_operation_id,v_actor
  );

  -- Backfill every booking that existed while the Event was standalone. Future
  -- bookings continue to use the pre-existing create_booking projection path.
  for v_booking in
    select b.id
    from reservations.bookings b
    where b.event_id=v_event_id
      and not exists(
        select 1
        from reservations.conference_person_links l
        where l.booking_id=b.id
      )
    order by b.created_at,b.id
  loop
    perform reservations_private.project_booking_to_conference(
      v_booking.id,extensions.gen_random_uuid(),v_context
    );
  end loop;

  select * into v_new_event
  from reservations.events
  where id=v_event_id;

  v_result:=jsonb_build_object(
    'eventId',v_event_id,
    'conferenceId',v_conference_id,
    'scopeType','conference',
    'oldScopePartitionId',v_old_partition,
    'scopePartitionId',v_new_partition,
    'revision',v_new_event.revision
  );

  perform reservations_private.audit(
    v_context,
    'event.linked_to_conference',
    'event',
    v_event_id,
    v_operation_id,
    to_jsonb(v_event),
    to_jsonb(v_new_event)
  );

  return reservations_private.complete_operation(
    v_operation_id,
    v_context,
    'link_standalone_event_to_conference',
    p_args,
    v_result
  );
end $$;

revoke all on function reservations_private.link_standalone_event_to_conference(uuid,jsonb)
from public, anon, authenticated, service_role;

commit;
