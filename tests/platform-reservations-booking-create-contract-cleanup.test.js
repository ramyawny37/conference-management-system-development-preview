const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260915210000_reservations_booking_create_contract_cleanup.sql'),
  'utf8'
);

test('booking-create discovery has one authoritative read path', () => {
  assert.match(migration, /p_operation in\('list_conference_options','list_events','list_booking_types'\)/);
  assert.match(migration, /return reservations\.read\(v_session\.device_id,p_operation,p_args\)/);
  assert.doesNotMatch(migration, /p_operation in\('list_bookings','list_booking_types'\)/);
});

test('booking history no longer has a booking-create empty-list fallback', () => {
  assert.doesNotMatch(migration, /if p_operation='list_bookings'/);
  assert.doesNotMatch(migration, /reservations\.booking\.create'[\s\S]*return '\[\]'::jsonb/);
  assert.match(migration, /return reservations_private\.read_scoped\(p_device_id,p_operation,p_args\)/);
});

test('create_booking returns the created booking and participant in its mutation result', () => {
  assert.match(migration, /if p_operation='create_booking' and v_booking_id is not null/);
  assert.match(migration, /select to_jsonb\(booking\),to_jsonb\(participant\)/);
  assert.match(migration, /'booking',v_created_booking/);
  assert.match(migration, /'participant',v_created_participant/);
});

test('cleanup does not widen permissions', () => {
  assert.doesNotMatch(migration, /grant .*authenticated/i);
  assert.doesNotMatch(migration, /insert into public\.module_permission_grants/i);
  assert.doesNotMatch(migration, /reservations\.booking\.view[\s\S]*reservations\.booking\.create/);
});
