// ─── In-process sliding-window rate limiter ──────────────────────────
// Module-scope state survives across requests on the same warm Node
// instance and resets on cold start. Sufficient to deter sustained
// automated abuse against the Mapbox proxy routes; not a substitute
// for edge-level rate limiting on a high-traffic public API.
//
// Design notes:
//   • Keyed by an opaque caller string (typically the first IP in
//     x-forwarded-for, or "anon" when the header is absent).
//   • Sliding window: we keep the raw timestamps of the last N accepted
//     requests rather than a counter, so the window never "resets" all
//     at once and creates a double-rate burst at the boundary.
//   • Blocked requests are not recorded in the window — the rate stays
//     pegged at the limit until the oldest accepted request ages out.
//   • Map is capped at MAX_ENTRIES; the oldest 10% is evicted when the
//     cap is hit, preventing unbounded growth under sustained scanning.

const MAX_ENTRIES = 5_000;

// IP → sorted array of accepted request timestamps (ms).
const windows = new Map<string, number[]>();

function evictOldest(): void {
  const evictCount = Math.ceil(windows.size * 0.1);
  let i = 0;
  for (const key of windows.keys()) {
    if (i++ >= evictCount) break;
    windows.delete(key);
  }
}

/**
 * Returns `true` when `key` has exceeded `maxRequests` within the last
 * `windowMs` milliseconds and the request should be rejected with 429.
 *
 * Side-effect on accept: records the current timestamp in the window.
 */
export function isRateLimited(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const prior = windows.get(key) ?? [];
  const recent = prior.filter((t) => t > cutoff);

  if (recent.length >= maxRequests) {
    // Don't record blocked requests — keep the window exactly at the
    // limit so the caller must wait for the oldest accepted timestamp
    // to expire before being admitted again.
    windows.set(key, recent);
    return true;
  }

  recent.push(now);
  if (!windows.has(key) && windows.size >= MAX_ENTRIES) evictOldest();
  windows.set(key, recent);
  return false;
}

/** Extract a best-effort caller key from an incoming request's headers. */
export function callerKey(headers: Headers): string {
  // x-forwarded-for may be a comma-separated chain; take the leftmost
  // (originating) address. On Vercel the chain is trustworthy because
  // Vercel's edge injects it and strips client-supplied headers.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "anon";
}
