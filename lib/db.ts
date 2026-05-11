// ─── Database client ────────────────────────────────────────────────
// Thin wrapper around Neon's serverless HTTP driver. Used by every
// /api route that touches Postgres (push subscriptions, dispatch
// log). The HTTP transport avoids the connection-pool exhaustion
// pattern that bites long-running pg clients inside Vercel functions
// — each invocation borrows a connection just for its lifetime.
//
// Module-scope `sql` is lazy: we don't crash at import time on a
// build environment that doesn't have DATABASE_URL (the same module
// gets pulled into bundle analysis); we crash at first use, which
// gives clearer error tracebacks.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function getDb(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add Neon Postgres via Vercel " +
        "Marketplace and re-pull env: `npx vercel env pull .env.local`.",
    );
  }
  cached = neon(url);
  return cached;
}
