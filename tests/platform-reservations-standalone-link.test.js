'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const migration=fs.readFileSync(
  'supabase/migrations/20260914133000_reservations_standalone_event_conference_link.sql',
  'utf8'
);
const edge=fs.readFileSync('supabase/functions/platform-device-operation/index.ts','utf8');

const operation='link_standalone_event_to_conference';

test('standalone event link stays behind exact Conference membership and event.manage',()=>{
  assert.match(migration,/conference_context\(\s*p_device_id,v_conference_id,'reservations\.event\.manage'\s*\)/);
  assert.match(migration,/require_exact_jsonb_keys\(\s*p_args,\s*array\['p_operation_id','p_event_id','p_expected_revision','p_conference_id'\]\s*\)/);
  assert.match(migration,/RESERVATIONS_TARGET_CONFERENCE_ALREADY_HAS_EVENT/);
  assert.match(migration,/where conference_id=v_conference_id and id<>v_event_id/);
});

test('scope transition remains fail-closed except the guarded one-way transition',()=>{
  assert.match(migration,/RESERVATIONS_EVENT_SCOPE_IMMUTABLE/);
  assert.match(migration,/old\.scope_type='standalone'/);
  assert.match(migration,/new\.scope_type='conference'/);
  assert.match(migration,/reservations\.scope_relink_guard/);
  assert.match(migration,/new\.scope_partition_id=new\.conference_id/);
});

test('link rekeys live business data atomically and leaves the historical ledger untouched',()=>{
  const liveTables=[
    'event_periods','booking_types','participants','bookings','payments',
    'attendance_records','operational_reviews','booking_number_counters'
  ];
  for(const table of liveTables){
    assert.match(
      migration,
      new RegExp(`update reservations\\.${table}\\s+set scope_partition_id=v_new_partition\\s+where scope_partition_id=v_old_partition`),
      `missing partition re-key for ${table}`
    );
  }
  assert.doesNotMatch(
    migration,
    /update\s+reservations\.operations\s+set\s+scope_partition_id/i,
    'historical operation ledger must not be rewritten'
  );
  assert.match(migration,/create table if not exists reservations\.scope_partition_links/);
  assert.match(migration,/link\.old_scope_partition_id=v_prior\.scope_partition_id/);
  assert.match(migration,/link\.new_scope_partition_id=v_partition/);
});

test('partition relationship constraints are deferred only for the guarded transaction',()=>{
  [
    'reservations_event_periods_partition_event_fk',
    'reservations_booking_types_partition_event_fk',
    'reservations_bookings_partition_event_fk',
    'reservations_bookings_partition_participant_fk',
    'reservations_bookings_partition_type_fk',
    'reservations_payments_partition_booking_fk',
    'reservations_attendance_partition_booking_fk',
    'reservations_reviews_partition_booking_fk'
  ].forEach(name=>{
    assert.match(migration,new RegExp(`alter constraint ${name} deferrable initially immediate`));
    assert.match(migration,new RegExp(name));
  });
  assert.match(migration,/set constraints[\s\S]*reservations_reviews_partition_booking_fk[\s\S]*deferred;/);
});

test('link operation is private and dispatched through the verified device-session predecessor',()=>{
  assert.match(migration,/revoke all on function reservations_private\.link_standalone_event_to_conference\(uuid,jsonb\)[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration,/when p_operation='link_standalone_event_to_conference' then true/);
  assert.match(migration,/s\.id=p_session_id and s\.user_id=p_user_id and s\.token_hash=p_token_hash/);
  assert.match(migration,/return reservations_private\.link_standalone_event_to_conference\(\s*v_session\.device_id,p_args\s*\)/);
});

test('Edge permits the guarded operation but still rejects browser actor and device overrides',()=>{
  assert.match(edge,new RegExp(`const reservations=new Set\\(\\[[^;]*'${operation}'[^;]*\\]\\)`));
  assert.match(edge,/module==='reservations'&&\(Object\.prototype\.hasOwnProperty\.call\(args,'p_device_id'\)\|\|Object\.prototype\.hasOwnProperty\.call\(args,'p_organization_id'\)\|\|Object\.prototype\.hasOwnProperty\.call\(args,'organization_id'\)\)/);
  assert.match(edge,/required\('SUPABASE_SERVICE_ROLE_KEY'\)/);
});
