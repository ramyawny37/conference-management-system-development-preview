'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase','migrations','20260914150000_reservations_standalone_event_link_constraint_resolution_fix.sql'),'utf8');

test('standalone event link keeps the security-definer boundary and defers transaction constraints without search-path name lookup',()=>{
  assert.match(migration,/create or replace function reservations_private\.link_standalone_event_to_conference\([\s\S]*?security definer[\s\S]*?set search_path=''[\s\S]*?set constraints all deferred;/i);
  assert.doesNotMatch(migration,/set constraints\s+reservations_event_periods_partition_event_fk/i);
  assert.match(migration,/conference_context\(p_device_id,v_conference_id,'reservations\.event\.manage'\)/);
  assert.match(migration,/RESERVATIONS_SCOPE_OVERRIDE_DENIED/);
  assert.match(migration,/require_exact_jsonb_keys/);
  assert.match(migration,/scope_relink_guard/);
  assert.match(migration,/revoke all on function reservations_private\.link_standalone_event_to_conference\(uuid,jsonb\)[\s\S]*?public, anon, authenticated, service_role/i);
});
