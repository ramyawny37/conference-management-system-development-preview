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
const next='startup-device-admin-lifecycle-v1';
const deviceOnboardingRevision='device-onboarding-v1';
const organizationTemplateRevision='organization-template-sync-v1';
const bootstrapRevision='first-owner-bootstrap-hardening-v1';
const userManagementUiRevision=next;
const userManagementStyleRevision='organization-management-v1';
const userManagementReadRevision='organization-archive-restore-v1';
const conferenceRoleRevision='conference-role-management-v1';
const houseTemplateRevision='house-template-propagation-v1';
const pwaAssetRevision='startup-queue-recovery-v1';
const appAssetRevision='section-accommodation-edit-lock-v1';
assert(worker.includes("CACHE_REVISION = '"+next+"'"));
assert(index.includes("window.APP_SHELL_REVISION='"+next+"'"));
assert(index.includes('pwa.js?rev='+pwaAssetRevision));
assert(index.includes('js/sync/sync-settings-ui.js?rev=first-use-auth-v1'));
assert(worker.includes("'./js/sync/sync-settings-ui.js?rev=first-use-auth-v1'"));
assert(index.includes('js/supabase/first-system-bootstrap-service.js?rev='+bootstrapRevision));
assert(worker.includes("'./js/supabase/first-system-bootstrap-service.js?rev="+bootstrapRevision+"'"));
assert(index.includes('js/sync/startup-access-gate.js?rev='+next));
assert(worker.includes("'./js/sync/startup-access-gate.js?rev="+next+"'"));
['houses.js','houseTemplates.js'].forEach(asset=>{
  const versionedAsset=asset+'?rev='+houseTemplateRevision;
  assert(index.includes(versionedAsset),'index missing '+versionedAsset);
  assert(worker.includes("'./"+versionedAsset+"'"),'app shell missing '+versionedAsset);
});
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
assert(index.includes('script.js?rev='+next));
assert(worker.includes("'./script.js?rev="+next+"'"));
[
  'js/storage/indexeddb.js','js/storage/storage-repository.js',
  'js/sync/startup-conference-discovery.js',
  'js/sync/organization-template-sync.js'
].forEach(asset=>{
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
const multiDeviceAsset='js/sync/device-authorization-administration-ui.js?rev='+next;
assert(index.includes(multiDeviceAsset),'index missing '+multiDeviceAsset);
assert(worker.includes("'./"+multiDeviceAsset+"'"),'app shell missing '+multiDeviceAsset);
[
  ['js/sync/organization-management-attempt-store.js','organization-management-v1'],
  ['js/supabase/organization-management-service.js','organization-archive-restore-v1'],
  ['js/sync/organization-management-ui.js',next]
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
