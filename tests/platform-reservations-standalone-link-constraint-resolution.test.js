'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');

const root=path.resolve(__dirname,'..');
const linkMigration=fs.readFileSync(path.join(root,'supabase','migrations','20260914150000_reservations_standalone_event_link_constraint_resolution_fix.sql'),'utf8');
const paymentMigration=fs.readFileSync(path.join(root,'supabase','migrations','20260914151500_reservations_payment_history_relink_guard_fix.sql'),'utf8');

test('standalone event link keeps the security-definer boundary and defers transaction constraints without search-path name lookup',()=>{
  assert.match(linkMigration,/create or replace function reservations_private\.link_standalone_event_to_conference\([\s\S]*?security definer[\s\S]*?set search_path=''[\s\S]*?set constraints all deferred;/i);
  assert.doesNotMatch(linkMigration,/set constraints\s+reservations_event_periods_partition_event_fk/i);
  assert.match(linkMigration,/conference_context\(p_device_id,v_conference_id,'reservations\.event\.manage'\)/);
  assert.match(linkMigration,/RESERVATIONS_SCOPE_OVERRIDE_DENIED/);
  assert.match(linkMigration,/require_exact_jsonb_keys/);
  assert.match(linkMigration,/scope_relink_guard/);
  assert.match(linkMigration,/revoke all on function reservations_private\.link_standalone_event_to_conference\(uuid,jsonb\)[\s\S]*?public, anon, authenticated, service_role/i);
});

test('payment immutability allows only the guarded partition rewrite used by the same event relink',()=>{
  assert.match(paymentMigration,/create or replace function reservations_private\.protect_payment_history\(\)/i);
  assert.match(paymentMigration,/old\.scope_partition_id is distinct from new\.scope_partition_id/i);
  assert.match(paymentMigration,/select b\.event_id,b\.scope_partition_id[\s\S]*?from reservations\.bookings b/i);
  assert.match(paymentMigration,/v_booking_partition=new\.scope_partition_id/i);
  assert.match(paymentMigration,/v_guard=\(v_booking_event_id::text\|\|':'\|\|old\.scope_partition_id::text\|\|':'\|\|new\.scope_partition_id::text\)/i);
  assert.match(paymentMigration,/RESERVATIONS_PAYMENT_DELETE_DENIED/);
  assert.match(paymentMigration,/RESERVATIONS_PAYMENT_IMMUTABLE/);
});
