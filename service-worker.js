const CORE_CACHE_NAME = 'conference-manager-core-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './utils.js',
  './core.js',
  './people.js',
  './houses.js',
  './transport.js',
  './houseTemplates.js',
  './state.js',
  './js/conference/accounts.js',
  './cards.js',
  './script.js',
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
    caches.open(CORE_CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(CORE_ASSETS);
      })
      // Do not call self.skipWaiting() here. Wait for user action.
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CORE_CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      ).then(() => self.clients.claim());
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});