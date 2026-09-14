begin;

-- Standalone Reservations Events can be linked later to an existing Conference.
-- The Event keeps its identity and all dependent records are re-keyed atomically
-- to the Conference partition. Historical operation-ledger rows remain on their
-- original partition and are replayable through the recorded partition alias.

do $$
begin
  if to_regclass('reservations.events') is null
     or to_regclass('reservations.bookings') is null
     or to_regclass('reservations.operations') is null
     or to_regclass('reservations.booking_number_counters') is null then
    raise exception 'RESERVATIONS_STANDALONE_LINK_PREDECESSOR_REQUIRED' using errcode='55000';
  end if;
end $$;

create table if not exists reservations.scope_partition_links (
  old_scope_partition_id uuid primary key,
  new_scope_partition_id uuid not null,
  event_id uuid not null unique references reservations.events(id) on delete restrict,
  conference_id uuid not null unique references public.conferences(id) on delete restrict,
  organization_id uuid not null,
  operation_id uuid not null unique,
  linked_by uuid not null references platform.profiles(user_id),
  linked_at timestamptz not null default statement_timestamp(),
  constraint reservations_scope_partition_links_changed_check
    check (old_scope_partition_id <> new_scope_partition_id),
  constraint reservations_scope_partition_links_conference_partition_check
    check (new_scope_partition_id = conference_id)
);

revoke all on table reservations.scope_partition_links from public, anon, authenticated, service_role;

-- Runtime re-keying changes both sides of the partition foreign keys inside one
-- transaction, so those relationship checks must be deferred until commit.
alter table reservations.event_periods
  alter constraint reservations_event_periods_partition_event_fk deferrable initially immediate;
alter table reservations.booking_types
  alter constraint reservations_booking_types_partition_event_fk deferrable initially immediate;
alter table reservations.bookings
  alter constraint reservations_bookings_partition_event_fk deferrable initially immediate;
alter table reservations.bookings
  alter constraint reservations_bookings_partition_participant_fk deferrable initially immediate;
alter table reservations.bookings
  alter constraint reservations_bookings_partition_type_fk deferrable initially immediate;
alter table reservations.payments
  alter constraint reservations_payments_partition_booking_fk deferrable initially immediate;
alter table reservations.attendance_records
  alter constraint reservations_attendance_partition_booking_fk deferrable initially immediate;
alter table reservations.operational_reviews
  alter constraint reservations_reviews_partition_booking_fk deferrable initially immediate;

-- Preserve the general immutability boundary. Only the guarded private linking
-- operation may perform the one allowed transition: standalone -> conference.
create or replace function reservations_private.enforce_event_scope_partition_immutable()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_guard text;
begin
  if tg_op='UPDATE' and (new.scope_type,new.scope_partition_id,new.conference_id,new.organization_id)
       is distinct from (old.scope_type,old.scope_partition_id,old.conference_id,old.organization_id) then
    v_guard:=current_setting('reservations.scope_relink_guard',true);
    if not (
      old.scope_type='standalone'
      and new.scope_type='conference'
      and old.conference_id is null
      and old.organization_id is null
      and new.conference_id is not null
      and new.organization_id is not null
      and new.scope_partition_id=new.conference_id
      and v_guard=(old.id::text||':'||old.scope_partition_id::text||':'||new.scope_partition_id::text)
    ) then
      raise exception 'RESERVATIONS_EVENT_SCOPE_IMMUTABLE' using errcode='55000';
    end if;
  end if;
  return new;
end $$;

-- Historical standalone ledger entries keep their original scope partition and
-- intent hash. After a link, an exact replay is accepted only when a persisted
-- alias proves that the old partition was linked to the current one.
create or replace function reservations_private.begin_operation(
  p_operation_id uuid,
  p_context jsonb,
  p_operation text,
  p_args jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_prior reservations.operations%rowtype;
  v_partition uuid:=(p_context->>'scopePartitionId')::uuid;
  v_org uuid:=(p_context->>'organizationId')::uuid;
  v_intent text;
  v_historical_intent text;
  v_linked_intent text;
  v_linked_partition boolean:=false;
begin
  if p_operation_id is null then
    raise exception 'RESERVATIONS_OPERATION_ID_REQUIRED' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('reservations-operation:'||p_operation_id::text,0)
  );
  select * into v_prior
  from reservations.operations
  where operation_id=p_operation_id;
  if not found then return null; end if;

  v_intent:=reservations_private.intent(
    p_operation,v_partition,p_args-'p_operation_id'
  );
  v_historical_intent:=case when v_prior.organization_id is not null then
    encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'operation',p_operation,
            'organizationId',v_prior.organization_id,
            'args',p_args-'p_operation_id'
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;

  select exists(
    select 1
    from reservations.scope_partition_links link
    where link.old_scope_partition_id=v_prior.scope_partition_id
      and link.new_scope_partition_id=v_partition
  ) into v_linked_partition;

  v_linked_intent:=case when v_linked_partition then
    reservations_private.intent(
      p_operation,v_prior.scope_partition_id,p_args-'p_operation_id'
    )
  end;

  if v_prior.actor_user_id<>(p_context->>'actorUserId')::uuid
     or v_prior.device_id<>(p_context->>'actorDeviceId')::uuid
     or v_prior.operation_name<>p_operation
     or not (
       (v_prior.scope_partition_id=v_partition and v_prior.intent_hash=v_intent)
       or (
         v_prior.organization_id is not null
         and v_prior.scope_partition_id=v_prior.organization_id
         and v_prior.intent_hash=v_historical_intent
       )
       or (
         v_linked_partition
         and v_prior.intent_hash=v_linked_intent
       )
     ) then
    raise exception 'RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT' using errcode='40001';
  end if;
  return v_prior.result;
end $$;

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

  -- Conference context proves module permission plus exact Conference membership.
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

  -- This makes retry of the linking operation itself deterministic after the
  -- Event has already moved to Conference scope.
  v_replay:=reservations_private.begin_operation(
    v_operation_id,v_context,'link_standalone_event_to_conference',p_args
  );
  if v_replay is not null then return v_replay; end if;

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

  set constraints
    reservations_event_periods_partition_event_fk,
    reservations_booking_types_partition_event_fk,
    reservations_bookings_partition_event_fk,
    reservations_bookings_partition_participant_fk,
    reservations_bookings_partition_type_fk,
    reservations_payments_partition_booking_fk,
    reservations_attendance_partition_booking_fk,
    reservations_reviews_partition_booking_fk
  deferred;

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

-- Extend the existing device-session dispatcher without exposing a direct RPC.
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
set search_path to 'pg_catalog','public','platform','platform_private','reservations','reservations_private'
as $$
declare
  v_session platform_private.device_sessions%rowtype;
  v_intercept boolean:=false;
begin
  if p_module='reservations' then
    v_intercept:=case
      when p_operation='list_events' then coalesce(p_args ? 'p_scope_type',false)
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
     or p_args ?| array[
       'organization_id','p_organization_id','scope_partition_id','p_scope_partition_id',
       'device_id','p_device_id','actor_user_id','p_actor_user_id',
       'actor_device_id','p_actor_device_id','p_conference_person_id','conference_person_id'
     ] then
    raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
  end if;

  case p_operation
    when 'list_events' then
      perform platform_private.require_exact_jsonb_keys(
        p_args,array['p_scope_type','p_status','p_limit']
      );
      if p_args->>'p_scope_type'<>'standalone' then
        raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
      end if;
    when 'get_dashboard_summary' then
      perform platform_private.require_exact_jsonb_keys(p_args,array['p_event_id']);
    when 'create_event' then
      perform platform_private.require_exact_jsonb_keys(
        p_args,
        array[
          'p_operation_id','p_scope_type','p_name','p_start_date','p_end_date',
          'p_location','p_capacity','p_status','p_notes'
        ]
      );
      if p_args->>'p_scope_type'<>'standalone' then
        raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023';
      end if;
    when 'update_event' then
      perform platform_private.require_exact_jsonb_keys(
        p_args,
        array[
          'p_operation_id','p_event_id','p_expected_revision','p_name',
          'p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes'
        ]
      );
    when 'link_standalone_event_to_conference' then
      perform platform_private.require_exact_jsonb_keys(
        p_args,
        array['p_operation_id','p_event_id','p_expected_revision','p_conference_id']
      );
  end case;

  select s.* into v_session
  from platform_private.device_sessions s
  join platform.device_key_bindings b on b.id=s.binding_id
  join platform.user_device_authorizations a on a.id=s.device_authorization_id
  join platform.devices d on d.id=s.device_id
  join platform.profiles p on p.user_id=s.user_id
  where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash
    and s.purpose='PLATFORM_DEVICE_SESSION'
    and s.revoked_at is null
    and s.expires_at>statement_timestamp()
    and b.user_id=s.user_id
    and b.device_id=s.device_id
    and b.device_authorization_id=s.device_authorization_id
    and b.public_key_thumbprint=s.public_key_thumbprint
    and b.algorithm='ECDSA_P256_SHA256'
    and b.lifecycle_status='active'
    and b.revoked_at is null
    and b.retired_at is null
    and a.user_id=s.user_id
    and a.device_id=s.device_id
    and a.status='approved'
    and a.revoked_at is null
    and d.lifecycle_status='active'
    and d.retired_at is null
    and d.compromised_at is null
    and p.account_status='approved';

  if not found then
    raise exception 'DEVICE_SESSION_INVALID' using errcode='42501';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',p_user_id,'role','service_role')::text,
    true
  );
  perform set_config(
    'platform.phase1c_context',
    jsonb_build_object(
      'purpose','PLATFORM_DEVICE_SESSION_DISPATCH',
      'session_id',v_session.id,
      'user_id',v_session.user_id,
      'device_id',v_session.device_id,
      'authorization_id',v_session.device_authorization_id,
      'binding_id',v_session.binding_id,
      'token_hash',encode(p_token_hash,'hex')
    )::text,
    true
  );

  if p_operation in ('list_events','get_dashboard_summary') then
    return reservations.read(v_session.device_id,p_operation,p_args);
  end if;
  if p_operation='link_standalone_event_to_conference' then
    return reservations_private.link_standalone_event_to_conference(
      v_session.device_id,p_args
    );
  end if;
  return reservations.mutate(v_session.device_id,p_operation,p_args);
end $$;

commit;
