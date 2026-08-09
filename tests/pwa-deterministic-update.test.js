'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
const pwa=fs.readFileSync(path.join(root,'pwa.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const manager=fs.readFileSync(path.join(root,'js/sync/conference-edit-lock-manager.js'),'utf8');

const previous='exclusive-edit-lock-v1';
const next='conference-snapshot-device-guard-v1';
const templateIsolationRevision='template-sync-isolation-v1';
const startupRevision='startup-authorized-view-v1';
const deviceOnboardingRevision='device-onboarding-v1';
const organizationTemplateRevision='shared-template-library-v1';
const bootstrapRevision='first-owner-bootstrap-hardening-v1';
const userManagementUiRevision='startup-device-admin-lifecycle-v1';
const userManagementStyleRevision='organization-management-v1';
const userManagementReadRevision='organization-archive-restore-v1';
const conferenceRoleRevision='conference-role-management-v1';
const houseTemplateRevision='available-template-room-discovery-v1';
const pwaAssetRevision=next;
const appAssetRevision='section-accommodation-edit-lock-v1';
const snapshotGuardRevision=next;
const priorFrontendRevision='admin-xlsx-template-room-fixes-v1';
assert(worker.includes("CACHE_REVISION = '"+next+"'"));
assert(index.includes("window.APP_SHELL_REVISION='"+next+"'"));
assert(index.includes('pwa.js?rev='+pwaAssetRevision));
assert(index.includes('js/sync/sync-settings-ui.js?rev=first-use-auth-v1'));
assert(worker.includes("'./js/sync/sync-settings-ui.js?rev=first-use-auth-v1'"));
assert(index.includes('js/supabase/first-system-bootstrap-service.js?rev='+bootstrapRevision));
assert(worker.includes("'./js/supabase/first-system-bootstrap-service.js?rev="+bootstrapRevision+"'"));
assert(index.includes('js/sync/startup-access-gate.js?rev='+startupRevision));
assert(worker.includes("'./js/sync/startup-access-gate.js?rev="+
  startupRevision+"'"));
['houses.js'].forEach(asset=>{
  const versionedAsset=asset+'?rev='+houseTemplateRevision;
  assert(index.includes(versionedAsset),'index missing '+versionedAsset);
  assert(worker.includes("'./"+versionedAsset+"'"),'app shell missing '+versionedAsset);
});
const isolatedHouseTemplates='houseTemplates.js?rev='+templateIsolationRevision;
assert(index.includes(isolatedHouseTemplates));
assert(worker.includes("'./"+isolatedHouseTemplates+"'"));
const conferenceMembersUi='js/sync/conference-members-ui.js?rev='+conferenceRoleRevision;
assert(index.includes(conferenceMembersUi),
  'index missing deterministic Conference Members UI revision');
assert(worker.includes("'./"+conferenceMembersUi+"'"),
  'app shell missing deterministic Conference Members UI revision');
assert(!index.includes('src="js/sync/conference-members-ui.js"'),
  'Conference Members UI must not use an unversioned script URL');
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
assert(index.includes('script.js?rev='+priorFrontendRevision));
assert(worker.includes("'./script.js?rev="+priorFrontendRevision+"'"));
const xlsxAsset='libs/xlsx.full.min.js';
assert(fs.existsSync(path.join(root,xlsxAsset)),'local XLSX runtime asset missing');
assert(index.includes('<script src="'+xlsxAsset+'"></script>'),'index missing local XLSX runtime');
assert(index.indexOf(xlsxAsset)<index.indexOf('script.js?rev='+priorFrontendRevision),'XLSX runtime must load before import logic');
assert(worker.includes("'./"+xlsxAsset+"'"),'app shell missing local XLSX runtime');
assert(!/https?:[^"']*(sheetjs|xlsx)/i.test(index),'XLSX must not depend on a CDN');
const organizationMembersAsset='js/sync/organization-members-ui.js?rev='+priorFrontendRevision;
assert(index.includes(organizationMembersAsset),'index missing deterministic Organization Members UI revision');
assert(worker.includes("'./"+organizationMembersAsset+"'"),'app shell missing deterministic Organization Members UI revision');
['js/supabase/snapshot-sync.js','js/sync/conflict-executor.js'].forEach(asset=>{
  const versioned=asset+'?rev='+snapshotGuardRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  'state.js','js/sync/automatic-queue-runner.js',
  'js/sync/conference-realtime-manager.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+templateIsolationRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  ['js/storage/indexeddb.js',organizationTemplateRevision],
  ['js/storage/storage-repository.js','organization-template-sync-v1']
].forEach(([asset,revision])=>{
  const versioned=asset+'?rev='+revision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
const isolatedTemplateSync='js/sync/organization-template-sync.js?rev='+organizationTemplateRevision;
assert(index.includes(isolatedTemplateSync));
assert(worker.includes("'./"+isolatedTemplateSync+"'"));
['js/sync/startup-conference-discovery.js',
  'js/sync/legacy-template-adoption-ui.js'].forEach(asset=>{
  const versioned=asset+'?rev='+organizationTemplateRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
[
  'js/sync/current-device-authorization-ui.js'
].forEach(asset=>{
  const versioned=asset+'?rev='+deviceOnboardingRevision;
  assert(index.includes(versioned),'index missing '+versioned);
  assert(worker.includes("'./"+versioned+"'"),'app shell missing '+versioned);
});
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
