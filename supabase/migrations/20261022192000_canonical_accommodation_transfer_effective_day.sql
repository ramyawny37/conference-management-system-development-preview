begin;

create or replace function public.move_conference_accommodation(
  p_device uuid,p_conference uuid,p_occupancy uuid,p_expected bigint,p_room uuid,
  p_arrival integer,p_leave integer,p_bed text,p_extra_type text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;device_authorization uuid;participation public.conference_participations%rowtype;
 current public.conference_accommodation_occupancies%rowtype;destination public.conference_accommodation_rooms%rowtype;
 days integer;updated public.conference_accommodation_occupancies%rowtype;created public.conference_accommodation_occupancies%rowtype;historical boolean;effective_day integer;conference_start date;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);
 actor:=(context->>'actorUserId')::uuid;device_authorization:=platform_private.validated_phase1c_device_authorization(actor,p_device);days:=platform_private.conference_accommodation_duration(p_conference);
 if p_arrival<1 or p_arrival>days or (p_leave is not null and (p_leave<=p_arrival or p_leave>days+1)) then raise exception 'ACCOMMODATION_STAY_INVALID' using errcode='22023';end if;
 select * into current from public.conference_accommodation_occupancies where id=p_occupancy and conference_id=p_conference;
 if not found then raise exception 'ACCOMMODATION_OCCUPANCY_NOT_FOUND' using errcode='P0002';end if;
 select * into participation from public.conference_participations where id=current.participation_id and conference_id=p_conference for update;
 if not found or participation.status<>'active' then raise exception 'ACTIVE_CONFERENCE_PARTICIPATION_REQUIRED' using errcode='42501';end if;
 perform 1 from public.conference_accommodation_rooms where id in(current.room_id,p_room) order by id for update;
 select * into current from public.conference_accommodation_occupancies where id=p_occupancy and participation_id=participation.id for update;
 if current.revision<>p_expected then raise exception 'ACCOMMODATION_REVISION_CONFLICT' using errcode='40001';end if;
 select * into destination from public.conference_accommodation_rooms where id=p_room and platform_private.conference_room_is_assigned(p_conference,id);
 if not found then raise exception 'ACCOMMODATION_ROOM_NOT_FOUND' using errcode='P0002';end if;
 if destination.is_closed and (destination.closed_day is null or p_arrival>=destination.closed_day or coalesce(p_leave,days+1)>destination.closed_day) then raise exception 'ACCOMMODATION_ROOM_UNAVAILABLE' using errcode='55000';end if;
 select start_date into conference_start from public.conferences where id=p_conference;
 effective_day:=greatest(1,least(days+1,(current_date-conference_start+1)::integer));
 if p_arrival<effective_day and current.arrival_day<effective_day and p_arrival<>current.arrival_day then
   raise exception 'ACCOMMODATION_HISTORICAL_TRANSFER_DAY_IMMUTABLE' using errcode='55000';
 end if;
 historical:=p_arrival>current.arrival_day and current.arrival_day<effective_day;
 -- A future-only reservation correction must not invent an earlier room-night segment.
 if not historical and current.arrival_day>=effective_day then
   p_arrival:=current.arrival_day;
 end if;
 if historical and p_arrival>=coalesce(current.leave_day,days+1) then raise exception 'ACCOMMODATION_TRANSFER_DAY_OUTSIDE_STAY' using errcode='22023';end if;
 if not platform_private.conference_room_has_capacity(p_conference,p_room,p_bed,p_arrival,p_leave,case when historical then null else p_occupancy end) then raise exception 'ACCOMMODATION_ROOM_CAPACITY_EXCEEDED' using errcode='55000';end if;
 if historical then
   update public.conference_accommodation_occupancies set leave_day=p_arrival,revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=current.id returning * into updated;
   insert into public.conference_accommodation_occupancies(conference_id,room_id,participation_id,arrival_day,leave_day,bed_type,extra_bed_person_type,created_by,updated_by)
   values(p_conference,p_room,current.participation_id,p_arrival,p_leave,p_bed,p_extra_type,actor,actor) returning * into created;
 else
   update public.conference_accommodation_occupancies set room_id=p_room,arrival_day=p_arrival,leave_day=p_leave,bed_type=p_bed,extra_bed_person_type=p_extra_type,revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=current.id returning * into updated;
   created:=updated;
 end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,source)
 values(actor,device_authorization,'platform','conference','conference.accommodation.moved','accommodation_occupancy',created.id,'platform',to_jsonb(current),to_jsonb(created),jsonb_build_object('conferenceId',p_conference,'participationId',current.participation_id,'oldRoomId',current.room_id,'newRoomId',p_room,'previousOccupancyId',case when historical then current.id else null end,'historicalSegmentPreserved',historical,'permissionKey','conference.accommodation.manage','authoritySource',context->>'authoritySource','grantId',context->'grantId'),'rpc');
 return jsonb_build_object('occupancyId',created.id,'revision',created.revision,'roomId',created.room_id,'previousOccupancyId',case when historical then current.id else null end,'historicalSegmentPreserved',historical,'arrivalDay',created.arrival_day,'leaveDay',created.leave_day);
exception when exclusion_violation then raise exception 'ACCOMMODATION_STAY_OVERLAP' using errcode='23P01';
end $$;

commit;
