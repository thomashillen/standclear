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

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  // Keep the worker alive until the background revalidation finishes.
  // On a cache hit we resolve respondWith() immediately with `cached`,
  // at which point the browser is free to terminate the SW — killing
  // the in-flight networkPromise before its cache.put() lands. That
  // silently drops the "revalidate" half of stale-while-revalidate, so
  // the next cold launch (often underground, on a worse connection)
  // serves an even staler /api/trains, /api/alerts, or gtfsData.json.
  // waitUntil extends the event's lifetime past respondWith, which is
  // exactly how Workbox's StaleWhileRevalidate guarantees the refresh.
  // networkPromise never rejects (it .catch()es to null), so this can't
  // surface an unhandled rejection inside waitUntil.
  if (event) event.waitUntil(networkPromise);
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

// ─── Push notifications ─────────────────────────────────────────────
// Fires when the push service (Apple/Mozilla/Google) wakes the SW
// with a payload the dispatch cron sent. Payload shape mirrors what
// app/api/cron/dispatch-alerts/route.ts emits:
//
//   {
//     title: "Q line — service disruption",
//     body:  "No Q service in Manhattan until 5 AM Sunday",
//     url:   "/?line=Q",   // deep link to open on tap
//     tag:   "alert:<alert_id>"   // dedups stacked banners
//   }
//
// The `tag` is the dedup key the OS uses to coalesce repeated
// notifications for the same alert — even if the dispatch cron
// somehow fires twice (network retry, race), the user sees one
// banner, not two.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  const title = typeof payload.title === "string" ? payload.title : "StandClear";
  const body = typeof payload.body === "string" ? payload.body : "";
  const tag = typeof payload.tag === "string" ? payload.tag : undefined;
  const url = typeof payload.url === "string" ? payload.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      data: { url },
      // Reuse the same tag-update strategy as our in-app alert
      // disclosure — when the MTA updates an existing alert (e.g.
      // service restored), the new banner replaces the old one
      // instead of stacking.
      renotify: false,
    }),
  );
});

// Tap a notification → open or focus a window pointed at the deep
// link the dispatch payload included (line page, station, etc.).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // If a tab on the same origin is already open, navigate it.
      // Saves the rider from re-bootstrapping the whole app shell.
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          if ("navigate" in c) await c.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

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
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE, event));
    return;
  }

  if (isStaticGtfs(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE, event));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
});
