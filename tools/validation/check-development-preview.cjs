'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const testsDir = path.join(root, 'tests');

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

runNode(['--check', 'js/storage/environment-namespace.js']);
runNode(['--check', 'service-worker.js']);

const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const deviceAdminAsset = 'js/supabase/device-authorization-administration-service.js?rev=canonical-owner-session-list-v1';
if (!indexSource.includes(deviceAdminAsset) || !serviceWorkerSource.includes('./' + deviceAdminAsset)) {
  throw new Error('DEVICE_ADMIN_RUNTIME_CACHE_REVISION_MISMATCH');
}
if (/platform-authority-cutover-v2/.test(serviceWorkerSource)) {
  throw new Error('STALE_DEVELOPMENT_CACHE_REVISION_PRESENT');
}

const runtimePages = [
  'index.html',
  'platform-device-recovery-login-v2.html',
  'platform-device-recovery.html',
  'platform-device-session.html',
];
const runtimeScripts = new Set(['service-worker.js']);
for (const page of runtimePages) {
  const source = fs.readFileSync(path.join(root, page), 'utf8');
  for (const match of source.matchAll(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)) {
    const script = match[1].split('?')[0].replace(/^\.\//, '');
    if (!/^https?:/i.test(script) && fs.existsSync(path.join(root, script))) {
      runtimeScripts.add(script);
    }
  }
}
for (const match of serviceWorkerSource.matchAll(/['"]\.\/([^'"]+\.js(?:\?[^'"]*)?)['"]/gi)) {
  const script = match[1].split('?')[0];
  if (fs.existsSync(path.join(root, script))) runtimeScripts.add(script);
}
for (const script of [...runtimeScripts].sort()) runNode(['--check', script]);
runNode(['tests/browser-storage-isolation.test.js']);

const retiredAuthorityArtifacts = [
  'platform-device-admin.html',
  'js/sync/device-authorization-operation-repository.js',
  'js/supabase/current-device-authorization-service.js',
  'js/sync/current-device-authorization-ui.js',
  'js/sync/device-reauthorization-flow.js',

  'tools/approve-development-pending-device.cjs',
  'tools/verify-development-organization-templates-realtime.cjs',
  'supabase/device-authorization-foundation-readonly-verification.sql',
  'supabase/webauthn-privileged-device-security-foundation-readonly-verification.sql',
  'supabase/organization-access-role-variable-fix-readonly-verification.sql',
  'supabase/organization-administration-rpc-reads-readonly-verification.sql',
  'supabase/organization-member-list-role-variable-fix-readonly-verification.sql',
  'supabase/reservations-phase1br-runtime-verification.sql',
];

for (const artifact of retiredAuthorityArtifacts) {
  if (fs.existsSync(path.join(root, artifact))) {
    throw new Error(`RETIRED_AUTHORITY_ARTIFACT_PRESENT:${artifact}`);
  }
}


const developmentBootstrapSource = fs.readFileSync(
  path.join(root, 'tools/issue-development-initial-platform-bootstrap.cjs'),
  'utf8'
);
if (/system_user_access|system_user_roles|\/rest\/v1\/devices\?|\/rest\/v1\/user_device_authorizations\?/.test(developmentBootstrapSource)) {
  throw new Error('RETIRED_BOOTSTRAP_DEVICE_AUTHORITY_PRESENT');
}

const canonicalDeviceAdministrationSource = fs.readFileSync(
  path.join(root, 'js/supabase/device-authorization-administration-service.js'),
  'utf8'
);
if (/listPlatformPendingDevices|list_pending_device_authorizations|DeviceAuthorizationOperationRepository/.test(canonicalDeviceAdministrationSource)) {
  throw new Error('RETIRED_DIRECT_DEVICE_ADMINISTRATION_PATH_PRESENT');
}


for (const retiredContract of [
  'platform-privileged-device-administration-transactions.test.js',
  'platform-privileged-device-administration.test.js',
  'platform-startup-device-read-reconciliation.test.js',
  'platform-production-device-admin-compatibility-round3l3.test.js',
  'platform-account-status-reconciliation-round3d3.test.js',
  'platform-inventory-authority-retirement-round3e5.test.js',
  'platform-canonical-device-authority-reconciliation.test.js'
]) {
  if (fs.existsSync(path.join(testsDir, retiredContract))) {
    throw new Error('RETIRED_PARALLEL_AUTHORITY_CONTRACT_PRESENT: ' + retiredContract);
  }
}
for (const canonicalContract of [
  'platform-final-single-authority-cutover.test.js',
  'platform-reservations-organization-detenant-final.test.js'
]) {
  if (!fs.existsSync(path.join(testsDir, canonicalContract))) {
    throw new Error('CANONICAL_AUTHORITY_CONTRACT_MISSING: ' + canonicalContract);
  }
}

const platformTests = fs.readdirSync(testsDir)
  .filter((name) => /^platform-.*\.test\.js$/.test(name))
  .filter((name) => name !== 'platform-promotion-readiness.test.js')
  .sort()
  .map((name) => path.join('tests', name));

if (platformTests.length === 0) {
  throw new Error('DEVELOPMENT_PREVIEW_PLATFORM_TESTS_NOT_FOUND');
}

// Canonical session isolation must be exercised by the publish gate, not just syntax-checked.
runNode(['--test', 'tests/canonical-conference-session-stale-hydration.test.js']);
runNode(['--test', 'tests/canonical-conference-activation-render-isolation.test.js']);
runNode(['--test', ...platformTests]);

for (const artifact of [
  'modules/reservations/reservations-module.js',
  'modules/reservations/reservations-module.css',
]) {
  if (!fs.existsSync(path.join(root, artifact))) {
    throw new Error(`DEVELOPMENT_PREVIEW_ARTIFACT_MISSING:${artifact}`);
  }
}

process.stdout.write(`Development preview validation passed (${platformTests.length} platform test files).\n`);
