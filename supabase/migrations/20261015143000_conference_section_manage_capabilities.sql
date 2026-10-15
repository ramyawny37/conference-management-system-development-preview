begin;

do $$ begin
  if to_regprocedure('public.require_current_approved_device(uuid)') is null
     or to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is null then
    raise exception 'CONFERENCE_SECTION_MANAGE_CAPABILITY_PREREQUISITE_REQUIRED' using errcode='55000';
  end if;
  if exists(select 1 from (values
      ('conference.people.manage'),('conference.accommodation.manage')
    ) required(code) where not exists(
      select 1 from platform.permissions permission
      where permission.code=required.code and permission.domain='conference'
        and permission.status='active'
    )) then
    raise exception 'CONFERENCE_SECTION_MANAGE_CAPABILITY_CATALOG_REQUIRED' using errcode='55000';
  end if;
end $$;

create or replace function public.list_accessible_conferences(p_actor_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_conference public.conferences%rowtype;
  v_items jsonb:='[]'::jsonb;
  v_capabilities jsonb;
  v_permission text;
  v_capability text;
begin
  perform public.require_current_approved_device(p_actor_device_id);
  for v_conference in
    select conferences.* from public.conferences conferences
    where conferences.deleted_at is null order by conferences.created_at,conferences.id
  loop
    begin
      perform public.require_effective_module_permission(
        p_actor_device_id,'conference','conference.access.view','conference',v_conference.id::text);
      v_capabilities:=jsonb_build_object('core',true);
      for v_permission,v_capability in select * from (values
        ('conference.people.view','people'),
        ('conference.people.manage','peopleManage'),
        ('conference.accommodation.view','accommodation'),
        ('conference.accommodation.manage','accommodationManage'),
        ('conference.air_conditioning.view','airConditioning'),
        ('conference.cards.view','branding'),
        ('conference.accounts.view','finance'),
        ('conference.transport.view','transport'),
        ('conference.restaurant.view','restaurant')
      ) permissions(permission_code,capability_key)
      loop
        begin
          perform public.require_effective_module_permission(
            p_actor_device_id,'conference',v_permission,'conference',v_conference.id::text);
          v_capabilities:=v_capabilities||jsonb_build_object(v_capability,true);
        exception when insufficient_privilege then
          v_capabilities:=v_capabilities||jsonb_build_object(v_capability,false);
        end;
      end loop;
      v_items:=v_items||jsonb_build_array(jsonb_build_object(
        'conferenceId',v_conference.id,'name',v_conference.name,
        'startDate',v_conference.start_date,'endDate',v_conference.end_date,
        'status',v_conference.status,'completedAt',v_conference.completed_at,
        'revision',v_conference.revision,'createdAt',v_conference.created_at,
        'updatedAt',v_conference.updated_at,'capabilities',v_capabilities));
    exception when insufficient_privilege then null;
    end;
  end loop;
  return jsonb_build_object('conferences',v_items);
end $$;

revoke all on function public.list_accessible_conferences(uuid)
  from public,anon,authenticated,service_role;

comment on function public.list_accessible_conferences(uuid) is
'Canonical Conference discovery. Exact read and manage capabilities are independently resolved for each Conference section; no permission implies another.';

commit;
