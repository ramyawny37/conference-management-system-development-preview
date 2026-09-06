'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

function read(path){return fs.readFileSync(path,'utf8');}

const migration=read('supabase/migrations/20260906120000_system_access_platform_profile_reconciliation.sql');
const systemAccessFoundation=read('supabase/migrations/20260730_5_0_0_system_access_foundation.sql');
const platformFoundation=read('supabase/migrations/20260831023000_platform_foundation_reconciliation.sql');
const dispatcher=read('supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql');
const phase1c=read('supabase/migrations/20260903150000_phase1c_server_device_context_reconciliation.sql');
const warehouseGuarded=read('supabase/migrations/20260829140200_warehouse_v1_guarded_rpc.sql');
const warehouseContract=read('js/supabase/warehouse-device-operation-contract.js');
const currentStore=read('js/warehouse/current-store-context.js');
const conferenceContract=read('js/supabase/conference-device-operation-contract.js');

function body(name){
  const match=migration.match(new RegExp(
    'create or replace function platform_private\\.'+name+'[\\s\\S]*?\\n\\$\\$;',
    'i'
  ));
  assert.ok(match,'missing function: '+name);
  return match[0];
}

test('missing Platform profiles are backfilled before canonical status projection',()=>{
  const identityBackfill=migration.indexOf('insert into platform.profiles (user_id, display_name)');
  const statusBackfill=migration.indexOf('perform platform_private.reconcile_system_user_access_profile(access_row)');
  assert.ok(identityBackfill>=0&&statusBackfill>identityBackfill);
  assert.match(migration,/from auth\.users as users[\s\S]*on conflict \(user_id\) do nothing/i);
  assert.match(migration,/select access\.\* from public\.system_user_access as access/i);
});

test('pending, approved, and blocked canonical states project with compatible metadata',()=>{
  const reconcile=body('reconcile_system_user_access_profile');
  assert.match(reconcile,/p_access\.account_status not in \('pending', 'approved', 'blocked'\)/i);
  assert.match(reconcile,/when 'approved' then v_approved_at/i);
  assert.match(reconcile,/when 'blocked' then v_blocked_at/i);
  assert.match(reconcile,/p_access\.account_status, v_status_changed_at/i);
  assert.match(reconcile,/v_approved_at, p_access\.approved_by/i);
  assert.match(reconcile,/v_blocked_at, p_access\.blocked_by/i);
});

test('legacy approve, block, and unblock mutations atomically fire final-row reconciliation',()=>{
  for(const operation of ['approve_system_user','block_system_user','unblock_system_user'])
    assert.match(systemAccessFoundation,new RegExp('function public\\.'+operation,'i'));
  assert.match(systemAccessFoundation,/set account_status = 'approved'[\s\S]*approved_at = now\(\)/i);
  assert.match(systemAccessFoundation,/set account_status = 'blocked'[\s\S]*blocked_at = now\(\)/i);
  assert.match(migration,/after insert or update of\s*account_status, approved_at, approved_by, blocked_at, blocked_by/i);
  assert.match(body('reconcile_system_user_access_profile_trigger'),/reconcile_system_user_access_profile\(new\)/i);
});

test('projection is one-way, idempotent, private, and preserves unrelated profile data',()=>{
  const reconcile=body('reconcile_system_user_access_profile');
  assert.doesNotMatch(migration,/update public\.system_user_access|insert into public\.system_user_access/i);
  assert.match(reconcile,/on conflict \(user_id\) do update/i);
  const projectedFields=[
    'account_status','status_changed_at','status_changed_by','approved_at',
    'approved_by','blocked_at','blocked_by'
  ];
  for(const field of projectedFields)
    assert.match(reconcile,new RegExp(
      'platform\\.profiles\\.'+field+' is distinct from excluded\\.'+field,'i'
    ));
  assert.equal((reconcile.match(/is distinct from excluded\./gi)||[]).length,7,
    'fully identical projection must avoid an unnecessary update');
  for(const field of ['display_name','phone','avatar_url','locale','timezone','status_reason'])
    assert.doesNotMatch(reconcile,new RegExp('set[\\s\\S]*?'+field+'\\s*=' ,'i'));
  assert.match(migration,/drop trigger if exists system_user_access_reconcile_platform_profile/i);
  assert.match(migration,/revoke all on function platform_private\.reconcile_system_user_access_profile\([\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration,/revoke all on function platform_private\.reconcile_system_user_access_profile_trigger\(\)[\s\S]*?from public, anon, authenticated, service_role/i);
});

test('same-status approval and block metadata differences are reconciled',()=>{
  const reconcile=body('reconcile_system_user_access_profile');
  assert.match(reconcile,/account_status is distinct from excluded\.account_status\s+or[\s\S]*approved_at is distinct from excluded\.approved_at/i);
  assert.match(reconcile,/approved_at is distinct from excluded\.approved_at[\s\S]*approved_by is distinct from excluded\.approved_by/i);
  assert.match(reconcile,/blocked_at is distinct from excluded\.blocked_at[\s\S]*blocked_by is distinct from excluded\.blocked_by/i);
  assert.match(reconcile,/status_changed_at is distinct from excluded\.status_changed_at[\s\S]*status_changed_by is distinct from excluded\.status_changed_by/i);
});

test('Conference capability and both owner models remain outside reconciliation',()=>{
  assert.doesNotMatch(migration,/can_create_conferences|system_user_roles|platform\.user_roles|platform_owner|system_owner|organization/i);
  assert.match(systemAccessFoundation,/can_create_conferences boolean not null default false/i);
  assert.match(platformFoundation,/'platform_owner'/);
  assert.match(conferenceContract,/device_guarded_list_my_organizations/);
});

test('Warehouse authorization and Organization independence remain unchanged',()=>{
  const warehouseRuntime=[warehouseGuarded,warehouseContract,currentStore].join('\n');
  assert.match(warehouseGuarded,/public\.require_effective_module_permission\(\s*p_device_id,'warehouse',p_permission/i);
  assert.match(warehouseRuntime,/'warehouse\.stock\.(?:receive|issue|transfer|adjust|approve|post)'/i);
  assert.doesNotMatch(warehouseRuntime,/inventory\.[a-z]|platform\.user_roles|organization_id|organizationId|organization_members|organization_owner|organization_admin/i);
  assert.doesNotMatch(migration,/warehouse\.|module_permission_grants/i);
});

test('both account gates and direct actor-device protections remain intact',()=>{
  assert.match(dispatcher,/profile\.account_status='approved'/i);
  assert.match(dispatcher,/item\.purpose='PLATFORM_DEVICE_SESSION'/i);
  assert.match(dispatcher,/p_args \? 'p_actor_device_id'.*p_args \? 'p_device_id'/i);
  assert.match(phase1c,/public\.is_account_approved\(current_user_id\)/i);
  assert.match(phase1c,/platform_private\.validated_phase1c_device_authorization/i);
  assert.doesNotMatch(migration,/create or replace function platform\.set_account_status/i);
});
