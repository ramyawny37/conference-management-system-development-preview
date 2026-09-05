'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
const pwa=fs.readFileSync(path.join(root,'pwa.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const manager=fs.readFileSync(path.join(root,'js/sync/conference-edit-lock-manager.js'),'utf8');

const previous='exclusive-edit-lock-v1';
const next='organization-membership-operation-key-v1';
const mobileRoomInputRevision='anchored-glass-person-picker-v5';
const appVersion='3.4.0';
const shellRevision='development-3-4-0-platform-foundation-v1';
const cacheRevision='development-3-4-0-item-unit-dialog-v1';
const startupTransportRevision='warehouse-original-items-secure-restoration-v1';
const moduleRoutingRevision='warehouse-original-items-secure-restoration-v1';
const priorAuthorizationCacheRevision='runtime-authorization-phase1-v1';
const productionCacheRevision='production-integrated-3-3-0-main-6d0c1e1-develop-80653ca-v1';
const accountIdentityRevision='account-session-identity-v1';
const firstLoginCoordinatorRevision='platform-first-login-coordinator-v1';
const stateAssetRevision='managed-platform-startup-gate-v1';
const persistenceArbitrationRevision='develop-cross-store-arbitration-v1';
const permissionRuntimeRevision='development-3-4-0-platform-foundation-v1';
const platformShellScriptRevision='delayed-warehouse-route-override-v1';
const testTemplateCleanupRevision='test-house-template-cleanup-v1';
const templateDiagnosticRevision='template-diagnostic-export-v1';
const partialTemplateCleanupRevision='partial-template-state-cleanup-v1';
const rejectedSharedTemplateCleanupRevision='rejected-shared-template-cleanup-v1';
const sharedTemplateCopyGuardRevision='shared-template-copy-guard-v1';
const hardeningRevision='legacy-rpc-hardening-v1';
const memberDiagnosticsRevision='repository-rejection-diagnostics-v1';
const legacyConferenceRevision='legacy-conference-preflight-v2';
const privacyRevision='diagnostics-privacy-hardening-v1';
const templateIsolationRevision='template-sync-isolation-v1';
const startupRevision='platform-first-login-coordinator-v1';
const deviceOnboardingRevision='platform-first-login-coordinator-v1';
const organizationTemplateRevision='shared-template-library-v1';
const legacyTemplateAuthorizationRevision='legacy-template-adoption-authorization-v1';
const officialTemplateSharingRevision='official-house-template-sharing-v1';
const sharedTemplateReadOnlyRevision='shared-house-template-read-only-v1';
const bootstrapRevision='first-owner-bootstrap-hardening-v1';
const userManagementUiRevision=next;
const userManagementStyleRevision='item-unit-dialog-v1';
const userManagementReadRevision='organization-archive-restore-v1';
const conferenceRoleRevision=privacyRevision;
const houseTemplateRevision='template-floor-conference-sync-v1';
const pwaAssetRevision=next;
const appAssetRevision='section-accommodation-edit-lock-v1';
const snapshotGuardRevision='conference-snapshot-device-guard-v1';
const priorFrontendRevision=accountIdentityRevision;
const conferenceSyncRevision='conference-organization-context-v1';
const organizationMembersRevision='organization-membership-manual-retry-v1';
const snapshotPayloadDiagnosticsRevision='snapshot-payload-diagnostics-v1';
const postRestoreProofBoundaryRevision='post-restore-proof-boundary-v1';
assert(worker.includes("? '"+cacheRevision+"'"));
assert(!worker.includes("? '"+priorAuthorizationCacheRevision+"'"));
assert(worker.includes(": '"+productionCacheRevision+"'"));
assert(worker.includes("const APP_VERSION = '"+appVersion+"';"));
assert(index.includes("? '"+shellRevision+"'"));
assert(index.includes(": '"+productionCacheRevision+"'"));
const brandingIcons=[
  'icons/icon-96x96-v3.png',
  'icons/icon-152x152-v3.png',
  'icons/icon-192x192-v3.png',
  'icons/icon-512x512-v3.png',
  'icons/icon-maskable-512-v3.png'
];
brandingIcons.forEach(asset=>{
  assert(manifest.icons.some(icon=>icon.src===asset),'manifest missing '+asset);
  assert(worker.includes("'./"+asset+"'"),'app shell missing '+asset);
});
[
  'icons/apple-touch-icon-180x180-v3.png',
  'icons/favicon-32x32-v3.png'
].forEach(asset=>{
  assert(index.includes('./'+asset),'index missing '+asset);
  assert(worker.includes("'./"+asset+"'"),'app shell missing '+asset);
});
assert(index.includes('pwa.js?rev='+pwaAssetRevision));
['js/supabase/auth.js'].forEach(asset=>{
  const versioned=asset+'?rev='+accountIdentityRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
['js/sync/diagnostics-privacy-policy.js',
  'js/sync/device-rescue-export.js','js/sync/conflict-resolution-ui.js'].forEach(asset=>{
  const versioned=asset+'?rev='+privacyRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
const cleanupAsset='js/sync/test-house-template-cleanup.js?rev='+
  testTemplateCleanupRevision;
assert(index.includes(cleanupAsset));
assert(worker.includes("'./"+cleanupAsset+"'"));
['js/sync/template-diagnostic-export.js'].forEach(asset=>{
  const versioned=asset+'?rev='+templateDiagnosticRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  'js/sync/partial-template-state-cleanup.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+partialTemplateCleanupRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  'js/sync/rejected-shared-template-cleanup.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+rejectedSharedTemplateCleanupRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  'js/sync/local-template-copy-cleanup.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+sharedTemplateCopyGuardRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
assert(index.includes('js/sync/orphaned-conference-cleanup.js?rev=orphaned-local-cleanup-v2'));
assert(worker.includes("'./js/sync/orphaned-conference-cleanup.js?rev=orphaned-local-cleanup-v2'"));
[
  'js/sync/conference-members-service.js',
  'js/sync/realtime-locks-ui.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+hardeningRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
{
  const versioned='js/supabase/organization-administration-service.js?rev='+
    'organization-membership-manual-retry-v1';
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
}
{
  const versioned='js/sync/sync-settings-ui.js?rev='+
    firstLoginCoordinatorRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
}
const memberDiagnostics='js/sync/member-runtime-diagnostics.js?rev='+memberDiagnosticsRevision;
assert(index.includes(memberDiagnostics));
assert(worker.includes("'./"+memberDiagnostics+"'"));
['targeted-stuck-operation-recovery.js','experimental-conference-reset.js',
  'debug-binding-report-ui.js','migration-repair.js'].forEach(asset=>{
  assert(!index.includes(asset),'production app shell must not load '+asset);
  assert(!worker.includes(asset),'production cache must not include '+asset);
});
assert(index.includes('js/supabase/first-system-bootstrap-service.js?rev='+bootstrapRevision));
assert(worker.includes("'./js/supabase/first-system-bootstrap-service.js?rev="+bootstrapRevision+"'"));
assert(index.includes('js/sync/startup-access-gate.js?rev='+startupRevision));
assert(worker.includes("'./js/sync/startup-access-gate.js?rev="+
  startupRevision+"'"));
const organizationMembershipRepository='js/sync/organization-membership-operation-repository.js?rev=organization-membership-retention-safe-v1';
assert(index.includes(organizationMembershipRepository));
assert(worker.includes("'./"+organizationMembershipRepository+"'"));
['houses.js'].forEach(asset=>{
  const versionedAsset=asset+'?rev='+houseTemplateRevision;
  assert(index.includes(versionedAsset),'index missing '+versionedAsset);
  assert(worker.includes("'./"+versionedAsset+"'"),'app shell missing '+versionedAsset);
});
const isolatedHouseTemplates='houseTemplates.js?rev='+sharedTemplateReadOnlyRevision;
assert(index.includes(isolatedHouseTemplates));
assert(worker.includes("'./"+isolatedHouseTemplates+"'"));
const isolatedState='state.js?rev='+stateAssetRevision;
assert(index.includes(isolatedState));
assert(worker.includes("'./"+isolatedState+"'"));
const conferenceMembersUi='js/sync/conference-members-ui.js?rev='+conferenceRoleRevision;
assert(index.includes(conferenceMembersUi),
  'index missing deterministic Conference Members UI revision');
assert(worker.includes("'./"+conferenceMembersUi+"'"),
  'app shell missing deterministic Conference Members UI revision');
assert(!index.includes('src="js/sync/conference-members-ui.js"'),
  'Conference Members UI must not use an unversioned script URL');
[
  'js/sync/legacy-conference-organization-assignment-attempt-store.js',
  'js/supabase/legacy-conference-organization-assignment-service.js',
  'js/sync/legacy-conference-organization-assignment-ui.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+legacyConferenceRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
assert(index.includes('js/sync/conference-sync-ui.js?rev='+conferenceSyncRevision));
assert(worker.includes("'./js/sync/conference-sync-ui.js?rev="+
  conferenceSyncRevision+"'"));
[
  ['js/sync/user-management-ui.js',userManagementUiRevision],
  ['style.css',userManagementStyleRevision]
].forEach(([asset,revision])=>{
  const versionedAsset=asset+'?rev='+revision;
  assert(index.includes(versionedAsset),'index missing '+versionedAsset);
  assert(worker.includes("'./"+versionedAsset+"'"),
    'app shell missing '+versionedAsset);
});
const readAsset='js/sync/user-management-read-service.js?rev='+
  userManagementReadRevision;
assert(index.includes(readAsset));
assert(worker.includes("'./"+readAsset+"'"));
assert(index.includes('script.js?rev='+platformShellScriptRevision));
assert(worker.includes("'./script.js?rev="+platformShellScriptRevision+"'"));
[['js/platform-integration.js','cold-refresh-startup-ordering-v1'],
 ['js/supabase/device-session.js',startupTransportRevision]].forEach(([asset,revision])=>{
  const versioned=asset+'?rev='+revision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  'js/sync/conference-permission-resolver.js',
  'core.js',
  'js/conference/accounts.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+permissionRuntimeRevision;
  assert(index.includes(versioned),'index missing Phase 2B runtime asset '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing Phase 2B runtime asset '+versioned);
});
{
  const activationAsset='js/sync/conference-activation-authorization.js?rev=runtime-authorization-phase1-v1';
  assert(index.includes(activationAsset),'index missing Phase 1 activation authorization asset');
  assert(worker.includes("'./"+activationAsset+"'"),'app shell missing Phase 1 activation authorization asset');
}
const xlsxAsset='libs/xlsx.full.min.js';
assert(fs.existsSync(path.join(root,xlsxAsset)),'local XLSX runtime asset missing');
assert(index.includes('<script src="'+xlsxAsset+'"></script>'),'index missing local XLSX runtime');
assert(index.indexOf(xlsxAsset)<index.indexOf('script.js?rev='+platformShellScriptRevision),'XLSX runtime must load before import logic');
assert(worker.includes("'./"+xlsxAsset+"'"),'app shell missing local XLSX runtime');
assert(!/https?:[^"']*(sheetjs|xlsx)/i.test(index),'XLSX must not depend on a CDN');
const organizationMembersAsset='js/sync/organization-members-ui.js?rev='+organizationMembersRevision;
assert(index.includes(organizationMembersAsset),'index missing deterministic Organization Members UI revision');
assert(worker.includes("'./"+organizationMembersAsset+"'"),'app shell missing deterministic Organization Members UI revision');
[['js/supabase/snapshot-sync.js',next],['js/sync/conflict-executor.js',snapshotGuardRevision]].forEach(([asset,revision])=>{
  const versioned=asset+'?rev='+revision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[/* state.js uses stateAssetRevision */
  'js/sync/automatic-queue-runner.js',
  'js/sync/conference-realtime-manager.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+templateIsolationRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  ['js/storage/snapshot-payload-diagnostics.js',snapshotPayloadDiagnosticsRevision],
  ['js/storage/local-persistence-arbitration.js',persistenceArbitrationRevision],
  ['js/storage/indexeddb.js',persistenceArbitrationRevision],
  ['js/storage/storage-repository.js',persistenceArbitrationRevision],
  ['js/sync/sync-queue.js',postRestoreProofBoundaryRevision],
  ['js/sync/startup-queue-recovery.js',postRestoreProofBoundaryRevision],
  ['js/storage/full-backup.js',postRestoreProofBoundaryRevision]
].forEach(([asset,revision])=>{
  const versioned=asset+'?rev='+revision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
const isolatedTemplateSync='js/sync/organization-template-sync.js?rev='+sharedTemplateCopyGuardRevision;
assert(index.includes(isolatedTemplateSync));
assert(worker.includes("'./"+isolatedTemplateSync+"'"));
const contentAuthorization='js/sync/house-template-content-authorization.js?rev='+sharedTemplateCopyGuardRevision;
assert(index.includes(contentAuthorization));
assert(worker.includes("'./"+contentAuthorization+"'"));
const officialTemplateSharingUi='js/sync/house-template-sharing-ui.js?rev='+
  officialTemplateSharingRevision;
assert(index.includes(officialTemplateSharingUi));
assert(worker.includes("'./"+officialTemplateSharingUi+"'"));
['js/sync/startup-conference-discovery.js'].forEach(asset=>{
  const versioned=asset+'?rev='+organizationTemplateRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
const adoptionUi='js/sync/legacy-template-adoption-ui.js?rev='+
  legacyTemplateAuthorizationRevision;
assert(index.includes(adoptionUi));
assert(worker.includes("'./"+adoptionUi+"'"));
[
  'js/sync/current-device-authorization-ui.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+deviceOnboardingRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
const platformDeviceAdministrationAsset='js/supabase/device-authorization-administration-service.js?rev=platform-privileged-device-admin-diagnostics-v1';
assert(index.includes(platformDeviceAdministrationAsset),'index missing '+platformDeviceAdministrationAsset);
assert(worker.includes("'./"+platformDeviceAdministrationAsset+"'"),'app shell missing '+platformDeviceAdministrationAsset);
const multiDeviceAsset='js/sync/device-authorization-administration-ui.js?rev=startup-device-admin-lifecycle-v1';
assert(index.includes(multiDeviceAsset),'index missing '+multiDeviceAsset);
assert(worker.includes("'./"+multiDeviceAsset+"'"),'app shell missing '+multiDeviceAsset);
[
  ['js/sync/organization-management-attempt-store.js','organization-management-v1'],
  ['js/supabase/organization-management-service.js','organization-archive-restore-v1'],
  ['js/sync/organization-management-ui.js','startup-device-admin-lifecycle-v1']
].forEach(([asset,revision])=>{const versioned=asset+'?rev='+revision;assert(index.includes(versioned));assert(worker.includes("'./"+versioned+"'"));});
assert(index.includes('conference-edit-lock-manager.js?rev='+appAssetRevision));
assert(!index.includes('conference-edit-lock-manager.js?rev='+previous));
assert(manager.includes('beginAccommodationEdit'));
assert(!manager.includes('committed:committed'));

const navigation=worker.slice(worker.indexOf('function handleNavigationRequest'),worker.indexOf("self.addEventListener('fetch'"));
assert(navigation.indexOf("fetch(request,{cache:'no-store'})")>=0,'navigation must request network without HTTP cache');
assert(navigation.indexOf('fetch(request')<navigation.indexOf('cache.match'),'navigation must be network-first');
assert(worker.includes("event.data.action === 'skipWaiting'"));
assert(worker.includes('event.waitUntil(self.skipWaiting())'));
assert(worker.includes('cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME'));
assert(worker.includes('caches.delete(cacheName)'));
assert.match(worker,/IS_DEVELOPMENT && requestUrl\.pathname === '\/manifest\.json'[\s\S]*JSON\.stringify\(\{[\s\S]*start_url: '\/'[\s\S]*status: 200/);
assert.match(worker,/application\/manifest\+json/);
assert.doesNotMatch(worker,/requestUrl\.pathname === '\/manifest\.json'[\s\S]{0,800}status: 503/);
assert.match(worker,/warehouse-original-shell-round1-v1/);
assert(pwa.includes("postMessage({ action: 'skipWaiting' })"),'update button and worker message must match');
assert(pwa.includes("updateViaCache:'none'"),'worker update must bypass HTTP cache');
assert(pwa.includes("addEventListener('controllerchange'"));
assert(pwa.includes('window.location.reload()'));

[
  'activeWorkerCacheRevision','waitingWorker','installingWorker',
  'controllerScriptURL','appShellRevision'
].forEach(field=>assert(pwa.includes(field),'missing update diagnostic '+field));
assert(worker.includes("action:'updateDiagnostics'"));
assert(worker.includes('cacheRevision:CACHE_REVISION'));

const updateSources=worker+'\n'+pwa;
assert(!/indexedDB\s*\.\s*deleteDatabase|localStorage\s*\.\s*clear|sessionStorage\s*\.\s*clear/.test(updateSources),'update must not clear persistent application data');
console.log('deterministic PWA update regression tests passed');
