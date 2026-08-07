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
const next='startup-queue-recovery-v1';
const appAssetRevision='section-accommodation-edit-lock-v1';
assert(worker.includes("CACHE_REVISION = '"+next+"'"));
assert(index.includes("window.APP_SHELL_REVISION='"+next+"'"));
assert(index.includes('pwa.js?rev='+next));
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
