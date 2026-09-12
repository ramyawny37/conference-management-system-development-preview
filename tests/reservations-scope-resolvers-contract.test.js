'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260911120000_reservations_scope_partition_integrity.sql','utf8');
test('Round A resolvers derive every scope from stored Reservations roots',()=>{
 for(const fn of ['resolve_event_scope','resolve_booking_scope','resolve_payment_scope','resolve_event_period_scope','resolve_booking_type_scope'])assert.match(sql,new RegExp(`function reservations_private\\.${fn}`));
 assert.match(sql,/select \* into v_event from reservations\.events where id=p_event_id/);
 assert.match(sql,/select event_id into v_event_id from reservations\.bookings where id=p_booking_id/);
 assert.match(sql,/select booking_id into v_booking_id from reservations\.payments where id=p_payment_id/);
 assert.match(sql,/select event_id into v_event_id from reservations\.event_periods where id=p_period_id/);
 assert.match(sql,/select event_id into v_event_id from reservations\.booking_types where id=p_booking_type_id/);
});
test('Conference and Standalone authorization branches are explicit and partition stays server-derived',()=>{
 assert.match(sql,/scope_type='conference'[\s\S]*conference_context\(p_device_id,v_event\.conference_id,p_permission\)/);
 assert.match(sql,/scope_type='standalone'[\s\S]*require_effective_module_permission/);
 assert.match(sql,/scopePartitionId',v_event\.scope_partition_id/);
 assert.doesNotMatch(sql,/resolve_event_scope[\s\S]{0,1200}p_scope_partition_id/);
});
test('Round C3 entry points remain active beneath the thin C4 Platform wrapper',()=>{
 const executable=sql.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\n]*/g,'');
 assert.match(executable,/create or replace function reservations\.read\(p_device_id uuid,p_operation text,p_args jsonb\)/i);
 assert.match(executable,/create or replace function reservations\.mutate\(p_device_id uuid,p_operation text,p_args jsonb\)/i);
 assert.match(executable,/rename to execute_device_operation_pre_reservations_standalone_dispatch/i);
});

test('Round A child partition derivation fails closed and helper execution is explicit',()=>{
 assert.doesNotMatch(sql,/v_partition is null and new\.scope_partition_id is not null then return new/);
 assert.match(sql,/RESERVATIONS_SCOPE_PARTITION_CONTEXT_REQUIRED/);
 assert.match(sql,/revoke all on function reservations_private\.resolve_event_scope/);
 assert.match(sql,/grant execute on function reservations_private\.resolve_event_scope[\s\S]* to postgres/);
});
