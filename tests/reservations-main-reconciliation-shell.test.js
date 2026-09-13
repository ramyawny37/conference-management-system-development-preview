import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('reconciliation shim preserves synchronous platform and reservations load order', () => {
  const source = read('js/platform-integration.js');

  const core = 'js/platform-integration-core.js?rev=reservations-main-reconciliation-v1';
  const reservations = 'modules/reservations/reservations-module.js?rev=mountable-bundle-v6';
  const bootstrap = 'js/reservations-reconciliation-bootstrap.js?rev=reservations-main-reconciliation-v1';

  assert.match(source, /document\.write/);
  assert.ok(source.includes(core));
  assert.ok(source.includes(reservations));
  assert.ok(source.includes(bootstrap));
  assert.ok(source.indexOf(core) < source.indexOf(reservations));
  assert.ok(source.indexOf(reservations) < source.indexOf(bootstrap));
});

test('reservations reconciliation bootstrap owns only the missing production-shell wiring', () => {
  const source = read('js/reservations-reconciliation-bootstrap.js');

  assert.ok(source.includes('modules/reservations/reservations-module.css?rev=mountable-bundle-v6'));
  assert.ok(source.includes("getElementById('reservationsWorkspace')"));
  assert.ok(source.includes("dataset.platformModule === 'reservations'"));
  assert.ok(source.includes("removeAttribute('disabled')"));
  assert.ok(source.includes("removeAttribute('aria-disabled')"));
  assert.ok(source.includes("state.textContent = 'متاحة'"));
  assert.ok(source.includes('PlatformIntegration.reconcileRoute()'));
  assert.ok(source.includes('attempts >= 12'));
  assert.ok(source.includes('1000'));
  assert.ok(source.includes("classList.remove('platform-reservations-active')"));
});

test('candidate shell does not require wholesale production index/script/style replacement', () => {
  const source = read('js/reservations-reconciliation-bootstrap.js');

  assert.ok(source.includes("document.createElement('link')"));
  assert.ok(source.includes("document.createElement('style')"));
  assert.ok(source.includes("document.createElement('main')"));
  assert.ok(source.includes("querySelector('[data-platform-module=\"reservations\"]')"));
});
