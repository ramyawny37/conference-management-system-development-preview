begin;

create or replace function public.device_guarded_list_eligible_legacy_conference_organizations(
  p_actor_device_id uuid,
  p_conference_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  conference_row public.conferences%rowtype;
  eligible_organizations jsonb;
begin
  actor_id := public.require_current_approved_device(p_actor_device_id);

  if p_conference_id is null then
    raise exception 'INVALID_PREFLIGHT_REQUEST' using errcode = '22023';
  end if;

  select conferences.* into conference_row
    from public.conferences as conferences
   where conferences.id = p_conference_id;

  if not found or conference_row.organization_id is not null then
    raise exception 'LEGACY_CONFERENCE_PREFLIGHT_UNAVAILABLE' using errcode = '42501';
  end if;

  if not public.is_system_owner(actor_id)
     and not exists (
       select 1 from public.organization_members as actor_memberships
        where actor_memberships.user_id = actor_id
          and actor_memberships.role = 'organization_owner'
     ) then
    raise exception 'LEGACY_CONFERENCE_PREFLIGHT_UNAVAILABLE' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'organizationId', organizations.id,
    'displayName', organizations.display_name,
    'organizationStatus', organizations.status,
    'eligibility', true
  ) order by organizations.display_name, organizations.id), '[]'::jsonb)
    into eligible_organizations
    from public.organizations as organizations
   where organizations.status = 'active'
     and (public.is_system_owner(actor_id) or exists (
       select 1 from public.organization_members as actor_memberships
        where actor_memberships.organization_id = organizations.id
          and actor_memberships.user_id = actor_id
          and actor_memberships.role = 'organization_owner'
     ))
     and exists (
       select 1 from public.organization_members as owner_memberships
        where owner_memberships.organization_id = organizations.id
          and owner_memberships.user_id = conference_row.owner_id
     )
     and not exists (
       select 1 from public.conference_members as conference_members
        where conference_members.conference_id = p_conference_id
          and not exists (
            select 1 from public.organization_members as member_memberships
             where member_memberships.organization_id = organizations.id
               and member_memberships.user_id = conference_members.user_id
          )
     );

  return jsonb_build_object(
    'status', 'eligible_organizations',
    'organizations', eligible_organizations
  );
end;
$$;

revoke all on function public.device_guarded_list_eligible_legacy_conference_organizations(uuid, uuid)
  from public, anon;
grant execute on function public.device_guarded_list_eligible_legacy_conference_organizations(uuid, uuid)
  to authenticated;

commit;
