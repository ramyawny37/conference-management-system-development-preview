'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.resolve(__dirname,'../..');
const migration=name=>`supabase/migrations/${name}`;
const apply=[
  '20260829120000_module_authorization_foundation.sql',
  '20260829130000_module_permission_catalog_and_grant_adapter.sql',
  '20260829140000_warehouse_module_permission_catalog.sql',
  '20260829140100_warehouse_v1_business_schema.sql',
  '20260829140200_warehouse_v1_guarded_rpc.sql',
  '20260829150000_warehouse_post_document_revision_ambiguity_correction.sql',
  '20260829150100_warehouse_post_reversal_alias_collision_correction.sql',
  '20260829150200_warehouse_posted_header_lifecycle_immutability_correction.sql',
  '20260829150300_warehouse_posted_header_lifecycle_normalization_correction.sql',
  '20260829150400_warehouse_posted_header_generated_column_normalization_correction.sql',
  '20260829150500_warehouse_secure_read_surface.sql',
  '20260829150600_warehouse_bounded_balance_read.sql',
  '20260830120000_integrated_platform_module_registration.sql',
  '20260907155000_production_structural_platform_foundation.sql',
  '20260907160000_production_foundation_reconciliation.sql',
  '20260907161000_production_platform_device_admin_compatibility.sql',
  '20260902010000_warehouse_postgrest_exposed_schema_reconciliation.sql',
  '20260902120116_grant_platform_schema_usage_to_service_role.sql',
  '20260902122033_platform_device_session_foundation_1b.sql',
  '20260902130805_platform_device_session_context_rowtype_correction.sql',
  '20260903090000_conference_device_session_execution_boundary.sql',
  '20260907162000_production_phase1c_session_only_reconciliation.sql',
  '20260903170000_startup_device_authorization_read_reconciliation.sql',
  '20260903175000_platform_native_device_enrollment.sql',
  '20260903180000_unified_platform_warehouse_device_operation.sql',
  '20260904130000_warehouse_item_master_historical_contract.sql',
  '20260904143000_warehouse_category_code_allocation.sql',
  '20260904160000_warehouse_party_financial_ledger.sql',
  '20260904200000_warehouse_issue_post_financial_snapshot_fix.sql',
  '20260905133000_warehouse_draft_cancellation.sql',
  '20260905150000_opening_balance_reason_normalization.sql',
  '20260905170000_warehouse_item_unit_conversion.sql',
  '20260905193000_warehouse_item_unit_upsert_ambiguity_fix.sql',
  '20260905200000_warehouse_item_unit_status_ambiguity_fix.sql',
  '20260905203000_warehouse_unit_conversion_draft_wrapper_and_cost_fix.sql',
  '20260905210000_warehouse_issue_financial_unit_conversion_fix.sql',
  '20260905213000_warehouse_system_owner_self_approval_exception.sql',
  '20260905214500_warehouse_system_owner_self_approval_record_constraint.sql',
  '20260906120000_system_access_platform_profile_reconciliation.sql',
  '20260907120000_system_owner_platform_owner_reconciliation.sql',
  '20260907163000_production_inventory_authority_retirement_session_only_reconciliation.sql',
  '20260907140000_module_access_delegation_enforcement.sql',
  '20260907150000_module_permission_administration_backend_surface.sql'
];
const superseded={
  '20260829123000_development_legacy_authenticated_execute_reconciliation.sql':'DEVELOPMENT_ONLY',
  '20260831023000_platform_foundation_reconciliation.sql':'REPLACED_BY_20260907155000_AND_20260907160000',
  '20260831024500_first_platform_owner_bootstrap_reconciliation.sql':'UNSAFE_BOOTSTRAP_REPLACED_BY_LIVE_OWNER_PROJECTION',
  '20260831040000_platform_device_administration_contract.sql':'REPLACED_BY_20260907161000',
  '20260831050000_one_time_stable_development_device_recovery.sql':'DEVELOPMENT_ONLY',
  '20260831051000_stable_device_recovery_state_lookup.sql':'DEVELOPMENT_ONLY',
  '20260831052000_stable_device_recovery_server_actor_resolution.sql':'DEVELOPMENT_ONLY',
  '20260831054000_stable_device_recovery_state_volatility_reconciliation.sql':'DEVELOPMENT_ONLY',
  '20260831210905_stable_device_recovery_expired_challenge_retry_reconciliation.sql':'DEVELOPMENT_ONLY',
  '20260901051509_reconcile_platform_device_guard.sql':'LEGACY_POSSESSION_PATH_REPLACED_BY_SESSION_ONLY_BOUNDARY',
  '20260902020000_platform_device_ownership_handoff_1a.sql':'DEVELOPMENT_ONLY_HANDOFF',
  '20260903120000_device_key_binding_lost_private_key_rotation.sql':'HANDOFF_DEPENDENT_REPLACED_BY_NATIVE_ENROLLMENT',
  '20260903150000_phase1c_server_device_context_reconciliation.sql':'REPLACED_BY_20260907162000',
  '20260907130000_inventory_authority_retirement.sql':'REPLACED_BY_20260907163000'
};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const version=name=>name.match(/^([0-9]{14})_/)[1];
function semanticExpression(name){
  const checks={
    '20260829120000':'to_regclass(\'public.module_permission_grants\') is not null and to_regclass(\'public.module_grant_operations\') is not null',
    '20260829130000':"to_regclass('public.module_permission_catalog') is not null and to_regprocedure('public.validate_module_permission_catalog(text,text,text,text,text)') is not null and to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is not null and to_regprocedure('public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)') is not null and to_regprocedure('public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)') is not null",
    '20260829140000':"exists(select 1 from public.module_permission_catalog where module_key='warehouse')",
    '20260829140100':"to_regclass('warehouse.stores') is not null",
    '20260829140200':"to_regprocedure('warehouse.list_stores(uuid,uuid)') is not null and to_regprocedure('warehouse_private.canonical_intent_hash(jsonb)') is not null",
    '20260829150000':"to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)') is not null and position('select array[d.store_id],d.status,d.creator_user_id,d.approval_status,d.submitted_revision,d.adjustment_kind into stores,status_now,creator,approval,submitted_revision,p_kind from warehouse.adjustment_documents d where d.id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) > 0 and position('select d.status,d.approval_status,d.submitted_revision,d.adjustment_kind into status_now,approval,submitted_revision,p_kind from warehouse.adjustment_documents d where d.id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) > 0 and position('select array[store_id],status,creator_user_id,approval_status,submitted_revision,adjustment_kind into stores,status_now,creator,approval,submitted_revision,p_kind from warehouse.adjustment_documents where id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) = 0 and position('select status,approval_status,submitted_revision,adjustment_kind into status_now,approval,submitted_revision,p_kind from warehouse.adjustment_documents where id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) = 0",
    '20260829150100':"position('select 1 from warehouse.stock_movements original_movement join warehouse.stock_movements later on later.store_id=original_movement.store_id and later.item_id=original_movement.item_id and later.sequence>original_movement.sequence where original_movement.document_id=request.original_document_id' in coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal(uuid,uuid,uuid,bigint)')),'')||coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal_inventory_core(uuid,uuid,uuid,bigint)')),'')) > 0 and position('select 1 from warehouse.stock_movements original join warehouse.stock_movements later on later.store_id=original.store_id and later.item_id=original.item_id and later.sequence>original.sequence where original.document_id=request.original_document_id' in coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal(uuid,uuid,uuid,bigint)')),'')||coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal_inventory_core(uuid,uuid,uuid,bigint)')),'')) = 0",
    '20260829150200':"position('if old.status=''posted'' then' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position('old.status in (''posted'',''reversed'')' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) = 0",
    '20260829150300':"position('''status'',to_jsonb(old.status)' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position('to_jsonb(new)-array[''status'',''reversed_at'',''updated_at'']' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) = 0",
    '20260829150400':"position('when to_jsonb(old) ? ''document_kind''' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0",
    '20260829150500':"to_regprocedure('warehouse_private.require_read_session(uuid)') is not null",
    '20260829150600':"to_regprocedure('warehouse.list_balances(uuid,uuid,uuid,integer)') is not null",
    '20260830120000':"not exists(select 1 from (values ('conference'),('warehouse'),('reservations'),('custody')) expected(module_key) left join public.platform_modules modules using(module_key) where modules.module_key is null or modules.status<>'active')",
    '20260907155000':"to_regclass('platform.profiles') is not null and to_regclass('platform.device_key_bindings') is not null",
    '20260907160000':"to_regclass('platform_private.legacy_device_reconciliation_boundaries') is not null",
    '20260907161000':"to_regprocedure('platform.list_pending_device_authorizations()') is not null",
    '20260902010000':"(select count(*)=1 from pg_roles roles cross join lateral unnest(coalesce(roles.rolconfig,array[]::text[])) setting where roles.rolname='authenticator' and setting like 'pgrst.db_schemas=%' and setting='pgrst.db_schemas=public, graphql_public, platform, warehouse') and not exists(select 1 from pg_roles roles cross join lateral unnest(coalesce(roles.rolconfig,array[]::text[])) setting where roles.rolname='authenticator' and setting like 'pgrst.db_schemas=%' and setting<>'pgrst.db_schemas=public, graphql_public, platform, warehouse')",
    '20260902120116':"exists(select 1 from pg_namespace namespace cross join lateral aclexplode(coalesce(namespace.nspacl,acldefault('n',namespace.nspowner))) acl where namespace.nspname='platform' and acl.grantee='service_role'::regrole and acl.privilege_type='USAGE')",
    '20260902122033':"to_regclass('platform_private.device_sessions') is not null",
    '20260902130805':"position('select challenge.* into v_challenge' in pg_get_functiondef(to_regprocedure('platform.get_device_session_challenge_context(uuid,uuid)'))) > 0 and position('select challenge into v_challenge' in pg_get_functiondef(to_regprocedure('platform.get_device_session_challenge_context(uuid,uuid)'))) = 0",
    '20260903090000':"to_regprocedure('platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)') is not null",
    '20260907162000':"to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)') is not null",
    '20260903170000':"to_regprocedure('platform_private.resolve_startup_device_authorization_status(uuid,uuid)') is not null",
    '20260903175000':"to_regprocedure('platform.enroll_new_device_key(uuid,uuid,text,text,jsonb,text,text,text,text)') is not null",
    '20260903180000':"to_regprocedure('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)') is not null",
    '20260904130000':"to_regclass('warehouse.item_sku_sequence') is not null and to_regclass('warehouse.unit_code_sequence') is not null and to_regprocedure('warehouse_private.require_master_payload(jsonb,text[],text[])') is not null",
    '20260904143000':"to_regprocedure('warehouse_private.next_category_code()') is not null",
    '20260904160000':"to_regclass('warehouse.parties') is not null and to_regclass('warehouse.beneficiary_financial_entries') is not null",
    '20260904200000':"position(E'to_jsonb(new)\\n         || jsonb_build_object(' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0",
    '20260905133000':"to_regprocedure('warehouse.cancel_document_draft(uuid,uuid,text,uuid,bigint,text)') is not null",
    '20260905150000':"position('to_jsonb(coalesce(nullif(btrim(p_payload->>''reason''),'''')' in coalesce(pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft(uuid,uuid,text,jsonb)')),'')||coalesce(pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft_pre_unit_conversion(uuid,uuid,text,jsonb)')),'')) > 0",
    '20260905170000':"to_regclass('warehouse.item_units') is not null",
    '20260905193000':"position('; target_unit_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) > 0 and position('; unit_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) = 0",
    '20260905200000':"position('; target_status text;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) > 0 and position('; status text;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) = 0",
    '20260905203000':"position('uses_inbound_cost boolean' in pg_get_functiondef(to_regprocedure('warehouse_private.canonicalize_unit_lines(jsonb)'))) > 0 and position('created_document_id uuid' in pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft(uuid,uuid,text,jsonb)'))) > 0",
    '20260905210000':"position('selected_actual numeric' in pg_get_functiondef(to_regprocedure('warehouse.create_issue_draft(uuid,uuid,jsonb)'))) > 0 and position('selected_reference numeric' in pg_get_functiondef(to_regprocedure('warehouse.create_issue_draft(uuid,uuid,jsonb)'))) > 0",
    '20260905213000':"position('is_system_owner' in pg_get_functiondef(to_regprocedure('warehouse.decide_adjustment_approval(uuid,uuid,uuid,bigint,text,text)'))) > 0",
    '20260905214500':"exists(select 1 from pg_constraint where conrelid=to_regclass('warehouse.approval_records') and conname='approval_records_check' and pg_get_constraintdef(oid) like '%warehouse_approval_policy_v2_system_owner_self_approval%') and exists(select 1 from pg_constraint where conrelid=to_regclass('warehouse.approval_records') and conname='approval_records_policy_version_check' and pg_get_constraintdef(oid) like '%warehouse_approval_policy_v2_system_owner_self_approval%')",
    '20260906120000':"to_regprocedure('platform_private.reconcile_system_user_access_profile(public.system_user_access)') is not null",
    '20260907120000':"to_regprocedure('platform_private.reconcile_system_owner_platform_owner(uuid)') is not null",
    '20260907163000':"(select count(*) from platform.roles where domain='inventory' and code in ('inventory_manager','inventory_operator','viewer') and not is_assignable)=3 and position('p_scope_type=''platform''' in pg_get_functiondef(to_regprocedure('platform_private.has_permission_for(uuid,text,text,uuid)'))) > 0 and position('p_scope_type in (''platform'',''inventory'')' in pg_get_functiondef(to_regprocedure('platform_private.has_permission_for(uuid,text,text,uuid)'))) = 0",
    '20260907140000':"position('module.access' in pg_get_functiondef(to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)'))) > 0",
    '20260907150000':"to_regprocedure('public.search_module_permission_candidates(uuid,text,text,integer)') is not null"
  };
  const key=version(name);
  if(!checks[key])throw new Error(`EXPLICIT_SEMANTIC_CONTRACT_REQUIRED:${key}`);
  return checks[key];
}
function oldStateExpression(name){
  const checks={
    '20260829120000':"to_regclass('public.system_user_access') is not null and to_regclass('public.module_permission_grants') is null and to_regclass('public.module_grant_operations') is null",
    '20260829130000':"to_regclass('public.module_permission_grants') is not null and to_regclass('public.module_permission_catalog') is null",
    '20260829140000':"to_regclass('public.module_permission_catalog') is not null and not exists(select 1 from public.module_permission_catalog where module_key='warehouse')",
    '20260829140100':"exists(select 1 from public.module_permission_catalog where module_key='warehouse') and to_regclass('warehouse.stores') is null",
    '20260829140200':"to_regclass('warehouse.stores') is not null and to_regprocedure('warehouse.list_stores(uuid,uuid)') is null",
    '20260829150000':"to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)') is not null and position('select array[store_id],status,creator_user_id,approval_status,submitted_revision,adjustment_kind into stores,status_now,creator,approval,submitted_revision,p_kind from warehouse.adjustment_documents where id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) > 0 and position('select status,approval_status,submitted_revision,adjustment_kind into status_now,approval,submitted_revision,p_kind from warehouse.adjustment_documents where id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) > 0 and position('select array[d.store_id],d.status,d.creator_user_id,d.approval_status,d.submitted_revision,d.adjustment_kind into stores,status_now,creator,approval,submitted_revision,p_kind from warehouse.adjustment_documents d where d.id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) = 0 and position('select d.status,d.approval_status,d.submitted_revision,d.adjustment_kind into status_now,approval,submitted_revision,p_kind from warehouse.adjustment_documents d where d.id=p_document_id' in pg_get_functiondef(to_regprocedure('warehouse_private.post_document(uuid,uuid,text,uuid,bigint)'))) = 0",
    '20260829150100':"to_regprocedure('warehouse.post_reversal(uuid,uuid,uuid,bigint)') is not null and position('select 1 from warehouse.stock_movements original join warehouse.stock_movements later on later.store_id=original.store_id and later.item_id=original.item_id and later.sequence>original.sequence where original.document_id=request.original_document_id' in coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal(uuid,uuid,uuid,bigint)')),'')||coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal_inventory_core(uuid,uuid,uuid,bigint)')),'')) > 0 and position('select 1 from warehouse.stock_movements original_movement join warehouse.stock_movements later on later.store_id=original_movement.store_id and later.item_id=original_movement.item_id and later.sequence>original_movement.sequence where original_movement.document_id=request.original_document_id' in coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal(uuid,uuid,uuid,bigint)')),'')||coalesce(pg_get_functiondef(to_regprocedure('warehouse.post_reversal_inventory_core(uuid,uuid,uuid,bigint)')),'')) = 0",
    '20260829150200':"to_regprocedure('warehouse_private.protect_posted_header()') is not null and position('old.status in (''posted'',''reversed'')' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position('if old.status=''posted'' then' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) = 0",
    '20260829150300':"to_regprocedure('warehouse_private.protect_posted_header()') is not null and position('if old.status=''posted'' then' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position('to_jsonb(new)-array[''status'',''reversed_at'',''updated_at'']' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position('''status'',to_jsonb(old.status)' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) = 0",
    '20260829150400':"to_regprocedure('warehouse_private.protect_posted_header()') is not null and position('to_jsonb(new) || jsonb_build_object' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position('when to_jsonb(old) ? ''document_kind''' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) = 0",
    '20260829150500':"to_regprocedure('warehouse.list_stores(uuid,uuid)') is not null and to_regprocedure('warehouse_private.require_read_session(uuid)') is null",
    '20260829150600':"to_regprocedure('warehouse_private.require_read_session(uuid)') is not null and to_regprocedure('warehouse.list_balances(uuid,uuid,uuid,integer)') is null",
    '20260830120000':"to_regprocedure('warehouse.list_balances(uuid,uuid,uuid,integer)') is not null and exists(select 1 from public.platform_modules where module_key='warehouse' and status='active') and not exists(select 1 from public.platform_modules where module_key in ('conference','reservations','custody'))",
    '20260907155000':"exists(select 1 from public.platform_modules where module_key='warehouse') and to_regclass('platform.profiles') is null and to_regclass('platform.device_key_bindings') is null",
    '20260907160000':"to_regclass('platform.profiles') is not null and to_regclass('platform_private.legacy_device_reconciliation_boundaries') is null",
    '20260907161000':"to_regclass('platform_private.legacy_device_reconciliation_boundaries') is not null and to_regprocedure('platform.list_pending_device_authorizations()') is null",
    '20260902010000':"to_regprocedure('platform.list_pending_device_authorizations()') is not null and exists(select 1 from pg_roles where rolname='authenticator') and not exists(select 1 from pg_roles roles cross join lateral unnest(coalesce(roles.rolconfig,array[]::text[])) setting where roles.rolname='authenticator' and setting like 'pgrst.db_schemas=%' and setting<>'pgrst.db_schemas=public, graphql_public, platform') and not exists(select 1 from pg_roles roles cross join lateral unnest(coalesce(roles.rolconfig,array[]::text[])) setting where roles.rolname='authenticator' and setting='pgrst.db_schemas=public, graphql_public, platform, warehouse')",
    '20260902120116':"exists(select 1 from pg_roles roles cross join lateral unnest(coalesce(roles.rolconfig,array[]::text[])) setting where roles.rolname='authenticator' and setting='pgrst.db_schemas=public, graphql_public, platform, warehouse') and not exists(select 1 from pg_namespace namespace cross join lateral aclexplode(coalesce(namespace.nspacl,acldefault('n',namespace.nspowner))) acl where namespace.nspname='platform' and acl.grantee='service_role'::regrole and acl.privilege_type='USAGE')",
    '20260902122033':"has_schema_privilege('service_role','platform','USAGE') and to_regclass('platform_private.device_sessions') is null",
    '20260902130805':"to_regclass('platform_private.device_sessions') is not null and to_regprocedure('platform.get_device_session_challenge_context(uuid,uuid)') is not null and position('select challenge into v_challenge' in pg_get_functiondef(to_regprocedure('platform.get_device_session_challenge_context(uuid,uuid)'))) > 0 and position('select challenge.* into v_challenge' in pg_get_functiondef(to_regprocedure('platform.get_device_session_challenge_context(uuid,uuid)'))) = 0",
    '20260903090000':"position('binding.id' in pg_get_functiondef(to_regprocedure('platform.get_device_session_challenge_context(uuid,uuid)'))) > 0 and to_regprocedure('platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)') is null",
    '20260907162000':"to_regprocedure('platform.execute_conference_device_operation(uuid,uuid,bytea,text,jsonb)') is not null and to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)') is null",
    '20260903170000':"to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)') is not null and to_regprocedure('platform_private.resolve_startup_device_authorization_status(uuid,uuid)') is null",
    '20260903175000':"to_regprocedure('platform_private.resolve_startup_device_authorization_status(uuid,uuid)') is not null and to_regprocedure('platform.enroll_new_device_key(uuid,uuid,text,text,jsonb,text,text,text,text)') is null",
    '20260903180000':"to_regprocedure('platform.enroll_new_device_key(uuid,uuid,text,text,jsonb,text,text,text,text)') is not null and to_regprocedure('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)') is null",
    '20260904130000':"to_regprocedure('platform.execute_device_operation(uuid,uuid,bytea,text,text,jsonb)') is not null and to_regprocedure('warehouse.list_item_master(uuid)') is not null and to_regclass('warehouse.item_sku_sequence') is null and to_regclass('warehouse.unit_code_sequence') is null and to_regprocedure('warehouse_private.require_master_payload(jsonb,text[],text[])') is null",
    '20260904143000':"to_regprocedure('warehouse.list_item_master(uuid)') is not null and to_regprocedure('warehouse_private.next_category_code()') is null",
    '20260904160000':"to_regprocedure('warehouse_private.next_category_code()') is not null and to_regclass('warehouse.parties') is null and to_regclass('warehouse.beneficiary_financial_entries') is null",
    '20260904200000':"to_regclass('warehouse.beneficiary_financial_entries') is not null and position('and (to_jsonb(new)||jsonb_build_object(' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and position(E'to_jsonb(new)\\n         || jsonb_build_object(' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) = 0",
    '20260905133000':"position(E'to_jsonb(new)\\n         || jsonb_build_object(' in pg_get_functiondef(to_regprocedure('warehouse_private.protect_posted_header()'))) > 0 and to_regprocedure('warehouse.cancel_document_draft(uuid,uuid,text,uuid,bigint,text)') is null",
    '20260905150000':"to_regprocedure('warehouse.cancel_document_draft(uuid,uuid,text,uuid,bigint,text)') is not null and position('to_jsonb(coalesce(nullif(btrim(p_payload->>''reason''),'''')' in coalesce(pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft(uuid,uuid,text,jsonb)')),'')||coalesce(pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft_pre_unit_conversion(uuid,uuid,text,jsonb)')),'')) = 0",
    '20260905170000':"position('opening_balance' in pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft(uuid,uuid,text,jsonb)'))) > 0 and to_regclass('warehouse.item_units') is null",
    '20260905193000':"to_regclass('warehouse.item_units') is not null and to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)') is not null and position('; unit_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) > 0 and position('; target_unit_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) = 0",
    '20260905200000':"position('; target_unit_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) > 0 and position('; status text;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) > 0 and position('; target_status text;' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) = 0",
    '20260905203000':"position('target_status text' in pg_get_functiondef(to_regprocedure('warehouse.upsert_item_units(uuid,uuid,uuid,bigint,jsonb)'))) > 0 and position('uses_inbound_cost boolean' in pg_get_functiondef(to_regprocedure('warehouse_private.canonicalize_unit_lines(jsonb)'))) = 0 and position('; document_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft(uuid,uuid,text,jsonb)'))) > 0 and position('; created_document_id uuid;' in pg_get_functiondef(to_regprocedure('warehouse_private.create_document_draft(uuid,uuid,text,jsonb)'))) = 0",
    '20260905210000':"position('uses_inbound_cost boolean' in pg_get_functiondef(to_regprocedure('warehouse_private.canonicalize_unit_lines(jsonb)'))) > 0 and to_regprocedure('warehouse.create_issue_draft(uuid,uuid,jsonb)') is not null and position('selected_actual numeric' in pg_get_functiondef(to_regprocedure('warehouse.create_issue_draft(uuid,uuid,jsonb)'))) = 0",
    '20260905213000':"position('selected_actual numeric' in pg_get_functiondef(to_regprocedure('warehouse.create_issue_draft(uuid,uuid,jsonb)'))) > 0 and position('if actor=d.creator_user_id then raise exception ''WAREHOUSE_CREATOR_SELF_APPROVAL_FORBIDDEN''' in pg_get_functiondef(to_regprocedure('warehouse.decide_adjustment_approval(uuid,uuid,uuid,bigint,text,text)'))) > 0 and position('is_system_owner' in pg_get_functiondef(to_regprocedure('warehouse.decide_adjustment_approval(uuid,uuid,uuid,bigint,text,text)'))) = 0",
    '20260905214500':"position('is_system_owner' in pg_get_functiondef(to_regprocedure('warehouse.decide_adjustment_approval(uuid,uuid,uuid,bigint,text,text)'))) > 0 and not exists(select 1 from pg_constraint where conrelid=to_regclass('warehouse.approval_records') and conname='approval_records_check' and pg_get_constraintdef(oid) like '%warehouse_approval_policy_v2_system_owner_self_approval%') and exists(select 1 from pg_constraint where conrelid=to_regclass('warehouse.approval_records') and conname='approval_records_check')",
    '20260906120000':"exists(select 1 from pg_constraint where conrelid=to_regclass('warehouse.approval_records') and conname='approval_records_check' and pg_get_constraintdef(oid) like '%warehouse_approval_policy_v2_system_owner_self_approval%') and to_regprocedure('platform_private.reconcile_system_user_access_profile(public.system_user_access)') is null",
    '20260907120000':"to_regprocedure('platform_private.reconcile_system_user_access_profile(public.system_user_access)') is not null and to_regprocedure('platform_private.reconcile_system_owner_platform_owner(uuid)') is null",
    '20260907163000':"to_regprocedure('platform_private.reconcile_system_owner_platform_owner(uuid)') is not null and not exists(select 1 from platform.roles where domain='inventory' and code in ('inventory_manager','inventory_operator','viewer')) and position('p_scope_type in (''platform'',''inventory'')' in pg_get_functiondef(to_regprocedure('platform_private.has_permission_for(uuid,text,text,uuid)'))) > 0 and position('p_scope_type=''platform''' in pg_get_functiondef(to_regprocedure('platform_private.has_permission_for(uuid,text,text,uuid)'))) = 0",
    '20260907140000':"not exists(select 1 from platform.roles where domain='inventory' and code in ('inventory_manager','inventory_operator','viewer') and is_assignable) and to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is not null and position('module.access' in pg_get_functiondef(to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)'))) = 0 and position('module_permission_grants' in pg_get_functiondef(to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)'))) > 0",
    '20260907150000':"to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is not null and position('module.access' in pg_get_functiondef(to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)'))) > 0 and to_regprocedure('public.search_module_permission_candidates(uuid,text,text,integer)') is null and not has_function_privilege('service_role','public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)','EXECUTE')"
  };
  const key=version(name);
  if(!checks[key])throw new Error(`EXPLICIT_PREDECESSOR_STATE_CONTRACT_REQUIRED:${key}`);
  return checks[key];
}
function applyEntry(name){const file=migration(name),body=fs.readFileSync(path.join(root,file),'utf8'),executable=body.replace(/^\s*--[^\n]*$/gm,'').trim(),bounded=/^(begin|start\s+transaction)\s*;/i.test(executable)&&/commit\s*;\s*$/i.test(executable),semantic=semanticExpression(name),oldState=oldStateExpression(name);return {version:version(name),filename:file,sha256:sha(file),action:'APPLY',transaction:{startsExplicitly:/^(begin|start\s+transaction)\s*;/i.test(executable),commitsExplicitly:/commit\s*;\s*$/i.test(executable),safeOuterAtomicWrap:!bounded},preconditionSql:`select (${oldState})::text`,verificationSql:`select (${semantic})::text`,prerequisites:['exact preceding controlled history tail','explicit body-specific predecessor-state detector'],expectedPostconditions:['semantic verifier independently succeeds','locked APPLY provenance recorded'],sourceReason:'Round 3L reviewed Production dependency order'};}
function skipEntry(name){const file=migration(name),key=version(name),conditions={
  '20260829123000':"to_regprocedure('public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)') is null or to_regprocedure('public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)') is not null",
  '20260831023000':"to_regclass('platform.profiles') is not null and to_regclass('platform_private.legacy_device_reconciliation_boundaries') is not null",
  '20260831024500':"to_regprocedure('platform_private.reconcile_system_owner_platform_owner(uuid)') is not null or to_regclass('platform.user_roles') is not null",
  '20260831040000':"to_regprocedure('platform.list_pending_device_authorizations()') is not null",
  '20260831050000':"to_regclass('platform_private.stable_device_recovery_challenges') is null",
  '20260831051000':"to_regprocedure('platform.get_stable_device_recovery_state()') is null",
  '20260831052000':"to_regprocedure('platform_private.resolve_stable_device_recovery_actor()') is null",
  '20260831054000':"to_regprocedure('platform.get_stable_device_recovery_state()') is null",
  '20260831210905':"to_regclass('platform_private.stable_device_recovery_challenges') is null",
  '20260901051509':"to_regprocedure('platform_private.validated_phase1c_device_authorization(uuid,uuid)') is not null",
  '20260902020000':"to_regclass('platform_private.device_ownership_handoff_challenges') is null",
  '20260903120000':"to_regprocedure('platform.enroll_new_device_key(uuid,uuid,text,text,jsonb,text,text,text,text)') is not null",
  '20260903150000':"to_regprocedure('platform.execute_conference_device_operation_phase1c_core(uuid,uuid,bytea,text,jsonb)') is not null",
  '20260907130000':"not exists(select 1 from platform.roles where domain='inventory' and code in ('inventory_manager','inventory_operator','viewer') and is_assignable)"
};if(!conditions[key])throw new Error(`SUPERSESSION_CONTRACT_REQUIRED:${key}`);return {version:key,filename:file,sha256:sha(file),action:'RECORD_SUPERSEDED_WITHOUT_EXECUTION',transaction:{startsExplicitly:false,commitsExplicitly:false,safeOuterAtomicWrap:true},preconditionSql:`select (${conditions[key]})::text`,verificationSql:`select (${conditions[key]})::text`,prerequisites:['approved exclusion or replacement state verified'],expectedPostconditions:['signed supersession marker recorded','historical body remains unreachable'],sourceReason:superseded[name]};}
const early=['20260829123000_development_legacy_authenticated_execute_reconciliation.sql','20260831050000_one_time_stable_development_device_recovery.sql','20260831051000_stable_device_recovery_state_lookup.sql','20260831052000_stable_device_recovery_server_actor_resolution.sql','20260831054000_stable_device_recovery_state_volatility_reconciliation.sql','20260831210905_stable_device_recovery_expired_challenge_retry_reconciliation.sql','20260902020000_platform_device_ownership_handoff_1a.sql'];
const after={
  '20260907160000':['20260831023000_platform_foundation_reconciliation.sql','20260831024500_first_platform_owner_bootstrap_reconciliation.sql'],
  '20260907161000':['20260831040000_platform_device_administration_contract.sql'],
  '20260907162000':['20260901051509_reconcile_platform_device_guard.sql','20260903150000_phase1c_server_device_context_reconciliation.sql'],
  '20260903175000':['20260903120000_device_key_binding_lost_private_key_rotation.sql'],
  '20260907163000':['20260907130000_inventory_authority_retirement.sql']
};
const entries=early.map(skipEntry);
for(const name of apply){entries.push(applyEntry(name));for(const skipped of after[version(name)]||[])entries.push(skipEntry(skipped));}
if(entries.length!==apply.length+Object.keys(superseded).length)throw new Error('INTERLEAVED_MANIFEST_INCOMPLETE');
const manifest={schemaVersion:2,packageId:'conference-controlled-production-fa7d7ba-v1',checkpointSha:'fa7d7ba81058190602bdd215e71006576a49a6ce',productionProjectRef:'mpezfbvcdfxpgflehuot',forbiddenProjectRefs:['gppwltrifgfxrkzvvxoe'],baseline:{version:'20260828150000',name:'production_webauthn_privileged_device_final_activation'},historyContract:{columns:['version','statements','name','created_by','idempotency_key','rollback'],primaryKey:'version',unique:'idempotency_key'},executionOrder:entries.map(entry=>({version:entry.version,action:entry.action})),entries};
const output=path.join(__dirname,'controlled-production-manifest.json');
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n');
console.log(output);

module.exports={apply,superseded};
