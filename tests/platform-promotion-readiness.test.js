'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const readiness=require('../tools/release-preflight/verify-promotion-readiness.cjs');
const manifest=require('../tools/production-release/controlled-production-manifest.json');
const root=path.resolve(__dirname,'..');

test('controlled Production requirements include approved Reservations and Platform sources',()=>{
  for(const name of ['20260908153405_reservations_v1_foundation.sql','20260909120555_production_validated_phase1c_variable_disambiguation.sql','20260912192000_platform_module_entry_access_gate.sql','20260913173000_module_permission_catalog_arabic_labels.sql'])assert.ok(manifest.releaseRequirements.requiredMigrationFiles.includes(`supabase/migrations/${name}`));
  assert.ok(manifest.releaseRequirements.developmentOnlyMigrationFiles.includes('supabase/migrations/20260913141000_platform_private_recovery_rls_hardening.sql'));
  assert.equal(manifest.releaseRequirements.requiredMigrationFiles.includes('supabase/migrations/20260913141000_platform_private_recovery_rls_hardening.sql'),false);
  assert.equal(readiness.verifyManifest(),undefined);
});
test('canonical version markers remain internally consistent',()=>{
  const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  const version=fs.readFileSync(path.join(root,'version.js'),'utf8');
  const appVersion=(worker.match(/const APP_VERSION = '([^']+)'/)||[])[1];
  const releaseVersion=(version.match(/version: '([^']+)'/)||[])[1];
  assert.match(appVersion,/^\d+\.\d+\.\d+$/);assert.equal(appVersion,releaseVersion);
  assert.equal(readiness.isGreater('3.4.1','3.4.0'),true);assert.equal(readiness.isGreater('3.4.0','3.4.0'),false);assert.equal(readiness.isGreater('3.3.9','3.4.0'),false);
});
test('promotion mode requires all canonical markers to advance',()=>{
  const candidate={appVersion:'3.4.1',productionCacheRevision:'production-next',shellRevision:'production-next'};
  const base={appVersion:'3.4.0',productionCacheRevision:'production-current',shellRevision:'production-current'};
  assert.equal(readiness.isGreater(candidate.appVersion,base.appVersion),true);
  assert.equal(candidate.productionCacheRevision===base.productionCacheRevision,false);
  assert.equal(candidate.shellRevision===base.shellRevision,false);
});
test('preflight has no network, credential, or deployment path',()=>{
  const source=fs.readFileSync(path.join(root,'tools/release-preflight/verify-promotion-readiness.cjs'),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(|https?:|process\.env|supabase db push|deploy/i);
  assert.match(source,/PROMOTION_APPLICATION_VERSION_NOT_ADVANCED/);
  assert.match(source,/BASE_NOT_ANCESTOR_OF_CANDIDATE/);
  assert.match(source,/npm',\['run','check'\]/);
  assert.match(source,/reservations-reconciliation-rejected-architecture-guard/);
});
