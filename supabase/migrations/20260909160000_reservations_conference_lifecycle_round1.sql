begin;

alter table reservations.events add column conference_id uuid references public.conferences(id) on delete restrict;
create index reservations_events_conference_idx on reservations.events(conference_id,id);

create table reservations.conference_person_links(
 booking_id uuid primary key references reservations.bookings(id) on delete restrict,
 participant_id uuid not null references reservations.participants(id) on delete restrict,
 conference_id uuid not null references public.conferences(id) on delete restrict,
 conference_person_id uuid not null,
 created_at timestamptz not null default statement_timestamp(),
 unique(conference_id,conference_person_id)
);
alter table reservations.conference_person_links enable row level security;
alter table reservations.conference_person_links force row level security;
revoke all on table reservations.conference_person_links from public,anon,authenticated,service_role;

create function reservations_private.project_booking_to_conference(p_booking_id uuid,p_operation_id uuid,p_context jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_booking reservations.bookings%rowtype; v_participant reservations.participants%rowtype; v_event reservations.events%rowtype; v_snapshot public.conference_snapshots%rowtype; v_link reservations.conference_person_links%rowtype; v_person_id uuid; v_person jsonb; v_people jsonb; v_data jsonb; v_revision bigint; v_actor uuid:=(p_context->>'actorUserId')::uuid; v_device uuid:=(p_context->>'actorDeviceId')::uuid;
begin
 select l.* into v_link from reservations.conference_person_links l where l.booking_id=p_booking_id;
 if found then return jsonb_build_object('bookingId',v_link.booking_id,'participantId',v_link.participant_id,'conferenceId',v_link.conference_id,'conferencePersonId',v_link.conference_person_id,'linked',true); end if;
 select b.* into v_booking from reservations.bookings b where b.id=p_booking_id for key share; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
 select p.* into v_participant from reservations.participants p where p.id=v_booking.participant_id for key share;
 select e.* into v_event from reservations.events e where e.id=v_booking.event_id for key share;
 if v_event.conference_id is null then raise exception 'RESERVATIONS_EVENT_CONFERENCE_REQUIRED' using errcode='22023'; end if;
 if not exists(select 1 from public.conferences c where c.id=v_event.conference_id and c.deleted_at is null) then raise exception 'RESERVATIONS_CONFERENCE_UNAVAILABLE' using errcode='55000'; end if;
 select s.* into v_snapshot from public.conference_snapshots s where s.conference_id=v_event.conference_id for update;
 if not found then raise exception 'RESERVATIONS_CONFERENCE_SNAPSHOT_REQUIRED' using errcode='55000'; end if;
 v_person_id:=extensions.gen_random_uuid();
 v_person:=jsonb_build_object('id',v_person_id::text,'fullName',v_participant.full_name,'church',v_participant.church,'phone',v_participant.phone,'gender','','age',v_participant.age::text,'notes',coalesce(v_participant.notes,''),'createdAt',statement_timestamp()::text,'updatedAt',statement_timestamp()::text);
 v_data:=v_snapshot.data;
 v_people:=case when jsonb_typeof(v_data#>'{peopleDb,people}')='array' then v_data#>'{peopleDb,people}' else '[]'::jsonb end;
 v_data:=jsonb_set(v_data,'{peopleDb}',coalesce(v_data->'peopleDb','{}'::jsonb)||jsonb_build_object('version',coalesce(v_data#>>'{peopleDb,version}','1.0.0'),'people',v_people||jsonb_build_array(v_person)),true);
 v_revision:=v_snapshot.revision+1;
 update public.conference_snapshots set data=v_data,revision=v_revision,updated_by=v_actor,updated_by_device_id=v_device,updated_at=statement_timestamp() where conference_id=v_event.conference_id;
 insert into reservations.conference_person_links(booking_id,participant_id,conference_id,conference_person_id) values(v_booking.id,v_participant.id,v_event.conference_id,v_person_id);
 insert into public.sync_operations(operation_id,conference_id,user_id,device_id,operation_type,base_revision,resulting_revision,status,payload,processed_at) values(p_operation_id,v_event.conference_id,v_actor,v_device,'reservations_booking_person_projection',v_snapshot.revision,v_revision,'applied',jsonb_build_object('bookingId',v_booking.id,'participantId',v_participant.id,'conferencePersonId',v_person_id),statement_timestamp());
 perform reservations_private.audit(p_context,'booking.conference_person_projected','booking',v_booking.id,p_operation_id,null,jsonb_build_object('conferenceId',v_event.conference_id,'conferencePersonId',v_person_id));
 return jsonb_build_object('bookingId',v_booking.id,'participantId',v_participant.id,'conferenceId',v_event.conference_id,'conferencePersonId',v_person_id,'linked',true);
end $$;

alter function reservations.read(uuid,text,jsonb) rename to read_pre_conference_lifecycle;
alter function reservations.mutate(uuid,text,jsonb) rename to mutate_pre_conference_lifecycle;

create function reservations.read(p_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb; v_booking reservations.bookings%rowtype; v_link reservations.conference_person_links%rowtype; v_snapshot jsonb; v_room jsonb; v_house jsonb; v_floor jsonb;
begin
 if p_operation not in('list_conference_options','get_booking_accommodation') then return reservations.read_pre_conference_lifecycle(p_device_id,p_operation,p_args); end if;
 v_context:=reservations_private.context(p_device_id,(p_args->>'p_organization_id')::uuid,case when p_operation='list_conference_options' then 'reservations.event.view' else 'reservations.booking.view' end);
 if p_operation='list_conference_options' then return (select coalesce(jsonb_agg(jsonb_build_object('conferenceId',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb) from public.conferences c where c.deleted_at is null); end if;
 select b.* into v_booking from reservations.bookings b where b.id=(p_args->>'p_booking_id')::uuid; if not found then raise exception 'RESERVATIONS_BOOKING_NOT_FOUND' using errcode='P0002'; end if;
 select l.* into v_link from reservations.conference_person_links l where l.booking_id=v_booking.id;
 if not found then return jsonb_build_object('bookingId',v_booking.id,'linked',false,'readyForAccommodation',false,'accommodated',false); end if;
 select s.data into v_snapshot from public.conference_snapshots s where s.conference_id=v_link.conference_id;
 select h.value,f.value,r.value into v_house,v_floor,v_room from jsonb_array_elements(case when jsonb_typeof(v_snapshot->'houses')='array' then v_snapshot->'houses' else '[]'::jsonb end) h(value) cross join lateral jsonb_array_elements(case when jsonb_typeof(h.value->'floors')='array' then h.value->'floors' else '[]'::jsonb end) f(value) cross join lateral jsonb_array_elements(case when jsonb_typeof(f.value->'rooms')='array' then f.value->'rooms' else '[]'::jsonb end) r(value) where exists(select 1 from jsonb_array_elements((case when jsonb_typeof(r.value->'guests')='array' then r.value->'guests' else '[]'::jsonb end)||(case when jsonb_typeof(r.value->'children')='array' then r.value->'children' else '[]'::jsonb end)) occupant where occupant->>'personId'=v_link.conference_person_id::text) limit 1;
 return jsonb_strip_nulls(jsonb_build_object('bookingId',v_booking.id,'conferenceId',v_link.conference_id,'conferencePersonId',v_link.conference_person_id,'linked',true,'readyForAccommodation',true,'accommodated',v_room is not null,'roomId',v_room->>'id','roomNumber',v_room->>'number','houseLabel',v_house->>'name','floorLabel',v_floor->>'name'));
end $$;

create function reservations.mutate(p_device_id uuid,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_context jsonb; v_event_id uuid; v_conference_id uuid;
begin
 if p_operation in('create_event','update_event') then v_conference_id:=(p_args->>'p_conference_id')::uuid; if v_conference_id is null or not exists(select 1 from public.conferences c where c.id=v_conference_id and c.deleted_at is null) then raise exception 'RESERVATIONS_CONFERENCE_UNAVAILABLE' using errcode='22023'; end if; end if;
 if p_operation='update_event' and exists(select 1 from reservations.events e join reservations.bookings b on b.event_id=e.id where e.id=(p_args->>'p_event_id')::uuid and e.conference_id is distinct from v_conference_id) then raise exception 'RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE' using errcode='55000'; end if;
 if p_operation='delete_booking' and exists(select 1 from reservations.conference_person_links l where l.booking_id=(p_args->>'p_booking_id')::uuid) then raise exception 'RESERVATIONS_CONFERENCE_PERSON_MANUAL_ACTION_REQUIRED' using errcode='55000'; end if;
 v_result:=reservations.mutate_pre_conference_lifecycle(p_device_id,p_operation,p_args);
 if p_operation in('create_event','update_event') then v_event_id:=case when p_operation='create_event' then (v_result->>'eventId')::uuid else (p_args->>'p_event_id')::uuid end; update reservations.events set conference_id=v_conference_id where id=v_event_id;
 elsif p_operation='create_booking' then v_context:=reservations_private.context(p_device_id,(p_args->>'p_organization_id')::uuid,'reservations.booking.create'); v_result:=v_result||jsonb_build_object('conferencePerson',reservations_private.project_booking_to_conference((v_result->>'bookingId')::uuid,(p_args->>'p_operation_id')::uuid,v_context)); end if;
 return v_result;
end $$;

alter function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) rename to execute_device_operation_pre_reservations_conference_lifecycle;

create function platform.execute_device_operation(p_user_id uuid,p_session_id uuid,p_token_hash bytea,p_module text,p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='pg_catalog','public','platform','platform_private','reservations','reservations_private' as $$
declare v_session platform_private.device_sessions%rowtype; v_args jsonb;
begin
 if p_module<>'reservations' then return platform.execute_device_operation_pre_reservations_conference_lifecycle(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args); end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'PLATFORM_OPERATION_BACKEND_REQUIRED' using errcode='42501'; end if;
 if p_args is null or jsonb_typeof(p_args)<>'object' or p_args ?| array['p_organization_id','organization_id','p_device_id','p_actor_device_id','p_actor_user_id','p_conference_person_id','conference_person_id'] then raise exception 'PLATFORM_OPERATION_ARGUMENT_INVALID' using errcode='22023'; end if;
 select s.* into v_session from platform_private.device_sessions s join platform.device_key_bindings b on b.id=s.binding_id join platform.user_device_authorizations a on a.id=s.device_authorization_id join platform.devices d on d.id=s.device_id join platform.profiles p on p.user_id=s.user_id where s.id=p_session_id and s.user_id=p_user_id and s.token_hash=p_token_hash and s.purpose='PLATFORM_DEVICE_SESSION' and s.revoked_at is null and s.expires_at>statement_timestamp() and b.user_id=s.user_id and b.device_id=s.device_id and b.device_authorization_id=s.device_authorization_id and b.public_key_thumbprint=s.public_key_thumbprint and b.algorithm='ECDSA_P256_SHA256' and b.lifecycle_status='active' and b.revoked_at is null and b.retired_at is null and a.user_id=s.user_id and a.device_id=s.device_id and a.status='approved' and a.revoked_at is null and d.lifecycle_status='active' and d.retired_at is null and d.compromised_at is null and p.account_status='approved';
 if not found then raise exception 'DEVICE_SESSION_INVALID' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user_id,'role','service_role')::text,true); perform set_config('platform.phase1c_context',jsonb_build_object('purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id',v_session.id,'user_id',v_session.user_id,'device_id',v_session.device_id,'authorization_id',v_session.device_authorization_id,'binding_id',v_session.binding_id,'token_hash',encode(p_token_hash,'hex'))::text,true);
 case p_operation when 'list_conference_options' then perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]); when 'get_booking_accommodation' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_booking_id']); when 'create_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_conference_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']); when 'update_event' then perform platform_private.require_exact_jsonb_keys(p_args,array['p_operation_id','p_event_id','p_expected_revision','p_conference_id','p_name','p_start_date','p_end_date','p_location','p_capacity','p_status','p_notes']); else return platform.execute_device_operation_pre_reservations_conference_lifecycle(p_user_id,p_session_id,p_token_hash,p_module,p_operation,p_args); end case;
 v_args:=p_args||jsonb_build_object('p_organization_id',reservations_private.resolve_platform_scope()); if p_operation in('list_conference_options','get_booking_accommodation') then return reservations.read(v_session.device_id,p_operation,v_args); end if; return reservations.mutate(v_session.device_id,p_operation,v_args);
end $$;

revoke all on function reservations.read_pre_conference_lifecycle(uuid,text,jsonb),reservations.mutate_pre_conference_lifecycle(uuid,text,jsonb),reservations_private.project_booking_to_conference(uuid,uuid,jsonb),platform.execute_device_operation_pre_reservations_conference_lifecycle(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function reservations.read_pre_conference_lifecycle(uuid,text,jsonb),reservations.mutate_pre_conference_lifecycle(uuid,text,jsonb),reservations_private.project_booking_to_conference(uuid,uuid,jsonb),platform.execute_device_operation_pre_reservations_conference_lifecycle(uuid,uuid,bytea,text,text,jsonb) to postgres;
revoke all on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb),reservations.mutate(uuid,text,jsonb) to service_role;
revoke all on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) from public,anon,authenticated;
grant execute on function platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb) to service_role;

commit;
