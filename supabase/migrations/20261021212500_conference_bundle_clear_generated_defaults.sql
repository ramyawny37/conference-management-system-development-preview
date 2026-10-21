-- Conference creation triggers generate defaults. Clear only the new/target
-- Conference operational rows before inserting the validated bundle sections.
do $migration$
declare v_oid oid;v_definition text;v_old text;v_new text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='restore_conference_canonical_bundle'
 and pg_get_function_identity_arguments(p.oid)='p_actor_device_id uuid, p_operation_id uuid, p_bundle jsonb, p_mode text, p_target_conference_id uuid, p_expected_revision bigint, p_confirmed boolean';
 if v_oid is null then raise exception 'CONFERENCE_BUNDLE_RESTORE_NOT_FOUND'; end if;
 v_definition:=pg_get_functiondef(v_oid);
 v_old:=E'if p_mode=\'replace\' then\n  foreach v_table in array v_delete_order loop execute format(\'delete from public.%I where conference_id=$1\',v_table) using v_target; end loop;';
 v_definition:=replace(v_definition,v_old,E'if p_mode=\'replace\' then');
 v_old:=E' end if;\n -- Guardians are linked after every participation exists.';
 v_new:=E' end if;\n foreach v_table in array v_delete_order loop execute format(\'delete from public.%I where conference_id=$1\',v_table) using v_target; end loop;\n -- Guardians are linked after every participation exists.';
 if position(v_old in v_definition)=0 then raise exception 'CONFERENCE_BUNDLE_DEFAULT_CLEAR_SHAPE_CHANGED'; end if;
 execute replace(v_definition,v_old,v_new);
end $migration$;
