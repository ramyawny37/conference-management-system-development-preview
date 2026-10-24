-- Repair ambiguous room_id references in the existing canonical accommodation RPC.
-- Keep authorization, locking, audit and operation semantics unchanged.
DO $migration$
DECLARE fn_oid oid; definition text; updated text;
BEGIN
  SELECT p.oid INTO fn_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mutate_conference_accommodation_operations'
     AND pg_get_function_identity_arguments(p.oid)='p_device uuid, p_operation_id uuid, p_conference uuid, p_operation text, p_args jsonb';
  IF fn_oid IS NULL THEN RAISE EXCEPTION 'CANONICAL_ACCOMMODATION_RPC_MISSING'; END IF;
  definition:=pg_get_functiondef(fn_oid);
  IF position('and room_id=(p_args->>''roomId'')::uuid' IN definition)=0
     OR position('and room_id=(p_args->>''roomId'')::uuid' IN substring(definition FROM position('select * into holder' IN definition)))=0 THEN
     RAISE EXCEPTION 'ACCOMMODATION_RPC_EXPECTED_SOURCE_NOT_FOUND';
  END IF;
  updated:=replace(definition,
   'select * into assignment from public.conference_room_assignments where conference_id=p_conference and room_id=',
   'select * into assignment from public.conference_room_assignments where conference_id=p_conference and public.conference_room_assignments.room_id=');
  updated:=replace(updated,
   'select * into holder from public.conference_accommodation_occupancies where id=holder_id and conference_id=p_conference and room_id=',
   'select * into holder from public.conference_accommodation_occupancies where id=holder_id and conference_id=p_conference and public.conference_accommodation_occupancies.room_id=');
  IF updated=definition THEN RAISE EXCEPTION 'ACCOMMODATION_RPC_PATCH_NOT_APPLIED'; END IF;
  EXECUTE updated;
END $migration$;
