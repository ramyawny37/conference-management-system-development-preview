-- Enforce the canonical platform device-operation boundary for warehouse draft updates.
-- The function remains available to the service-role-backed dispatcher only.
revoke all on function warehouse.update_document_draft(uuid, uuid, text, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function warehouse.update_document_draft(uuid, uuid, text, uuid, bigint, jsonb)
  to service_role;
