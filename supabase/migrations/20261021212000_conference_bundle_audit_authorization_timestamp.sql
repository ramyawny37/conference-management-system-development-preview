-- Align bundle audit attribution with the canonical authorization timestamp.
do $migration$
declare v_oid oid;v_definition text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='restore_conference_canonical_bundle'
 and pg_get_function_identity_arguments(p.oid)='p_actor_device_id uuid, p_operation_id uuid, p_bundle jsonb, p_mode text, p_target_conference_id uuid, p_expected_revision bigint, p_confirmed boolean';
 if v_oid is null then raise exception 'CONFERENCE_BUNDLE_RESTORE_NOT_FOUND'; end if;
 v_definition:=pg_get_functiondef(v_oid);
 if position('order by reviewed_at desc nulls last' in v_definition)=0 then raise exception 'CONFERENCE_BUNDLE_AUDIT_SHAPE_CHANGED'; end if;
 execute replace(v_definition,'order by reviewed_at desc nulls last','order by approved_at desc nulls last');
end $migration$;
