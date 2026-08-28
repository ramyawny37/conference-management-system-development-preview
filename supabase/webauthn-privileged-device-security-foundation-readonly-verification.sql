-- READ ONLY: Phase A structural verification. Every result must be true/zero as named.
-- Future Phase B/D transaction tests must exercise concurrent activation/revocation and atomic challenge consumption.
with expected_tables(table_name) as (
  values ('webauthn_privileged_device_feature'),('device_security_credentials'),
    ('device_possession_challenges'),('device_possession_challenge_consumers'),
    ('privileged_device_listing_sessions'),
    ('system_owner_credential_bootstrap_authorizations'),
    ('system_owner_credential_recovery_authorizations'),
    ('privileged_device_authorization_audit_log'),
    ('system_owner_device_authorization_operations')
), controlled_owner as (
  select classes.relowner,pg_get_userbyid(classes.relowner) owner_name
  from pg_class classes join pg_namespace namespaces on namespaces.oid=classes.relnamespace
  where namespaces.nspname='public' and classes.relname='user_device_authorizations'
), table_state as (
  select expected.table_name,classes.oid,classes.relrowsecurity,
    pg_get_userbyid(classes.relowner) owner_name,
    coalesce(exists(select 1 from aclexplode(coalesce(classes.relacl,
      acldefault('r',classes.relowner))) privileges where privileges.grantee=0),false) public_access,
    coalesce(has_table_privilege('anon','public.'||expected.table_name,'select,insert,update,delete'),false) anon_access,
    coalesce(has_table_privilege('authenticated','public.'||expected.table_name,'select,insert,update,delete'),false) authenticated_access,
    (select count(*) from pg_policy policies where policies.polrelid=classes.oid) policy_count
  from expected_tables expected
  left join pg_namespace namespaces on namespaces.nspname='public'
  left join pg_class classes on classes.relnamespace=namespaces.oid
    and classes.relname=expected.table_name and classes.relkind='r'
), expected_functions(signature) as (
  values ('guard_device_security_credential_lifecycle()'),
    ('guard_device_authorization_security_credential_state()'),
    ('guard_device_possession_challenge_identity()'),
    ('guard_device_possession_challenge_consumer()'),
    ('guard_privileged_device_listing_session_lifecycle()'),
    ('guard_system_owner_bootstrap_authorization_lifecycle()'),
    ('guard_system_owner_recovery_authorization_lifecycle()')
), function_state as (
  select expected.signature,procedures.oid,
    pg_get_userbyid(procedures.proowner) owner_name,procedures.prosecdef,
    pg_get_functiondef(procedures.oid) definition,
    procedures.proconfig @> array['search_path=pg_catalog, public']::text[] search_path_valid,
    coalesce(exists(select 1 from aclexplode(coalesce(procedures.proacl,
      acldefault('f',procedures.proowner))) privileges where privileges.grantee=0),false) public_execute,
    coalesce(has_function_privilege('anon',procedures.oid,'execute'),false) anon_execute,
    coalesce(has_function_privilege('authenticated',procedures.oid,'execute'),false) authenticated_execute
  from expected_functions expected
  left join pg_proc procedures on procedures.oid=to_regprocedure('public.'||expected.signature)
), immutable_function_state as (
  select procedures.oid,pg_get_functiondef(procedures.oid) definition
  from pg_proc procedures
  where procedures.oid=to_regprocedure('public.prevent_device_authorization_audit_mutation()')
), constraints as (
  select classes.relname table_name,constraints.conname,
    pg_get_constraintdef(constraints.oid,true) definition
  from pg_constraint constraints join pg_class classes on classes.oid=constraints.conrelid
  join pg_namespace namespaces on namespaces.oid=classes.relnamespace
  where namespaces.nspname='public' and (classes.relname in (select table_name from expected_tables)
    or classes.relname='user_device_authorizations')
), foreign_keys as (
  select constraints.conname,classes.relname table_name,
    referenced_classes.relname referenced_table_name,
    array(select attributes.attname
      from unnest(constraints.conkey) with ordinality keys(attnum,position)
      join pg_attribute attributes on attributes.attrelid=constraints.conrelid
        and attributes.attnum=keys.attnum order by keys.position) local_columns,
    array(select attributes.attname
      from unnest(constraints.confkey) with ordinality keys(attnum,position)
      join pg_attribute attributes on attributes.attrelid=constraints.confrelid
        and attributes.attnum=keys.attnum order by keys.position) referenced_columns,
    pg_get_constraintdef(constraints.oid,true) definition
  from pg_constraint constraints
  join pg_class classes on classes.oid=constraints.conrelid
  join pg_class referenced_classes on referenced_classes.oid=constraints.confrelid
  join pg_namespace namespaces on namespaces.oid=classes.relnamespace
  join pg_namespace referenced_namespaces on referenced_namespaces.oid=referenced_classes.relnamespace
  where constraints.contype='f' and namespaces.nspname='public'
    and referenced_namespaces.nspname in ('public','auth')
), triggers as (
  select classes.relname table_name,triggers.tgname,pg_get_triggerdef(triggers.oid,true) definition,
    procedures.proname function_name,pg_get_functiondef(procedures.oid) function_definition
  from pg_trigger triggers join pg_class classes on classes.oid=triggers.tgrelid
  join pg_proc procedures on procedures.oid=triggers.tgfoid
  join pg_namespace namespaces on namespaces.oid=classes.relnamespace
  where namespaces.nspname='public' and not triggers.tgisinternal
), forbidden_rpcs(signature) as (
  values ('public.list_system_owner_pending_device_authorizations(uuid)'),
    ('public.approve_system_owner_pending_device(uuid,uuid,uuid,uuid)'),
    ('public.reject_system_owner_pending_device(uuid,uuid,uuid,uuid)')
), feature_state as (
  select count(*) row_count,count(*) filter(where singleton_id=1 and enabled=false) disabled_count,
    count(*) filter(where enabled) enabled_count
  from public.webauthn_privileged_device_feature
), recovery_environment as (
  select columns.is_nullable,columns.data_type
  from information_schema.columns columns
  where columns.table_schema='public'
    and columns.table_name='system_owner_credential_recovery_authorizations'
    and columns.column_name='environment'
), authorization_initial_columns as (
  select columns.table_name,columns.column_name,columns.is_nullable,columns.column_default
  from information_schema.columns columns
  where columns.table_schema='public' and (
    (columns.table_name='system_owner_credential_bootstrap_authorizations'
      and columns.column_name='consumed_at')
    or (columns.table_name='system_owner_credential_recovery_authorizations'
      and columns.column_name in ('status','consumed_at')))
), exact_context_columns as (
  select columns.table_name,columns.column_name,columns.is_nullable
  from information_schema.columns columns
  where columns.table_schema='public' and (
    (columns.table_name='system_owner_device_authorization_operations'
      and columns.column_name='environment')
    or (columns.table_name='privileged_device_authorization_audit_log'
      and columns.column_name in ('challenge_id','actor_user_id_snapshot','actor_device_id',
        'actor_credential_id','session_id','challenge_purpose','target_user_id_snapshot',
        'target_device_id','operation_id','environment','replaced_device_id',
        'replacement_device_id')))
)
select
  (select count(*) from table_state where oid is not null)=9 as exact_required_tables_exist,
  not exists(select 1 from table_state where not relrowsecurity) as all_rls_enabled,
  not exists(select 1 from table_state where policy_count<>0) as no_phase_a_policies,
  not exists(select 1 from table_state where public_access or anon_access or authenticated_access) as browser_table_access_denied,
  not exists(select 1 from table_state,controlled_owner where table_state.owner_name<>controlled_owner.owner_name) as controlled_relation_owner,
  not exists(select 1 from function_state where oid is null) as exact_helper_signatures_exist,
  not exists(select 1 from function_state,controlled_owner where function_state.owner_name<>controlled_owner.owner_name) as controlled_function_owner,
  not exists(select 1 from function_state where not prosecdef or not search_path_valid) as helper_security_definer_and_search_path_valid,
  not exists(select 1 from function_state where public_execute or anon_execute or authenticated_execute) as browser_helper_execute_denied,
  not exists(select 1 from forbidden_rpcs where to_regprocedure(signature) is not null) as uuid_only_global_rpcs_absent,
  feature_state.row_count=1 and feature_state.disabled_count=1 and feature_state.enabled_count=0 as feature_permanently_disabled,
  exists(select 1 from constraints where table_name='webauthn_privileged_device_feature'
    and definition ilike '%enabled = false%') as feature_enable_structurally_impossible,
  exists(select 1 from constraints where conname='device_possession_challenges_expiration' and definition ilike '%''00:02:00''::interval%') as challenge_max_two_minutes,
  exists(select 1 from constraints where conname='privileged_device_listing_sessions_expiration' and definition ilike '%''00:05:00''::interval%') as listing_max_five_minutes,
  exists(select 1 from foreign_keys where conname='privileged_device_listing_sessions_challenge_fk'
    and table_name='privileged_device_listing_sessions'
    and referenced_table_name='device_possession_challenges'
    and local_columns=array['source_challenge_id','user_id','session_id','actor_device_id','credential_id','source_challenge_purpose','environment']::name[]
    and referenced_columns=array['id','user_id','session_id','actor_device_id','credential_id','purpose','environment']::name[]) as listing_exact_assertion_binding,
  exists(select 1 from function_state where signature='guard_device_possession_challenge_identity()'
    and definition ilike '%DEVICE_POSSESSION_CHALLENGE_INITIAL_STATE_INVALID%'
    and definition ilike '%new.verified_at is not null%new.consumed_at is not null%new.failed_at is not null%new.failure_code is not null%new.verification_context is not null%')
    and exists(select 1 from triggers where tgname='device_possession_challenges_identity_guard'
      and table_name='device_possession_challenges'
      and function_name='guard_device_possession_challenge_identity'
      and definition ilike '%before insert or delete or update%') as challenge_initial_state_enforced,
  exists(select 1 from function_state where signature='guard_device_possession_challenge_identity()'
    and definition ilike '%DEVICE_POSSESSION_CHALLENGE_VERIFICATION_IMMUTABLE%'
    and definition ilike '%DEVICE_POSSESSION_CHALLENGE_TERMINAL%'
    and definition ilike '%DEVICE_POSSESSION_CHALLENGE_BINDING_IMMUTABLE%'
    and definition ilike '%DEVICE_POSSESSION_CHALLENGE_CONSUMER_REQUIRED%') as challenge_lifecycle_semantics,
  exists(select 1 from function_state where signature='guard_privileged_device_listing_session_lifecycle()'
    and definition ilike '%verified_at is not null%'
    and definition ilike '%failed_at is null%'
    and definition ilike '%consumed_at is null%'
    and definition ilike '%expires_at>now()%'
    and definition ilike '%for update%')
    and exists(select 1 from triggers where table_name='privileged_device_listing_sessions'
      and function_name='guard_privileged_device_listing_session_lifecycle'
      and definition ilike '%before insert or delete or update%') as listing_verified_unexpired_source_enforced,
  exists(select 1 from recovery_environment where is_nullable='NO' and data_type='text')
    and exists(select 1 from function_state where signature='guard_system_owner_recovery_authorization_lifecycle()'
      and definition ilike '%new.environment<>old.environment%') as recovery_environment_immutable,
  exists(select 1 from function_state where signature='guard_device_security_credential_lifecycle()'
    and definition ilike '%authorization_status%'
    and definition ilike '%revoked_at%'
    and definition ilike '%for update%')
    and exists(select 1 from function_state where signature='guard_device_authorization_security_credential_state()'
      and definition ilike '%DEVICE_AUTHORIZATION_HAS_LIVE_SECURITY_CREDENTIAL%')
    and exists(select 1 from triggers where tgname='user_device_authorizations_security_credential_guard'
      and table_name='user_device_authorizations'
      and function_name='guard_device_authorization_security_credential_state'
      and definition ilike '%before delete or update%')
    as credential_activation_locked_and_revalidated,
  exists(select 1 from exact_context_columns
      where table_name='system_owner_device_authorization_operations'
        and column_name='environment' and is_nullable='NO')
    and exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_challenge_actor_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','actor_user_id_snapshot','session_id','actor_device_id','actor_credential_id','challenge_purpose','environment','operation_id']::name[]
        and referenced_columns=array['id','user_id','session_id','actor_device_id','credential_id','purpose','environment','operation_id']::name[])
    as operation_environment_exactly_bound,
  exists(select 1 from constraints
      where conname='device_possession_challenge_consumers_purpose_kind'
        and definition ilike '%SYSTEM_OWNER_PENDING_DEVICE_LIST%listing_session%'
        and definition ilike '%SYSTEM_OWNER_PENDING_DEVICE_APPROVE%device_authorization_operation%'
        and definition ilike '%SYSTEM_OWNER_CREDENTIAL_ENROLLMENT%credential_enrollment%'
        and definition ilike '%SYSTEM_OWNER_CREDENTIAL_ROTATION%credential_rotation%'
        and definition ilike '%SYSTEM_OWNER_CREDENTIAL_RECOVERY%credential_recovery%')
    and exists(select 1 from foreign_keys
      where conname='device_possession_challenge_consumers_challenge_actor_fk'
        and table_name='device_possession_challenge_consumers'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','user_id','session_id','actor_device_id','challenge_purpose','environment']::name[]
        and referenced_columns=array['id','user_id','session_id','actor_device_id','purpose','environment']::name[])
    and exists(select 1 from foreign_keys
      where conname='device_possession_challenge_consumers_challenge_credential_fk'
        and table_name='device_possession_challenge_consumers'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','actor_credential_id']::name[]
        and referenced_columns=array['id','credential_id']::name[])
    and exists(select 1 from function_state
      where signature='guard_device_possession_challenge_consumer()'
        and definition ilike '%challenges.user_id=new.user_id%'
        and definition ilike '%challenges.session_id=new.session_id%'
        and definition ilike '%challenges.actor_device_id=new.actor_device_id%'
        and definition ilike '%challenges.credential_id is not distinct from new.actor_credential_id%'
        and definition ilike '%challenges.environment=new.environment%'
        and definition ilike '%verified_at is null%'
        and definition ilike '%failed_at is not null%'
        and definition ilike '%consumed_at is not null%'
        and definition ilike '%expires_at<=now()%'
        and definition ilike '%for update%'
        and definition ilike '%tg_op<>''INSERT''%'
        and definition ilike '%DEVICE_POSSESSION_CHALLENGE_CONSUMER_IMMUTABLE%')
    and exists(select 1 from triggers
      where tgname='device_possession_challenge_consumers_guard'
        and table_name='device_possession_challenge_consumers'
        and function_name='guard_device_possession_challenge_consumer'
        and definition ilike '%before insert or delete or update%'
        and definition ilike '%execute function guard_device_possession_challenge_consumer()%')
    as universal_challenge_consumer_binding,
  exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_actor_authorization_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='user_device_authorizations'
        and local_columns=array['actor_user_id_snapshot','actor_device_id']::name[]
        and referenced_columns=array['user_id','device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_actor_credential_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='device_security_credentials'
        and local_columns=array['actor_credential_id','actor_user_id_snapshot','actor_device_id']::name[]
        and referenced_columns=array['id','user_id','device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_challenge_actor_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','actor_user_id_snapshot','session_id','actor_device_id','actor_credential_id','challenge_purpose','environment','operation_id']::name[]
        and referenced_columns=array['id','user_id','session_id','actor_device_id','credential_id','purpose','environment','operation_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_challenge_target_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','target_user_id_snapshot','target_device_id']::name[]
        and referenced_columns=array['id','target_user_id','target_device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_challenge_replacement_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','target_user_id_snapshot','replaced_device_id','replacement_device_id']::name[]
        and referenced_columns=array['id','target_user_id','replaced_device_id','replacement_device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='system_owner_device_operations_consumer_fk'
        and table_name='system_owner_device_authorization_operations'
        and referenced_table_name='device_possession_challenge_consumers'
        and local_columns=array['challenge_id','actor_user_id_snapshot','session_id','actor_device_id','actor_credential_id','challenge_purpose','environment','operation_id','consumer_kind']::name[]
        and referenced_columns=array['challenge_id','user_id','session_id','actor_device_id','actor_credential_id','challenge_purpose','environment','consumer_id','consumer_kind']::name[])
    as operation_exact_challenge_binding,
  exists(select 1 from constraints
    where conname='system_owner_device_operations_action_purpose'
      and definition ilike '%approve_system_owner_pending_device%SYSTEM_OWNER_PENDING_DEVICE_APPROVE%'
      and definition ilike '%reject_system_owner_pending_device%SYSTEM_OWNER_PENDING_DEVICE_REJECT%'
      and definition ilike '%replace_system_owner_device%SYSTEM_OWNER_DEVICE_REPLACEMENT%'
      and definition ilike '%replaced_device_id%replacement_device_id%') as operation_action_purpose_binding,
  exists(select 1 from constraints where conname='privileged_device_audit_live_snapshot_consistency'
      and definition ilike '%actor_user_id%actor_user_id_snapshot%'
      and definition ilike '%target_user_id%target_user_id_snapshot%')
    and exists(select 1 from constraints where conname='system_owner_device_operations_live_snapshot_consistency'
      and definition ilike '%actor_user_id%actor_user_id_snapshot%'
      and definition ilike '%target_user_id%target_user_id_snapshot%')
    as live_snapshot_consistency,
  (select count(*) from exact_context_columns
      where table_name='privileged_device_authorization_audit_log')=12
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_actor_authorization_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='user_device_authorizations'
        and local_columns=array['actor_user_id_snapshot','actor_device_id']::name[]
        and referenced_columns=array['user_id','device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_actor_credential_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='device_security_credentials'
        and local_columns=array['actor_credential_id','actor_user_id_snapshot','actor_device_id']::name[]
        and referenced_columns=array['id','user_id','device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_challenge_actor_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','actor_user_id_snapshot','session_id','actor_device_id','challenge_purpose','environment']::name[]
        and referenced_columns=array['id','user_id','session_id','actor_device_id','purpose','environment']::name[])
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_challenge_credential_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','actor_credential_id']::name[]
        and referenced_columns=array['id','credential_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_challenge_operation_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','operation_id']::name[]
        and referenced_columns=array['id','operation_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_challenge_target_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','challenge_target_user_id','challenge_target_device_id']::name[]
        and referenced_columns=array['id','target_user_id','target_device_id']::name[])
    and exists(select 1 from foreign_keys
      where conname='privileged_device_audit_challenge_replacement_fk'
        and table_name='privileged_device_authorization_audit_log'
        and referenced_table_name='device_possession_challenges'
        and local_columns=array['challenge_id','target_user_id_snapshot','replaced_device_id','replacement_device_id']::name[]
        and referenced_columns=array['id','target_user_id','replaced_device_id','replacement_device_id']::name[])
    and exists(select 1 from constraints
      where conname='privileged_device_audit_action_purpose'
        and definition ilike '%credential_enrolled%SYSTEM_OWNER_CREDENTIAL_ENROLLMENT%challenge_target_user_id IS NULL%challenge_target_device_id IS NULL%target_user_id_snapshot%actor_user_id_snapshot%target_device_id%actor_device_id%'
        and definition ilike '%credential_activated%SYSTEM_OWNER_CREDENTIAL_ROTATION%SYSTEM_OWNER_CREDENTIAL_RECOVERY%challenge_target_user_id IS NOT NULL%challenge_target_device_id IS NOT NULL%challenge_target_user_id%target_user_id_snapshot%challenge_target_device_id%target_device_id%'
        and definition ilike '%credential_revoked%SYSTEM_OWNER_CREDENTIAL_ROTATION%SYSTEM_OWNER_CREDENTIAL_RECOVERY%challenge_target_user_id IS NOT NULL%challenge_target_device_id IS NOT NULL%challenge_target_user_id%target_user_id_snapshot%challenge_target_device_id%target_device_id%'
        and definition ilike '%pending_device_approved%SYSTEM_OWNER_PENDING_DEVICE_APPROVE%'
        and definition ilike '%pending_device_approved%challenge_target_user_id IS NOT NULL%challenge_target_device_id IS NOT NULL%'
        and definition ilike '%pending_device_rejected%SYSTEM_OWNER_PENDING_DEVICE_REJECT%'
        and definition ilike '%pending_device_rejected%challenge_target_user_id IS NOT NULL%challenge_target_device_id IS NOT NULL%'
        and definition ilike '%device_revoked%SYSTEM_OWNER_DEVICE_REVOKE%challenge_target_user_id IS NOT NULL%challenge_target_device_id IS NOT NULL%'
        and definition ilike '%device_replaced%SYSTEM_OWNER_DEVICE_REPLACEMENT%')
    and exists(select 1 from constraints
      where conname='privileged_device_audit_live_snapshot_consistency'
        and definition ilike '%actor_user_id%actor_user_id_snapshot%'
        and definition ilike '%target_user_id%target_user_id_snapshot%')
    as audit_exact_challenge_context,
  exists(select 1 from constraints where conname='device_security_credentials_non_backup_policy'
      and definition ilike '%backup_eligible = false%backup_state = false%')
    and exists(select 1 from constraints where table_name='device_security_credentials'
      and definition ilike '%user_verification_policy%required%') as routine_credentials_non_backup,
  exists(select 1 from triggers where tgname='device_security_credentials_lifecycle_guard'
      and table_name='device_security_credentials'
      and function_name='guard_device_security_credential_lifecycle'
      and definition ilike '%before insert or delete or update%'
      and function_definition ilike '%DEVICE_SECURITY_CREDENTIAL_MUST_ENROLL_PENDING%'
      and function_definition ilike '%DEVICE_SECURITY_CREDENTIAL_IDENTITY_IMMUTABLE%'
      and function_definition ilike '%DEVICE_SECURITY_CREDENTIAL_DELETE_FORBIDDEN%'
      and function_definition ilike '%DEVICE_SECURITY_CREDENTIAL_TRANSITION_INVALID%'
      and function_definition ilike '%DEVICE_SECURITY_CREDENTIAL_COUNTER_REGRESSION%'
      and function_definition ilike '%DEVICE_SECURITY_CREDENTIAL_DEVICE_NOT_APPROVED%'
      and function_definition ilike '%for update%') as credential_lifecycle_guard,
  exists(select 1 from triggers where tgname='device_possession_challenges_identity_guard'
      and table_name='device_possession_challenges'
      and function_name='guard_device_possession_challenge_identity'
      and definition ilike '%before insert or delete or update%'
      and function_definition ilike '%new.verified_at is not null%new.consumed_at is not null%new.failed_at is not null%new.failure_code is not null%new.verification_context is not null%'
      and function_definition ilike '%DEVICE_POSSESSION_CHALLENGE_BINDING_IMMUTABLE%'
      and function_definition ilike '%DEVICE_POSSESSION_CHALLENGE_VERIFICATION_IMMUTABLE%'
      and function_definition ilike '%DEVICE_POSSESSION_CHALLENGE_TERMINAL%'
      and function_definition ilike '%DEVICE_POSSESSION_CHALLENGE_CONSUMER_REQUIRED%') as challenge_lifecycle_guard,
  exists(select 1 from triggers where tgname='privileged_device_listing_sessions_lifecycle_guard'
      and table_name='privileged_device_listing_sessions'
      and function_name='guard_privileged_device_listing_session_lifecycle'
      and definition ilike '%before insert or delete or update%'
      and function_definition ilike '%PRIVILEGED_LISTING_SESSION_SOURCE_CHALLENGE_INVALID%'
      and function_definition ilike '%PRIVILEGED_LISTING_SESSION_BINDING_IMMUTABLE%'
      and function_definition ilike '%PRIVILEGED_LISTING_SESSION_REVOKED_TERMINAL%'
      and function_definition ilike '%for update%')
    and exists(select 1 from constraints where conname='privileged_device_listing_sessions_expiration'
      and definition ilike '%''00:05:00''::interval%')
    and exists(select 1 from constraints where table_name='privileged_device_listing_sessions'
      and definition ilike '%SYSTEM_OWNER_PENDING_DEVICE_LIST_READ_ONLY%') as listing_lifecycle_guard,
  exists(select 1 from triggers where tgname='system_owner_bootstrap_authorizations_lifecycle_guard'
      and table_name='system_owner_credential_bootstrap_authorizations'
      and function_name='guard_system_owner_bootstrap_authorization_lifecycle'
      and definition ilike '%before insert or delete or update%'
      and function_definition ilike '%SYSTEM_OWNER_BOOTSTRAP_INITIAL_STATE_INVALID%'
      and function_definition ilike '%SYSTEM_OWNER_BOOTSTRAP_BINDING_IMMUTABLE%'
      and function_definition ilike '%SYSTEM_OWNER_BOOTSTRAP_CONSUMPTION_ONE_WAY%'
      and function_definition ilike '%SYSTEM_OWNER_BOOTSTRAP_CALLER_CONSUMED_AT_FORBIDDEN%'
      and function_definition ilike '%SYSTEM_OWNER_BOOTSTRAP_CONSUMPTION_OUTSIDE_WINDOW%'
      and function_definition ilike '%new.consumed_at=statement_timestamp()%') as bootstrap_lifecycle_guard,
  exists(select 1 from triggers where tgname='system_owner_recovery_authorizations_lifecycle_guard'
      and table_name='system_owner_credential_recovery_authorizations'
      and function_name='guard_system_owner_recovery_authorization_lifecycle'
      and definition ilike '%before insert or delete or update%'
      and function_definition ilike '%SYSTEM_OWNER_RECOVERY_INITIAL_STATE_INVALID%'
      and function_definition ilike '%SYSTEM_OWNER_RECOVERY_BINDING_IMMUTABLE%'
      and function_definition ilike '%SYSTEM_OWNER_RECOVERY_WAITING_PERIOD_ACTIVE%'
      and function_definition ilike '%SYSTEM_OWNER_RECOVERY_TERMINAL%'
      and function_definition ilike '%SYSTEM_OWNER_RECOVERY_CALLER_CONSUMED_AT_FORBIDDEN%'
      and function_definition ilike '%new.consumed_at=statement_timestamp()%') as recovery_lifecycle_guard,
  exists(select 1 from triggers where tgname='system_owner_bootstrap_authorizations_lifecycle_guard'
    and definition ilike '%before insert or delete or update%')
    and exists(select 1 from function_state
      where signature='guard_system_owner_bootstrap_authorization_lifecycle()'
        and definition ilike '%SYSTEM_OWNER_BOOTSTRAP_INITIAL_STATE_INVALID%'
        and definition ilike '%new.consumed_at is not null%')
    and exists(select 1 from authorization_initial_columns
      where table_name='system_owner_credential_bootstrap_authorizations'
        and column_name='consumed_at' and is_nullable='YES' and column_default is null)
    as bootstrap_insert_issued_state_enforced,
  exists(select 1 from function_state
    where signature='guard_system_owner_bootstrap_authorization_lifecycle()'
      and definition ilike '%statement_timestamp()%'
      and definition ilike '%SYSTEM_OWNER_BOOTSTRAP_CONSUMPTION_OUTSIDE_WINDOW%'
      and definition ilike '%SYSTEM_OWNER_BOOTSTRAP_CALLER_CONSUMED_AT_FORBIDDEN%'
      and definition ilike '%new.consumed_at=statement_timestamp()%')
    as bootstrap_current_time_consumption,
  exists(select 1 from triggers where tgname='system_owner_recovery_authorizations_lifecycle_guard'
    and definition ilike '%before insert or delete or update%')
    and exists(select 1 from function_state
      where signature='guard_system_owner_recovery_authorization_lifecycle()'
        and definition ilike '%SYSTEM_OWNER_RECOVERY_INITIAL_STATE_INVALID%'
        and definition ilike '%new.status<>''pending_wait''%'
        and definition ilike '%new.consumed_at is not null%'
        and definition ilike '%new.not_before<=new.issued_at%')
    and (select count(*) from authorization_initial_columns
      where table_name='system_owner_credential_recovery_authorizations')=2
    as recovery_insert_pending_wait_enforced,
  exists(select 1 from function_state
    where signature='guard_system_owner_recovery_authorization_lifecycle()'
      and definition ilike '%SYSTEM_OWNER_RECOVERY_WAITING_PERIOD_ACTIVE%'
      and definition ilike '%statement_timestamp()<old.not_before%'
      and definition ilike '%SYSTEM_OWNER_RECOVERY_CONSUMPTION_OUTSIDE_WINDOW%'
      and definition ilike '%SYSTEM_OWNER_RECOVERY_CALLER_CONSUMED_AT_FORBIDDEN%'
      and definition ilike '%new.consumed_at=statement_timestamp()%')
    as recovery_wait_and_current_time_consumption,
  exists(select 1 from triggers where tgname='privileged_device_authorization_audit_immutable'
      and table_name='privileged_device_authorization_audit_log'
      and definition ilike '%before delete or update%prevent_device_authorization_audit_mutation%')
    and exists(select 1 from immutable_function_state
      where definition ilike '%raise exception%DEVICE_AUTHORIZATION_AUDIT_IMMUTABLE%') as audit_immutable,
  exists(select 1 from triggers where tgname='system_owner_device_authorization_operations_immutable'
      and table_name='system_owner_device_authorization_operations'
      and definition ilike '%before delete or update%prevent_device_authorization_audit_mutation%')
    and exists(select 1 from immutable_function_state
      where definition ilike '%raise exception%DEVICE_AUTHORIZATION_AUDIT_IMMUTABLE%') as operation_ledger_immutable,
  to_regprocedure('public.list_member_device_authorizations(uuid,uuid,uuid)') is not null as organization_scoped_device_listing_preserved,
  to_regprocedure('public.require_current_approved_device(uuid)') is not null as device_authorization_foundation_preserved
from feature_state;
