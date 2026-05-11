// ─── GET /api/notifications/stats ───────────────────────────────────
// Operator-facing introspection endpoint, gated by the same
// CRON_SECRET as the cron routes. Returns a JSON summary the user
// can curl from a terminal to see if the push pipeline is healthy:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://standclear.vercel.app/api/notifications/stats
//
// Stats are computed from the raw push_subscriptions +
// alert_dispatch_log tables, so they reflect real state — no
// counter cache to drift out of sync.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { captureException } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatsResponse {
  /** Active subscriptions (unsubscribed_at IS NULL). The headline
   *  number for "how many riders are getting pushes". */
  active: number;
  /** Soft-deleted rows waiting on the 30-day cleanup window. */
  pendingPurge: number;
  /** Push deliveries dispatched in the last 24 hours, across all
   *  subscriptions + alerts. Sums to "how loud were we yesterday." */
  dispatchedLast24h: number;
  /** Same, over the last 7 days. */
  dispatchedLast7d: number;
  /** Snapshot timestamp so callers can tell if they're seeing a
   *  cached response from an upstream proxy. */
  generatedAt: number;
}

function isAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sql = getDb();
    // Single batched query via UNION ALL would be one round-trip, but
    // four separate counts read clearer and the latency cost is
    // marginal (Neon HTTP is fast). Stays this way unless the route
    // becomes hot enough to need a perf pass.
    const [active] = (await sql`
      SELECT COUNT(*)::int AS n
      FROM push_subscriptions
      WHERE unsubscribed_at IS NULL
    `) as Array<{ n: number }>;
    const [pending] = (await sql`
      SELECT COUNT(*)::int AS n
      FROM push_subscriptions
      WHERE unsubscribed_at IS NOT NULL
    `) as Array<{ n: number }>;
    const [day] = (await sql`
      SELECT COUNT(*)::int AS n
      FROM alert_dispatch_log
      WHERE dispatched_at > NOW() - INTERVAL '24 hours'
    `) as Array<{ n: number }>;
    const [week] = (await sql`
      SELECT COUNT(*)::int AS n
      FROM alert_dispatch_log
      WHERE dispatched_at > NOW() - INTERVAL '7 days'
    `) as Array<{ n: number }>;

    const body: StatsResponse = {
      active: active.n,
      pendingPurge: pending.n,
      dispatchedLast24h: day.n,
      dispatchedLast7d: week.n,
      generatedAt: Date.now(),
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    captureException(err, { source: "notifications/stats" });
    return NextResponse.json({ error: "Stats query failed" }, { status: 500 });
  }
}
