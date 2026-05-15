// ─── Cron / operator endpoint authorization ─────────────────────────
// Three internal routes share the same bearer-token gate today —
// `/api/cron/dispatch-alerts`, `/api/cron/cleanup-subscriptions`, and
// `/api/notifications/stats`. The first two are hit on schedule by
// GitHub Actions; the third is an operator introspection surface
// that a maintainer hits manually with `curl -H "Authorization:
// Bearer $CRON_SECRET" ...`.
//
// Lifted out of three inline copies so the auth contract — and
// specifically the "no secret configured = misconfigured deploy,
// refuse to run" branch — has one source of truth + one test. A
// previous drift between the dispatch-alerts and cleanup-
// subscriptions copies (one named the local var `got`, the other
// inlined the header read) is the kind of small variation that
// makes a future security review have to read both versions to
// confirm they're equivalent; this collapses that to a single read.
//
// Bearer token: matches the convention Vercel Cron uses when wired
// directly (it sets `Authorization: Bearer <CRON_SECRET>` on every
// scheduled invocation). We're on GitHub Actions instead — the
// `Hobby` plan only allows daily Vercel Cron schedules — but we
// keep the same header shape so a future migration back to
// vercel.json is a config flip with no route changes.

/**
 * Check that the inbound request carries the CRON_SECRET bearer token.
 *
 *   - Missing CRON_SECRET env var → returns false. A deploy without
 *     the secret is misconfigured and should refuse to run rather
 *     than silently fan out push notifications on every public hit.
 *   - Missing or non-bearer Authorization header → false.
 *   - Header literal-matches `Bearer <CRON_SECRET>` → true.
 *
 * Comparison is a plain `===` rather than a timing-safe compare:
 * the secret is delivered over HTTPS and the route returns the same
 * "Unauthorized" body in either branch, so a timing-attack signal
 * isn't practically extractable. If a future deploy moves the
 * routes onto a higher-throughput surface where a side channel
 * becomes plausible, swap this for `crypto.timingSafeEqual` on the
 * Uint8Array forms of the strings.
 */
export function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}
