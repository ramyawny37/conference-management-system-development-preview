begin;

-- Reservations authority is module-scoped and independent from Conference
-- administration membership. Conference-linked reservation operations remain
-- tenant-bound through the Conference organization and active organization
-- membership, while Conference administration permissions remain untouched.
create or replace function reservations_private.conference_context(
  p_device_id uuid,
  p_conference_id uuid,
  p_permission text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_context jsonb;
  v_actor uuid;
  v_organization_id uuid;
begin
  v_context:=public.require_effective_module_permission(
    p_device_id,'reservations',p_permission,null,null
  );
  v_actor:=(v_context->>'actorUserId')::uuid;

  select c.organization_id
    into v_organization_id
  from public.conferences c
  join public.organizations o
    on o.id=c.organization_id
   and o.status='active'
  join public.organization_members om
    on om.organization_id=c.organization_id
   and om.user_id=v_actor
  where c.id=p_conference_id
    and c.deleted_at is null;

  if not found or v_organization_id is null then
    raise exception 'RESERVATIONS_CONFERENCE_ACCESS_REQUIRED' using errcode='42501';
  end if;

  return v_context||jsonb_build_object(
    'conferenceId',p_conference_id,
    'organizationId',v_organization_id,
    'scopeType','conference',
    'scopePartitionId',p_conference_id
  );
end $$;

-- Booking entry needs only the minimum target discovery data. A user with
-- reservations.booking.create may discover Conference names in organizations
-- they belong to without receiving reservations.event.view or any Conference
-- administration authority. Event viewers retain the same discovery ability.
create or replace function reservations_private.booking_target_context(
  p_device_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_context jsonb;
begin
  begin
    v_context:=public.require_effective_module_permission(
      p_device_id,'reservations','reservations.event.view',null,null
    );
  exception when sqlstate '42501' then
    v_context:=public.require_effective_module_permission(
      p_device_id,'reservations','reservations.booking.create',null,null
    );
  end;
  return v_context;
end $$;

create or replace function reservations.read(
  p_device_id uuid,
  p_operation text,
  p_args jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_context jsonb;
  v_actor uuid;
begin
  if p_operation='list_conference_options' then
    if p_args is null or jsonb_typeof(p_args)<>'object' then
      raise exception 'RESERVATIONS_READ_ARGUMENTS_INVALID' using errcode='22023';
    end if;
    perform platform_private.require_exact_jsonb_keys(p_args,array[]::text[]);
    v_context:=reservations_private.booking_target_context(p_device_id);
    v_actor:=(v_context->>'actorUserId')::uuid;

    return (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('conferenceId',c.id,'name',c.name)
          order by c.name,c.id
        ),
        '[]'::jsonb
      )
      from public.conferences c
      join public.organizations o
        on o.id=c.organization_id
       and o.status='active'
      join public.organization_members om
        on om.organization_id=c.organization_id
       and om.user_id=v_actor
      where c.deleted_at is null
    );
  end if;

  return reservations_private.read_scoped(p_device_id,p_operation,p_args);
end $$;

revoke all on function reservations_private.conference_context(uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function reservations_private.conference_context(uuid,uuid,text)
to postgres;

revoke all on function reservations_private.booking_target_context(uuid)
from public,anon,authenticated,service_role;
grant execute on function reservations_private.booking_target_context(uuid)
to postgres;

revoke all on function reservations.read(uuid,text,jsonb)
from public,anon,authenticated;
grant execute on function reservations.read(uuid,text,jsonb)
to service_role;

commit;
