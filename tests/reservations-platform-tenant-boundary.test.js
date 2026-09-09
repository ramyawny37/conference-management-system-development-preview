const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260909120000_reservations_platform_tenant_boundary_reconciliation.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/platform-device-operation/index.ts', 'utf8');

test('Reservations scope is server-owned and Conference membership is not authorization', () => {
  assert.match(migration, /resolve_platform_scope\(\)/);
  assert.match(migration, /status = 'active'[\s\S]*is_default/);
  assert.match(migration, /v_count <> 1/);
  assert.doesNotMatch(migration, /organization_members/);
  assert.match(migration, /require_effective_module_permission\(p_device_id, 'reservations'/);
});

test('browser tenant and identity overrides are rejected before trusted scope injection', () => {
  for (const key of ['p_organization_id', 'organization_id', 'p_actor_user_id', 'p_actor_device_id', 'p_device_id']) {
    assert.match(migration, new RegExp(key));
    assert.match(edge, new RegExp(key));
  }
  assert.match(migration, /v_args := p_args \|\| jsonb_build_object\('p_organization_id', reservations_private\.resolve_platform_scope\(\)\)/);
  assert.match(migration, /RESERVATIONS_SCOPE_OVERRIDE_DENIED/);
});

test('all Reservations allowlists omit browser organization arguments', () => {
  const allowlists = [...migration.matchAll(/require_exact_jsonb_keys\(p_args,array\[([^\]]*)\]/g)];
  assert.equal(allowlists.length, 23);
  for (const match of allowlists) assert.doesNotMatch(match[1], /organization_id/);
});

test('session, service role, idempotency and revision contracts remain present', () => {
  assert.match(migration, /PLATFORM_DEVICE_SESSION/);
  assert.match(migration, /service_role/);
  assert.match(migration, /p_expected_revision/);
  assert.match(migration, /p_operation_id/);
  assert.match(migration, /reservations\.read\(v_session\.device_id/);
  assert.match(migration, /reservations\.mutate\(v_session\.device_id/);
});
