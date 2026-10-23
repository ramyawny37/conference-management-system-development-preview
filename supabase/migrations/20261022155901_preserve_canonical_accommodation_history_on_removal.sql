begin;

-- Keep the canonical occupancy table as the sole source of room-night history.
-- Cancellation before arrival removes the future reservation; a stay already
-- underway is closed at the first unconsumed night.
create or replace function public.remove_conference_accommodation(
 p_device uuid,p_conference uuid,p_occupancy uuid,p_expected bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 context jsonb; actor uuid; device_authorization uuid;
 current public.conference_accommodation_occupancies%rowtype;
 conference_start date; conference_days integer; effective_day integer;
 removed boolean; result jsonb;
begin
 context:=platform_private.require_conference_accommodation_context(
   p_device,p_conference,'conference.accommodation.manage',true);
 actor:=(context->>'actorUserId')::uuid;
 device_authorization:=platform_private.validated_phase1c_device_authorization(actor,p_device);
 select c.start_date,(c.end_date-c.start_date+1)::integer
   into conference_start,conference_days
   from public.conferences c where c.id=p_conference and c.deleted_at is null;
 if conference_start is null or conference_days is null then
   raise exception 'CONFERENCE_CORE_NOT_FOUND' using errcode='P0002';
 end if;
 effective_day:=greatest(1,least(conference_days+1,(current_date-conference_start+1)::integer));
 select * into current from public.conference_accommodation_occupancies
   where id=p_occupancy and conference_id=p_conference for update;
 if not found then raise exception 'ACCOMMODATION_OCCUPANCY_NOT_FOUND' using errcode='P0002';end if;
 if current.revision<>p_expected then raise exception 'ACCOMMODATION_REVISION_CONFLICT' using errcode='40001';end if;
 if current.arrival_day>=effective_day then
   delete from public.conference_accommodation_occupancies where id=current.id;
   removed:=true;
 elsif coalesce(current.leave_day,conference_days+1)>effective_day then
   update public.conference_accommodation_occupancies
      set leave_day=effective_day,revision=revision+1,
          updated_at=statement_timestamp(),updated_by=actor
    where id=current.id;
   removed:=false;
 else
   -- A completed historical segment must never be erased.
   raise exception 'ACCOMMODATION_HISTORICAL_STAY_IMMUTABLE' using errcode='55000';
 end if;
 result:=jsonb_build_object('occupancyId',current.id,'deleted',removed,
   'historicalSegmentPreserved',not removed,'effectiveDay',effective_day);
 insert into platform.audit_events(
   actor_user_id,actor_device_authorization_id,domain,module,action,
   entity_type,entity_id,scope_type,old_values,new_values,metadata,source)
 values(actor,device_authorization,'platform','conference','conference.accommodation.removed',
   'accommodation_occupancy',current.id,'platform',to_jsonb(current),result,
   jsonb_build_object('conferenceId',p_conference,'participationId',current.participation_id,
     'effectiveDay',effective_day,'historicalSegmentPreserved',not removed,
     'permissionKey','conference.accommodation.manage',
     'authoritySource',context->>'authoritySource','grantId',context->'grantId'),'rpc');
 return result;
end $$;

commit;
