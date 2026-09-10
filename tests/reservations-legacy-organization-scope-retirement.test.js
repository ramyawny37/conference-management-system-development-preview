const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260910150000_reservations_legacy_organization_scope_retirement.sql'), 'utf8');
const conferenceScope = fs.readFileSync(path.join(root, 'supabase/migrations/20260910120000_reservations_conference_scope_reconciliation.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/platform-device-operation/index.ts'), 'utf8');

test('legacy Reservations dispatcher generations fail closed without changing non-Reservations delegation', () => {
  for (const predecessor of [
    'execute_device_operation_pre_reservations_conference_scope',
    'execute_device_operation_pre_reservations_conference_lifecycle',
    'execute_device_operation_pre_reservations_event_booking',
  ]) {
    const start = migration.indexOf(`function platform.${predecessor}`);
    assert.notEqual(start, -1);
    const body = migration.slice(start, migration.indexOf('$$;', start) + 3);
    assert.match(body, /if p_module = 'reservations' then/);
    assert.match(body, /LEGACY_RESERVATIONS_DISPATCH_RETIRED/);
    assert.match(body, /return platform\.execute_device_operation_pre_/);
    assert.doesNotMatch(body, /resolve_platform_scope|reservations\.(read|mutate)\s*\(/);
  }
});

test('legacy resolver is removed only after every historical caller is replaced', () => {
  const drop = migration.indexOf('drop function reservations_private.resolve_platform_scope();');
  assert.ok(drop > migration.lastIndexOf('create or replace function platform.execute_device_operation_pre_'));
  assert.equal((migration.match(/resolve_platform_scope/g) || []).length, 1);
});

test('only postgres retains execute on internal Reservations and predecessor surfaces', () => {
  assert.match(migration, /revoke all on function[\s\S]+from public, anon, authenticated, service_role;/);
  assert.match(migration, /grant execute on function[\s\S]+to postgres;/);
  assert.match(migration, /reservations\.read\(uuid,text,jsonb\)/);
  assert.match(migration, /reservations\.mutate\(uuid,text,jsonb\)/);
  assert.match(migration, /read_pre_conference_scope/);
  assert.match(migration, /mutate_pre_conference_lifecycle/);
});

test('canonical dispatcher and browser transport remain Conference-scoped', () => {
  assert.match(conferenceScope, /create function platform\.execute_device_operation/);
  assert.match(conferenceScope, /reservations_private\.conference_context/);
  for (const rejectedArgument of [
    'p_organization_id',
    'p_actor_user_id',
    'p_actor_device_id',
    'p_device_id',
    'p_conference_person_id',
  ]) assert.match(conferenceScope, new RegExp(rejectedArgument));
  assert.match(edge, /schema\('platform'\)\.rpc\('execute_device_operation'/);
  assert.doesNotMatch(edge, /reservations\.(read|mutate)|resolve_platform_scope/);
});

test('internal Organization semantics and booking allocation are not retired', () => {
  assert.doesNotMatch(migration, /drop function reservations_private\.(context|intent|allocate_booking_number)/);
  assert.doesNotMatch(migration, /drop (column|constraint)/);
  assert.doesNotMatch(migration, /delete from|truncate/i);
});
