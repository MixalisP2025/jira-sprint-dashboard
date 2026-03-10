// Service Worker for Sprint Analytics Dashboard PWA
// Cache version is injected at build time via index.html meta tag,
// or falls back to a timestamp-based name so updates always propagate.

const CACHE_VERSION = new Date().toISOString().slice(0, 10); // e.g. "2026-03-10"
const CACHE_NAME = `sprint-analytics-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install — cache shell assets, activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting(); // take over without waiting for old SW to die
});

// Activate — delete ALL old caches so stale builds never show
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    )
  );
  self.clients.claim(); // take control of all open tabs immediately
});

// Fetch — network first for HTML/API, cache first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Always go network-first for API calls and HTML (so updates are instant)
  if (url.pathname.startsWith('/api/') || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache fresh HTML responses
          if (request.headers.get('accept')?.includes('text/html') && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request)) // fallback to cache if offline
    );
    return;
  }

  // Cache-first for JS/CSS/images (they have hashed filenames from Vite build)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});

// Listen for a message from the app to force an update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
