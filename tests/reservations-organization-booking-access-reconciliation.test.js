const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260915190000_reservations_organization_booking_access_reconciliation.sql'),
  'utf8'
);

test('conference-linked Reservations authorization is organization-bound, not Conference-membership-bound', () => {
  assert.match(migration, /create or replace function reservations_private\.conference_context/);
  assert.match(migration, /public\.require_effective_module_permission\([\s\S]*'reservations'/);
  assert.match(migration, /join public\.organizations o[\s\S]*o\.status='active'/);
  assert.match(migration, /join public\.organization_members om[\s\S]*om\.user_id=v_actor/);
  assert.doesNotMatch(migration, /join public\.conference_members/);
});

test('booking creators can discover only Conference names from organizations they belong to', () => {
  assert.match(migration, /create or replace function reservations_private\.booking_target_context/);
  assert.match(migration, /'reservations\.event\.view'/);
  assert.match(migration, /exception when sqlstate '42501'[\s\S]*'reservations\.booking\.create'/);
  assert.match(migration, /if p_operation='list_conference_options'/);
  assert.match(migration, /jsonb_build_object\('conferenceId',c\.id,'name',c\.name\)/);
  assert.match(migration, /join public\.organization_members om[\s\S]*om\.user_id=v_actor/);
  assert.match(migration, /where c\.deleted_at is null/);
});

test('the reconciliation does not grant Conference administration or event management', () => {
  assert.doesNotMatch(migration, /conference\.manage/);
  assert.doesNotMatch(migration, /conference\.members\.manage/);
  assert.doesNotMatch(migration, /reservations\.event\.manage/);
  assert.doesNotMatch(migration, /insert into public\.conference_members/);
  assert.doesNotMatch(migration, /grant .* to authenticated/i);
});

test('non-discovery reads remain delegated to the existing scoped dispatcher', () => {
  assert.match(migration, /return reservations_private\.read_scoped\(p_device_id,p_operation,p_args\)/);
});
