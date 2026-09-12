'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20260911120000_reservations_scope_partition_integrity.sql','utf8');

test('Reservations uses an immutable internal scope partition with standalone null organization',()=>{
  assert.match(sql,/add column if not exists scope_type text/);
  assert.match(sql,/add column if not exists scope_partition_id uuid/);
  assert.match(sql,/alter column conference_id drop not null/);
  assert.match(sql,/scope_type='conference' and conference_id is not null and organization_id is not null/);
  assert.match(sql,/scope_type='standalone' and conference_id is null and organization_id is null/);
  assert.match(sql,/RESERVATIONS_EVENT_SCOPE_IMMUTABLE/);
  assert.match(sql,/reservations_one_canonical_event_per_conference_idx/);
});

test('all event dependents are backfilled and constrained to their Event partition',()=>{
  for(const table of ['event_periods','booking_types','participants','bookings','payments','attendance_records','operational_reviews','operations']) {
    assert.match(sql,new RegExp(`reservations\\.${table} add column if not exists scope_partition_id`));
  }
  assert.match(sql,/RESERVATIONS_SCOPE_PARTITION_BACKFILL_INCOMPLETE/);
  assert.match(sql,/RESERVATIONS_PARTICIPANT_SCOPE_PARTITION_AMBIGUOUS/);
  assert.match(sql,/reservations_bookings_partition_event_fk/);
  assert.match(sql,/reservations_payments_partition_booking_fk/);
  assert.match(sql,/reservations_attendance_partition_booking_fk/);
});

test('counter and idempotency namespaces move to partition without rewriting history',()=>{
  assert.match(sql,/primary key\(scope_partition_id,booking_year\)/);
  assert.match(sql,/allocate_booking_number\(p_scope_partition_id uuid,p_year integer\)/);
  const intent=sql.match(/create or replace function reservations_private\.intent\(p_operation text,p_organization_id uuid,p_args jsonb\)[\s\S]*?\); \$\$;/);
  assert.ok(intent);
  assert.match(intent[0],/jsonb_build_object\('operation',p_operation,'scopePartitionId',p_organization_id,'args',p_args\)/);
  assert.doesNotMatch(intent[0],/'organizationId'/);
  assert.match(sql,/v_historical_intent/);
  assert.doesNotMatch(sql,/update reservations\.operations set intent_hash/i);
  assert.match(sql,/v_prior\.intent_hash=v_intent/);
  assert.match(sql,/v_prior\.intent_hash=v_historical_intent/);
});

test('insert boundaries derive each child partition from the authoritative parent',()=>{
  assert.match(sql,/derive_event_scope_partition/);
  assert.match(sql,/derive_child_scope_partition/);
  assert.match(sql,/scope_partition_id:=new\.conference_id/);
  assert.match(sql,/select scope_partition_id into v_partition from reservations\.events where id=new\.event_id/);
  assert.match(sql,/select scope_partition_id into v_partition from reservations\.bookings where id=new\.booking_id/);
  assert.match(sql,/reservations_bookings_partition_number_unique/);
});

test('standalone writes are server-owned and use partition-aware child inserts',()=>{
  assert.match(sql,/create_standalone_event/);
  assert.match(sql,/extensions\.gen_random_uuid\(\)/);
  assert.match(sql,/values\('standalone',v_partition,null,null/);
  assert.match(sql,/mutate_standalone/);
  for(const table of ['event_periods','booking_types','participants','bookings','payments','attendance_records','operational_reviews']) assert.match(sql,new RegExp(`insert into reservations\\.${table}\\(scope_partition_id`));
});

test('attendance supports an empty immutable snapshot while preserving allowed values and duplicates',()=>{
  assert.match(sql,/cardinality\(eligible_attendance_segments\) between 0 and 2/);
  assert.match(sql,/cardinality\(attendance_segments_snapshot\) between 0 and 2/);
  assert.match(sql,/eligible_attendance_segments\[1\]<>eligible_attendance_segments\[2\]/);
  assert.match(sql,/attendance_segments_snapshot\[1\]<>attendance_segments_snapshot\[2\]/);
  assert.match(sql,/RESERVATIONS_ATTENDANCE_NOT_APPLICABLE/);
});

test('scope resolution has no Platform Organization selector and standalone accommodation is explicitly inapplicable',()=>{
  assert.match(sql,/event_scope_context/);
  assert.doesNotMatch(sql,/selectedOrganizationId/);
  assert.match(sql,/RESERVATIONS_ACCOMMODATION_NOT_APPLICABLE/);
  assert.match(sql,/RESERVATIONS_CONFERENCE_PROJECTION_NOT_APPLICABLE/);
  assert.match(sql,/read_pre_scope_partition_integrity/);
  assert.match(sql,/mutate_pre_scope_partition_integrity/);
});

test('Round C2 read activation remains intact beneath the thin C4 Platform wrapper',()=>{
  const executable=sql.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\n]*/g,'');
  const match=executable.match(/create or replace function reservations_private\.read_scoped\(p_device_id uuid,p_operation text,p_args jsonb\)[\s\S]*?end \$\$;/);
  assert.ok(match);
  const read=match[0];
  assert.match(read,/returns jsonb language plpgsql stable security definer set search_path=''/);
  for(const operation of ['list_conference_options','list_events','get_event','list_event_periods','list_booking_types','list_bookings','get_booking_detail','search_participants_bookings','list_booking_payments','list_attendance','get_operational_state','get_booking_accommodation','get_dashboard_summary','get_report_source_data','get_report_booking_page']) assert.match(read,new RegExp(`'${operation}'`));
  for(const key of ['organization_id','p_organization_id','scope_partition_id','p_scope_partition_id','device_id','p_device_id','actor_user_id','p_actor_user_id','actor_device_id','p_actor_device_id']) assert.match(read,new RegExp(`'${key}'`));
  assert.match(read,/RESERVATIONS_SCOPE_OVERRIDE_DENIED/);
  assert.match(read,/scope_partition_id/);
  assert.match(sql,/revoke all on function[\s\S]*reservations_private\.read_scoped\(uuid,text,jsonb\)[\s\S]*from public,anon,authenticated,service_role;/);
  assert.match(sql,/grant execute on function[\s\S]*reservations_private\.read_scoped\(uuid,text,jsonb\)[\s\S]*to postgres;/);
  const wrapper=executable.match(/create or replace function reservations\.read\(p_device_id uuid,p_operation text,p_args jsonb\)[\s\S]*?\$\$;/);
  assert.ok(wrapper);
  assert.match(wrapper[0],/returns jsonb language sql stable security definer set search_path=''/);
  assert.match(wrapper[0],/select reservations_private\.read_scoped\(p_device_id,p_operation,p_args\)/);
  assert.match(sql,/revoke all on function reservations\.read\(uuid,text,jsonb\) from public,anon,authenticated;/);
  assert.match(sql,/grant execute on function reservations\.read\(uuid,text,jsonb\) to service_role;/);
  const mutate=executable.match(/create or replace function reservations\.mutate\(p_device_id uuid,p_operation text,p_args jsonb\)[\s\S]*?end \$\$;/);
  assert.ok(mutate);
  assert.match(mutate[0],/return reservations_private\.mutate_scoped\(p_device_id,p_operation,v_args\)/);
  for(const operation of ['update_event','update_event_period','delete_event_period','update_booking_type']) assert.match(mutate[0],new RegExp(`'${operation}'`));
  for(const error of ['RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE','RESERVATIONS_EVENT_PERIOD_EVENT_IMMUTABLE','RESERVATIONS_BOOKING_TYPE_EVENT_IMMUTABLE']) assert.match(mutate[0],new RegExp(error));
  assert.match(sql,/revoke all on function reservations\.mutate\(uuid,text,jsonb\) from public,anon,authenticated;/);
  assert.match(sql,/grant execute on function reservations\.mutate\(uuid,text,jsonb\) to service_role;/);
  assert.match(executable,/rename to execute_device_operation_pre_reservations_standalone_dispatch/i);
});
