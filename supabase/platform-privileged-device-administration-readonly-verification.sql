-- READ ONLY. Run after 6.20 on Development. Every boolean must be true.
with expected_functions(signature) as (values
 ('public.require_platform_device_backend()'),
 ('public.require_system_owner_webauthn_actor(uuid,uuid,uuid)'),
 ('public.get_system_owner_platform_device_administration_state(uuid,uuid)'),
 ('public.begin_system_owner_credential_enrollment(uuid,uuid,uuid,text,text,text,bytea,uuid,bytea)'),
 ('public.issue_system_owner_credential_bootstrap_authorization(uuid,uuid,uuid,uuid,text,bytea,text,text,text)'),
 ('public.complete_system_owner_credential_enrollment(uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,bytea,bytea,integer,uuid,text[],bigint,text,text,jsonb)'),
 ('public.begin_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,bytea)'),
 ('public.get_system_owner_device_challenge_verification_material(uuid,uuid,uuid,uuid)'),
 ('public.fail_system_owner_device_possession_challenge(uuid,uuid,uuid,uuid,text)'),
 ('public.complete_system_owner_pending_device_listing(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,bytea,bigint,text,text,jsonb)'),
 ('public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea)'),
 ('public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)'),
 ('public.get_system_owner_device_operation_result(uuid,uuid,uuid,uuid,uuid,text,text)')
), functions as (
 select expected.signature,procedures.oid,procedures.prosecdef,
  procedures.proconfig @> array['search_path=pg_catalog, public']::text[] fixed_path,
  pg_get_functiondef(procedures.oid) definition,
  has_function_privilege('anon',procedures.oid,'execute') anon_execute,
  has_function_privilege('authenticated',procedures.oid,'execute') authenticated_execute,
  has_function_privilege('service_role',procedures.oid,'execute') backend_execute,
  pg_get_userbyid(procedures.proowner) owner_name
 from expected_functions expected left join pg_proc procedures
  on procedures.oid=to_regprocedure(expected.signature)
), controlled_owner as (
 select pg_get_userbyid(classes.relowner) owner_name from pg_class classes
 join pg_namespace namespaces on namespaces.oid=classes.relnamespace
 where namespaces.nspname='public' and classes.relname='user_device_authorizations'
)
select
 not exists(select 1 from functions where oid is null) exact_functions_exist,
 not exists(select 1 from functions where not prosecdef or not fixed_path) security_definer_fixed_paths,
 not exists(select 1 from functions where anon_execute or authenticated_execute or not backend_execute) backend_only_execute,
 not exists(select 1 from functions,controlled_owner where functions.owner_name<>controlled_owner.owner_name) controlled_owners,
 (select enabled from public.webauthn_privileged_device_feature where singleton_id=1)=true feature_enabled,
 not exists(select 1 from pg_policy policies join pg_class classes on classes.oid=policies.polrelid
   join pg_namespace namespaces on namespaces.oid=classes.relnamespace
   where namespaces.nspname='public' and classes.relname in ('device_security_credentials',
    'device_possession_challenges','device_possession_challenge_consumers',
    'privileged_device_listing_sessions','system_owner_device_authorization_operations',
    'privileged_device_authorization_audit_log')) no_browser_policies,
 not exists(select 1 from functions where definition ilike '%organization_members%'
   or definition ilike '%conferences%') no_conference_or_organization_dependency,
 not exists(select 1 from functions where definition ilike '%auth.uid()%') backend_does_not_infer_actor_from_service_token,
 (select definition ilike '%authorization_status=''pending''%revoked_at is null%account_status=''approved''%'
   from functions where signature='public.list_system_owner_pending_device_authorizations(uuid,uuid,uuid,text,bytea)') exact_pending_filter,
 (select definition ilike '%challenge_hash=p_challenge_hash%'
   from functions where signature='public.complete_system_owner_pending_device_operation(uuid,uuid,uuid,uuid,text,uuid,bytea,uuid,uuid,uuid,text,bigint,text,text,jsonb)') completion_hash_binding;
