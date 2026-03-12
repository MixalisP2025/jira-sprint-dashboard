// Service Worker for Sprint Analytics Dashboard PWA
// Cache name uses full timestamp so every build gets a unique cache.
// This guarantees the installed PWA always loads the latest version.

const CACHE_NAME = 'sprint-analytics-BUILD_TIMESTAMP';

const STATIC_ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => {
          console.log('[SW] Clearing old cache:', n);
          return caches.delete(n);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for HTML and API — always get the freshest version
  if (url.pathname.startsWith('/api/') || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (request.headers.get('accept')?.includes('text/html') && response.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for hashed JS/CSS assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.status === 200 && response.type === 'basic') {
          caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
        }
        return response;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
