begin;

drop trigger if exists conference_transport_resident_assignment on public.conference_transport_assignments;
create trigger conference_transport_resident_assignment
before insert or update on public.conference_transport_assignments
for each row execute function platform_private.enforce_transport_resident_assignment();

commit;
