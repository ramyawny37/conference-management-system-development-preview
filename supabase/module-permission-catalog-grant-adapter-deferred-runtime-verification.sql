\set ON_ERROR_STOP on

-- DEFERRED DISPOSABLE-RUNTIME VERIFICATION ONLY. DO NOT RUN DURING AUTHORING.
-- Invoke with an externally supplied disposable connection and both required variables:
-- psql "$DISPOSABLE_DATABASE_URL" -v phase4g_expected_environment=disposable \
--   -v phase4g_expected_database=<exact_test_database_name> -f <this-file>
-- No URL, credential, password, token, or secret is stored here. All fixtures roll back.

select set_config('phase4g.expected_environment', :'phase4g_expected_environment', false);
select set_config('phase4g.expected_database', :'phase4g_expected_database', false);

do $$
declare
  expected_database text := current_setting('phase4g.expected_database',true);
begin
  if current_setting('phase4g.expected_environment',true) is distinct from 'disposable'
     or expected_database is null or btrim(expected_database)=''
     or current_database() <> expected_database
     or lower(current_database()) ~ '(prod|production|development|staging)'
     or lower(current_database()) !~ '(test|disposable|local)' then
    raise exception 'PHASE4G_DISPOSABLE_ENVIRONMENT_REQUIRED';
  end if;
end;
$$;

begin;

create function pg_temp.phase4g_assert(p_condition boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'PHASE4G_ASSERTION_FAILED: %',p_message; end if;
end;
$$;

create function pg_temp.phase4g_expect_error(p_sql text,p_expected text)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm)>0 then return; end if;
    raise exception 'PHASE4G_WRONG_ERROR expected %, received %',p_expected,sqlerrm;
  end;
  raise exception 'PHASE4G_EXPECTED_ERROR_NOT_RAISED: %',p_expected;
end;
$$;

-- Object, owner, RLS, exact table privileges, and exact function exposure.
do $$
declare exposed text[];
begin
  if to_regclass('public.module_permission_catalog') is null
     or to_regprocedure('public.validate_module_permission_catalog(text,text,text,text,text)') is null
     or to_regprocedure('public.require_effective_module_permission(uuid,text,text,text,text)') is null
     or to_regprocedure('public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)') is null
     or to_regprocedure('public.manage_foundation_module_grant(uuid,uuid,text,uuid,text,text,uuid,text)') is null
     or to_regprocedure('public.recover_revoke_final_module_manager(uuid,uuid,text,uuid,uuid,text)') is null then
    raise exception 'PHASE4G_MIGRATION_OBJECTS_REQUIRED';
  end if;
  perform pg_temp.phase4g_assert(
    (select catalog.relowner=modules.relowner from pg_class catalog,pg_class modules
      where catalog.oid='public.module_permission_catalog'::regclass
        and modules.oid='public.platform_modules'::regclass),'catalog owner mismatch');
  perform pg_temp.phase4g_assert(
    (select relrowsecurity from pg_class where oid='public.module_permission_catalog'::regclass),
    'catalog RLS missing');
  perform pg_temp.phase4g_assert(
    not has_table_privilege('anon','public.module_permission_catalog','SELECT')
    and not has_table_privilege('authenticated','public.module_permission_catalog','SELECT')
    and not has_table_privilege('authenticated','public.module_permission_catalog','INSERT')
    and not has_table_privilege('authenticated','public.module_permission_catalog','UPDATE')
    and not has_table_privilege('authenticated','public.module_permission_catalog','DELETE')
    and not has_table_privilege('authenticated','public.module_permission_grants','INSERT')
    and not has_table_privilege('authenticated','public.module_grant_operations','UPDATE')
    and not has_table_privilege('authenticated','public.module_grant_audit_log','DELETE'),
    'browser table mutation privilege exposed');
  perform pg_temp.phase4g_assert(
    not has_function_privilege('authenticated','public.validate_module_permission_catalog(text,text,text,text,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.require_effective_module_permission(uuid,text,text,text,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.manage_catalog_module_grant(uuid,uuid,text,uuid,text,text,text,text,uuid,text)','EXECUTE'),
    'internal helper execute exposed');
  select coalesce(array_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
    order by p.proname),array[]::text[]) into exposed
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in (
     'validate_module_permission_catalog','require_effective_module_permission',
     'manage_catalog_module_grant','manage_foundation_module_grant',
     'recover_revoke_final_module_manager')
     and has_function_privilege('authenticated',p.oid,'EXECUTE');
  perform pg_temp.phase4g_assert(exposed=array[
    'manage_foundation_module_grant(p_actor_device_id uuid, p_operation_id uuid, p_action text, p_target_user_id uuid, p_module_key text, p_permission_key text, p_grant_id uuid, p_revocation_reason text)',
    'recover_revoke_final_module_manager(p_actor_device_id uuid, p_operation_id uuid, p_module_key text, p_target_user_id uuid, p_target_grant_id uuid, p_recovery_reason text)'
  ],'reviewed public RPC exposure mismatch');
end;
$$;

set local role authenticated;
select pg_temp.phase4g_expect_error(
  $q$select public.require_effective_module_permission(null,'x','x.y.z',null,null)$q$,
  'permission denied'
);
select pg_temp.phase4g_expect_error(
  $q$select public.manage_catalog_module_grant(null,null,null,null,null,null,null,null,null,null)$q$,
  'permission denied'
);
reset role;

-- Rolled-back fixture identities: owner, manager, target, pending, blocked, and admin.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('4f000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4g-owner@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
('4f000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4g-manager@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
('4f000000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','phase4g-target@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
('4f000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4g-pending@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
('4f000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4g-blocked@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now()),
('4f000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4g-admin@example.invalid','', '{}'::jsonb,'{}'::jsonb,now(),now());

insert into public.system_user_access(user_id,account_status,approved_at) values
('4f000000-0000-4000-8000-000000000001','approved',now()),('4f000000-0000-4000-8000-000000000002','approved',now()),
('4f000000-0000-4000-8000-000000000003','approved',now()),('4f000000-0000-4000-8000-000000000004','pending',null),
('4f000000-0000-4000-8000-000000000005','blocked',null),('4f000000-0000-4000-8000-000000000006','approved',now())
on conflict(user_id) do update set account_status=excluded.account_status,approved_at=excluded.approved_at;
insert into public.system_user_roles(user_id,role,granted_by) values
('4f000000-0000-4000-8000-000000000001','system_owner','4f000000-0000-4000-8000-000000000001'),
('4f000000-0000-4000-8000-000000000004','system_owner','4f000000-0000-4000-8000-000000000001'),
('4f000000-0000-4000-8000-000000000006','system_admin','4f000000-0000-4000-8000-000000000001');

insert into public.devices(id,user_id,device_name,platform) values
('4f100000-0000-4000-8000-000000000001','4f000000-0000-4000-8000-000000000001','owner','phase4g'),
('4f100000-0000-4000-8000-000000000002','4f000000-0000-4000-8000-000000000002','manager','phase4g'),
('4f100000-0000-4000-8000-000000000003','4f000000-0000-4000-8000-000000000003','target','phase4g'),
('4f100000-0000-4000-8000-000000000004','4f000000-0000-4000-8000-000000000004','pending','phase4g'),
('4f100000-0000-4000-8000-000000000005','4f000000-0000-4000-8000-000000000005','blocked','phase4g'),
('4f100000-0000-4000-8000-000000000006','4f000000-0000-4000-8000-000000000006','admin','phase4g'),
('4f100000-0000-4000-8000-000000000007','4f000000-0000-4000-8000-000000000001','revoked','phase4g'),
('4f100000-0000-4000-8000-000000000008','4f000000-0000-4000-8000-000000000001','pending','phase4g');
insert into public.user_device_authorizations(user_id,device_id,authorization_status,approved_at,approved_by,revoked_at,revoked_by) values
('4f000000-0000-4000-8000-000000000001','4f100000-0000-4000-8000-000000000001','approved',now(),'4f000000-0000-4000-8000-000000000001',null,null),
('4f000000-0000-4000-8000-000000000002','4f100000-0000-4000-8000-000000000002','approved',now(),'4f000000-0000-4000-8000-000000000001',null,null),
('4f000000-0000-4000-8000-000000000003','4f100000-0000-4000-8000-000000000003','approved',now(),'4f000000-0000-4000-8000-000000000001',null,null),
('4f000000-0000-4000-8000-000000000004','4f100000-0000-4000-8000-000000000004','pending',null,null,null,null),
('4f000000-0000-4000-8000-000000000005','4f100000-0000-4000-8000-000000000005','approved',now(),'4f000000-0000-4000-8000-000000000001',null,null),
('4f000000-0000-4000-8000-000000000006','4f100000-0000-4000-8000-000000000006','approved',now(),'4f000000-0000-4000-8000-000000000001',null,null),
('4f000000-0000-4000-8000-000000000001','4f100000-0000-4000-8000-000000000007','revoked',null,null,now(),'4f000000-0000-4000-8000-000000000001'),
('4f000000-0000-4000-8000-000000000001','4f100000-0000-4000-8000-000000000008','pending',null,null,null,null);

insert into public.platform_modules(module_key,display_name,status) values
('phase4g','Phase 4G fixture','active'),('phase4gx','Phase 4G namespace fixture','active'),
('phase4goff','Phase 4G disabled fixture','disabled');
insert into public.module_permission_catalog(permission_key,module_key,display_name,description,status,allowed_scope_mode,allowed_resource_type,sensitive_mutation,catalog_version) values
('phase4g.record.read','phase4g','Read','Fixture read','active','both','record',false,1),
('phase4g.record.write','phase4g','Write','Fixture write','active','resource','record',true,1),
('phase4gx.record.read','phase4gx','Other read','Namespace fixture','active','module',null,false,1),
('phase4goff.record.read','phase4goff','Disabled read','Disabled fixture','active','module',null,false,1);
insert into public.module_permission_grants(user_id,module_key,permission_key,granted_by,granted_by_device_id) values
('4f000000-0000-4000-8000-000000000002','phase4g','module.manage','4f000000-0000-4000-8000-000000000001','4f100000-0000-4000-8000-000000000001');

-- Actor/device matrix: unauthenticated, pending/blocked actor, missing/pending/revoked
-- device, approved success, System Admin no bypass, Owner still device-guarded.
select set_config('request.jwt.claim.sub','',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4g','phase4g.record.read',null,null)$q$,'AUTH_REQUIRED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000004',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000004','phase4g','phase4g.record.read',null,null)$q$,'SYSTEM_ACCESS_APPROVED_REQUIRED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000005',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000005','phase4g','phase4g.record.read',null,null)$q$,'SYSTEM_ACCESS_APPROVED_REQUIRED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000001',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000007','phase4g','phase4g.record.read',null,null)$q$,'APPROVED_DEVICE_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000008','phase4g','phase4g.record.read',null,null)$q$,'APPROVED_DEVICE_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000099','phase4g','phase4g.record.read',null,null)$q$,'APPROVED_DEVICE_REQUIRED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000006',true);
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000006','4f200000-0000-4000-8000-000000000001','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read',null,null,null,null)$q$,'MODULE_PERMISSION_REQUIRED');

-- Catalog and target matrix, including replay/mismatch and equivalent duplicate.
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000001',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4g','phase4g.unknown.read',null,null)$q$,'MODULE_PERMISSION_CATALOG_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4g','phase4gx.record.read',null,null)$q$,'MODULE_PERMISSION_NAMESPACE_MISMATCH');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4goff','phase4goff.record.read',null,null)$q$,'ACTIVE_MODULE_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4g','phase4g.record.write',null,null)$q$,'MODULE_PERMISSION_SCOPE_NOT_ALLOWED');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4g','phase4g.record.write','wrong','r1')$q$,'MODULE_PERMISSION_RESOURCE_TYPE_INVALID');
select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000010','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r1',null,null);
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000011','grant','4f000000-0000-4000-8000-000000000004','phase4g','phase4g.record.read','record','r2',null,null)$q$,'TARGET_ACCOUNT_APPROVED_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000012','grant','4f000000-0000-4000-8000-000000000005','phase4g','phase4g.record.read','record','r2',null,null)$q$,'TARGET_ACCOUNT_APPROVED_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000013','grant','4f000000-0000-4000-8000-000000000099','phase4g','phase4g.record.read','record','r2',null,null)$q$,'TARGET_ACCOUNT_NOT_FOUND');
select pg_temp.phase4g_assert((select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000010','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r1',null,null)->>'status')='created','same-intent replay');
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000010','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','changed',null,null)$q$,'MODULE_GRANT_OPERATION_MISMATCH');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000002',true);
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000002','4f200000-0000-4000-8000-000000000010','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r1',null,null)$q$,'MODULE_GRANT_OPERATION_MISMATCH');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000001',true);
select pg_temp.phase4g_assert((select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000014','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r1',null,null)->>'status')='existing','equivalent duplicate');

-- Effective authorization: exact resource, unrelated rejection, no resource-to-module
-- escalation, literal wildcard-looking ID, same-permission module fallback, no manager bypass.
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000003',true);
select pg_temp.phase4g_assert((select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r1')->>'authoritySource')='resource_grant','exact resource');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r2')$q$,'MODULE_PERMISSION_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000003','phase4g','phase4g.record.read',null,null)$q$,'MODULE_PERMISSION_REQUIRED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000001',true);
select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000015','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.write','record','*',null,null);
select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000016','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read',null,null,null,null);
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000003',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000003','phase4g','phase4g.record.write','record','anything')$q$,'MODULE_PERMISSION_REQUIRED');
select pg_temp.phase4g_assert((select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','unrelated')->>'authoritySource')='module_grant','module fallback');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000002',true);
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000002','phase4g','phase4g.record.write','record','*')$q$,'MODULE_PERMISSION_REQUIRED');

-- Retire and narrow a resource permission: current authorize/grant fail, exact stored
-- historical resource grant still revokes because stored identity/scope is authoritative.
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000001',true);
update public.module_permission_catalog set status='retired',retired_at=now(),allowed_scope_mode='module',allowed_resource_type=null,catalog_version=2 where permission_key='phase4g.record.write';
select pg_temp.phase4g_expect_error($q$select public.require_effective_module_permission('4f100000-0000-4000-8000-000000000001','phase4g','phase4g.record.write','record','*')$q$,'ACTIVE_MODULE_PERMISSION_REQUIRED');
select pg_temp.phase4g_expect_error($q$select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000017','grant','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.write','record','new',null,null)$q$,'ACTIVE_MODULE_PERMISSION_REQUIRED');
select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000018','revoke','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.write','record','*',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000003' and permission_key='phase4g.record.write' and resource_id='*'),'retired exact grant');

-- Blocking preserves grants; exact revocation after blocking remains possible.
update public.system_user_access set account_status='blocked',blocked_at=now(),blocked_by='4f000000-0000-4000-8000-000000000001' where user_id='4f000000-0000-4000-8000-000000000003';
select pg_temp.phase4g_assert(exists(select 1 from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000003'),'blocking preserves grants');
select public.manage_catalog_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000019','revoke','4f000000-0000-4000-8000-000000000003','phase4g','phase4g.record.read','record','r1',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000003' and permission_key='phase4g.record.read' and resource_id='r1'),'blocked target revoke');

-- History immutability and exact audit attribution.
select pg_temp.phase4g_expect_error($q$delete from public.module_permission_catalog where permission_key='phase4g.record.read'$q$,'MODULE_PERMISSION_CATALOG_DELETE_PROHIBITED');
select pg_temp.phase4g_expect_error($q$delete from public.module_permission_grants where permission_key='phase4g.record.write' and revoked_at is not null$q$,'MODULE_GRANT_DELETE_PROHIBITED');
select pg_temp.phase4g_expect_error($q$update public.module_permission_grants set resource_id='rewritten' where permission_key='phase4g.record.write' and revoked_at is not null$q$,'REVOKED_MODULE_GRANT_IMMUTABLE');
select pg_temp.phase4g_expect_error($q$update public.module_grant_operations set outcome='existing' where operation_id='4f200000-0000-4000-8000-000000000010'$q$,'MODULE_AUTHORIZATION_HISTORY_IMMUTABLE');
select pg_temp.phase4g_expect_error($q$delete from public.module_grant_audit_log where operation_id='4f200000-0000-4000-8000-000000000010'$q$,'MODULE_AUTHORIZATION_HISTORY_IMMUTABLE');
select pg_temp.phase4g_assert(exists(select 1 from public.module_grant_audit_log where operation_id='4f200000-0000-4000-8000-000000000010' and actor_user_id='4f000000-0000-4000-8000-000000000001' and actor_device_id='4f100000-0000-4000-8000-000000000001' and module_key='phase4g' and permission_key='phase4g.record.read' and resource_type='record' and resource_id='r1'),'exact audit attribution');

-- Recovery: ordinary-final rejection, non-owner rejection, multiple-manager rejection,
-- reason bounds, success, distinct audit, deterministic replay, and stale new operation.
select pg_temp.phase4g_expect_error($q$select public.manage_foundation_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000020','revoke','4f000000-0000-4000-8000-000000000002','phase4g','module.manage',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000002' and permission_key='module.manage' and revoked_at is null),'ordinary final revoke')$q$,'LAST_MODULE_MANAGER_REVOCATION_PROHIBITED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000002',true);
select pg_temp.phase4g_expect_error($q$select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000002','4f200000-0000-4000-8000-000000000021','phase4g','4f000000-0000-4000-8000-000000000002',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000002' and permission_key='module.manage' and revoked_at is null),'non owner recovery rejected')$q$,'SYSTEM_OWNER_REQUIRED');
select set_config('request.jwt.claim.sub','4f000000-0000-4000-8000-000000000001',true);
insert into public.module_permission_grants(user_id,module_key,permission_key,granted_by,granted_by_device_id) values('4f000000-0000-4000-8000-000000000006','phase4g','module.manage','4f000000-0000-4000-8000-000000000001','4f100000-0000-4000-8000-000000000001');
select pg_temp.phase4g_expect_error($q$select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000022','phase4g','4f000000-0000-4000-8000-000000000002',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000002' and permission_key='module.manage' and revoked_at is null),'multiple managers recovery')$q$,'FINAL_MODULE_MANAGER_RECOVERY_NOT_REQUIRED');
select public.manage_foundation_module_grant('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000023','revoke','4f000000-0000-4000-8000-000000000006','phase4g','module.manage',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000006' and permission_key='module.manage' and revoked_at is null),'remove extra manager');
select pg_temp.phase4g_expect_error($q$select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000024','phase4g','4f000000-0000-4000-8000-000000000002',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000002' and permission_key='module.manage' and revoked_at is null),'short')$q$,'INVALID_FINAL_MANAGER_RECOVERY');
select pg_temp.phase4g_expect_error($q$select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000024','phase4g','4f000000-0000-4000-8000-000000000002',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000002' and permission_key='module.manage' and revoked_at is null),repeat('x',501))$q$,'INVALID_FINAL_MANAGER_RECOVERY');
select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000025','phase4g','4f000000-0000-4000-8000-000000000002',(select grant_id from public.module_permission_grants where user_id='4f000000-0000-4000-8000-000000000002' and permission_key='module.manage' and revoked_at is null),'disposable final manager recovery');
select pg_temp.phase4g_assert(exists(select 1 from public.module_grant_audit_log where operation_id='4f200000-0000-4000-8000-000000000025' and event_type='final_manager_recovery_revoked'),'distinct recovery audit');
select pg_temp.phase4g_assert((select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000025','phase4g','4f000000-0000-4000-8000-000000000002',(select resulting_grant_id from public.module_grant_operations where operation_id='4f200000-0000-4000-8000-000000000025'),'disposable final manager recovery')->>'status')='recovered','recovery replay');
select pg_temp.phase4g_expect_error($q$select public.recover_revoke_final_module_manager('4f100000-0000-4000-8000-000000000001','4f200000-0000-4000-8000-000000000026','phase4g','4f000000-0000-4000-8000-000000000002',(select resulting_grant_id from public.module_grant_operations where operation_id='4f200000-0000-4000-8000-000000000025'),'new operation stale recovery')$q$,'MODULE_GRANT_NOT_FOUND_OR_STALE');

rollback;
\echo 'Phase 4G disposable single-session verification: PASS'
\echo 'Run the separate concurrency runner for real multi-session race verification.'
