// Service Worker for Фінанси PWA
// Strategy: cache-first with background refresh.
// Updates: bump VERSION below to force a new cache on next deploy.

const VERSION = '1.10.1';
const CACHE = 'finance-' + VERSION;

// Pre-cache the app shell on install.
// We only know our HTML for sure; fonts get cached on first fetch.
const PRECACHE_URLS = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // Activate the new SW immediately, without waiting for tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET — POST/PUT etc. go straight to the network
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      // Cache-first: if we have it, return it AND refresh in the background
      if (cached) {
        // Background revalidation — don't await
        fetch(req).then(resp => {
          if (resp && resp.ok) {
            caches.open(CACHE).then(c => c.put(req, resp.clone())).catch(() => {});
          }
        }).catch(() => {});
        return cached;
      }
      // Not cached — fetch and cache the response if successful
      return fetch(req).then(resp => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return resp;
      }).catch(() => {
        // Offline and not cached — degrade gracefully
        return new Response('Offline and not cached', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});
