begin;

create extension if not exists btree_gist with schema extensions;

alter table public.conference_accommodation_occupancies
  drop constraint if exists conference_accommodation_occupancies_participation_id_key;

do $constraint_reconciliation$
declare existing record;definition text;
begin
 select c.contype,pg_get_constraintdef(c.oid,true) into existing
 from pg_constraint c
 where c.conrelid='public.conference_accommodation_occupancies'::regclass
   and c.conname='conference_accommodation_occupancies_participation_period_excl';
 if found then
   definition:=existing.pg_get_constraintdef;
   if existing.contype<>'x'
      or position('participation_id WITH =' in definition)=0
      or position('int4range(arrival_day, COALESCE(leave_day, 2147483647)' in definition)=0
      or position('WITH &&' in definition)=0 then
     raise exception 'ACCOMMODATION_STAY_EXCLUSION_DRIFT: %',definition using errcode='55000';
   end if;
 else
   alter table public.conference_accommodation_occupancies
     add constraint conference_accommodation_occupancies_participation_period_excl
     exclude using gist (
       participation_id with =,
       int4range(arrival_day,coalesce(leave_day,2147483647),'[)') with &&
     );
 end if;
end $constraint_reconciliation$;

create index if not exists conference_accommodation_occupancies_participation_period_idx
  on public.conference_accommodation_occupancies(participation_id,arrival_day,leave_day,id);

create or replace function platform_private.conference_room_has_capacity(
  p_conference uuid,p_room uuid,p_bed text,p_arrival integer,p_leave integer,
  p_exclude_occupancy uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select not exists(
    select 1
    from generate_series(p_arrival,coalesce(p_leave,platform_private.conference_accommodation_duration(p_conference)+1)-1) night(day)
    cross join lateral (
      select count(*)::integer used
      from public.conference_accommodation_occupancies o
      where o.conference_id=p_conference and o.room_id=p_room and o.bed_type=p_bed
        and o.id is distinct from p_exclude_occupancy
        and o.arrival_day<=night.day and coalesce(o.leave_day,platform_private.conference_accommodation_duration(p_conference)+1)>night.day
    ) occupancy
    join public.conference_accommodation_rooms room on room.id=p_room
    where occupancy.used >= case when p_bed='base' then room.base_capacity else room.extra_bed_capacity end
  )
$$;

create or replace function public.assign_conference_accommodation(
  p_device uuid,p_conference uuid,p_room uuid,p_participation uuid,
  p_arrival integer,p_leave integer,p_bed text,p_extra_type text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;device_authorization uuid;participation public.conference_participations%rowtype;
 room public.conference_accommodation_rooms%rowtype;days integer;row public.conference_accommodation_occupancies%rowtype;result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);
 actor:=(context->>'actorUserId')::uuid;device_authorization:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 days:=platform_private.conference_accommodation_duration(p_conference);
 if p_arrival<1 or p_arrival>days or (p_leave is not null and (p_leave<=p_arrival or p_leave>days+1)) then raise exception 'ACCOMMODATION_STAY_INVALID' using errcode='22023';end if;
 select * into participation from public.conference_participations where id=p_participation and conference_id=p_conference for update;
 if not found or participation.status<>'active' then raise exception 'ACTIVE_CONFERENCE_PARTICIPATION_REQUIRED' using errcode='42501';end if;
 select * into room from public.conference_accommodation_rooms where id=p_room and platform_private.conference_room_is_assigned(p_conference,id) for update;
 if not found then raise exception 'ACCOMMODATION_ROOM_NOT_FOUND' using errcode='P0002';end if;
 if room.is_closed and (room.closed_day is null or p_arrival>=room.closed_day or coalesce(p_leave,days+1)>room.closed_day) then raise exception 'ACCOMMODATION_ROOM_UNAVAILABLE' using errcode='55000';end if;
 if not platform_private.conference_room_has_capacity(p_conference,p_room,p_bed,p_arrival,p_leave,null) then raise exception 'ACCOMMODATION_ROOM_CAPACITY_EXCEEDED' using errcode='55000';end if;
 insert into public.conference_accommodation_occupancies(conference_id,room_id,participation_id,arrival_day,leave_day,bed_type,extra_bed_person_type,created_by,updated_by)
 values(p_conference,p_room,p_participation,p_arrival,p_leave,p_bed,p_extra_type,actor,actor) returning * into row;
 result:=jsonb_build_object('occupancyId',row.id,'revision',row.revision,'roomId',row.room_id,'participationId',row.participation_id,'arrivalDay',row.arrival_day,'leaveDay',row.leave_day);
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,new_values,metadata,source)
 values(actor,device_authorization,'platform','conference','conference.accommodation.assigned','accommodation_occupancy',row.id,'platform',to_jsonb(row),jsonb_build_object('conferenceId',p_conference,'participationId',p_participation,'permissionKey','conference.accommodation.manage','authoritySource',context->>'authoritySource','grantId',context->'grantId'),'rpc');
 return result;
exception when exclusion_violation then raise exception 'ACCOMMODATION_STAY_OVERLAP' using errcode='23P01';
end $$;

create or replace function public.move_conference_accommodation(
  p_device uuid,p_conference uuid,p_occupancy uuid,p_expected bigint,p_room uuid,
  p_arrival integer,p_leave integer,p_bed text,p_extra_type text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;device_authorization uuid;participation public.conference_participations%rowtype;
 current public.conference_accommodation_occupancies%rowtype;destination public.conference_accommodation_rooms%rowtype;
 days integer;updated public.conference_accommodation_occupancies%rowtype;created public.conference_accommodation_occupancies%rowtype;historical boolean;
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
 historical:=p_arrival>current.arrival_day;
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

create or replace function platform_private.cleanup_conference_accommodation_for_participation(
 p_participation_id uuid,p_actor_user_id uuid,p_device_authorization_id uuid,p_authority_context jsonb,p_cause text,p_operation_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare item public.conference_accommodation_occupancies%rowtype;first_changed uuid;effective_day integer;conference_start date;conference_days integer;
begin
 if p_cause not in('participation_apologized','participation_deleted') then raise exception 'PARTICIPATION_ACCOMMODATION_CLEANUP_CAUSE_INVALID' using errcode='22023';end if;
 select c.start_date,(c.end_date-c.start_date+1) into conference_start,conference_days from public.conference_participations p join public.conferences c on c.id=p.conference_id where p.id=p_participation_id;
 effective_day:=greatest(1,least(conference_days+1,current_date-conference_start+1));
 for item in select * from public.conference_accommodation_occupancies where participation_id=p_participation_id order by arrival_day,id for update loop
   if item.arrival_day>=effective_day then
     delete from public.conference_accommodation_occupancies where id=item.id;
   elsif coalesce(item.leave_day,conference_days+1)>effective_day then
     update public.conference_accommodation_occupancies set leave_day=effective_day,revision=revision+1,updated_at=statement_timestamp(),updated_by=p_actor_user_id where id=item.id;
   else continue;
   end if;
   first_changed:=coalesce(first_changed,item.id);
   insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
   values(p_actor_user_id,p_device_authorization_id,'platform','conference','conference.accommodation.participation_cleanup','accommodation_occupancy',item.id,'platform',to_jsonb(item),null,jsonb_build_object('conferenceId',item.conference_id,'participationId',p_participation_id,'occupancyId',item.id,'previousRoomId',item.room_id,'effectiveDay',effective_day,'cause',p_cause,'permissionKey','conference.people.manage','authoritySource',p_authority_context->>'authoritySource','grantId',p_authority_context->'grantId'),p_operation_id,'rpc');
 end loop;
 return first_changed;
end $$;

revoke all on function platform_private.conference_room_has_capacity(uuid,uuid,text,integer,integer,uuid) from public,anon,authenticated,service_role;
comment on table public.conference_accommodation_occupancies is 'Canonical half-open Accommodation stay segments. Multiple non-overlapping periods per participation preserve room history.';

commit;
