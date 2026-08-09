begin;

create or replace function public.enforce_launch_conference_member_contract()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  conference_organization_id uuid;
  conference_organization_status text;
begin
  if new.role in ('accommodation_viewer','transport_viewer')
    and (tg_op = 'INSERT' or new.role is distinct from old.role) then
    raise exception 'SECTION_VIEWER_ASSIGNMENT_DISABLED' using errcode = '42501';
  end if;

  select conferences.organization_id, organizations.status
    into conference_organization_id, conference_organization_status
    from public.conferences as conferences
    left join public.organizations as organizations
      on organizations.id = conferences.organization_id
   where conferences.id = new.conference_id;

  if conference_organization_id is null then
    raise exception 'CONFERENCE_ORGANIZATION_REQUIRED' using errcode = '23514';
  end if;
  if conference_organization_status <> 'active' then
    raise exception 'CONFERENCE_ORGANIZATION_INACTIVE' using errcode = '55000';
  end if;
  if not exists (
    select 1
      from public.organization_members as organization_members
     where organization_members.organization_id = conference_organization_id
       and organization_members.user_id = new.user_id
  ) then
    raise exception 'CONFERENCE_MEMBER_ORGANIZATION_REQUIRED' using errcode = '42501';
  end if;

  return new;
end;
$$;

commit;
