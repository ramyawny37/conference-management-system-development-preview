-- Canonical platform.people update via the existing conference device dispatcher.
begin;
create function public.update_conference_canonical_person(p_actor_device_id uuid,p_conference_id uuid,p_person_id uuid,p_expected_revision bigint,p_full_name text,p_phone text,p_church text,p_gender text,p_date_of_birth date)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare v_context jsonb;v_actor uuid;v_device_authorization uuid;v_person platform.people%rowtype;
begin
 v_context:=platform_private.require_conference_participation_context(p_actor_device_id,p_conference_id,'conference.people.manage',true);
 v_actor:=(v_context->>'actorUserId')::uuid;
 v_device_authorization:=platform_private.validated_phase1c_device_authorization(v_actor,p_actor_device_id);
 if p_person_id is null or p_expected_revision is null or p_expected_revision<1 or length(btrim(coalesce(p_full_name,'')))=0 or length(btrim(p_full_name))>240 or p_gender is not null and p_gender not in ('male','female') or p_date_of_birth>current_date then
  raise exception 'PERSON_UPDATE_ARGUMENT_INVALID' using errcode='22023';
 end if;
 if not exists(select 1 from public.conference_participations where conference_id=p_conference_id and person_id=p_person_id) then
  raise exception 'CONFERENCE_PERSON_NOT_PARTICIPATING' using errcode='42501';
 end if;
 update platform.people set full_name=btrim(p_full_name),phone=nullif(btrim(coalesce(p_phone,'')),''),church=nullif(btrim(coalesce(p_church,'')),''),gender=p_gender,date_of_birth=p_date_of_birth,revision=revision+1,updated_at=statement_timestamp(),updated_by=v_actor
 where id=p_person_id and revision=p_expected_revision returning * into v_person;
 if not found then raise exception 'PERSON_REVISION_CONFLICT' using errcode='40001';end if;
 insert into platform.audit_events(actor_user_id,actor_device_authorization_id,domain,module,action,entity_type,entity_id,scope_type,new_values,metadata,source)
 values(v_actor,v_device_authorization,'platform','conference','platform.person.updated','person',p_person_id,'platform',jsonb_build_object('id',p_person_id,'fullName',v_person.full_name,'phone',v_person.phone,'church',v_person.church,'gender',v_person.gender,'dateOfBirth',v_person.date_of_birth),jsonb_build_object('conferenceId',p_conference_id,'expectedRevision',p_expected_revision,'permissionKey','conference.people.manage'),'rpc');
 return jsonb_build_object('personId',v_person.id,'fullName',v_person.full_name,'phone',v_person.phone,'church',v_person.church,'gender',v_person.gender,'dateOfBirth',v_person.date_of_birth,'revision',v_person.revision);
end $body$;
revoke all on function public.update_conference_canonical_person(uuid,uuid,uuid,bigint,text,text,text,text,date) from public,anon,authenticated;
grant execute on function public.update_conference_canonical_person(uuid,uuid,uuid,bigint,text,text,text,text,date) to service_role;
do $do$
declare v_original text;v_anchor text;v_added text;
begin
 v_original:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
 v_anchor:='  elsif p_operation=''search_conference_people'' then';
 if length(v_original)-length(replace(v_original,v_anchor,''))<>length(v_anchor) then raise exception 'CONFERENCE_ROUTE_ANCHOR_NOT_UNIQUE';end if;
 v_added:='  elsif p_operation=''update_conference_canonical_person'' then'||chr(10)||
 '    perform platform_private.require_exact_jsonb_keys(p_args,array[''p_conference_id'',''p_person_id'',''p_expected_revision'',''p_full_name'',''p_phone'',''p_church'',''p_gender'',''p_date_of_birth'']);'||chr(10)||
 '    return public.update_conference_canonical_person(p_actor_device_id,(p_args->>''p_conference_id'')::uuid,(p_args->>''p_person_id'')::uuid,(p_args->>''p_expected_revision'')::bigint,p_args->>''p_full_name'',p_args->>''p_phone'',p_args->>''p_church'',p_args->>''p_gender'',(p_args->>''p_date_of_birth'')::date);'||chr(10);
 execute replace(v_original,v_anchor,v_added||v_anchor);
end $do$;
commit;
