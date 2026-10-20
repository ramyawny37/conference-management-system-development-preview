begin;
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.assign_conference_house(uuid,uuid,uuid,uuid,boolean,bigint)'::regprocedure);
 d:=replace(d,'declare context jsonb;actor uuid;auth_id uuid;row public.conference_house_assignments%rowtype;result jsonb;',
   'declare context jsonb;actor uuid;auth_id uuid;row public.conference_house_assignments%rowtype;result jsonb;prior jsonb;');
 d:=replace(d,'begin\n context:=platform_private.require_conference_accommodation_context',
   E'begin\n if p_operation_id is null then raise exception ''HOUSE_ASSIGNMENT_ARGUMENT_INVALID'' using errcode=''22023'';end if;\n context:=platform_private.require_conference_accommodation_context');
 d:=replace(d,'actor:=(context->>''actorUserId'')::uuid;auth_id:=platform_private.validated_phase1c_device_authorization(actor,p_device);',
   E'actor:=(context->>''actorUserId'')::uuid;auth_id:=platform_private.validated_phase1c_device_authorization(actor,p_device);\n perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''conference-house:''||p_house::text,0));\n select new_values into prior from platform.audit_events where actor_user_id=actor and operation_id=p_operation_id and action in(''conference.house.assigned'',''conference.house.unassigned'') limit 1;\n if prior is not null then return prior||jsonb_build_object(''status'',''duplicate'');end if;');
 d:=replace(d,'if row.id is null then select * into row from public.conference_house_assignments where conference_id=p_conference and house_id=p_house;end if;',
   'if row.id is null then select * into row from public.conference_house_assignments where conference_id=p_conference and house_id=p_house;return jsonb_build_object(''status'',''duplicate'',''assignmentId'',row.id,''conferenceId'',p_conference,''houseId'',p_house,''revision'',row.revision,''assigned'',true);end if;');
 execute d;
end $patch$;
commit;
