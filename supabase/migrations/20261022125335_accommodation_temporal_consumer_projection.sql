begin;

create or replace function platform_private.conference_operational_day(p_conference uuid)
returns integer language sql stable security definer set search_path='' as $$
 select greatest(1,least((end_date-start_date+1)::integer,(current_date-start_date+1)::integer))
 from public.conferences where id=p_conference and start_date is not null and end_date is not null
$$;

do $repair$
declare signature regprocedure;definition text;old_join text;new_join text;
begin
 foreach signature in array array[
  'public.get_conference_restaurant(uuid,uuid)'::regprocedure,
  'public.get_conference_transport(uuid,uuid)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(signature);
  if signature='public.get_conference_restaurant(uuid,uuid)'::regprocedure then
   old_join:='left join public.conference_accommodation_occupancies occupancy on occupancy.participation_id=p.id left join public.conference_accommodation_rooms room on room.id=occupancy.room_id';
   new_join:='left join lateral (select o.room_id from public.conference_accommodation_occupancies o where o.participation_id=p.id and o.arrival_day<=platform_private.conference_operational_day(p.conference_id) and coalesce(o.leave_day,platform_private.conference_accommodation_duration(p.conference_id)+1)>platform_private.conference_operational_day(p.conference_id) order by o.arrival_day desc,o.id limit 1) occupancy on true left join public.conference_accommodation_rooms room on room.id=occupancy.room_id';
  else
   old_join:='left join platform.people gperson on gperson.id=gp.person_id left join public.conference_accommodation_occupancies o on o.participation_id=p.id';
   new_join:='left join platform.people gperson on gperson.id=gp.person_id left join lateral (select stay.room_id from public.conference_accommodation_occupancies stay where stay.participation_id=p.id and stay.arrival_day<=platform_private.conference_operational_day(p.conference_id) and coalesce(stay.leave_day,platform_private.conference_accommodation_duration(p.conference_id)+1)>platform_private.conference_operational_day(p.conference_id) order by stay.arrival_day desc,stay.id limit 1) o on true';
  end if;
  if position(new_join in definition)>0 then
   continue;
  elsif position(old_join in definition)>0 then
   definition:=replace(definition,old_join,new_join);
   execute definition;
  else
   raise exception 'ACCOMMODATION_TEMPORAL_CONSUMER_DRIFT: %',signature using errcode='55000';
  end if;
 end loop;
end $repair$;

revoke all on function platform_private.conference_operational_day(uuid) from public,anon,authenticated,service_role;
comment on function platform_private.conference_operational_day(uuid) is 'Current bounded Conference day used only for present-time projections; historical consumers must pass their explicit business day.';

commit;
