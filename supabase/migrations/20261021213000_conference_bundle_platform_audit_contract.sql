-- Use the existing Platform audit taxonomy; no parallel Conference ledger.
do $migration$
declare v_oid oid;v_definition text;
begin
 select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='restore_conference_canonical_bundle'
 and pg_get_function_identity_arguments(p.oid)='p_actor_device_id uuid, p_operation_id uuid, p_bundle jsonb, p_mode text, p_target_conference_id uuid, p_expected_revision bigint, p_confirmed boolean';
 if v_oid is null then raise exception 'CONFERENCE_BUNDLE_RESTORE_NOT_FOUND'; end if;
 v_definition:=pg_get_functiondef(v_oid);
 if position('v_actor,v_auth,''conference'',''conference''' in v_definition)=0 then raise exception 'CONFERENCE_BUNDLE_AUDIT_SHAPE_CHANGED'; end if;
 v_definition:=replace(v_definition,'v_actor,v_auth,''conference'',''conference''','v_actor,v_auth,''platform'',''conference''');
 v_definition:=replace(v_definition,'p_operation_id,''device_session''','p_operation_id,''rpc''');
 execute v_definition;
end $migration$;
