'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const file='supabase/migrations/20260907155000_production_structural_platform_foundation.sql';
const sql=fs.readFileSync(file,'utf8');
const executable=sql.replace(/--[^\n]*/g,'');
const migrations={
  sessions:fs.readFileSync('supabase/migrations/20260902122033_platform_device_session_foundation_1b.sql','utf8'),
  conference:fs.readFileSync('supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql','utf8'),
  enrollment:fs.readFileSync('supabase/migrations/20260903175000_platform_native_device_enrollment.sql','utf8'),
  warehouse:fs.readFileSync('supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql','utf8'),
  round3k:fs.readFileSync('supabase/migrations/20260907160000_production_foundation_reconciliation.sql','utf8')
};

test('1 package is ordered immediately before Round 3K',()=>assert.ok(file.split('/').pop()<'20260907160000_production_foundation_reconciliation.sql'));
test('2 schemas and pgcrypto are established with API revocation',()=>{
  assert.match(sql,/create schema if not exists platform;/);
  assert.match(sql,/create schema if not exists platform_private;/);
  assert.match(sql,/create extension if not exists pgcrypto with schema extensions;/);
  assert.match(sql,/revoke all on schema platform from public, anon, authenticated;/);
  assert.match(sql,/revoke all on schema platform_private from public, anon, authenticated;/);
});
test('3 canonical Round 3K tables exist',()=>{
  for(const name of ['profiles','permissions','roles','role_permissions','user_roles','devices','user_device_authorizations','audit_events'])
    assert.match(sql,new RegExp(`create table platform\\.${name} \\(`));
});
test('4 Round 3K referenced columns are supplied',()=>{
  for(const column of ['account_status','approved_at','approved_by','blocked_at','blocked_by','status_changed_at','status_changed_by'])assert.match(sql,new RegExp(column));
  for(const table of ['profiles','roles','user_roles','devices','user_device_authorizations'])assert.match(migrations.round3k,new RegExp(`platform\\.${table}`));
});
test('5 only active Platform permissions are seeded',()=>{
  const seeds=sql.slice(sql.indexOf('insert into platform.permissions'),sql.indexOf('create or replace function platform_private.set_updated_at'));
  assert.doesNotMatch(seeds,/'inventory\.|'inventory_manager'|'inventory_operator'|'viewer'/);
  assert.match(seeds,/'platform\.users\.manage'/);
});
test('6 dormant inventory type compatibility creates no competing authority',()=>{
  assert.doesNotMatch(sql,/create schema if not exists inventory|create table inventory\./);
  assert.doesNotMatch(executable,/insert into public\.(?:platform_modules|module_permission_catalog|module_permission_grants)/i);
  assert.doesNotMatch(executable,/require_effective_module_permission/i);
});
test('7 platform owner has exact structural semantics and no assignment',()=>{
  assert.match(sql,/'platform_owner','platform',[^\n]+,'platform',true,false/);
  assert.doesNotMatch(executable,/insert into platform\.user_roles/i);
});
test('8 provisioning explicitly creates pending identity only',()=>{
  assert.match(sql,/create or replace function platform_private\.provision_auth_user\(\)/);
  assert.match(sql,/values\(new\.id,[\s\S]*,'pending'\)/);
  const body=sql.slice(sql.indexOf('create or replace function platform_private.provision_auth_user'),sql.indexOf('create trigger platform_auth_user_provisioned'));
  assert.doesNotMatch(body,/approved|user_roles|role_permissions/);
});
test('9 no existing account or owner bootstrap executes',()=>{
  assert.doesNotMatch(executable,/complete_first_system_bootstrap|first_platform_owner_bootstrap/);
  assert.doesNotMatch(executable,/insert into platform\.profiles\s*\([^)]*\)\s*select/i);
});
test('10 no device, authorization, or key binding row is created',()=>{
  assert.doesNotMatch(executable,/insert into platform\.(?:devices|user_device_authorizations|device_key_bindings)/i);
});
test('11 no secret or key material is fabricated',()=>assert.doesNotMatch(executable,/gen_random_bytes|random\s*\(|public_key_jwk\s*\)\s*values/i));
test('12 no legacy device is projected',()=>assert.doesNotMatch(executable,/public\.(?:user_devices|system_user_devices|conference_user_devices)/i));
test('13 Conference and Organization data are untouched',()=>assert.doesNotMatch(executable,/(?:insert into|update|delete from|alter table)\s+(?:public\.)?(?:conferences|organizations|organization_members)/i));
test('14 Warehouse business data and Organization dependency are absent',()=>assert.doesNotMatch(executable,/(?:warehouse\.|organization_id|module_permission_grants)/i));
test('15 key binding table preserves the downstream structural contract',()=>{
  for(const token of ['device_authorization_id','public_key_jwk','public_key_thumbprint','ECDSA_P256_SHA256','lifecycle_status','migration_source','device_key_bindings_migration_source_check'])assert.match(sql,new RegExp(token));
  assert.match(sql,/unique\(id,user_id,device_id,device_authorization_id\)/);
  assert.match(sql,/device_key_bindings_one_active_device_idx/);
});
test('16 Development handoff challenge and audit flow is absent',()=>{
  assert.doesNotMatch(sql,/device_ownership_handoff_challenges|device_ownership_handoff_audit|complete_device_ownership_handoff/);
  assert.match(sql,/PLATFORM_NATIVE_ENROLLMENT_REQUIRED/);
});
test('17 no Development target or recovery identity leaks into package',()=>{
  assert.doesNotMatch(sql,/gppwltrifgfxrkzvvxoe|development_preview|one_time_stable_development_device_recovery/i);
  assert.doesNotMatch(sql,/f9306733-612d-433f-a38e-5d72855c2fe3/i);
});
test('18 session foundation can resolve binding structure',()=>{
  assert.match(migrations.sessions,/references platform\.device_key_bindings\(id\)/);
  for(const column of ['id','user_id','device_id','device_authorization_id','public_key_thumbprint','algorithm','lifecycle_status','revoked_at','retired_at'])assert.match(sql,new RegExp(`\\b${column}\\b`));
});
test('19 Conference boundary compatibility signatures exist without handoff state',()=>{
  for(const signature of ['begin_current_device_ownership_handoff','get_current_device_handoff_assertion_claims','get_my_device_key_binding_status']){
    assert.match(migrations.conference,new RegExp(`platform\\.${signature}`));
    assert.match(sql,new RegExp(`function platform\\.${signature}`));
  }
});
test('20 native enrollment can replace the migration-source constraint',()=>{
  assert.match(sql,/constraint device_key_bindings_migration_source_check\s+check/);
  assert.match(migrations.enrollment,/drop constraint device_key_bindings_migration_source_check/);
});
test('21 unified Warehouse operation can resolve session binding joins',()=>{
  assert.match(migrations.warehouse,/join platform\.device_key_bindings binding on binding\.id=item\.binding_id/);
  assert.match(sql,/create table platform\.device_key_bindings/);
});
test('22 RLS audit immutability and private isolation are installed',()=>{
  assert.match(sql,/alter table platform\.device_key_bindings force row level security/);
  assert.match(sql,/PLATFORM_AUDIT_IMMUTABLE/);
  assert.match(sql,/revoke all on all functions in schema platform_private from public,anon,authenticated,service_role/);
});
test('23 package is forward-only and transaction bounded',()=>{
  assert.match(sql,/^--[\s\S]*\nbegin;/);
  assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(executable,/\b(?:drop|truncate)\b/i);
});
test('24 canonical Warehouse permission authority remains separate',()=>{
  const catalog=fs.readFileSync('supabase/migrations/20260829140000_warehouse_module_permission_catalog.sql','utf8');
  assert.match(catalog,/warehouse\./);
  assert.doesNotMatch(sql,/'warehouse\./);
});
test('25 dedicated package and immutable prerequisite migration sources exist',()=>{
  assert.ok(fs.existsSync(file));
  for(const prerequisite of [
    'supabase/migrations/20260902122033_platform_device_session_foundation_1b.sql',
    'supabase/migrations/20260903090000_conference_device_session_execution_boundary.sql',
    'supabase/migrations/20260903175000_platform_native_device_enrollment.sql',
    'supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql',
    'supabase/migrations/20260907160000_production_foundation_reconciliation.sql'
  ])assert.ok(fs.existsSync(prerequisite),prerequisite);
});
test('26 regression test is independent of unpublished git status',()=>{
  const source=fs.readFileSync(__filename,'utf8');
  assert.doesNotMatch(source,new RegExp(['node:child','process'].join('_')+'|'+['execFile','Sync'].join('')));
  assert.doesNotMatch(source,new RegExp(['status','includes'].join('\\.')));
});
test('27 legacy Platform registration is structural and fail closed',()=>{
  const start=sql.indexOf('create or replace function platform.register_current_device');
  const end=sql.indexOf('create or replace function platform.get_my_device_authorization',start);
  const body=sql.slice(start,end);
  assert.match(body,/PLATFORM_NATIVE_ENROLLMENT_REQUIRED/);
  assert.doesNotMatch(body,/insert into|request_header|hash_device_secret/);
  const grants=sql.slice(sql.indexOf('revoke all on all functions in schema platform'),sql.indexOf('create policy profiles_select'));
  assert.doesNotMatch(grants,/grant execute[^;]*platform\.register_current_device/is);
});
test('28 active onboarding does not call the legacy Platform registration function',()=>{
  const service=fs.readFileSync('js/supabase/current-device-authorization-service.js','utf8');
  assert.match(service,/register_or_refresh_current_device/);
  assert.doesNotMatch(service,/platform\.register_current_device|['"]register_current_device['"]/);
  assert.match(migrations.conference,/grant execute[^;]*platform\.register_current_device\(text,text,text\)/s);
});
test('29 reserved authorization keyword is never used as a relation alias',()=>{
  assert.doesNotMatch(executable,/\b(?:from|join)\s+[^\s;(),]+\s+(?:as\s+)?authorization\b/i);
  assert.doesNotMatch(executable,/\bauthorization\s*\./i);
});
test('30 get_my_access_context closes its outer CASE before FROM',()=>{
  const start=sql.indexOf('create or replace function platform.get_my_access_context');
  const end=sql.indexOf('create or replace function platform.register_current_device',start);
  const body=sql.slice(start,end).replace(/\s+/g,' ');
  assert.match(body,/select case when auth\.uid\(\) is null then null else pg_catalog\.jsonb_build_object\([\s\S]*\) end from \(select 1\) singleton left join platform\.profiles profile/);
});
