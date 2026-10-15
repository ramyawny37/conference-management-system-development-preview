begin;

create or replace function public.list_conference_activity(p_actor_device_id uuid,p_conference_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.require_effective_module_permission(p_actor_device_id,'conference','conference.settings.view','conference',p_conference_id::text);
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId',e.id,'action',e.action,'entityId',e.entity_id,
    'person',case when e.action='platform.person.updated' then (select jsonb_build_object('personId',person.id,'fullName',person.full_name,'phone',person.phone,'church',person.church,'gender',person.gender,'dateOfBirth',person.date_of_birth,'revision',person.revision) from platform.people person where person.id=e.entity_id) else null end,
    'section',case when e.action='platform.person.updated' then 'people' when e.action like 'conference.branding.%' then 'settings' when e.action like 'conference.accommodation.%' then 'accommodation' when e.action like 'conference.output.%' then 'cards' else 'conference' end,
    'title',case e.action when 'conference.branding.changed' then 'تم تعديل هوية المؤتمر' when 'conference.output.card_shared' then 'تمت مشاركة كارت' when 'conference.output.card_printed' then 'تمت طباعة كارت' when 'conference.output.cards_printed' then 'تمت طباعة الكروت' else 'تم تحديث بيانات المؤتمر' end,
    'createdAt',e.occurred_at
  ) order by e.occurred_at desc,e.id desc),'[]'::jsonb) into result
  from (
    select event.* from platform.audit_events event
    where event.action in('conference.core.updated','conference.lifecycle.completed','conference.branding.changed','conference.participation.created','conference.participation.status_changed','conference.participation.guardian_changed','conference.participation.deleted','conference.accommodation.assigned','conference.accommodation.moved','conference.accommodation.removed','conference.accommodation.pricing_updated','conference.accommodation.pricing_room_excluded','conference.accommodation.pricing_room_included','conference.transport.assignment_set','conference.transport.assignment_removed','conference.restaurant.participation_override_removed','conference.air_conditioning.configuration_changed','conference.finance.changed','conference.output.card_shared','conference.output.card_printed','conference.output.cards_printed','platform.person.updated')
      and (
        event.module='conference' and event.metadata->>'conferenceId'=p_conference_id::text
        or event.action='platform.person.updated' and event.module='reservations'
          and exists(select 1 from reservations.events reservations_event where reservations_event.id::text=event.metadata->>'eventId' and reservations_event.conference_id=p_conference_id)
          and exists(select 1 from public.conference_participations participation where participation.conference_id=p_conference_id and participation.person_id=event.entity_id)
      )
    order by event.occurred_at desc,event.id desc limit 200
  ) e;
  return jsonb_build_object('conferenceId',p_conference_id,'items',result);
end $$;

revoke all on function public.list_conference_activity(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_conference_activity(uuid,uuid) to service_role;

commit;
