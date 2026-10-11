import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261012110000_reservations_booking_creation_context_dispatch_contract.sql', import.meta.url), 'utf8');
const client = readFileSync(new URL('../modules/reservations/reservations-module.js', import.meta.url), 'utf8');

test('booking context dispatch accepts only standalone or canonical conference scope', () => {
  assert.match(migration, /when ''get_booking_creation_context'' then/);
  assert.match(migration, /require_exact_jsonb_keys\(p_args,array\[''p_scope_type''\]\)/);
  assert.match(migration, /require_exact_jsonb_keys\(p_args,array\[''p_conference_id''\]\)/);
  assert.match(migration, /RESERVATIONS_SCOPE_TYPE_INVALID/);
  assert.match(migration, /RESERVATIONS_CONFERENCE_REQUIRED/);
  assert.match(client, /get_booking_creation_context/);
  assert.match(client, /p_scope_type:"standalone"/);
  assert.match(client, /p_conference_id:Si\(\)/);
});
