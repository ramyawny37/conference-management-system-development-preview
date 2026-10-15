begin;

-- Keep the existing approved-device dispatcher as the sole entry point.  This
-- definition removes the fragile historical delete wrapper chain while
-- preserving every current cleanup and audit side effect.
create or replace function public.delete_conference_participation(
  p_actor_device_id uuid,p_operation_id uuid,p_participation_id uuid,p_expected_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_current public.conference_participations%rowtype;
  v_deleted public.conference_participations%rowtype;
  v_affected public.conference_participations[];
  v_context jsonb; v_session_context jsonb; v_actor uuid; v_authorization uuid;
  v_request jsonb; v_prior public.conference_participation_operations%rowtype; v_result jsonb;
  v_restaurant public.conference_restaurant_participation_overrides%rowtype;
  v_transport public.conference_transport_assignments%rowtype;
  v_deleted_ids jsonb:='[]'::jsonb; v_removed_transport_ids jsonb:='[]'::jsonb;
begin
  if p_operation_id is null or p_participation_id is null or p_expected_revision is null or p_expected_revision<1 then
    raise exception 'CONFERENCE_PARTICIPATION_ARGUMENT_INVALID' using errcode='22023';
  end if;
  begin
    v_session_context:=nullif(pg_catalog.current_setting('platform.phase1c_context',true),'')::jsonb;
    if v_session_context is null or v_session_context->>'purpose'<>'PLATFORM_DEVICE_SESSION_DISPATCH'
       or (v_session_context->>'device_id')::uuid is distinct from p_actor_device_id then
      raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501';
    end if;
    v_actor:=(v_session_context->>'user_id')::uuid;
  exception when invalid_text_representation or null_value_not_allowed then
    raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501';
  end;
  v_authorization:=platform_private.validated_phase1c_device_authorization(v_actor,p_actor_device_id);
  if v_authorization is null then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
  v_request:=jsonb_build_object('participationId',p_participation_id,'expectedRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':conference-participation:'||p_operation_id::text,0));
  select * into v_prior from public.conference_participation_operations where actor_user_id=v_actor and operation_id=p_operation_id;
  if found then
    if v_prior.operation<>'delete' or v_prior.request<>v_request then raise exception 'CONFERENCE_PARTICIPATION_OPERATION_MISMATCH' using errcode='22023'; end if;
    v_context:=platform_private.require_conference_participation_context(p_actor_device_id,(v_prior.result->>'conferenceId')::uuid,'conference.people.manage',false);
    if (v_context->>'actorUserId')::uuid is distinct from v_actor then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
    return v_prior.result;
  end if;
  select * into v_current from public.conference_participations where id=p_participation_id;
  if not found then raise exception 'CONFERENCE_PARTICIPATION_NOT_FOUND' using errcode='P0002'; end if;
  v_context:=platform_private.require_conference_participation_context(p_actor_device_id,v_current.conference_id,'conference.people.manage',true);
  if (v_context->>'actorUserId')::uuid is distinct from v_actor then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conference-guardian:'||v_current.conference_id::text,0));
  perform 1 from public.conference_participations where id=p_participation_id or guardian_participation_id=p_participation_id order by id for update;
  select * into v_current from public.conference_participations where id=p_participation_id;
  if not found then raise exception 'CONFERENCE_PARTICIPATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_current.revision<>p_expected_revision then raise exception 'CONFERENCE_PARTICIPATION_REVISION_CONFLICT' using errcode='40001'; end if;
  select array_agg(participation order by participation.id) into v_affected from public.conference_participations participation
  where participation.id=p_participation_id or participation.guardian_participation_id=p_participation_id;

  for v_restaurant in select item.* from public.conference_restaurant_participation_overrides item
    where item.participation_id=any(array(select affected.id from unnest(v_affected) affected)) order by item.id for update
  loop
    insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
    values(v_actor,v_authorization,'platform','conference','conference.restaurant.participation_override_removed','conference_restaurant_participation_override',v_restaurant.id,'platform',to_jsonb(v_restaurant),null,jsonb_build_object('conferenceId',v_restaurant.conference_id,'reason','participation_deleted','permissionKey','conference.people.manage'),p_operation_id,'rpc');
  end loop;
  delete from public.conference_restaurant_participation_overrides where participation_id=any(array(select affected.id from unnest(v_affected) affected));

  for v_transport in select assignment.* from public.conference_transport_assignments assignment
    where assignment.participation_id=any(array(select affected.id from unnest(v_affected) affected)) order by assignment.id for update
  loop
    insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
    values(v_actor,v_authorization,'platform','conference','conference.transport.assignment_removed','conference_transport_assignment',v_transport.id,'platform',to_jsonb(v_transport),null,jsonb_build_object('conferenceId',v_transport.conference_id,'participationId',v_transport.participation_id,'reason','participation_deleted','permissionKey','conference.people.manage'),p_operation_id,'rpc');
    v_removed_transport_ids:=v_removed_transport_ids||jsonb_build_array(v_transport.id);
  end loop;
  delete from public.conference_transport_assignments where participation_id=any(array(select affected.id from unnest(v_affected) affected));

  foreach v_deleted in array v_affected loop
    perform platform_private.cleanup_conference_accommodation_for_participation(v_deleted.id,v_actor,v_authorization,v_context,'participation_deleted',p_operation_id);
    v_deleted_ids:=v_deleted_ids||jsonb_build_array(v_deleted.id);
  end loop;
  delete from public.conference_participations where guardian_participation_id=p_participation_id;
  delete from public.conference_participations where id=p_participation_id;
  v_result:=jsonb_build_object('participationId',p_participation_id,'conferenceId',v_current.conference_id,'personId',v_current.person_id,'deleted',true,'deletedParticipationIds',v_deleted_ids,'removedTransportAssignmentIds',v_removed_transport_ids);
  insert into public.conference_participation_operations(actor_user_id,operation_id,operation,request,result,created_at)
  values(v_actor,p_operation_id,'delete',v_request,v_result,statement_timestamp());
  foreach v_deleted in array v_affected loop
    insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,old_values,new_values,metadata,operation_id,source)
    values(v_actor,v_authorization,'platform','conference','conference.participation.deleted','conference_participation',v_deleted.id,'platform',jsonb_build_object('conferenceId',v_deleted.conference_id,'personId',v_deleted.person_id,'status',v_deleted.status,'revision',v_deleted.revision,'guardianParticipationId',v_deleted.guardian_participation_id),null,jsonb_build_object('requestedParticipationId',p_participation_id,'cascade',v_deleted.id<>p_participation_id,'permissionKey','conference.people.manage','authoritySource',v_context->>'authoritySource','grantId',v_context->'grantId'),p_operation_id,'rpc');
  end loop;
  return v_result;
end $$;

revoke all on function public.delete_conference_participation(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.delete_conference_participation(uuid,uuid,uuid,bigint) to service_role;

do $$
declare v_router regprocedure:='platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure; v_definition text;
begin
  v_definition:=pg_get_functiondef(v_router);
  if position('p_operation=''search_conference_people''' in v_definition)=0
     or position('p_operation=''get_conference_canonical_person''' in v_definition)=0
     or position('p_operation=''update_conference_canonical_person''' in v_definition)=0
     or position('p_operation=''create_conference_participation''' in v_definition)=0
     or position('p_operation=''create_conference_participation_with_person''' in v_definition)=0
     or position('p_operation=''delete_conference_participation''' in v_definition)=0 then
    raise exception 'CONFERENCE_PEOPLE_ROUTER_CONTRACT_INCOMPLETE' using errcode='55000';
  end if;
  if to_regprocedure('public.search_conference_people(uuid,uuid,text,integer)') is null
     or to_regprocedure('public.get_conference_canonical_person(uuid,uuid,uuid)') is null
     or to_regprocedure('public.update_conference_canonical_person(uuid,uuid,uuid,bigint,text,text,text,text,date)') is null
     or to_regprocedure('public.create_conference_participation(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.create_conference_participation_with_person(uuid,uuid,uuid,text,text,text,date,text)') is null
     or to_regprocedure('platform_private.cleanup_conference_accommodation_for_participation(uuid,uuid,uuid,jsonb,text,uuid)') is null
     or to_regclass('public.conference_transport_assignments') is null
     or to_regclass('public.conference_restaurant_participation_overrides') is null then
    raise exception 'CONFERENCE_PEOPLE_FUNCTION_CONTRACT_INCOMPLETE' using errcode='55000';
  end if;
end $$;

commit;
