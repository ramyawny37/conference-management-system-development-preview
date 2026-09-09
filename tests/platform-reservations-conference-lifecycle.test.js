const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const migration = fs.readFileSync(
  'supabase/migrations/20260909160000_reservations_conference_lifecycle_round1.sql',
  'utf8'
);
const edge = fs.readFileSync(
  'supabase/functions/platform-device-operation/index.ts',
  'utf8'
);

test('event owns the stable Conference relationship and booking derives it server-side', () => {
  assert.match(migration, /events add column conference_id uuid references public\.conferences/);
  assert.match(migration, /select e\.\* into v_event from reservations\.events/);
  assert.match(migration, /v_event\.conference_id/);
  assert.match(migration, /RESERVATIONS_EVENT_CONFERENCE_IMMUTABLE/);
  assert.doesNotMatch(
    migration.match(/project_booking_to_conference[\s\S]*?end \$\$/)[0],
    /full_name\s*=|phone\s*=|lower\(|ilike/
  );
});

test('projection persists an idempotent durable bridge and no accommodation placeholder', () => {
  assert.match(migration, /booking_id uuid primary key/);
  assert.match(migration, /participant_id uuid not null/);
  assert.match(migration, /conference_person_id uuid not null/);
  assert.match(migration, /where l\.booking_id=p_booking_id/);
  assert.match(migration, /peopleDb,people/);
  assert.doesNotMatch(migration, /fake|placeholder/i);
  assert.doesNotMatch(migration, /insert into .*room|insert into .*house|insert into .*floor/i);
});

test('accommodation is read live by durable person identity and deletion is protected', () => {
  assert.match(migration, /get_booking_accommodation/);
  assert.match(migration, /occupant->>'personId'=v_link\.conference_person_id::text/);
  assert.match(migration, /RESERVATIONS_CONFERENCE_PERSON_MANUAL_ACTION_REQUIRED/);
  assert.doesNotMatch(migration, /delete from public\.conference_snapshots|delete from reservations\.conference_person_links/);
});

test('browser-controlled security fields stay rejected and operations are allowlisted', () => {
  assert.match(migration, /p_actor_device_id/);
  assert.match(migration, /p_actor_user_id/);
  assert.match(migration, /p_conference_person_id/);
  assert.match(edge, /'list_conference_options','get_booking_accommodation'/);
  assert.match(migration, /require_exact_jsonb_keys/);
  assert.match(migration, /RESERVATIONS_OPERATION_BACKEND_REQUIRED|PLATFORM_OPERATION_BACKEND_REQUIRED/);
});
