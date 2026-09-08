const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'supabase/migrations/20260908171814_reservations_event_booking_domain_reconciliation.sql'), 'utf8');
const dispatcher = fs.readFileSync(path.join(root, 'supabase/migrations/20260908171822_reservations_event_booking_dispatcher.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/platform-device-operation/index.ts'), 'utf8');

test('replaces the empty lodging model with the existing product domain', () => {
  for (const table of ['events', 'event_periods', 'booking_types', 'participants', 'bookings', 'payments', 'attendance_records', 'operational_reviews']) {
    assert.match(schema, new RegExp(`create table reservations\\.${table}\\(`));
  }
  assert.match(schema, /RESERVATIONS_PHASE1B_DATA_REQUIRES_MANUAL_RECONCILIATION/);
  assert.match(schema, /RESERVATIONS_PERMISSION_GRANTS_REQUIRE_MANUAL_RECONCILIATION/);
});

test('preserves tenant boundaries and protected access', () => {
  assert.equal((schema.match(/organization_id uuid not null/g) || []).length >= 9, true);
  assert.match(schema, /force row level security/);
  assert.match(schema, /require_effective_module_permission\(p_device_id,'reservations'/);
  assert.match(schema, /validated_phase1c_device_authorization/);
  assert.match(schema, /insert into platform\.audit_events/);
});

test('implements event, period, type, participant, booking and numbering rules', () => {
  assert.match(schema, /status in\('open','closed','full','draft'\)/);
  assert.match(schema, /kind in\('conference','caravans'\)/);
  assert.match(schema, /eligible_attendance_segments/);
  assert.match(schema, /service_sector in\('widows'/);
  assert.match(schema, /RES-.*lpad\(v_value::text,4,'0'\)/);
  assert.match(schema, /RESERVATIONS_EVENT_CAPACITY_REACHED/);
});

test('implements append-preserving financial and attendance behavior', () => {
  assert.match(schema, /RESERVATIONS_PAYMENT_DELETE_DENIED/);
  assert.match(schema, /RESERVATIONS_PAYMENT_IMMUTABLE/);
  assert.match(schema, /p_operation='void_payment'/);
  assert.match(schema, /on conflict\(booking_id,segment\) do update/);
  assert.match(schema, /RESERVATIONS_ATTENDANCE_SEGMENT_INELIGIBLE/);
});

test('enforces dependency deletion, optimistic concurrency and idempotency', () => {
  assert.match(schema, /RESERVATIONS_EVENT_HAS_DEPENDENCIES/);
  assert.match(schema, /RESERVATIONS_BOOKING_HAS_HISTORY/);
  assert.match(schema, /RESERVATIONS_REVISION_CONFLICT/);
  assert.match(schema, /pg_advisory_xact_lock/);
  assert.match(schema, /RESERVATIONS_OPERATION_IDEMPOTENCY_CONFLICT/);
});

test('exposes the exact protected operation surface and delegates other modules', () => {
  for (const operation of ['get_dashboard_summary', 'list_events', 'get_event', 'list_event_periods', 'list_booking_types', 'list_bookings', 'get_booking_detail', 'search_participants_bookings', 'list_booking_payments', 'list_attendance', 'get_operational_state', 'get_report_source_data', 'create_event', 'update_event', 'delete_event', 'create_event_period', 'update_event_period', 'delete_event_period', 'reorder_event_periods', 'create_booking_type', 'update_booking_type', 'create_booking', 'update_participant_booking', 'delete_booking', 'record_payment', 'void_payment', 'update_attendance', 'update_operational_review']) {
    assert.match(dispatcher, new RegExp(`'${operation}'`));
    assert.match(edge, new RegExp(`'${operation}'`));
  }
  assert.match(dispatcher, /execute_device_operation_pre_reservations_event_booking/);
  assert.match(edge, /module==='warehouse'\?'WAREHOUSE_IDENTIFIER_ALREADY_EXISTS':module==='reservations'\?'RESERVATIONS_IDENTIFIER_ALREADY_EXISTS'/);
});

test('does not create room inventory or Conference-owned accommodation', () => {
  assert.doesNotMatch(schema, /create table reservations\.(assignable_resources|rooms|assignments)\b/);
  assert.doesNotMatch(schema, /accommodation|room_number/);
});
