begin;

-- Replace the occupant from an effective Conference day without rewriting the
-- identity of the historical stay. The entire function is one PostgreSQL
-- transaction: any validation, insert, audit, or constraint failure rolls back
-- the old segment update as well.
create or replace function public.replace_conference_accommodation(
  p_device uuid,p_operation_id uuid,p_conference uuid,p_occupancy uuid,
  p_expected bigint,p_replacement_participation uuid,p_effective_day integer,
  p_bed text,p_extra_type text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;actor uuid;authz uuid;days integer;
 old_stay public.conference_accommodation_occupancies%rowtype;
 replacement public.conference_participations%rowtype;
 room public.conference_accommodation_rooms%rowtype;
 new_stay public.conference_accommodation_occupancies%rowtype;
 prior_old jsonb;result jsonb;
begin
 if p_operation_id is null then raise exception 'ACCOMMODATION_OPERATION_ID_REQUIRED' using errcode='22023';end if;
 ctx:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);
 actor:=(ctx->>'actorUserId')::uuid;
 authz:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 select new_values into result from platform.audit_events
  where actor_user_id=actor and operation_id=p_operation_id and scope_id=p_conference
    and action='conference.accommodation.replaced' limit 1;
 if result is not null then return result||jsonb_build_object('status','duplicate');end if;
 days:=platform_private.conference_accommodation_duration(p_conference);
 if p_effective_day<1 or p_effective_day>days or p_bed not in('base','extra')
    or (p_bed='base' and p_extra_type is not null)
    or (p_bed='extra' and p_extra_type not in('adult','child')) then
   raise exception 'ACCOMMODATION_REPLACEMENT_ARGUMENT_INVALID' using errcode='22023';
 end if;
 -- Participation locks precede the room and occupancy locks, matching the
 -- canonical accommodation lock order and serializing status changes.
 perform 1 from public.conference_participations
  where id in(p_replacement_participation,(select participation_id from public.conference_accommodation_occupancies where id=p_occupancy))
  order by id for update;
 select * into old_stay from public.conference_accommodation_occupancies
  where id=p_occupancy and conference_id=p_conference;
 if not found then raise exception 'ACCOMMODATION_OCCUPANCY_NOT_FOUND' using errcode='P0002';end if;
 if not exists(select 1 from public.conference_participations where id=old_stay.participation_id and conference_id=p_conference and status='active') then
   raise exception 'ACTIVE_CONFERENCE_PARTICIPATION_REQUIRED' using errcode='42501';
 end if;
 select * into replacement from public.conference_participations
  where id=p_replacement_participation and conference_id=p_conference and status='active';
 if not found then raise exception 'ACTIVE_CONFERENCE_PARTICIPATION_REQUIRED' using errcode='42501';end if;
 if replacement.id=old_stay.participation_id then raise exception 'ACCOMMODATION_REPLACEMENT_PERSON_UNCHANGED' using errcode='22023';end if;
 select * into room from public.conference_accommodation_rooms
  where id=old_stay.room_id and platform_private.conference_room_is_assigned(p_conference,id) for update;
 if not found then raise exception 'ACCOMMODATION_ROOM_NOT_FOUND' using errcode='P0002';end if;
 select * into old_stay from public.conference_accommodation_occupancies where id=p_occupancy for update;
 if old_stay.revision<>p_expected then raise exception 'ACCOMMODATION_REVISION_CONFLICT' using errcode='40001';end if;
 if p_effective_day<old_stay.arrival_day or p_effective_day>=coalesce(old_stay.leave_day,days+1) then
   raise exception 'ACCOMMODATION_REPLACEMENT_DAY_OUTSIDE_STAY' using errcode='22023';
 end if;
 if room.is_closed and (room.closed_day is null or p_effective_day>=room.closed_day) then
   raise exception 'ACCOMMODATION_ROOM_UNAVAILABLE' using errcode='55000';
 end if;
 if exists(select 1 from public.conference_accommodation_occupancies o
   where o.participation_id=p_replacement_participation
     and o.arrival_day<coalesce(old_stay.leave_day,days+1)
     and p_effective_day<coalesce(o.leave_day,days+1)) then
   raise exception 'ACCOMMODATION_STAY_OVERLAP' using errcode='23P01';
 end if;
 if not platform_private.conference_room_has_capacity(p_conference,old_stay.room_id,p_bed,p_effective_day,old_stay.leave_day,old_stay.id) then
   raise exception 'ACCOMMODATION_ROOM_CAPACITY_EXCEEDED' using errcode='55000';
 end if;
 prior_old:=to_jsonb(old_stay);
 -- A room key cannot silently remain attributed to the replaced person.
 update public.conference_room_assignments set key_holder_occupancy_id=null,
  key_delivered_at=null,key_delivered_by=null,revision=revision+1,updated_at=statement_timestamp(),updated_by=actor
  where conference_id=p_conference and room_id=old_stay.room_id and key_holder_occupancy_id=old_stay.id;
 insert into public.conference_accommodation_occupancies(
  conference_id,room_id,participation_id,arrival_day,leave_day,bed_type,
  extra_bed_person_type,arrived_at,arrived_by,created_by,updated_by
 ) values(
  p_conference,old_stay.room_id,replacement.id,p_effective_day,old_stay.leave_day,p_bed,
  p_extra_type,case when old_stay.arrived_at is null then null else statement_timestamp() end,
  case when old_stay.arrived_at is null then null else actor end,actor,actor
 ) returning * into new_stay;
 if p_effective_day=old_stay.arrival_day then
   -- The original row cannot represent a zero-length segment. Its complete
   -- value remains immutable in the audit event; deletion occurs only inside
   -- this transaction and therefore rolls back if the replacement fails.
   delete from public.conference_accommodation_occupancies where id=old_stay.id;
 else
   update public.conference_accommodation_occupancies set leave_day=p_effective_day,
    revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=old_stay.id;
 end if;
 result:=jsonb_build_object('status','success','occupancyId',new_stay.id,'revision',new_stay.revision,
  'roomId',new_stay.room_id,'participationId',new_stay.participation_id,
  'previousOccupancyId',old_stay.id,'previousParticipationId',old_stay.participation_id,
  'effectiveDay',p_effective_day,'historicalSegmentPreserved',p_effective_day>old_stay.arrival_day);
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,
  entity_type,entity_id,scope_type,scope_id,old_values,new_values,metadata,operation_id,source)
 values(actor,authz,'platform','conference','conference.accommodation.replaced','accommodation_occupancy',
  new_stay.id,'conference',p_conference,prior_old,result,
  jsonb_build_object('conferenceId',p_conference,'roomId',old_stay.room_id,
   'previousOccupancyId',old_stay.id,'previousParticipationId',old_stay.participation_id,
   'replacementParticipationId',replacement.id,'effectiveDay',p_effective_day,
   'permissionKey','conference.accommodation.manage','authoritySource',ctx->>'authoritySource','grantId',ctx->'grantId'),
  p_operation_id,'rpc');
 return result;
exception when exclusion_violation then raise exception 'ACCOMMODATION_STAY_OVERLAP' using errcode='23P01';
end $$;

do $dispatch$
declare d text;marker text;branch text;
begin
 d:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
 if position('p_operation=''replace_conference_accommodation''' in d)=0 then
  marker:='elsif p_operation=''move_conference_accommodation'' then';
  branch:=$body$elsif p_operation='replace_conference_accommodation' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_occupancy_id','p_expected_revision','p_replacement_participation_id','p_effective_day','p_bed_type','p_extra_bed_person_type','p_room_lease_tokens']);
    perform platform_private.require_accommodation_operation_leases(p_actor_device_id,(p_args->>'p_conference_id')::uuid,'remove_conference_accommodation',jsonb_build_object('p_occupancy_id',p_args->>'p_occupancy_id','p_room_lease_tokens',p_args->'p_room_lease_tokens'));
    return public.replace_conference_accommodation(p_actor_device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_conference_id')::uuid,(p_args->>'p_occupancy_id')::uuid,(p_args->>'p_expected_revision')::bigint,(p_args->>'p_replacement_participation_id')::uuid,(p_args->>'p_effective_day')::integer,p_args->>'p_bed_type',p_args->>'p_extra_bed_person_type');
  elsif p_operation='move_conference_accommodation' then$body$;
  if position(marker in d)=0 then raise exception 'ACCOMMODATION_REPLACEMENT_DISPATCH_MARKER_MISSING';end if;
  execute replace(d,marker,branch);
 end if;
end $dispatch$;

revoke all on function public.replace_conference_accommodation(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.replace_conference_accommodation(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text) to service_role;
comment on function public.replace_conference_accommodation(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text) is
 'Atomic, idempotent canonical occupant replacement. The old stay ends at effective_day and the replacement begins that day in the same room.';

commit;
