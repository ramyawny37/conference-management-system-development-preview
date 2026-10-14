-- Exact canonical person read for editing an existing conference participant.
begin;
create function public.get_conference_canonical_person(p_actor_device_id uuid,p_conference_id uuid,p_person_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare v_person platform.people%rowtype;
begin
 perform platform_private.require_conference_participation_context(p_actor_device_id,p_conference_id,'conference.people.view',false);
 if p_person_id is null or not exists(select 1 from public.conference_participations where conference_id=p_conference_id and person_id=p_person_id) then
  raise exception 'CONFERENCE_PERSON_NOT_PARTICIPATING' using errcode='42501';
 end if;
 select * into v_person from platform.people where id=p_person_id;
 if not found then raise exception 'PERSON_NOT_FOUND' using errcode='P0002';end if;
 return jsonb_build_object('personId',v_person.id,'fullName',v_person.full_name,'phone',v_person.phone,'church',v_person.church,'gender',v_person.gender,'dateOfBirth',v_person.date_of_birth,'revision',v_person.revision);
end $body$;
revoke all on function public.get_conference_canonical_person(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_conference_canonical_person(uuid,uuid,uuid) to service_role;
do $do$
declare v_original text;v_anchor text;v_added text;
begin
 v_original:=pg_get_functiondef('platform_private.route_canonical_conference_operation(uuid,uuid,bytea,uuid,text,jsonb)'::regprocedure);
 v_anchor:='  elsif p_operation=''search_conference_people'' then';
 if length(v_original)-length(replace(v_original,v_anchor,''))<>length(v_anchor) then raise exception 'CONFERENCE_ROUTE_ANCHOR_NOT_UNIQUE';end if;
 v_added:='  elsif p_operation=''get_conference_canonical_person'' then'||chr(10)||
 '    perform platform_private.require_exact_jsonb_keys(p_args,array[''p_conference_id'',''p_person_id'']);'||chr(10)||
 '    return public.get_conference_canonical_person(p_actor_device_id,(p_args->>''p_conference_id'')::uuid,(p_args->>''p_person_id'')::uuid);'||chr(10);
 execute replace(v_original,v_anchor,v_added||v_anchor);
end $do$;
commit;
