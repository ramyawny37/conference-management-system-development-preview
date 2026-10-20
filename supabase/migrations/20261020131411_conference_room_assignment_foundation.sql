-- Applied to Conference Development as migration 20261020131411.
begin;

create table public.conference_room_assignments(
 id uuid primary key default extensions.gen_random_uuid(),
 conference_id uuid not null references public.conferences(id) on delete restrict,
 house_assignment_id uuid not null references public.conference_house_assignments(id) on delete restrict,
 house_id uuid not null references public.conference_accommodation_houses(id) on delete restrict,
 room_id uuid not null references public.conference_accommodation_rooms(id) on delete restrict,
 revision bigint not null default 1 check(revision>=1),
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id) on delete restrict,
 updated_by uuid not null references platform.profiles(user_id) on delete restrict,
 unique(conference_id,room_id),
 unique(conference_id,id),
 foreign key(conference_id,house_id) references public.conference_house_assignments(conference_id,house_id) on delete restrict
);
create index conference_room_assignments_house_idx on public.conference_room_assignments(conference_id,house_id,room_id);
create index conference_room_assignments_room_idx on public.conference_room_assignments(room_id,conference_id);
alter table public.conference_room_assignments enable row level security;
alter table public.conference_room_assignments force row level security;
revoke all on table public.conference_room_assignments from public,anon,authenticated,service_role;

-- Preserve the effective scope of any pre-existing house assignment.
insert into public.conference_room_assignments(conference_id,house_assignment_id,house_id,room_id,created_by,updated_by)
select a.conference_id,a.id,a.house_id,r.id,a.created_by,a.updated_by
from public.conference_house_assignments a
join public.conference_accommodation_floors f on f.house_id=a.house_id
join public.conference_accommodation_rooms r on r.floor_id=f.id
on conflict(conference_id,room_id) do nothing;

create or replace function platform_private.conference_room_is_assigned(p_conference uuid,p_room uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conference_room_assignments a where a.conference_id=p_conference and a.room_id=p_room)
$$;

create or replace function platform_private.assert_conference_room_period_available(
 p_conference uuid,p_room uuid,p_start date,p_end date
) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_start is null or p_end is null or p_end<p_start then raise exception 'CONFERENCE_CORE_ARGUMENT_INVALID' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('conference-room-period:'||p_room::text,0));
 if exists(
  select 1 from public.conference_room_assignments a
  join public.conferences c on c.id=a.conference_id
  where a.room_id=p_room and a.conference_id<>p_conference and c.deleted_at is null
    and p_start<=c.end_date and c.start_date<=p_end
 ) then raise exception 'ROOM_CONFERENCE_PERIOD_OVERLAP' using errcode='23P01';end if;
end $$;

create or replace function platform_private.guard_conference_room_period_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare assigned record;
begin
 if new.start_date is not distinct from old.start_date and new.end_date is not distinct from old.end_date then return new;end if;
 for assigned in select room_id from public.conference_room_assignments where conference_id=new.id order by room_id loop
  perform platform_private.assert_conference_room_period_available(new.id,assigned.room_id,new.start_date,new.end_date);
 end loop;
 return new;
end $$;
drop trigger if exists guard_conference_room_period_change on public.conferences;
create trigger guard_conference_room_period_change before update of start_date,end_date on public.conferences
for each row execute function platform_private.guard_conference_room_period_change();

create or replace function public.assign_conference_house(p_device uuid,p_operation_id uuid,p_conference uuid,p_house uuid,p_assign boolean,p_expected bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;auth_id uuid;row public.conference_house_assignments%rowtype;result jsonb;prior jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);actor:=(context->>'actorUserId')::uuid;auth_id:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('conference-house:'||p_conference::text||':'||p_house::text,0));
 select new_values into prior from platform.audit_events where actor_user_id=actor and operation_id=p_operation_id and action in('conference.house.assigned','conference.house.unassigned') limit 1;
 if prior is not null then return prior||jsonb_build_object('status','duplicate');end if;
 if p_assign then
  if not exists(select 1 from public.conference_accommodation_houses where id=p_house and is_active) then raise exception 'HOUSE_NOT_AVAILABLE' using errcode='P0002';end if;
  insert into public.conference_house_assignments(conference_id,house_id,created_by,updated_by) values(p_conference,p_house,actor,actor) on conflict(conference_id,house_id) do nothing returning * into row;
  if row.id is null then select * into row from public.conference_house_assignments where conference_id=p_conference and house_id=p_house;return jsonb_build_object('status','duplicate','assignmentId',row.id,'conferenceId',p_conference,'houseId',p_house,'revision',row.revision,'assigned',true);end if;
 else
  select * into row from public.conference_house_assignments where conference_id=p_conference and house_id=p_house for update;
  if not found then return jsonb_build_object('status','duplicate','houseId',p_house);end if;
  if p_expected is distinct from row.revision then raise exception 'HOUSE_ASSIGNMENT_REVISION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from public.conference_room_assignments where conference_id=p_conference and house_id=p_house) then raise exception 'HOUSE_ASSIGNMENT_HAS_ROOMS' using errcode='55000';end if;
  delete from public.conference_house_assignments where id=row.id;
 end if;
 result:=jsonb_build_object('status','success','assignmentId',row.id,'conferenceId',p_conference,'houseId',p_house,'revision',row.revision,'assigned',p_assign);
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,new_values,metadata,operation_id,source) values(actor,auth_id,'platform','conference',case when p_assign then 'conference.house.assigned' else 'conference.house.unassigned' end,'conference_house_assignment',row.id,'resource',p_conference::text,result,jsonb_build_object('permissionKey','conference.accommodation.manage'),p_operation_id,'rpc');
 return result;
end $$;

create or replace function public.assign_conference_room(p_device uuid,p_operation_id uuid,p_conference uuid,p_room uuid,p_assign boolean,p_expected bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;auth_id uuid;conf public.conferences%rowtype;house uuid;house_assignment public.conference_house_assignments%rowtype;row public.conference_room_assignments%rowtype;prior jsonb;result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);actor:=(context->>'actorUserId')::uuid;auth_id:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 select new_values into prior from platform.audit_events where actor_user_id=actor and operation_id=p_operation_id and action in('conference.room.assigned','conference.room.unassigned') limit 1;
 if prior is not null then return prior||jsonb_build_object('status','duplicate');end if;
 select c.* into conf from public.conferences c where c.id=p_conference and c.deleted_at is null for key share;if not found then raise exception 'CONFERENCE_CORE_NOT_FOUND' using errcode='P0002';end if;
 select f.house_id into house from public.conference_accommodation_rooms r join public.conference_accommodation_floors f on f.id=r.floor_id where r.id=p_room;if house is null then raise exception 'ROOM_NOT_FOUND' using errcode='P0002';end if;
 perform platform_private.assert_conference_room_period_available(p_conference,p_room,conf.start_date,conf.end_date);
 if p_assign then
  select * into house_assignment from public.conference_house_assignments where conference_id=p_conference and house_id=house for update;
  if not found then raise exception 'HOUSE_ASSIGNMENT_REQUIRED' using errcode='55000';end if;
  insert into public.conference_room_assignments(conference_id,house_assignment_id,house_id,room_id,created_by,updated_by) values(p_conference,house_assignment.id,house,p_room,actor,actor) on conflict(conference_id,room_id) do nothing returning * into row;
  if row.id is null then select * into row from public.conference_room_assignments where conference_id=p_conference and room_id=p_room;return jsonb_build_object('status','duplicate','roomAssignmentId',row.id,'roomId',p_room,'assigned',true,'revision',row.revision);end if;
 else
  select * into row from public.conference_room_assignments where conference_id=p_conference and room_id=p_room for update;
  if not found then return jsonb_build_object('status','duplicate','roomId',p_room,'assigned',false);end if;
  if p_expected is distinct from row.revision then raise exception 'ROOM_ASSIGNMENT_REVISION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from public.conference_accommodation_occupancies where conference_id=p_conference and room_id=p_room) then raise exception 'ROOM_ASSIGNMENT_HAS_OCCUPANCIES' using errcode='55000';end if;
  delete from public.conference_room_assignments where id=row.id;
 end if;
 result:=jsonb_build_object('status','success','roomAssignmentId',row.id,'conferenceId',p_conference,'houseId',house,'roomId',p_room,'revision',row.revision,'assigned',p_assign);
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,new_values,metadata,operation_id,source) values(actor,auth_id,'platform','conference',case when p_assign then 'conference.room.assigned' else 'conference.room.unassigned' end,'conference_room_assignment',row.id,'resource',p_conference::text,result,jsonb_build_object('permissionKey','conference.accommodation.manage','roomId',p_room),p_operation_id,'rpc');
 return result;
end $$;

create or replace function public.list_conference_house_room_options(p_device uuid,p_conference uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb;conf public.conferences%rowtype;result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.view',false);
 select * into conf from public.conferences where id=p_conference and deleted_at is null;if not found then raise exception 'CONFERENCE_CORE_NOT_FOUND' using errcode='P0002';end if;
 select coalesce(jsonb_agg(jsonb_build_object('houseId',h.id,'name',h.name,'isActive',h.is_active,'houseAssigned',ha.id is not null,'houseAssignmentRevision',ha.revision,'floors',(select coalesce(jsonb_agg(jsonb_build_object('floorId',f.id,'name',f.name,'rooms',(select coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomNumber',r.room_number,'assigned',mine.id is not null,'assignmentRevision',mine.revision,'available',mine.id is not null or blocker.conference_id is null,'unavailableReason',case when mine.id is not null or blocker.conference_id is null then null else 'ROOM_CONFERENCE_PERIOD_OVERLAP' end) order by r.position,r.id),'[]') from public.conference_accommodation_rooms r left join public.conference_room_assignments mine on mine.room_id=r.id and mine.conference_id=p_conference left join lateral(select a.conference_id from public.conference_room_assignments a join public.conferences c on c.id=a.conference_id where a.room_id=r.id and a.conference_id<>p_conference and c.deleted_at is null and conf.start_date<=c.end_date and c.start_date<=conf.end_date limit 1) blocker on true where r.floor_id=f.id)) order by f.position,f.id),'[]') from public.conference_accommodation_floors f where f.house_id=h.id)) order by h.position,h.id),'[]') into result from public.conference_accommodation_houses h left join public.conference_house_assignments ha on ha.house_id=h.id and ha.conference_id=p_conference;
 return jsonb_build_object('conferenceId',p_conference,'startDate',conf.start_date,'endDate',conf.end_date,'houses',result);
end $$;

create or replace function public.get_conference_accommodation(p_device uuid,p_conference uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb;result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.view',false);
 select coalesce(jsonb_agg(jsonb_build_object('assignmentId',a.id,'assignmentRevision',a.revision,'houseId',h.id,'name',h.name,'description',h.description,'position',h.position,'revision',h.revision,'floors',(select coalesce(jsonb_agg(jsonb_build_object('floorId',f.id,'name',f.name,'position',f.position,'revision',f.revision,'rooms',(select coalesce(jsonb_agg(jsonb_build_object('roomAssignmentId',ra.id,'roomAssignmentRevision',ra.revision,'roomId',r.id,'roomNumber',r.room_number,'baseCapacity',r.base_capacity,'extraBedCapacity',r.extra_bed_capacity,'notes',r.notes,'isClosed',r.is_closed,'closedDay',r.closed_day,'position',r.position,'revision',r.revision,'occupancies',(select coalesce(jsonb_agg(jsonb_build_object('occupancyId',o.id,'revision',o.revision,'arrivalDay',o.arrival_day,'leaveDay',o.leave_day,'bedType',o.bed_type,'extraBedPersonType',o.extra_bed_person_type,'participationId',p.id,'participationStatus',p.status,'person',jsonb_build_object('personId',pe.id,'fullName',pe.full_name,'phone',pe.phone,'gender',pe.gender,'dateOfBirth',pe.date_of_birth,'church',pe.church)) order by pe.full_name,o.id),'[]') from public.conference_accommodation_occupancies o join public.conference_participations p on p.id=o.participation_id join platform.people pe on pe.id=p.person_id where o.room_id=r.id and o.conference_id=p_conference)) order by r.position,r.id),'[]') from public.conference_room_assignments ra join public.conference_accommodation_rooms r on r.id=ra.room_id where ra.conference_id=p_conference and ra.house_id=h.id and r.floor_id=f.id)) order by f.position,f.id),'[]') from public.conference_accommodation_floors f where f.house_id=h.id and exists(select 1 from public.conference_room_assignments ra where ra.conference_id=p_conference and ra.house_id=h.id and ra.room_id in(select rr.id from public.conference_accommodation_rooms rr where rr.floor_id=f.id)))) order by h.position,h.id),'[]') into result from public.conference_house_assignments a join public.conference_accommodation_houses h on h.id=a.house_id where a.conference_id=p_conference and exists(select 1 from public.conference_room_assignments ra where ra.conference_id=p_conference and ra.house_id=h.id);
 return jsonb_build_object('conferenceId',p_conference,'houses',result,'pricing',platform_private.conference_accommodation_pricing_projection(p_conference));
end $$;

do $dispatch$
declare d text;marker text;replacement text;
begin
 d:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
 marker:='  elsif p_operation=''get_conference_accommodation'' then';
 if position('p_operation=''assign_conference_room''' in d)=0 then
  replacement=$body$  elsif p_operation='list_conference_house_room_options' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_conference_id']);
    return public.list_conference_house_room_options(p_actor_device_id,(p_args->>'p_conference_id')::uuid);
  elsif p_operation='assign_conference_room' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_room_id','p_assign','p_expected_revision']);
    return public.assign_conference_room(p_actor_device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_conference_id')::uuid,(p_args->>'p_room_id')::uuid,(p_args->>'p_assign')::boolean,nullif(p_args->>'p_expected_revision','')::bigint);
  elsif p_operation='get_conference_accommodation' then$body$;
  if position(marker in d)=0 then raise exception 'CONFERENCE_ROOM_DISPATCH_MARKER_MISSING';end if;
  execute replace(d,marker,replacement);
 end if;
end $dispatch$;

revoke all on function platform_private.assert_conference_room_period_available(uuid,uuid,date,date),platform_private.guard_conference_room_period_change(),public.assign_conference_room(uuid,uuid,uuid,uuid,boolean,bigint),public.list_conference_house_room_options(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assign_conference_room(uuid,uuid,uuid,uuid,boolean,bigint),public.list_conference_house_room_options(uuid,uuid) to service_role;
comment on table public.conference_room_assignments is 'Authoritative Conference allocation of permanent central rooms. Inclusive date overlap is rejected per room.';
comment on function public.assign_conference_room(uuid,uuid,uuid,uuid,boolean,bigint) is 'Device-session guarded, idempotent and audited room allocation mutation.';
commit;
