begin;
-- Reservations owns its operational participant records. A nullable, explicit
-- reference connects them to the platform-wide identity without name/phone
-- matching, changing bookings, or creating duplicate people.
alter table reservations.participants
  add column if not exists person_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'reservations.participants'::regclass
      and conname = 'reservations_participants_person_id_fkey'
  ) then
    alter table reservations.participants
      add constraint reservations_participants_person_id_fkey
      foreign key (person_id) references platform.people(id)
      on delete restrict;
  end if;
end $$;
create index if not exists reservations_participants_person_id_idx
  on reservations.participants(person_id) where person_id is not null;
commit;
