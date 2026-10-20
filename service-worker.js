const APP_VERSION = '3.6.0';
const DEVELOPMENT_PROJECT_REF = 'gppwltrifgfxrkzvvxoe';
const DEVELOPMENT_PATH = '/conference-management-system-development-preview/';
const IS_DEVELOPMENT = self.location.pathname.indexOf(DEVELOPMENT_PATH) === 0 ||
  self.location.pathname.indexOf('/conference-management-system-v1' + DEVELOPMENT_PATH) === 0;
const CACHE_NAMESPACE = IS_DEVELOPMENT
  ? 'cms:development:' + DEVELOPMENT_PROJECT_REF + ':'
  : '';
const CACHE_PREFIX = CACHE_NAMESPACE + 'conference-manager-core-';
const CACHE_REVISION = IS_DEVELOPMENT
  ? 'development-platform-design-system-v2'
  : 'production-3-6-0-release-v6';
const CACHE_NAME = CACHE_PREFIX + 'v' + APP_VERSION + '-' + CACHE_REVISION;
const CORE_ASSETS = [
  './',
  './index.html',
  './design-system-reference.html',
  './shared-design-tokens.css?rev=platform-design-system-consolidation-v2',
  './style.css?rev=platform-design-system-consolidation-v2',
  './canonical-platform-shell.css?rev=platform-administration-canonical-sidebar-navigation-v2',
  './modules/reservations/reservations-module.css?rev=reservations-person-live-0d9db39-v1',
  './js/application-routing.js?rev=conference-room-assignments-v1',
  './js/storage/environment-namespace.js',
  './js/storage/indexeddb.js?rev=single-local-persistence-v1',
  './js/storage/storage-repository.js?rev=house-template-local-authority-v1',
  './js/storage/conference-repository.js',
  './js/storage/full-backup.js?rev=canonical-conference-id-v1',
  './js/supabase/public-config.js',
  './js/supabase/runtime-config.js',
  './js/supabase/device-storage-namespace.js?rev=project-device-storage-isolation-v1',
  './js/supabase/device-session.js?rev=device-key-store-recovery-v1',
  './js/supabase/conference-device-operation-contract.js?rev=permission-audit-closure-v1',
  './js/supabase/warehouse-device-operation-contract.js?rev=opening-balance-ux-correction-v1',
  './js/supabase/platform-device-operation-contract.js?rev=phase-w1-v1',
  './js/supabase/warehouse-transport.js?rev=phase-w1-v1',
  './js/supabase/client.js?rev=target-device-argument-preservation-v1',
  './js/supabase/auth.js?rev=account-session-identity-v1',
  './js/platform-integration.js?rev=conference-room-assignments-v1',
  './js/platform-home-dashboard.js?rev=unified-platform-state-home-v2',
  './js/supabase/canonical-conference-discovery.js?rev=conference-section-capabilities-v2',
  './js/supabase/canonical-conference-transport.js?rev=p6i-b2-v1',
  './js/supabase/canonical-conference-restaurant.js?rev=p6i-b3-v1',
  './modules/reservations/reservations-module.js?rev=reservations-person-live-0d9db39-v1',
  './js/supabase/system-access-service.js?rev=conference-create-authorization-v1',
  './js/sync/diagnostics-privacy-policy.js?rev=platform-capability-authority-v1',
  './js/sync/access-diagnostics-ui.js?rev=platform-first-login-coordinator-v1',
  './js/supabase/device-identity.js?rev=project-device-storage-isolation-v1',
  './js/supabase/device-enrollment.js?rev=account-scoped-device-key-selection-v1',

  './js/supabase/device-authorization-administration-service.js?rev=canonical-owner-session-list-v1',

  './js/sync/device-authorization-administration-ui.js?rev=canonical-owner-session-list-v1',
  './js/sync/startup-conference-discovery.js?rev=shared-template-library-v1',
  './js/sync/conference-locks.js?rev=conference-lock-release-diagnostics-v1',
  './js/sync/conference-edit-lock-manager.js?rev=canonical-conference-id-v1',
  './js/sync/template-diagnostic-export.js?rev=house-template-local-authority-v1',
  './js/sync/sync-settings-ui.js?rev=platform-first-login-coordinator-v1',
  './js/supabase/first-system-bootstrap-service.js?rev=first-owner-bootstrap-hardening-v1',
  './js/sync/startup-access-gate.js?rev=revoked-rerequest-error-code-v1',
  './js/sync/conference-activation-authorization.js?rev=canonical-conference-id-v1',
  './js/sync/user-management-read-service.js?rev=platform-administration-unification-v1',
  './js/sync/user-management-ui.js?rev=platform-admin-security-retirement-v1',
  './js/sync/module-permission-administration-service.js?rev=platform-administration-unification-v1',
  './js/sync/module-permission-administration-ui.js?rev=platform-administration-canonical-sidebar-navigation-v2',
  './js/sync/platform-administration-ui.js?rev=platform-admin-security-retirement-v1',
  './js/sync/conference-linking-attempt-store.js',
  './js/sync/discovered-conference-open-service.js?rev=conference-section-capabilities-v2',
  './utils.js',
  './core.js?rev=canonical-conference-id-v1',
  './people.js?rev=canonical-conference-schema-v1',
  './houses.js?rev=template-floor-conference-sync-v1',
  './transport.js',
  './houseTemplates.js?rev=house-template-local-authority-v1',
  './state.js?rev=canonical-conference-id-v1',
  './js/conference/accounts.js?rev=development-3-4-0-platform-foundation-v1',
  './js/conference-template-houses-editor.js',
  './cards.js',
  './libs/xlsx.full.min.js',
  './js/ui-icons.js?rev=warehouse-original-shell-round1-v1',
  './js/warehouse/current-store-context.js?rev=warehouse-current-store-context-v1',
  './js/warehouse/historical-operations.js?rev=reversal-ui-v1',
  './js/warehouse/party-management.js?rev=warehouse-party-management-v1',
  './js/warehouse/remaining-operations.js?rev=adjustment-conversion-ux-v1',
  './js/warehouse/workspace.js?rev=item-unit-add-ui-v1',
  './script.js?rev=conference-room-assignments-v1',
  './version.js',
  './pwa.js?rev=pwa-update-state-consistency-v1',
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
        return cache.addAll(CORE_ASSETS.map(asset => new Request(asset, { cache: 'reload' })));
      })
      .catch(error => {
        return caches.delete(CACHE_NAME).then(() => {
          throw error;
        });
      })
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

function developmentNetworkFirst(request) {
  return fetch(new Request(request,{cache:'no-store'}))
    .then(response => {
      if (!response || !response.ok) return response;
      const responseToCache=response.clone();
      return caches.open(CACHE_NAME)
        .then(cache => cache.put(request,responseToCache))
        .catch(() => null)
        .then(() => response);
    })
    .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request)));
}

function productionPublicConfigNetworkOnly(request) {
  return fetch(new Request(request,{cache:'no-store'}))
    .then(response => response)
    .catch(() => new Response('',{
      status:503,
      statusText:'Production configuration unavailable',
      headers:{'Cache-Control':'no-store'}
    }));
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
        headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control':'no-store' }
      }))
    );
    return;
  }

  if (IS_DEVELOPMENT) {
    event.respondWith(developmentNetworkFirst(request));
    return;
  }

  if (requestUrl.pathname.endsWith('/js/supabase/public-config.js')) {
    event.respondWith(productionPublicConfigNetworkOnly(request));
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
