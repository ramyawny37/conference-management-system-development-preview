begin;

-- The existing accommodation hierarchy becomes the one permanent house directory.
-- Conference-specific state is held only by assignments and occupancies.
lock table public.conference_accommodation_houses,
  public.conference_accommodation_floors,
  public.conference_accommodation_rooms,
  public.conference_accommodation_occupancies in access exclusive mode;

insert into platform.permissions(
 code,domain,description,is_system,status,allowed_scope_mode,
 allowed_resource_type,sensitive_mutation
) values
 ('conference.houses.view','conference','View the permanent central conference house directory.',false,'active','module',null,false),
 ('conference.houses.manage','conference','Manage permanent houses, floors and rooms.',false,'active','module',null,true)
on conflict(code) do update set domain='conference',description=excluded.description,
 status='active',allowed_scope_mode='module',allowed_resource_type=null,
 sensitive_mutation=excluded.sensitive_mutation;

alter table public.conference_accommodation_houses
 add column is_active boolean not null default true;

create table public.conference_house_assignments(
 id uuid primary key default extensions.gen_random_uuid(),
 conference_id uuid not null references public.conferences(id) on delete restrict,
 house_id uuid not null references public.conference_accommodation_houses(id) on delete restrict,
 revision bigint not null default 1 check(revision>=1),
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 created_by uuid not null references platform.profiles(user_id) on delete restrict,
 updated_by uuid not null references platform.profiles(user_id) on delete restrict,
 unique(conference_id,house_id),unique(conference_id,id)
);

insert into public.conference_house_assignments(conference_id,house_id,created_by,updated_by)
select conference_id,id,created_by,updated_by from public.conference_accommodation_houses;

alter table public.conference_accommodation_occupancies
 drop constraint conference_accommodation_occupancies_room_fk;
alter table public.conference_accommodation_pricing_room_exclusions
 drop constraint conference_accommodation_pricing_room_exclusions_room_fk;
alter table public.conference_accommodation_rooms
 drop constraint conference_accommodation_rooms_floor_fk;
alter table public.conference_accommodation_floors
 drop constraint conference_accommodation_floors_house_fk;
alter table public.conference_accommodation_floors
 add constraint conference_accommodation_floors_house_fk foreign key(house_id)
 references public.conference_accommodation_houses(id) on delete restrict;
alter table public.conference_accommodation_rooms
 add constraint conference_accommodation_rooms_floor_fk foreign key(floor_id)
 references public.conference_accommodation_floors(id) on delete restrict;
alter table public.conference_accommodation_occupancies
 add constraint conference_accommodation_occupancies_room_fk foreign key(room_id)
 references public.conference_accommodation_rooms(id) on delete restrict;
alter table public.conference_accommodation_pricing_room_exclusions
 add constraint conference_accommodation_pricing_room_exclusions_room_fk foreign key(room_id)
 references public.conference_accommodation_rooms(id) on delete cascade;

drop index if exists public.conference_accommodation_houses_list_idx;
drop index if exists public.conference_accommodation_floors_list_idx;
drop index if exists public.conference_accommodation_rooms_list_idx;
alter table public.conference_accommodation_houses drop constraint if exists conference_accommodation_houses_conference_id_id_key;
alter table public.conference_accommodation_floors drop constraint if exists conference_accommodation_floors_conference_id_id_key;
alter table public.conference_accommodation_rooms drop constraint if exists conference_accommodation_rooms_conference_id_id_key;
alter table public.conference_accommodation_rooms drop column conference_id;
alter table public.conference_accommodation_floors drop column conference_id;
alter table public.conference_accommodation_houses drop column conference_id;
create index conference_accommodation_houses_list_idx on public.conference_accommodation_houses(is_active desc,position,id);
create index conference_accommodation_floors_list_idx on public.conference_accommodation_floors(house_id,position,id);
create index conference_accommodation_rooms_list_idx on public.conference_accommodation_rooms(floor_id,position,id);
create index conference_house_assignments_list_idx on public.conference_house_assignments(conference_id,house_id);
alter table public.conference_house_assignments enable row level security;
alter table public.conference_house_assignments force row level security;
revoke all on table public.conference_house_assignments from public,anon,authenticated,service_role;

create or replace function platform_private.require_conference_house_directory_context(p_device uuid,p_permission text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb; actor uuid;
begin
 if p_permission not in('conference.houses.view','conference.houses.manage') then raise exception 'HOUSE_DIRECTORY_ARGUMENT_INVALID' using errcode='22023'; end if;
 context:=public.require_effective_module_permission(p_device,'conference',p_permission,null,null);
 actor:=(context->>'actorUserId')::uuid;
 if platform_private.validated_phase1c_device_authorization(actor,p_device) is null then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
 return context;
end $$;

create or replace function public.list_conference_houses(p_device uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb; result jsonb;
begin
 context:=platform_private.require_conference_house_directory_context(p_device,'conference.houses.view');
 select coalesce(jsonb_agg(jsonb_build_object('houseId',h.id,'name',h.name,'description',h.description,'position',h.position,'isActive',h.is_active,'revision',h.revision,'floors',
  (select coalesce(jsonb_agg(jsonb_build_object('floorId',f.id,'name',f.name,'position',f.position,'revision',f.revision,'rooms',
   (select coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomNumber',r.room_number,'baseCapacity',r.base_capacity,'extraBedCapacity',r.extra_bed_capacity,'notes',r.notes,'position',r.position,'revision',r.revision) order by r.position,r.id),'[]') from public.conference_accommodation_rooms r where r.floor_id=f.id)
  ) order by f.position,f.id),'[]') from public.conference_accommodation_floors f where f.house_id=h.id)
 ) order by h.position,h.id),'[]') into result from public.conference_accommodation_houses h;
 return jsonb_build_object('houses',result);
end $$;

create or replace function public.mutate_conference_house_directory(p_device uuid,p_operation_id uuid,p_operation text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;auth_id uuid;entity_id uuid;expected bigint;old_row jsonb;result jsonb;parent_id uuid;
begin
 if p_operation_id is null or p_operation not in('create_house','update_house','deactivate_house','create_floor','update_floor','delete_floor','create_room','update_room','delete_room') then raise exception 'HOUSE_DIRECTORY_ARGUMENT_INVALID' using errcode='22023'; end if;
 context:=platform_private.require_conference_house_directory_context(p_device,'conference.houses.manage');actor:=(context->>'actorUserId')::uuid;auth_id:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':house-directory:'||p_operation_id::text,0));
 select new_values into result from platform.audit_events where actor_user_id=actor and operation_id=p_operation_id and action='conference.houses.'||p_operation limit 1;
 if result is not null then return result||jsonb_build_object('status','duplicate'); end if;
 if p_operation='create_house' then
  insert into public.conference_accommodation_houses(name,description,position,created_by,updated_by) values(btrim(p_args->>'name'),nullif(btrim(p_args->>'description'),''),coalesce((p_args->>'position')::integer,0),actor,actor) returning id into entity_id;
 elsif p_operation in('update_house','deactivate_house') then
  entity_id:=(p_args->>'houseId')::uuid;expected:=(p_args->>'expectedRevision')::bigint;select to_jsonb(h) into old_row from public.conference_accommodation_houses h where h.id=entity_id for update;if old_row is null then raise exception 'HOUSE_NOT_FOUND' using errcode='P0002';end if;if (old_row->>'revision')::bigint<>expected then raise exception 'HOUSE_REVISION_CONFLICT' using errcode='40001';end if;
  if p_operation='deactivate_house' then update public.conference_accommodation_houses set is_active=false,revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=entity_id;else update public.conference_accommodation_houses set name=btrim(p_args->>'name'),description=nullif(btrim(p_args->>'description'),''),position=coalesce((p_args->>'position')::integer,position),is_active=coalesce((p_args->>'isActive')::boolean,is_active),revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=entity_id;end if;
 elsif p_operation='create_floor' then parent_id:=(p_args->>'houseId')::uuid;if not exists(select 1 from public.conference_accommodation_houses where id=parent_id) then raise exception 'HOUSE_NOT_FOUND' using errcode='P0002';end if;insert into public.conference_accommodation_floors(house_id,name,position,created_by,updated_by) values(parent_id,btrim(p_args->>'name'),coalesce((p_args->>'position')::integer,0),actor,actor) returning id into entity_id;
 elsif p_operation in('update_floor','delete_floor') then entity_id:=(p_args->>'floorId')::uuid;expected:=(p_args->>'expectedRevision')::bigint;select to_jsonb(f) into old_row from public.conference_accommodation_floors f where f.id=entity_id for update;if old_row is null then raise exception 'FLOOR_NOT_FOUND' using errcode='P0002';end if;if (old_row->>'revision')::bigint<>expected then raise exception 'HOUSE_REVISION_CONFLICT' using errcode='40001';end if;if p_operation='delete_floor' then if exists(select 1 from public.conference_accommodation_rooms where floor_id=entity_id) then raise exception 'FLOOR_NOT_EMPTY' using errcode='55000';end if;delete from public.conference_accommodation_floors where id=entity_id;else update public.conference_accommodation_floors set name=btrim(p_args->>'name'),position=coalesce((p_args->>'position')::integer,position),revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=entity_id;end if;
 elsif p_operation='create_room' then parent_id:=(p_args->>'floorId')::uuid;if not exists(select 1 from public.conference_accommodation_floors where id=parent_id) then raise exception 'FLOOR_NOT_FOUND' using errcode='P0002';end if;insert into public.conference_accommodation_rooms(floor_id,room_number,base_capacity,extra_bed_capacity,notes,position,created_by,updated_by) values(parent_id,btrim(p_args->>'roomNumber'),(p_args->>'baseCapacity')::integer,coalesce((p_args->>'extraBedCapacity')::integer,0),nullif(btrim(p_args->>'notes'),''),coalesce((p_args->>'position')::integer,0),actor,actor) returning id into entity_id;
 else entity_id:=(p_args->>'roomId')::uuid;expected:=(p_args->>'expectedRevision')::bigint;select to_jsonb(r) into old_row from public.conference_accommodation_rooms r where r.id=entity_id for update;if old_row is null then raise exception 'ROOM_NOT_FOUND' using errcode='P0002';end if;if (old_row->>'revision')::bigint<>expected then raise exception 'HOUSE_REVISION_CONFLICT' using errcode='40001';end if;if p_operation='delete_room' then if exists(select 1 from public.conference_accommodation_occupancies where room_id=entity_id) then raise exception 'ROOM_HAS_OCCUPANCIES' using errcode='55000';end if;delete from public.conference_accommodation_rooms where id=entity_id;else update public.conference_accommodation_rooms set room_number=btrim(p_args->>'roomNumber'),base_capacity=(p_args->>'baseCapacity')::integer,extra_bed_capacity=coalesce((p_args->>'extraBedCapacity')::integer,0),notes=nullif(btrim(p_args->>'notes'),''),position=coalesce((p_args->>'position')::integer,position),revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=entity_id;end if;
 end if;
 result:=jsonb_build_object('status','success','entityId',entity_id,'operationId',p_operation_id);
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source) values(actor,auth_id,'platform','conference','conference.houses.'||p_operation,'conference_house_directory',entity_id,'platform',old_row,result,jsonb_build_object('permissionKey','conference.houses.manage','deviceId',p_device),p_operation_id,'rpc');return result;
end $$;

create or replace function public.assign_conference_house(p_device uuid,p_operation_id uuid,p_conference uuid,p_house uuid,p_assign boolean,p_expected bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;actor uuid;auth_id uuid;row public.conference_house_assignments%rowtype;result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);actor:=(context->>'actorUserId')::uuid;auth_id:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 if p_assign then if not exists(select 1 from public.conference_accommodation_houses where id=p_house and is_active) then raise exception 'HOUSE_NOT_AVAILABLE' using errcode='P0002';end if;if exists(select 1 from public.conference_house_assignments other join public.conferences requested on requested.id=p_conference join public.conferences existing on existing.id=other.conference_id where other.house_id=p_house and other.conference_id<>p_conference and requested.start_date<=existing.end_date and existing.start_date<=requested.end_date and existing.deleted_at is null) then raise exception 'HOUSE_CONFERENCE_PERIOD_OVERLAP' using errcode='23P01';end if;insert into public.conference_house_assignments(conference_id,house_id,created_by,updated_by) values(p_conference,p_house,actor,actor) on conflict(conference_id,house_id) do nothing returning * into row;if row.id is null then select * into row from public.conference_house_assignments where conference_id=p_conference and house_id=p_house;end if;
 else select * into row from public.conference_house_assignments where conference_id=p_conference and house_id=p_house for update;if not found then return jsonb_build_object('status','duplicate','houseId',p_house);end if;if p_expected is distinct from row.revision then raise exception 'HOUSE_ASSIGNMENT_REVISION_CONFLICT' using errcode='40001';end if;if exists(select 1 from public.conference_accommodation_occupancies o join public.conference_accommodation_rooms r on r.id=o.room_id join public.conference_accommodation_floors f on f.id=r.floor_id where o.conference_id=p_conference and f.house_id=p_house) then raise exception 'HOUSE_ASSIGNMENT_HAS_OCCUPANCIES' using errcode='55000';end if;delete from public.conference_house_assignments where id=row.id;
 end if;
 result:=jsonb_build_object('status','success','assignmentId',row.id,'conferenceId',p_conference,'houseId',p_house,'revision',row.revision,'assigned',p_assign);
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,new_values,metadata,operation_id,source) values(actor,auth_id,'platform','conference',case when p_assign then 'conference.house.assigned' else 'conference.house.unassigned' end,'conference_house_assignment',row.id,'resource',p_conference::text,result,jsonb_build_object('permissionKey','conference.accommodation.manage'),p_operation_id,'rpc');return result;
end $$;

create or replace function public.get_conference_accommodation(p_device uuid,p_conference uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb;result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.view',false);
 select coalesce(jsonb_agg(jsonb_build_object('assignmentId',a.id,'assignmentRevision',a.revision,'houseId',h.id,'name',h.name,'description',h.description,'position',h.position,'revision',h.revision,'floors',(select coalesce(jsonb_agg(jsonb_build_object('floorId',f.id,'name',f.name,'position',f.position,'revision',f.revision,'rooms',(select coalesce(jsonb_agg(jsonb_build_object('roomId',r.id,'roomNumber',r.room_number,'baseCapacity',r.base_capacity,'extraBedCapacity',r.extra_bed_capacity,'notes',r.notes,'isClosed',r.is_closed,'closedDay',r.closed_day,'position',r.position,'revision',r.revision,'occupancies',(select coalesce(jsonb_agg(jsonb_build_object('occupancyId',o.id,'revision',o.revision,'arrivalDay',o.arrival_day,'leaveDay',o.leave_day,'bedType',o.bed_type,'extraBedPersonType',o.extra_bed_person_type,'participationId',p.id,'participationStatus',p.status,'person',jsonb_build_object('personId',pe.id,'fullName',pe.full_name,'phone',pe.phone,'gender',pe.gender,'dateOfBirth',pe.date_of_birth,'church',pe.church)) order by pe.full_name,o.id),'[]') from public.conference_accommodation_occupancies o join public.conference_participations p on p.id=o.participation_id join platform.people pe on pe.id=p.person_id where o.room_id=r.id and o.conference_id=p_conference)) order by r.position,r.id),'[]') from public.conference_accommodation_rooms r where r.floor_id=f.id)) order by f.position,f.id),'[]') from public.conference_accommodation_floors f where f.house_id=h.id)) order by h.position,h.id),'[]') into result from public.conference_house_assignments a join public.conference_accommodation_houses h on h.id=a.house_id where a.conference_id=p_conference;
 return jsonb_build_object('conferenceId',p_conference,'houses',result,'pricing',platform_private.conference_accommodation_pricing_projection(p_conference));
end $$;

-- A room is in Conference scope only through its assignment.
create or replace function platform_private.conference_room_is_assigned(p_conference uuid,p_room uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conference_house_assignments a join public.conference_accommodation_floors f on f.house_id=a.house_id join public.conference_accommodation_rooms r on r.floor_id=f.id where a.conference_id=p_conference and r.id=p_room)
$$;

create or replace function platform_private.require_conference_room_lease(
 p_actor_device_id uuid,p_conference_id uuid,p_room_id uuid,p_lease_token uuid
) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_conference_id is null or p_room_id is null
    or not platform_private.conference_room_is_assigned(p_conference_id,p_room_id) then
  raise exception 'ACCOMMODATION_ROOM_CONFERENCE_MISMATCH' using errcode='42501';
 end if;
 perform platform_private.require_owned_accommodation_room_lease(p_actor_device_id,p_room_id,p_lease_token);
end $$;

do $dispatch$
declare d text;marker text;replacement text;
begin
 d:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
 marker:='  elsif p_operation=''get_conference_accommodation'' then';
 if position(marker in d)=0 then raise exception 'CANONICAL_CONFERENCE_DISPATCH_MARKER_MISSING';end if;
 replacement=$body$  elsif p_operation='list_conference_houses' then
    perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
    return public.list_conference_houses(p_actor_device_id);
  elsif p_operation='mutate_conference_house_directory' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_operation','p_payload']);
    return public.mutate_conference_house_directory(p_actor_device_id,(p_args->>'p_operation_id')::uuid,p_args->>'p_operation',p_args->'p_payload');
  elsif p_operation='assign_conference_house' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_house_id','p_assign','p_expected_revision']);
    return public.assign_conference_house(p_actor_device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_conference_id')::uuid,(p_args->>'p_house_id')::uuid,(p_args->>'p_assign')::boolean,nullif(p_args->>'p_expected_revision','')::bigint);
  elsif p_operation='get_conference_accommodation' then$body$;
 d:=replace(d,marker,replacement);
 execute d;
end $dispatch$;

-- Patch the established mutation functions' room-scope predicates in-place.
do $patch$
declare sig regprocedure;d text;
begin
 foreach sig in array array['public.assign_conference_accommodation(uuid,uuid,uuid,uuid,integer,integer,text,text)'::regprocedure,'public.move_conference_accommodation(uuid,uuid,uuid,bigint,uuid,integer,integer,text,text)'::regprocedure] loop
  d:=pg_get_functiondef(sig);
  d:=replace(d,'where id=p_room and conference_id=p_conference','where id=p_room and platform_private.conference_room_is_assigned(p_conference,id)');
  execute d;
 end loop;
end $patch$;

revoke all on function platform_private.require_conference_house_directory_context(uuid,text),platform_private.conference_room_is_assigned(uuid,uuid),public.list_conference_houses(uuid),public.mutate_conference_house_directory(uuid,uuid,text,jsonb),public.assign_conference_house(uuid,uuid,uuid,uuid,boolean,bigint),public.get_conference_accommodation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_conference_houses(uuid),public.mutate_conference_house_directory(uuid,uuid,text,jsonb),public.assign_conference_house(uuid,uuid,uuid,uuid,boolean,bigint),public.get_conference_accommodation(uuid,uuid) to service_role;

comment on table public.conference_accommodation_houses is 'Permanent canonical central Conference house directory; Conference usage exists only through conference_house_assignments.';
comment on table public.conference_house_assignments is 'Conference-specific selection of a permanent central house; unassignment is blocked while occupancies exist.';
commit;
