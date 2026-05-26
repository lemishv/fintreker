// Service Worker for Фінанси PWA
//
// Strategy:
//   - HTML / navigation requests: stale-while-revalidate.
//     Cached HTML is served immediately (fast first paint), and the network
//     copy is fetched in the background to refresh the cache for next time.
//     When a NEW SW activates (VERSION bumped), we broadcast 'sw-updated' so
//     the page can show a toast prompting reload.
//   - Static assets (fonts, CDN libs): cache-first with background refresh.
//     These rarely change and we want them instant.
//
// Updates: bump VERSION below to force a new cache on next deploy. The bump
//          also drives the "new version available" toast in the app.

const VERSION = '1.19.0';
const CACHE = 'finance-' + VERSION;

// Pre-cache the app shell on install.
const PRECACHE_URLS = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // Activate the new SW immediately, without waiting for tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter(k => k !== CACHE);
    // If we found OLD caches to delete, this is an upgrade — not first install.
    // We use this signal to decide whether to broadcast the "new version" toast.
    const isUpgrade = oldKeys.length > 0;
    await Promise.all(oldKeys.map(k => caches.delete(k)));
    await self.clients.claim();
    if (isUpgrade) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'sw-updated', version: VERSION });
      }
    }
  })());
});

// Decide whether a request is for the HTML shell.
// Covers: top-level navigation, explicit .html, the root path.
function isHTMLRequest(req) {
  if (req.mode === 'navigate') return true;
  if (req.destination === 'document') return true;
  const url = new URL(req.url);
  if (url.pathname.endsWith('.html')) return true;
  if (url.pathname === '/' || url.pathname.endsWith('/')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET — POST/PUT etc. go straight to the network
  if (req.method !== 'GET') return;

  if (isHTMLRequest(req)) {
    event.respondWith(staleWhileRevalidate(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

// Stale-while-revalidate: return cache immediately, refresh in background.
// If nothing is cached yet, wait for the network. If network fails too, 503.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  // Kick off the network refresh — don't await unless we have to.
  const networkPromise = fetch(req).then(resp => {
    if (resp && resp.ok) {
      cache.put(req, resp.clone()).catch(() => {});
    }
    return resp;
  }).catch(() => null);

  if (cached) return cached;

  // No cache yet (first visit, or asset wasn't pre-cached) — wait for network.
  const fresh = await networkPromise;
  if (fresh) return fresh;

  return new Response('Offline and not cached', {
    status: 503,
    statusText: 'Service Unavailable'
  });
}

// Cache-first with background refresh. Used for static assets (fonts, CDN libs).
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  if (cached) {
    // Background revalidation — don't await
    fetch(req).then(resp => {
      if (resp && resp.ok) {
        cache.put(req, resp.clone()).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }

  // Not cached — fetch and cache the response if successful
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) {
      cache.put(req, resp.clone()).catch(() => {});
    }
    return resp;
  } catch (e) {
    return new Response('Offline and not cached', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}
