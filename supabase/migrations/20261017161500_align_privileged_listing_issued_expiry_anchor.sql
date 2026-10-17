-- Keep the five-minute listing-session constraint intact; anchor both timestamps to the same statement.
DO $migration$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT p.oid INTO STRICT v_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'complete_system_owner_pending_device_listing'
    AND p.pronargs = 13;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  IF pg_catalog.strpos(v_definition, 'actor_device_id,credential_id,source_challenge_id,source_challenge_purpose,environment,scope,expires_at)') = 0
     OR pg_catalog.strpos(v_definition, '''SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY'',pg_catalog.statement_timestamp()+interval ''5 minutes'')') = 0 THEN
    RAISE EXCEPTION 'UNEXPECTED_LISTING_FUNCTION_DEFINITION';
  END IF;
  v_updated := pg_catalog.replace(v_definition,
    'actor_device_id,credential_id,source_challenge_id,source_challenge_purpose,environment,scope,expires_at)',
    'actor_device_id,credential_id,source_challenge_id,source_challenge_purpose,environment,scope,issued_at,expires_at)');
  v_updated := pg_catalog.replace(v_updated,
    '''SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY'',pg_catalog.statement_timestamp()+interval ''5 minutes'')',
    '''SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY'',pg_catalog.statement_timestamp(),pg_catalog.statement_timestamp()+interval ''5 minutes'')');
  EXECUTE v_updated;
END;
$migration$;
