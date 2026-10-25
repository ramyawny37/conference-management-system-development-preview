begin;

alter table public.conference_accommodation_occupancies
  drop constraint conference_accommodation_occupancies_bed_type_check,
  drop constraint conference_accommodation_occupancies_bed_ck;
alter table public.conference_accommodation_occupancies
  add constraint conference_accommodation_occupancies_bed_type_check
    check (bed_type in ('base','extra','shared')),
  add constraint conference_accommodation_occupancies_bed_ck
    check ((bed_type='base' and extra_bed_person_type is null)
        or (bed_type='extra' and extra_bed_person_type is not null)
        or (bed_type='shared' and extra_bed_person_type is null));

create or replace function platform_private.conference_room_has_capacity(
  p_conference uuid,p_room uuid,p_bed text,p_arrival integer,p_leave integer,
  p_exclude_occupancy uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select p_bed='shared' or not exists(
    select 1
    from generate_series(p_arrival,coalesce(p_leave,platform_private.conference_accommodation_duration(p_conference)+1)-1) night(day)
    cross join lateral (
      select count(*)::integer used from public.conference_accommodation_occupancies o
      where o.conference_id=p_conference and o.room_id=p_room and o.bed_type=p_bed
        and o.id is distinct from p_exclude_occupancy and o.arrival_day<=night.day
        and coalesce(o.leave_day,platform_private.conference_accommodation_duration(p_conference)+1)>night.day
    ) occupancy
    join public.conference_accommodation_rooms room on room.id=p_room
    where occupancy.used >= case when p_bed='base' then room.base_capacity else room.extra_bed_capacity end
  )
$$;

create or replace function platform_private.enforce_shared_child_guardian_stay()
returns trigger language plpgsql security definer set search_path='' as $$
declare child public.conference_participations%rowtype;
begin
  if new.bed_type<>'shared' then return new; end if;
  select * into child from public.conference_participations
   where id=new.participation_id and conference_id=new.conference_id and status='active';
  if not found or child.guardian_participation_id is null then
    raise exception 'ACCOMMODATION_SHARED_CHILD_GUARDIAN_REQUIRED' using errcode='23514';
  end if;
  if not exists(
    select 1 from public.conference_accommodation_occupancies guardian_stay
    join public.conference_participations guardian on guardian.id=child.guardian_participation_id
    where guardian.status='active' and guardian_stay.participation_id=guardian.id
      and guardian_stay.conference_id=new.conference_id and guardian_stay.room_id=new.room_id
      and guardian_stay.bed_type<>'shared'
      and guardian_stay.arrival_day<=new.arrival_day
      and coalesce(guardian_stay.leave_day,2147483647)>=coalesce(new.leave_day,2147483647)
  ) then raise exception 'ACCOMMODATION_SHARED_CHILD_GUARDIAN_STAY_REQUIRED' using errcode='23514'; end if;
  return new;
end $$;

drop trigger if exists conference_accommodation_shared_child_guardian on public.conference_accommodation_occupancies;
create trigger conference_accommodation_shared_child_guardian
before insert or update of conference_id,room_id,participation_id,arrival_day,leave_day,bed_type
on public.conference_accommodation_occupancies for each row
execute function platform_private.enforce_shared_child_guardian_stay();

create or replace function platform_private.sync_guardian_shared_child_stays()
returns trigger language plpgsql security definer set search_path='' as $$
declare linked public.conference_accommodation_occupancies%rowtype;
begin
  if tg_op='DELETE' then
    delete from public.conference_transport_assignments a using public.conference_participations child
     where child.id=a.participation_id and child.guardian_participation_id=old.participation_id;
    delete from public.conference_accommodation_occupancies child_stay using public.conference_participations child
     where child.id=child_stay.participation_id and child.guardian_participation_id=old.participation_id
       and child_stay.bed_type='shared' and child_stay.room_id=old.room_id
       and child_stay.arrival_day=old.arrival_day and child_stay.leave_day is not distinct from old.leave_day;
    return old;
  end if;
  if new.room_id is distinct from old.room_id or new.arrival_day is distinct from old.arrival_day
     or new.leave_day is distinct from old.leave_day then
    for linked in select child_stay.* from public.conference_accommodation_occupancies child_stay
      join public.conference_participations child on child.id=child_stay.participation_id
      where child.guardian_participation_id=new.participation_id and child_stay.bed_type='shared'
        and child_stay.room_id=old.room_id and child_stay.arrival_day=old.arrival_day
        and child_stay.leave_day is not distinct from old.leave_day for update of child_stay loop
      delete from public.conference_accommodation_occupancies where id=linked.id;
      insert into public.conference_accommodation_occupancies(
        conference_id,room_id,participation_id,arrival_day,leave_day,bed_type,
        extra_bed_person_type,arrived_at,arrived_by,created_by,updated_by
      ) values(new.conference_id,new.room_id,linked.participation_id,new.arrival_day,new.leave_day,'shared',
        null,linked.arrived_at,linked.arrived_by,linked.created_by,new.updated_by);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists conference_accommodation_sync_guardian_children on public.conference_accommodation_occupancies;
create trigger conference_accommodation_sync_guardian_children
after update of room_id,arrival_day,leave_day or delete on public.conference_accommodation_occupancies
for each row when (old.bed_type<>'shared') execute function platform_private.sync_guardian_shared_child_stays();

create or replace function platform_private.enforce_transport_resident_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare part public.conference_participations%rowtype;
begin
  select * into part from public.conference_participations where id=new.participation_id and conference_id=new.conference_id and status='active';
  if not found or not exists(select 1 from public.conference_accommodation_occupancies o where o.participation_id=part.id) then
    raise exception 'CONFERENCE_TRANSPORT_RESIDENT_REQUIRED' using errcode='23514';
  end if;
  if new.rider_kind in('child','infant') and part.guardian_participation_id is null then
    raise exception 'CONFERENCE_TRANSPORT_CHILD_GUARDIAN_REQUIRED' using errcode='23514';
  end if;
  return new;
end $$;

drop trigger if exists conference_transport_resident_assignment on public.conference_transport_assignments;
create trigger conference_transport_resident_assignment before insert or update of conference_id,participation_id,rider_kind
on public.conference_transport_assignments for each row execute function platform_private.enforce_transport_resident_assignment();

revoke all on function platform_private.enforce_shared_child_guardian_stay() from public,anon,authenticated,service_role;
revoke all on function platform_private.sync_guardian_shared_child_stays() from public,anon,authenticated,service_role;
revoke all on function platform_private.enforce_transport_resident_assignment() from public,anon,authenticated,service_role;
comment on column public.conference_accommodation_occupancies.bed_type is
  'base and extra consume capacity; shared is a guardian-linked child resident in the same room and consumes no bed.';

commit;
