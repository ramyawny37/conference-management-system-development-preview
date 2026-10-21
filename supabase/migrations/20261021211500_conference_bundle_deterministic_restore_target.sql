-- Keep new-mode restore idempotent even when the caller omits a target UUID.
do $migration$
declare v_oid oid;v_definition text;v_old text;v_new text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='restore_conference_canonical_bundle'
 and pg_get_function_identity_arguments(p.oid)='p_actor_device_id uuid, p_operation_id uuid, p_bundle jsonb, p_mode text, p_target_conference_id uuid, p_expected_revision bigint, p_confirmed boolean';
 if v_oid is null then raise exception 'CONFERENCE_BUNDLE_RESTORE_NOT_FOUND'; end if;
 v_definition:=pg_get_functiondef(v_oid);
 v_old:='v_target:=coalesce(p_target_conference_id,extensions.gen_random_uuid())';
 v_new:='v_target:=coalesce(p_target_conference_id,platform_private.conference_bundle_uuid(p_operation_id,v_source))';
 if position(v_old in v_definition)=0 then raise exception 'CONFERENCE_BUNDLE_RESTORE_SHAPE_CHANGED'; end if;
 execute replace(v_definition,v_old,v_new);
end $migration$;
