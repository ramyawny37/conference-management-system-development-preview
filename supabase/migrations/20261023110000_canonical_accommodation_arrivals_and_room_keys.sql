begin;

alter table public.conference_accommodation_occupancies
 add column if not exists arrived_at timestamptz,
 add column if not exists arrived_by uuid references platform.profiles(user_id) on delete restrict;

alter table public.conference_room_assignments
 add column if not exists key_holder_occupancy_id uuid,
 add column if not exists key_delivered_at timestamptz,
 add column if not exists key_delivered_by uuid references platform.profiles(user_id) on delete restrict;

alter table public.conference_accommodation_occupancies
 drop constraint if exists conference_accommodation_arrival_complete_check;
alter table public.conference_accommodation_occupancies
 add constraint conference_accommodation_arrival_complete_check
 check ((arrived_at is null)=(arrived_by is null));
alter table public.conference_room_assignments
 drop constraint if exists conference_room_key_delivery_complete_check;
alter table public.conference_room_assignments
 add constraint conference_room_key_delivery_complete_check
 check ((key_holder_occupancy_id is null and key_delivered_at is null and key_delivered_by is null)
     or (key_holder_occupancy_id is not null and key_delivered_at is not null and key_delivered_by is not null));

-- A temporal move creates a new stay segment. Preserve the person's Conference
-- arrival state on that immediately-contiguous segment without rewriting history.
create or replace function platform_private.inherit_conference_accommodation_arrival()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior public.conference_accommodation_occupancies%rowtype;
begin
 if new.arrived_at is null then
  select * into prior from public.conference_accommodation_occupancies o
   where o.conference_id=new.conference_id and o.participation_id=new.participation_id
     and o.leave_day=new.arrival_day and o.arrived_at is not null
   order by o.leave_day desc,o.id limit 1;
  if found then new.arrived_at:=prior.arrived_at;new.arrived_by:=prior.arrived_by;end if;
 end if;
 return new;
end $$;
drop trigger if exists inherit_conference_accommodation_arrival on public.conference_accommodation_occupancies;
create trigger inherit_conference_accommodation_arrival before insert on public.conference_accommodation_occupancies
for each row execute function platform_private.inherit_conference_accommodation_arrival();

create or replace function public.mutate_conference_accommodation_operations(
 p_device uuid,p_operation_id uuid,p_conference uuid,p_operation text,p_args jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;actor uuid;authz uuid;occupancy public.conference_accommodation_occupancies%rowtype;
 assignment public.conference_room_assignments%rowtype;holder public.conference_accommodation_occupancies%rowtype;
 old_values jsonb;new_values jsonb;result jsonb;expected bigint;room_id uuid;holder_id uuid;
begin
 if p_operation_id is null or p_operation not in('set_arrival','set_room_key') then raise exception 'ACCOMMODATION_OPERATION_INVALID' using errcode='22023';end if;
 ctx:=platform_private.require_conference_accommodation_context(p_device,p_conference,'conference.accommodation.manage',true);
 actor:=(ctx->>'actorUserId')::uuid;authz:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 select new_values into result from platform.audit_events where actor_user_id=actor and operation_id=p_operation_id
   and action in('conference.accommodation.arrival_updated','conference.accommodation.room_key_updated') limit 1;
 if result is not null then return result||jsonb_build_object('status','duplicate');end if;
 if p_operation='set_arrival' then
  perform platform_private.require_exact_jsonb_keys(p_args,array['occupancyId','expectedRevision','arrived']);
  expected:=(p_args->>'expectedRevision')::bigint;
  select * into occupancy from public.conference_accommodation_occupancies where id=(p_args->>'occupancyId')::uuid and conference_id=p_conference for update;
  if not found then raise exception 'ACCOMMODATION_OCCUPANCY_NOT_FOUND' using errcode='P0002';end if;
  if occupancy.revision<>expected then raise exception 'ACCOMMODATION_REVISION_CONFLICT' using errcode='40001';end if;
  room_id:=occupancy.room_id;old_values:=to_jsonb(occupancy);
  update public.conference_accommodation_occupancies set
   arrived_at=case when (p_args->>'arrived')::boolean then coalesce(arrived_at,statement_timestamp()) else null end,
   arrived_by=case when (p_args->>'arrived')::boolean then coalesce(arrived_by,actor) else null end,
   revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=occupancy.id returning * into occupancy;
  new_values:=to_jsonb(occupancy);result:=jsonb_build_object('status','success','occupancyId',occupancy.id,'revision',occupancy.revision,'arrivedAt',occupancy.arrived_at,'arrivedBy',occupancy.arrived_by);
 else
  perform platform_private.require_exact_jsonb_keys(p_args,array['roomId','expectedRevision','holderOccupancyId']);
  room_id:=(p_args->>'roomId')::uuid;expected:=(p_args->>'expectedRevision')::bigint;holder_id:=nullif(p_args->>'holderOccupancyId','')::uuid;
  select * into assignment from public.conference_room_assignments where conference_id=p_conference and room_id=room_id for update;
  if not found then raise exception 'ROOM_ASSIGNMENT_NOT_FOUND' using errcode='P0002';end if;
  if assignment.revision<>expected then raise exception 'ROOM_ASSIGNMENT_REVISION_CONFLICT' using errcode='40001';end if;
  if holder_id is not null then
   select * into holder from public.conference_accommodation_occupancies where id=holder_id and conference_id=p_conference and room_id=room_id
    and arrival_day<=platform_private.conference_operational_day(p_conference)
    and coalesce(leave_day,platform_private.conference_accommodation_duration(p_conference)+1)>platform_private.conference_operational_day(p_conference) for key share;
   if not found then raise exception 'ROOM_KEY_HOLDER_NOT_CURRENT_OCCUPANT' using errcode='22023';end if;
  end if;
  old_values:=to_jsonb(assignment);
  update public.conference_room_assignments set key_holder_occupancy_id=holder_id,
   key_delivered_at=case when holder_id is null then null else statement_timestamp() end,
   key_delivered_by=case when holder_id is null then null else actor end,
   revision=revision+1,updated_at=statement_timestamp(),updated_by=actor where id=assignment.id returning * into assignment;
  new_values:=to_jsonb(assignment);result:=jsonb_build_object('status','success','roomId',room_id,'roomAssignmentId',assignment.id,'revision',assignment.revision,'keyHolderOccupancyId',assignment.key_holder_occupancy_id,'keyDeliveredAt',assignment.key_delivered_at,'keyDeliveredBy',assignment.key_delivered_by);
 end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,scope_id,old_values,new_values,metadata,operation_id,source)
 values(actor,authz,'platform','conference',case when p_operation='set_arrival' then 'conference.accommodation.arrival_updated' else 'conference.accommodation.room_key_updated' end,
  case when p_operation='set_arrival' then 'accommodation_occupancy' else 'conference_room_assignment' end,
  case when p_operation='set_arrival' then occupancy.id else assignment.id end,'resource',p_conference::text,old_values,new_values,
  jsonb_build_object('conferenceId',p_conference,'roomId',room_id,'permissionKey','conference.accommodation.manage','authoritySource',ctx->>'authoritySource','grantId',ctx->'grantId'),p_operation_id,'rpc');
 return result;
end $$;

do $projection$
declare d text;
begin
 d:=pg_get_functiondef('public.get_conference_accommodation(uuid,uuid)'::regprocedure);
 if position('''arrivedAt''' in d)=0 then
  if position('''revision'', o.revision, ''arrivalDay''' in d)>0 then
   d:=replace(d,'''revision'', o.revision, ''arrivalDay''','''revision'', o.revision, ''arrivedAt'', o.arrived_at, ''arrivedBy'', o.arrived_by, ''arrivalDay''');
  elsif position('''revision'',o.revision,''arrivalDay''' in d)>0 then
   d:=replace(d,'''revision'',o.revision,''arrivalDay''','''revision'',o.revision,''arrivedAt'',o.arrived_at,''arrivedBy'',o.arrived_by,''arrivalDay''');
  else raise exception 'ARRIVAL_PROJECTION_MARKER_MISSING';end if;
 end if;
 if position('''keyHolderOccupancyId''' in d)=0 then
  if position('''roomAssignmentRevision'', ra.revision, ''roomId''' in d)>0 then
   d:=replace(d,'''roomAssignmentRevision'', ra.revision, ''roomId''','''roomAssignmentRevision'', ra.revision, ''keyHolderOccupancyId'', case when exists(select 1 from public.conference_accommodation_occupancies ko where ko.id=ra.key_holder_occupancy_id and ko.room_id=ra.room_id and ko.conference_id=ra.conference_id and ko.arrival_day<=platform_private.conference_operational_day(ra.conference_id) and coalesce(ko.leave_day,platform_private.conference_accommodation_duration(ra.conference_id)+1)>platform_private.conference_operational_day(ra.conference_id)) then ra.key_holder_occupancy_id else null end, ''keyHolderPersonId'', (select p.person_id from public.conference_accommodation_occupancies ko join public.conference_participations p on p.id=ko.participation_id where ko.id=ra.key_holder_occupancy_id and ko.room_id=ra.room_id), ''keyHolderName'', (select pe.full_name from public.conference_accommodation_occupancies ko join public.conference_participations p on p.id=ko.participation_id join platform.people pe on pe.id=p.person_id where ko.id=ra.key_holder_occupancy_id and ko.room_id=ra.room_id), ''keyDeliveredAt'', ra.key_delivered_at, ''keyDeliveredBy'', ra.key_delivered_by, ''roomId''');
  elsif position('''roomAssignmentRevision'',ra.revision,''roomId''' in d)>0 then
   d:=replace(d,'''roomAssignmentRevision'',ra.revision,''roomId''','''roomAssignmentRevision'',ra.revision,''keyHolderOccupancyId'',case when exists(select 1 from public.conference_accommodation_occupancies ko where ko.id=ra.key_holder_occupancy_id and ko.room_id=ra.room_id and ko.conference_id=ra.conference_id and ko.arrival_day<=platform_private.conference_operational_day(ra.conference_id) and coalesce(ko.leave_day,platform_private.conference_accommodation_duration(ra.conference_id)+1)>platform_private.conference_operational_day(ra.conference_id)) then ra.key_holder_occupancy_id else null end,''keyHolderPersonId'',(select p.person_id from public.conference_accommodation_occupancies ko join public.conference_participations p on p.id=ko.participation_id where ko.id=ra.key_holder_occupancy_id and ko.room_id=ra.room_id),''keyHolderName'',(select pe.full_name from public.conference_accommodation_occupancies ko join public.conference_participations p on p.id=ko.participation_id join platform.people pe on pe.id=p.person_id where ko.id=ra.key_holder_occupancy_id and ko.room_id=ra.room_id),''keyDeliveredAt'',ra.key_delivered_at,''keyDeliveredBy'',ra.key_delivered_by,''roomId''');
  elsif position('''roomId'', r.id, ''roomNumber''' in d)>0 then
   d:=replace(d,'''roomId'', r.id, ''roomNumber''','''keyHolderOccupancyId'', (select cra.key_holder_occupancy_id from public.conference_room_assignments cra join public.conference_accommodation_occupancies ko on ko.id=cra.key_holder_occupancy_id and ko.room_id=cra.room_id and ko.conference_id=cra.conference_id where cra.conference_id=p_conference and cra.room_id=r.id and ko.arrival_day<=platform_private.conference_operational_day(cra.conference_id) and coalesce(ko.leave_day,platform_private.conference_accommodation_duration(cra.conference_id)+1)>platform_private.conference_operational_day(cra.conference_id)), ''keyHolderPersonId'', (select p.person_id from public.conference_room_assignments cra join public.conference_accommodation_occupancies ko on ko.id=cra.key_holder_occupancy_id and ko.room_id=cra.room_id join public.conference_participations p on p.id=ko.participation_id where cra.conference_id=p_conference and cra.room_id=r.id), ''keyHolderName'', (select pe.full_name from public.conference_room_assignments cra join public.conference_accommodation_occupancies ko on ko.id=cra.key_holder_occupancy_id and ko.room_id=cra.room_id join public.conference_participations p on p.id=ko.participation_id join platform.people pe on pe.id=p.person_id where cra.conference_id=p_conference and cra.room_id=r.id), ''keyDeliveredAt'', (select cra.key_delivered_at from public.conference_room_assignments cra where cra.conference_id=p_conference and cra.room_id=r.id), ''keyDeliveredBy'', (select cra.key_delivered_by from public.conference_room_assignments cra where cra.conference_id=p_conference and cra.room_id=r.id), ''roomId'', r.id, ''roomNumber''');
  elsif position('''roomId'',r.id,''roomNumber''' in d)>0 then
   d:=replace(d,'''roomId'',r.id,''roomNumber''','''keyHolderOccupancyId'',(select cra.key_holder_occupancy_id from public.conference_room_assignments cra join public.conference_accommodation_occupancies ko on ko.id=cra.key_holder_occupancy_id and ko.room_id=cra.room_id and ko.conference_id=cra.conference_id where cra.conference_id=p_conference and cra.room_id=r.id and ko.arrival_day<=platform_private.conference_operational_day(cra.conference_id) and coalesce(ko.leave_day,platform_private.conference_accommodation_duration(cra.conference_id)+1)>platform_private.conference_operational_day(cra.conference_id)),''keyHolderPersonId'',(select p.person_id from public.conference_room_assignments cra join public.conference_accommodation_occupancies ko on ko.id=cra.key_holder_occupancy_id and ko.room_id=cra.room_id join public.conference_participations p on p.id=ko.participation_id where cra.conference_id=p_conference and cra.room_id=r.id),''keyHolderName'',(select pe.full_name from public.conference_room_assignments cra join public.conference_accommodation_occupancies ko on ko.id=cra.key_holder_occupancy_id and ko.room_id=cra.room_id join public.conference_participations p on p.id=ko.participation_id join platform.people pe on pe.id=p.person_id where cra.conference_id=p_conference and cra.room_id=r.id),''keyDeliveredAt'',(select cra.key_delivered_at from public.conference_room_assignments cra where cra.conference_id=p_conference and cra.room_id=r.id),''keyDeliveredBy'',(select cra.key_delivered_by from public.conference_room_assignments cra where cra.conference_id=p_conference and cra.room_id=r.id),''roomId'',r.id,''roomNumber''');
  else raise exception 'ROOM_KEY_PROJECTION_MARKER_MISSING';end if;
 end if;
 execute d;
end $projection$;

do $dispatch$
declare d text;marker text;branch text;
begin
 d:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
 if position('p_operation=''mutate_conference_accommodation_operations''' in d)=0 then
  marker:='elsif p_operation=''get_conference_accommodation'' then';
  branch:=$body$elsif p_operation='mutate_conference_accommodation_operations' then
    perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_operation','p_payload','p_room_lease_tokens']);
    perform platform_private.require_accommodation_operation_leases(p_actor_device_id,(p_args->>'p_conference_id')::uuid,case when p_args->>'p_operation'='set_arrival' then 'remove_conference_accommodation' else 'assign_conference_accommodation' end,
      case when p_args->>'p_operation'='set_arrival' then jsonb_build_object('p_occupancy_id',p_args->'p_payload'->>'occupancyId','p_room_lease_tokens',p_args->'p_room_lease_tokens') else jsonb_build_object('p_room_id',p_args->'p_payload'->>'roomId','p_room_lease_tokens',p_args->'p_room_lease_tokens') end);
    return public.mutate_conference_accommodation_operations(p_actor_device_id,(p_args->>'p_operation_id')::uuid,(p_args->>'p_conference_id')::uuid,p_args->>'p_operation',p_args->'p_payload');
  elsif p_operation='get_conference_accommodation' then$body$;
  if position(marker in d)=0 then raise exception 'ACCOMMODATION_OPERATIONS_DISPATCH_MARKER_MISSING';end if;
  execute replace(d,marker,branch);
 end if;
end $dispatch$;

revoke all on function platform_private.inherit_conference_accommodation_arrival(),public.mutate_conference_accommodation_operations(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mutate_conference_accommodation_operations(uuid,uuid,uuid,text,jsonb) to service_role;
comment on column public.conference_accommodation_occupancies.arrived_at is 'Actual Conference arrival confirmation for this canonical stay; null means not yet arrived.';
comment on column public.conference_room_assignments.key_holder_occupancy_id is 'Current room-key recipient stay. Read projection suppresses stale recipients after move/removal.';
commit;
