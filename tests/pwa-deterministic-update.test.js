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
const next='first-use-auth-v1';
const userManagementUiRevision='user-onboarding-flow-v1';
const userManagementStyleRevision='user-management-ui-polish-v1';
const userManagementReadRevision='user-management-scoped-v1';
const conferenceRoleRevision='conference-role-management-v1';
const houseTemplateRevision='house-template-propagation-v1';
const pwaAssetRevision='startup-queue-recovery-v1';
const appAssetRevision='section-accommodation-edit-lock-v1';
assert(worker.includes("CACHE_REVISION = '"+next+"'"));
assert(index.includes("window.APP_SHELL_REVISION='"+next+"'"));
assert(index.includes('pwa.js?rev='+pwaAssetRevision));
assert(index.includes('js/sync/sync-settings-ui.js?rev=first-use-auth-v1'));
assert(worker.includes("'./js/sync/sync-settings-ui.js?rev=first-use-auth-v1'"));
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
assert(index.includes('script.js?rev=user-management-scoped-v1'));
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
