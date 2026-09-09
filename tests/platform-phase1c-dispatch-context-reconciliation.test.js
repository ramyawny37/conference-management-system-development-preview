'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const migrations=path.join(__dirname,'../supabase/migrations');
const reconciliation=fs.readdirSync(migrations)
  .filter(name=>name.endsWith('_phase1c_dispatch_context_reconciliation.sql'))
  .sort().at(-1);
const sourceFile=reconciliation||'20260903090000_conference_device_session_execution_boundary.sql';
const sql=fs.readFileSync(path.join(migrations,sourceFile),'utf8');
const executable=sql.replace(/--[^\n]*/g,'');

test('migration changes the Conference core only by installing strict context',()=>{
  if(!reconciliation)return;
  const foundation=fs.readFileSync(path.join(migrations,
    '20260903090000_conference_device_session_execution_boundary.sql'),'utf8');
  const foundationStart=foundation.indexOf(
    'create or replace function platform.execute_conference_device_operation(');
  const foundationEnd=foundation.indexOf('\n\nrevoke all on function platform_private.require_exact_jsonb_keys',
    foundationStart);
  const migrationStart=sql.indexOf(
    'create or replace function platform.execute_conference_device_operation_phase1c_core(');
  const migrationEnd=sql.indexOf('\n\nrevoke all on function platform.execute_conference_device_operation_phase1c_core',
    migrationStart);
  const contextBlock="  perform set_config('platform.phase1c_context',jsonb_build_object(\n"+
    "    'purpose','PLATFORM_DEVICE_SESSION_DISPATCH',\n"+
    "    'session_id',v_session.id,\n"+
    "    'user_id',v_session.user_id,\n"+
    "    'device_id',v_session.device_id,\n"+
    "    'authorization_id',v_session.device_authorization_id,\n"+
    "    'binding_id',v_session.binding_id,\n"+
    "    'token_hash',encode(p_token_hash,'hex')\n"+
    "  )::text,true);\n";
  const expected=foundation.slice(foundationStart,foundationEnd)
    .replace('platform.execute_conference_device_operation(',
      'platform.execute_conference_device_operation_phase1c_core(')
    .replace("  perform set_config('request.jwt.claims'",contextBlock+
      "  perform set_config('request.jwt.claims'");
  assert.strictEqual(sql.slice(migrationStart,migrationEnd),expected);
});

test('Conference core installs exact transaction-local Phase1C context after validation',()=>{
  const invalid=sql.indexOf("raise exception 'DEVICE_SESSION_INVALID'");
  const override=sql.indexOf("raise exception 'ACTOR_DEVICE_OVERRIDE_DENIED'");
  const context=sql.indexOf("set_config('platform.phase1c_context'");
  const claims=sql.indexOf("set_config('request.jwt.claims'");
  const dispatch=sql.indexOf('case p_operation');
  assert.ok(invalid>=0&&override>invalid&&context>override&&claims>context&&dispatch>claims,
    'context must be installed only after session and override validation, before claims and dispatch');
  assert.match(sql,/set_config\('platform\.phase1c_context',[\s\S]*,\s*true\)/);
  for(const field of ['purpose','PLATFORM_DEVICE_SESSION_DISPATCH','session_id','user_id',
    'device_id','authorization_id','binding_id','token_hash'])assert.ok(sql.includes(field),field);
  assert.match(sql,/encode\(p_token_hash,'hex'\)/);
});

test('session, binding, authorization, device, and account validation stays fail-closed',()=>{
  for(const fragment of [
    'session.id=p_session_id','session.user_id=p_user_id','session.token_hash=p_token_hash',
    'session.revoked_at is null','session.expires_at>statement_timestamp()',
    "binding.lifecycle_status='active'",'binding.revoked_at is null','binding.retired_at is null',
    "uda.status='approved'",'uda.revoked_at is null',"device.lifecycle_status='active'",
    'device.retired_at is null','device.compromised_at is null',"profile.account_status='approved'"
  ])assert.ok(sql.includes(fragment),fragment);
  assert.match(sql,/p_args \? 'p_actor_device_id'/);
});

test('required Platform and Conference protected reads dispatch with authoritative session device',()=>{
  for(const operation of ['get_user_management_actor_capabilities','get_organization_management_overview',
    'device_guarded_list_my_organizations','device_guarded_list_available_conferences']){
    assert.ok(sql.includes("when '"+operation+"'"),operation);
  }
  assert.match(sql,/public\.get_user_management_actor_capabilities\(v_session\.device_id\)/);
  assert.match(sql,/public\.get_organization_management_overview\(v_session\.device_id\)/);
  assert.match(sql,/public\.device_guarded_list_my_organizations\(v_session\.device_id\)/);
  assert.match(sql,/public\.device_guarded_list_available_conferences\(v_session\.device_id\)/);
});

test('migration changes no guards, authority data, shared module wrappers, or fallback',()=>{
  if(!reconciliation)return;
  assert.doesNotMatch(sql,/create or replace function public\.require_current_approved_device/i);
  assert.doesNotMatch(sql,/create or replace function platform_private\.validated_phase1c_device_authorization/i);
  assert.doesNotMatch(sql,/execute_device_operation_pre_module_permission_administration|execute_device_operation_pre_item_units|execute_device_operation_pre_party_finance|reservations\./i);
  assert.doesNotMatch(executable,/\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?(?:platform|public)\./i);
  assert.doesNotMatch(sql,/\bcoalesce\s*\(\s*platform_private\.validated_phase1c_device_authorization/i);
  assert.doesNotMatch(sql,/current_device_authorization_id|request_device_id|request_header|x-platform-device|device\.secret_hash|device-secret/i);
});

test('module-permission, Warehouse, and Reservations dispatchers retain their own strict context',()=>{
  for(const file of ['20260907150000_module_permission_administration_backend_surface.sql',
    '20260905170000_warehouse_item_unit_conversion.sql','20260908153406_reservations_v1_protected_dispatcher.sql']){
    const wrapper=fs.readFileSync(path.join(migrations,file),'utf8');
    assert.match(wrapper,/set_config\('platform\.phase1c_context',[\s\S]*,\s*true\)/,file);
    assert.match(wrapper,/DEVICE_SESSION_INVALID/,file);
  }
});
