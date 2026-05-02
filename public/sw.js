// StandClear service worker.
//
// Strategy:
//   * Precache nothing at install. The Next.js build hashes bundle names into
//     chunks we cannot know at SW-author time; instead we cache-on-use.
//   * Runtime caching lives in two buckets:
//       standclear-static  — CSS, JS, fonts, icons, images. Cache-first.
//       standclear-data    — /api/trains and /api/alerts. Stale-while-
//         revalidate so the app opens instantly and refreshes in the
//         background. The UI already polls, so showing last-known data for
//         a second while the network catches up is preferable to a spinner.
//   * HTML navigations are network-first with a cached fallback, so offline
//     launches still render the shell using whatever was cached last.
//   * Opaque or failed fetches are never cached.
//
// Bump CACHE_VERSION when the SW logic changes meaningfully — older caches
// are purged on activate. Caches written by the previous brand prefix
// (subwaysurfer-*) are also evicted on activate so a one-time deploy
// reclaims their storage.

const CACHE_VERSION = "v3";
const STATIC_CACHE = `standclear-static-${CACHE_VERSION}`;
const DATA_CACHE = `standclear-data-${CACHE_VERSION}`;
const HTML_CACHE = `standclear-html-${CACHE_VERSION}`;

const KNOWN_CACHES = new Set([STATIC_CACHE, DATA_CACHE, HTML_CACHE]);

self.addEventListener("install", (event) => {
  // Pre-warm the HTML cache with the root shell so first offline load works
  // even before the user has visited anything.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(HTML_CACHE);
      try {
        await cache.add(new Request("/", { cache: "reload" }));
      } catch {
        // ignore — we'll fill on first successful navigation
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (n) =>
              (n.startsWith("standclear-") || n.startsWith("subwaysurfer-")) &&
              !KNOWN_CACHES.has(n),
          )
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname === "/favicon.ico" ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp)$/.test(url.pathname)
  );
}

function isDataRequest(url) {
  return url.pathname === "/api/trains" || url.pathname === "/api/alerts";
}

// The static GTFS payload is ~430KB and only changes with a redeploy.
// Stale-while-revalidate gives instant cold-boot rendering (the app shell
// can build the station index immediately from cached data) while pulling
// fresh data in the background. Without this entry the JSON falls through
// the matcher chain and is fetched every cold launch — fatal underground.
function isStaticGtfs(url) {
  return url.pathname === "/gtfsData.json";
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || new Response("", { status: 504 });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return cached || new Response("", { status: 504 });
  }
}

async function networkFirstHtml(request) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached =
      (await cache.match(request)) || (await cache.match("/"));
    return cached || new Response("Offline", { status: 503 });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle same-origin requests — tile requests to Mapbox, MTA feeds,
  // etc. should bypass the SW so their own caching policies apply.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (isStaticGtfs(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
});
