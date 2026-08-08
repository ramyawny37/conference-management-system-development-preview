const APP_VERSION = '3.1.1';
const DEVELOPMENT_PROJECT_REF = 'gppwltrifgfxrkzvvxoe';
const DEVELOPMENT_PATH = '/conference-management-system-development-preview/';
const IS_DEVELOPMENT = self.location.pathname.indexOf(DEVELOPMENT_PATH) === 0;
const CACHE_NAMESPACE = IS_DEVELOPMENT
  ? 'cms:development:' + DEVELOPMENT_PROJECT_REF + ':'
  : '';
const CACHE_PREFIX = CACHE_NAMESPACE + 'conference-manager-core-';
const CACHE_REVISION = 'user-onboarding-flow-v1';
const CACHE_NAME = CACHE_PREFIX + 'v' + APP_VERSION + '-' + CACHE_REVISION;
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css?rev=user-management-ui-polish-v1',
  './js/storage/environment-namespace.js',
  './js/storage/indexeddb.js',
  './js/storage/storage-repository.js?rev=local-save-queue-wake-v1',
  './js/storage/conference-repository.js',
  './js/storage/conference-publishing-engine.js',
  './js/storage/conference-publish-recovery.js',
  './js/storage/conference-publish-manager.js',
  './js/storage/full-backup.js',
  './js/sync/sync-queue.js?rev=startup-queue-recovery-v1',
  './js/sync/startup-queue-recovery.js?rev=startup-queue-recovery-v1',
  './js/sync/targeted-stuck-operation-recovery.js',
  './js/storage/migration-audit.js',
  './js/storage/migration-repair.js',
  './js/supabase/public-config.js',
  './js/supabase/runtime-config.js',
  './js/supabase/client.js',
  './js/supabase/auth.js?rev=realtime-startup-e2e-v1',
  './js/supabase/system-access-service.js',
  './js/sync/organization-administration-utils.js',
  './js/sync/organization-membership-operation-repository.js',
  './js/supabase/organization-administration-service.js',
  './js/sync/organization-members-ui.js',
  './js/supabase/device-identity.js',
  './js/sync/device-authorization-operation-repository.js',
  './js/supabase/current-device-authorization-service.js?rev=device-reauthorization-flow-v2',
  './js/supabase/device-authorization-administration-service.js?rev=device-single-replacement-v1',
  './js/sync/current-device-authorization-ui.js?rev=device-reauthorization-flow-v2',
  './js/sync/device-reauthorization-flow.js?rev=device-reauthorization-flow-v1',
  './js/sync/device-authorization-administration-ui.js?rev=multi-device-authorization-v1',
  './js/supabase/snapshot-sync.js?rev=startup-queue-recovery-v1',
  './js/sync/startup-conference-discovery.js',
  './js/sync/sync-processor.js?rev=startup-queue-recovery-v1',
  './js/sync/realtime.js',
  './js/sync/conflict-resolution.js',
  './js/sync/conflict-executor.js',
  './js/sync/conference-locks.js?rev=conference-lock-release-diagnostics-v1',
  './js/sync/conference-edit-lock-manager.js?rev=section-accommodation-edit-lock-v1',
  './js/sync/offline-first-integration.js?rev=revision-publish-1',
  './js/sync/debug-binding-report-ui.js?rev=debug-binding-report-ui-v2',
  './js/sync/device-rescue-export.js?rev=device-rescue-export-v1',
  './js/sync/experimental-conference-reset.js?rev=experimental-reset-v1',
  './js/sync/sync-settings-ui.js?rev=targeted-stuck-operation-recovery-v1',
  './js/sync/link-status-diagnostic-store.js',
  './js/sync/conference-link-store.js',
  './js/sync/conference-membership-attempt-store.js',
  './js/sync/conference-members-service.js',
  './js/sync/conference-members-ui.js?rev=conference-role-management-v1',
  './js/sync/system-access-administration-attempt-store.js?rev=user-account-administration-v1',
  './js/supabase/account-administration-service.js?rev=user-account-administration-v1',
  './js/sync/user-management-read-service.js?rev=user-management-scoped-v1',
  './js/sync/user-management-ui.js?rev=user-onboarding-flow-v1',
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
  './js/sync/realtime-locks-ui.js?rev=realtime-refresh-completion-v1',
  './js/sync/automatic-sync-preferences.js?rev=automatic-sync-preferences-gap-v1',
  './js/sync/sync-scheduler-state.js',
  './js/sync/conference-sync-state-resolver.js?rev=phase-5',
  './js/sync/conference-queue-integration.js?rev=queue-legacy-compat-v1',
  './js/sync/conference-realtime-manager.js?rev=realtime-reconnect-catchup-v1',
  './js/sync/conference-operational-ui.js',
  './js/sync/automatic-queue-runner.js?rev=startup-queue-recovery-v1',
  './js/sync/automatic-conference-linking.js?rev=realtime-refresh-completion-v1',
  './js/sync/discovered-conference-open-service.js?rev=realtime-reconnect-catchup-v1',
  './js/sync/member-runtime-diagnostics.js?rev=startup-queue-recovery-v1',
  './js/sync/automatic-sync-orchestrator.js?rev=realtime-reconnect-catchup-v1',
  './js/sync/wrong-remote-binding-repair-store.js?rev=wrong-remote-binding-repair-v1',
  './js/sync/wrong-remote-binding-repair-service.js?rev=wrong-remote-binding-repair-v1',
  './js/sync/wrong-remote-binding-repair-ui.js?rev=wrong-remote-binding-repair-v1',
  './utils.js',
  './core.js?rev=canonical-conference-schema-v1',
  './people.js?rev=canonical-conference-schema-v1',
  './houses.js?rev=house-template-propagation-v1',
  './transport.js',
  './houseTemplates.js?rev=house-template-propagation-v1',
  './state.js?rev=device-reauthorization-flow-v1',
  './js/conference/accounts.js',
  './js/conference-template-houses-editor.js',
  './cards.js',
  './script.js?rev=user-management-scoped-v1',
  './version.js',
  './pwa.js?rev=realtime-drop-instrumentation-v1',
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

  return fetch(request,{cache:'no-store'})
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
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (event.data.action === 'getVersion' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      action: 'versionInfo',
      version: APP_VERSION
    });
    return;
  }

  if (event.data.action === 'getUpdateDiagnostics' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      action:'updateDiagnostics',
      version:APP_VERSION,
      cacheRevision:CACHE_REVISION,
      cacheName:CACHE_NAME
    });
  }
});
