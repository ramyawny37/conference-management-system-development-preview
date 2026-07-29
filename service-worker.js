const APP_VERSION = '3.1.1';
const CACHE_PREFIX = 'conference-manager-core-';
const CACHE_REVISION = 'phase-6';
const CACHE_NAME = CACHE_PREFIX + 'v' + APP_VERSION + '-' + CACHE_REVISION;
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/storage/indexeddb.js',
  './js/storage/storage-repository.js',
  './js/sync/sync-queue.js',
  './js/storage/migration-audit.js',
  './js/storage/migration-repair.js',
  './js/supabase/runtime-config.js',
  './js/supabase/client.js',
  './js/supabase/auth.js',
  './js/supabase/device-identity.js',
  './js/supabase/snapshot-sync.js',
  './js/sync/sync-processor.js',
  './js/sync/realtime.js',
  './js/sync/conflict-resolution.js',
  './js/sync/conflict-executor.js',
  './js/sync/conference-locks.js',
  './js/sync/offline-first-integration.js?rev=revision-publish-1',
  './js/sync/sync-settings-ui.js?rev=phase-6',
  './js/sync/conference-link-store.js',
  './js/sync/conference-linking-attempt-store.js',
  './js/sync/conference-linking-service.js',
  './js/sync/conference-sync-ui.js',
  './js/sync/conflict-backup-store.js?rev=phase-4',
  './js/sync/pending-remote-application-store.js?rev=phase-4',
  './js/sync/conflict-resolution-draft-store.js',
  './js/sync/conflict-finalization-service.js?rev=phase-3-5',
  './js/sync/local-snapshot-application.js?rev=phase-5',
  './js/sync/conflict-resolution-ui.js?rev=phase-6',
  './js/sync/remote-update-store.js',
  './js/sync/realtime-locks-ui.js',
  './js/sync/automatic-sync-preferences.js',
  './js/sync/sync-scheduler-state.js',
  './js/sync/conference-sync-state-resolver.js?rev=phase-5',
  './js/sync/automatic-queue-runner.js?rev=phase-5',
  './js/sync/automatic-conference-linking.js',
  './js/sync/automatic-sync-orchestrator.js?rev=phase-5',
  './utils.js',
  './core.js',
  './people.js',
  './houses.js',
  './transport.js',
  './houseTemplates.js',
  './state.js',
  './js/conference/accounts.js',
  './cards.js',
  './script.js?rev=sync-ui-1',
  './version.js',
  './pwa.js',
  './libs/html2canvas.min.js',
  './assets/logo.jpg',
  './assets/startup-bg.png',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(CORE_ASSETS);
      })
      .catch(error => {
        return caches.delete(CACHE_NAME).then(() => {
          throw error;
        });
      })
      // Do not call self.skipWaiting() here. Wait for user action.
  );
});

function handleNavigationRequest(request) {
  const homeCacheKey = './';

  return fetch(request)
    .then(response => {
      const responseUrl = new URL(response.url);
      const canCacheResponse = response.ok &&
        responseUrl.origin === self.location.origin;

      if (!canCacheResponse) {
        return response;
      }

      const responseToCache = response.clone();
      return caches.open(CACHE_NAME)
        .then(cache => cache.put(homeCacheKey, responseToCache))
        .catch(() => null)
        .then(() => response);
    })
    .catch(() => {
      return caches.open(CACHE_NAME)
        .then(cache => cache.match(homeCacheKey));
    });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (
    request.method !== 'GET' ||
    (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') ||
    requestUrl.origin !== self.location.origin
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(request).then(response => {
        return response || fetch(request);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      ).then(() => self.clients.claim());
    })
  );
});

self.addEventListener('message', event => {
  if (!event.data || !event.data.action) return;

  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
    return;
  }

  if (event.data.action === 'getVersion' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      action: 'versionInfo',
      version: APP_VERSION
    });
  }
});
