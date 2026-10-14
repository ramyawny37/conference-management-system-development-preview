-- One canonical writer for both Reservations and Conference, with scoped permission checks in callers.
begin;
create function platform_private.update_canonical_person(p_device_id uuid,p_actor uuid,p_person_id uuid,p_expected_revision bigint,p_patch jsonb,p_operation_id uuid,p_module text,p_permission text,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare v_person platform.people%rowtype;v_authorization uuid;v_allowed text[];
begin
 if p_module='conference' and p_permission='conference.people.manage' then
  v_allowed:=array['fullName','phone','church','gender','dateOfBirth'];
 elsif p_module='reservations' and p_permission='reservations.people.manage' then
  v_allowed:=array['fullName','phone','church'];
 else raise exception 'PERSON_UPDATE_MODULE_INVALID' using errcode='42501';end if;
 if p_actor is null or p_person_id is null or p_expected_revision is null or p_expected_revision<1 or p_patch is null or jsonb_typeof(p_patch)<>'object' or not (p_patch ? 'fullName') then
  raise exception 'PERSON_UPDATE_ARGUMENT_INVALID' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_patch) k where not k=any(v_allowed)) then raise exception 'PERSON_UPDATE_ARGUMENT_UNKNOWN' using errcode='22023';end if;
 if length(btrim(coalesce(p_patch->>'fullName','')))=0 or length(btrim(p_patch->>'fullName'))>240 or p_patch ? 'gender' and p_patch->>'gender' is not null and p_patch->>'gender' not in('male','female') or p_patch ? 'dateOfBirth' and p_patch->>'dateOfBirth' is not null and (p_patch->>'dateOfBirth')::date>current_date then
  raise exception 'PERSON_UPDATE_ARGUMENT_INVALID' using errcode='22023';end if;
 v_authorization:=platform_private.validated_phase1c_device_authorization(p_actor,p_device_id);
 if v_authorization is null then raise exception 'APPROVED_DEVICE_SESSION_REQUIRED' using errcode='42501';end if;
 perform public.require_effective_module_permission(p_device_id,p_module,p_permission,null,null);
 update platform.people set full_name=btrim(p_patch->>'fullName'),
 phone=case when p_patch ? 'phone' then nullif(btrim(coalesce(p_patch->>'phone','')),'') else phone end,
 church=case when p_patch ? 'church' then nullif(btrim(coalesce(p_patch->>'church','')),'') else church end,
 gender=case when p_patch ? 'gender' then p_patch->>'gender' else gender end,
 date_of_birth=case when p_patch ? 'dateOfBirth' then (p_patch->>'dateOfBirth')::date else date_of_birth end,
 revision=revision+1,updated_at=statement_timestamp(),updated_by=p_actor
 where id=p_person_id and revision=p_expected_revision returning * into v_person;
 if not found then raise exception 'PERSON_REVISION_CONFLICT' using errcode='40001';end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,new_values,metadata,operation_id,source)
 values(p_actor,v_authorization,'platform',p_module,'platform.person.updated','person',p_person_id,'platform',jsonb_build_object('id',p_person_id,'fullName',v_person.full_name,'phone',v_person.phone,'church',v_person.church,'gender',v_person.gender,'dateOfBirth',v_person.date_of_birth),coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('expectedRevision',p_expected_revision,'permissionKey',p_permission),p_operation_id,'rpc');
 return jsonb_build_object('personId',v_person.id,'fullName',v_person.full_name,'phone',v_person.phone,'church',v_person.church,'gender',v_person.gender,'dateOfBirth',v_person.date_of_birth,'revision',v_person.revision);
end $body$;
revoke all on function platform_private.update_canonical_person(uuid,uuid,uuid,bigint,jsonb,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function platform_private.update_canonical_person(uuid,uuid,uuid,bigint,jsonb,uuid,text,text,jsonb) to service_role;
create or replace function public.update_conference_canonical_person(p_actor_device_id uuid,p_conference_id uuid,p_person_id uuid,p_expected_revision bigint,p_full_name text,p_phone text,p_church text,p_gender text,p_date_of_birth date)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare v_context jsonb;v_actor uuid;
begin
 v_context:=platform_private.require_conference_participation_context(p_actor_device_id,p_conference_id,'conference.people.manage',true);
 v_actor:=(v_context->>'actorUserId')::uuid;
 if not exists(select 1 from public.conference_participations where conference_id=p_conference_id and person_id=p_person_id) then raise exception 'CONFERENCE_PERSON_NOT_PARTICIPATING' using errcode='42501';end if;
 return platform_private.update_canonical_person(p_actor_device_id,v_actor,p_person_id,p_expected_revision,jsonb_build_object('fullName',p_full_name,'phone',p_phone,'church',p_church,'gender',p_gender,'dateOfBirth',p_date_of_birth),null,'conference','conference.people.manage',jsonb_build_object('conferenceId',p_conference_id));
end $body$;
do $do$
declare v_original text;v_old text;v_new text;
begin
 v_original:=pg_get_functiondef('reservations_private.mutate_scoped(uuid,text,jsonb)'::regprocedure);
 v_old:='    update platform.people set full_name=btrim(p_args->>''p_full_name''),phone=nullif(btrim(coalesce(p_args->>''p_phone'','''')),''''),church=nullif(btrim(coalesce(p_args->>''p_church'','''')),''''),revision=revision+1,updated_at=statement_timestamp(),updated_by=v_actor'||chr(10)||
 '    where id=v_person_id and revision=(p_args->>''p_person_update_revision'')::bigint returning id into v_id;'||chr(10)||
 '    if not found then raise exception ''PERSON_REVISION_CONFLICT'' using errcode=''40001''; end if;'||chr(10)||
 '    insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,new_values,metadata,operation_id,source)'||chr(10)||
 '    values(v_actor,(select id from platform.user_device_authorizations where device_id=p_device_id and user_id=v_actor and status=''approved'' limit 1),''platform'',''reservations'',''platform.person.updated'',''person'',v_person_id,''platform'',jsonb_build_object(''id'',v_person_id,''fullName'',btrim(p_args->>''p_full_name''),''phone'',nullif(btrim(coalesce(p_args->>''p_phone'','''')),''''),''church'',nullif(btrim(coalesce(p_args->>''p_church'','''')),'''')),jsonb_build_object(''eventId'',v_event.id,''expectedRevision'',(p_args->>''p_person_update_revision'')::bigint,''permissionKey'',''reservations.people.manage''),v_operation_id,''rpc'');';
 v_new:='    perform platform_private.update_canonical_person(p_device_id,v_actor,v_person_id,(p_args->>''p_person_update_revision'')::bigint,jsonb_build_object(''fullName'',p_args->>''p_full_name'',''phone'',p_args->>''p_phone'',''church'',p_args->>''p_church''),v_operation_id,''reservations'',''reservations.people.manage'',jsonb_build_object(''eventId'',v_event.id));';
 if length(v_original)-length(replace(v_original,v_old,''))<>length(v_old) then raise exception 'RESERVATIONS_PERSON_UPDATE_ANCHOR_NOT_UNIQUE';end if;
 execute replace(v_original,v_old,v_new);
end $do$;
commit;
