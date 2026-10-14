-- Preserve conference-scoped authorization in the shared canonical person writer.
begin;
do $do$
declare v_original text;v_old text;v_new text;
begin
 v_original:=pg_get_functiondef('platform_private.update_canonical_person(uuid,uuid,uuid,bigint,jsonb,uuid,text,text,jsonb)'::regprocedure);
 v_old:=' perform public.require_effective_module_permission(p_device_id,p_module,p_permission,null,null);';
 v_new:=' if p_module=''conference'' then'||chr(10)||
 '  if nullif(p_metadata->>''conferenceId'','''') is null then raise exception ''CONFERENCE_PERSON_SCOPE_REQUIRED'' using errcode=''42501'';end if;'||chr(10)||
 '  perform platform_private.require_conference_participation_context(p_device_id,(p_metadata->>''conferenceId'')::uuid,''conference.people.manage'',true);'||chr(10)||
 '  if not exists(select 1 from public.conference_participations where conference_id=(p_metadata->>''conferenceId'')::uuid and person_id=p_person_id) then raise exception ''CONFERENCE_PERSON_NOT_PARTICIPATING'' using errcode=''42501'';end if;'||chr(10)||
 ' else'||chr(10)||
 '  perform public.require_effective_module_permission(p_device_id,p_module,p_permission,null,null);'||chr(10)||
 ' end if;';
 if length(v_original)-length(replace(v_original,v_old,''))<>length(v_old) then raise exception 'SHARED_PERSON_SCOPE_ANCHOR_NOT_UNIQUE';end if;
 execute replace(v_original,v_old,v_new);
end $do$;
commit;
