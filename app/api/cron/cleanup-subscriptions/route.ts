// ─── /api/cron/cleanup-subscriptions ────────────────────────────────
// GitHub Actions hits this once a day (configured in
// .github/workflows/cleanup-subscriptions.yml) to garbage-collect
// stale rows in push_subscriptions + alert_dispatch_log. Thin glue
// around lib/pushCleanup.ts.

import { NextResponse } from "next/server";
import { cleanupSubscriptions } from "@/lib/pushCleanup";
import { captureException } from "@/lib/observability";
import { isCronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cleanup typically finishes in <1s but a long-running deploy with
// thousands of churned subs could take a few seconds. 30s is the
// Hobby ceiling and leaves plenty of headroom.
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await cleanupSubscriptions();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    captureException(err, { source: "cron/cleanup-subscriptions" });
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 },
    );
  }
}
