const APP_VERSION = '3.4.0';
const DEVELOPMENT_PROJECT_REF = 'gppwltrifgfxrkzvvxoe';
const DEVELOPMENT_PATH = '/conference-management-system-development-preview/';
const IS_DEVELOPMENT = self.location.pathname.indexOf(DEVELOPMENT_PATH) === 0;
const CACHE_NAMESPACE = IS_DEVELOPMENT
  ? 'cms:development:' + DEVELOPMENT_PROJECT_REF + ':'
  : '';
const CACHE_PREFIX = CACHE_NAMESPACE + 'conference-manager-core-';
const CACHE_REVISION = IS_DEVELOPMENT
  ? 'development-3-4-0-warehouse-core-screens-round2-v1'
  : 'production-integrated-3-3-0-main-6d0c1e1-develop-80653ca-v1';
const CACHE_NAME = CACHE_PREFIX + 'v' + APP_VERSION + '-' + CACHE_REVISION;
const CORE_ASSETS = [
  './',
  './index.html',
  './shared-design-tokens.css?rev=platform-shell-phase2b-v1',
  './style.css?rev=warehouse-core-screens-round2-v1',
  './js/application-routing.js?rev=canonical-conference-routing-v1',
  './js/storage/environment-namespace.js',
  './js/storage/snapshot-payload-diagnostics.js?rev=snapshot-payload-diagnostics-v1',
  './js/storage/local-persistence-arbitration.js?rev=develop-cross-store-arbitration-v1',
  './js/storage/indexeddb.js?rev=develop-cross-store-arbitration-v1',
  './js/storage/storage-repository.js?rev=develop-cross-store-arbitration-v1',
  './js/storage/conference-repository.js',
  './js/storage/conference-publishing-engine.js?rev=organization-membership-operation-key-v1',
  './js/storage/conference-publish-recovery.js?rev=organization-membership-operation-key-v1',
  './js/storage/conference-publish-manager.js',
  './js/storage/full-backup.js?rev=post-restore-proof-boundary-v1',
  './js/sync/sync-queue.js?rev=post-restore-proof-boundary-v1',
  './js/sync/startup-queue-recovery.js?rev=post-restore-proof-boundary-v1',
  './js/storage/migration-audit.js',
  './js/supabase/public-config.js',
  './js/supabase/runtime-config.js',
  './js/supabase/device-session.js?rev=startup-transport-cleanup-v1',
  './js/supabase/conference-device-operation-contract.js?rev=phase1c-v1',
  './js/supabase/warehouse-device-operation-contract.js?rev=phase-w1-v1',
  './js/supabase/platform-device-operation-contract.js?rev=phase-w1-v1',
  './js/supabase/warehouse-transport.js?rev=phase-w1-v1',
  './js/supabase/client.js?rev=phase1c-v1',
  './js/supabase/auth.js?rev=account-session-identity-v1',
  './js/platform-integration.js?rev=cold-refresh-startup-ordering-v1',
  './js/supabase/system-access-service.js?rev=conference-create-authorization-v1',
  './js/sync/diagnostics-privacy-policy.js?rev=diagnostics-privacy-hardening-v1',
  './js/sync/organization-administration-utils.js',
  './js/sync/access-diagnostics-ui.js?rev=platform-first-login-coordinator-v1',
  './js/sync/organization-membership-operation-repository.js?rev=organization-membership-retention-safe-v1',
  './js/supabase/organization-administration-service.js?rev=organization-membership-manual-retry-v1',
  './js/sync/organization-members-ui.js?rev=organization-membership-manual-retry-v1',
  './js/sync/organization-management-attempt-store.js?rev=organization-management-v1',
  './js/supabase/organization-management-service.js?rev=organization-archive-restore-v1',
  './js/sync/organization-management-ui.js?rev=startup-device-admin-lifecycle-v1',
  './js/supabase/device-identity.js?rev=organization-membership-operation-key-v1',
  './js/supabase/device-enrollment.js?rev=phase-w1-native-enrollment-v1',
  './js/sync/device-authorization-operation-repository.js',
  './js/supabase/current-device-authorization-service.js?rev=platform-authorization-readiness-v2',
  './js/supabase/device-authorization-administration-service.js?rev=platform-privileged-device-admin-diagnostics-v1',
  './js/sync/current-device-authorization-ui.js?rev=platform-first-login-coordinator-v1',
  './js/sync/device-reauthorization-flow.js?rev=device-reauthorization-flow-v1',
  './js/sync/device-authorization-administration-ui.js?rev=startup-device-admin-lifecycle-v1',
  './js/supabase/snapshot-sync.js?rev=organization-membership-operation-key-v1',
  './js/sync/startup-conference-discovery.js?rev=shared-template-library-v1',
  './js/sync/organization-template-sync.js?rev=shared-template-copy-guard-v1',
  './js/sync/house-template-content-authorization.js?rev=shared-template-copy-guard-v1',
  './js/sync/house-template-sharing-ui.js?rev=official-house-template-sharing-v1',
  './js/sync/test-house-template-cleanup.js?rev=test-house-template-cleanup-v1',
  './js/sync/partial-template-state-cleanup.js?rev=partial-template-state-cleanup-v1',
  './js/sync/rejected-shared-template-cleanup.js?rev=rejected-shared-template-cleanup-v1',
  './js/sync/local-template-copy-cleanup.js?rev=shared-template-copy-guard-v1',
  './js/sync/legacy-template-adoption-ui.js?rev=legacy-template-adoption-authorization-v1',
  './js/sync/sync-processor.js?rev=startup-queue-recovery-v1',
  './js/sync/realtime.js',
  './js/sync/conflict-resolution.js',
  './js/sync/conflict-executor.js?rev=conference-snapshot-device-guard-v1',
  './js/sync/conference-locks.js?rev=conference-lock-release-diagnostics-v1',
  './js/sync/conference-edit-lock-manager.js?rev=section-accommodation-edit-lock-v1',
  './js/sync/offline-first-integration.js?rev=revision-publish-1',
  './js/sync/device-rescue-export.js?rev=diagnostics-privacy-hardening-v1',
  './js/sync/template-diagnostic-export.js?rev=template-diagnostic-export-v1',
  './js/sync/sync-settings-ui.js?rev=platform-first-login-coordinator-v1',
  './js/supabase/first-system-bootstrap-service.js?rev=first-owner-bootstrap-hardening-v1',
  './js/sync/startup-access-gate.js?rev=platform-first-login-coordinator-v1',
  './js/sync/link-status-diagnostic-store.js',
  './js/sync/conference-link-store.js',
  './js/sync/conference-permission-contract.js?rev=permission-contract-phase2a-v1',
  './js/sync/conference-permission-resolver.js?rev=development-3-4-0-platform-foundation-v1',
  './js/sync/conference-activation-authorization.js?rev=runtime-authorization-phase1-v1',
  './js/sync/conference-membership-attempt-store.js',
  './js/sync/conference-members-service.js?rev=legacy-rpc-hardening-v1',
  './js/sync/conference-members-ui.js?rev=diagnostics-privacy-hardening-v1',
  './js/sync/legacy-conference-organization-assignment-attempt-store.js?rev=legacy-conference-preflight-v2',
  './js/supabase/legacy-conference-organization-assignment-service.js?rev=legacy-conference-preflight-v2',
  './js/sync/legacy-conference-organization-assignment-ui.js?rev=legacy-conference-preflight-v2',
  './js/sync/system-access-administration-attempt-store.js?rev=user-account-administration-v1',
  './js/supabase/account-administration-service.js?rev=user-account-administration-v1',
  './js/sync/user-management-read-service.js?rev=organization-archive-restore-v1',
  './js/sync/user-management-ui.js?rev=organization-membership-operation-key-v1',
  './js/sync/conference-linking-attempt-store.js',
  './js/sync/conference-linking-service.js?rev=conference-organization-context-v1',
  './js/sync/conference-sync-ui.js?rev=conference-organization-context-v1',
  './js/sync/conflict-backup-store.js?rev=phase-4',
  './js/sync/pending-remote-application-store.js?rev=phase-4',
  './js/sync/conflict-resolution-draft-store.js',
  './js/sync/conflict-finalization-service.js?rev=phase-3-5',
  './js/sync/local-snapshot-application.js?rev=phase-5',
  './js/sync/conflict-resolution-ui.js?rev=diagnostics-privacy-hardening-v1',
  './js/sync/remote-update-store.js',
  './js/sync/realtime-locks-ui.js?rev=legacy-rpc-hardening-v1',
  './js/sync/automatic-sync-preferences.js?rev=automatic-sync-preferences-gap-v1',
  './js/sync/sync-scheduler-state.js',
  './js/sync/conference-sync-state-resolver.js?rev=phase-5',
  './js/sync/conference-queue-integration.js?rev=queue-legacy-compat-v1',
  './js/sync/conference-realtime-manager.js?rev=template-sync-isolation-v1',
  './js/sync/orphaned-conference-cleanup.js?rev=orphaned-local-cleanup-v2',
  './js/sync/conference-operational-ui.js',
  './js/sync/automatic-queue-runner.js?rev=template-sync-isolation-v1',
  './js/sync/automatic-conference-linking.js?rev=realtime-refresh-completion-v1',
  './js/sync/discovered-conference-open-service.js?rev=repository-rejection-diagnostics-v1',
  './js/sync/member-runtime-diagnostics.js?rev=repository-rejection-diagnostics-v1',
  './js/sync/automatic-sync-orchestrator.js?rev=realtime-reconnect-catchup-v1',
  './js/sync/wrong-remote-binding-repair-store.js?rev=wrong-remote-binding-repair-v1',
  './js/sync/wrong-remote-binding-repair-service.js?rev=wrong-remote-binding-repair-v1',
  './js/sync/wrong-remote-binding-repair-ui.js?rev=diagnostics-privacy-hardening-v1',
  './utils.js',
  './core.js?rev=development-3-4-0-platform-foundation-v1',
  './people.js?rev=canonical-conference-schema-v1',
  './houses.js?rev=template-floor-conference-sync-v1',
  './transport.js',
  './houseTemplates.js?rev=shared-house-template-read-only-v1',
  './state.js?rev=managed-platform-startup-gate-v1',
  './js/conference/accounts.js?rev=development-3-4-0-platform-foundation-v1',
  './js/conference-template-houses-editor.js',
  './cards.js',
  './libs/xlsx.full.min.js',
  './js/ui-icons.js?rev=warehouse-original-shell-round1-v1',
  './js/warehouse/workspace.js?rev=warehouse-core-screens-round2-v1',
  './script.js?rev=delayed-warehouse-route-override-v1',
  './version.js',
  './pwa.js?rev=organization-membership-operation-key-v1',
  './libs/html2canvas.min.js',
  './assets/logo.jpg',
  './assets/make-a-difference-logo.png',
  './assets/startup-bg.png',
  './icons/icon-192x192-v3.png',
  './icons/icon-512x512-v3.png',
  './icons/icon-maskable-512-v3.png',
  './icons/apple-touch-icon-180x180-v3.png',
  './icons/icon-152x152-v3.png',
  './icons/icon-96x96-v3.png',
  './icons/favicon-32x32-v3.png'
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

  if (IS_DEVELOPMENT && requestUrl.pathname === '/manifest.json') {
    event.respondWith(
      Promise.resolve(new Response(JSON.stringify({
        name: 'Integrated Management Platform Development',
        short_name: 'Platform Dev',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#123E7A',
        background_color: '#123E7A'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' }
      }))
    );
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
