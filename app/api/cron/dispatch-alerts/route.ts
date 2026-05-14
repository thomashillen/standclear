// ─── /api/cron/dispatch-alerts ──────────────────────────────────────
// GitHub Actions hits this every 5 minutes (configured in
// .github/workflows/dispatch-alerts.yml — Vercel Cron on the Hobby
// plan only allows daily schedules, so the cron lives in Actions
// instead and posts a `Bearer $CRON_SECRET` header to gate the
// route against public traffic).
//
// The route is the thin glue; all the dispatch logic lives in
// lib/pushDispatch.ts so it's unit-testable without HTTP. The bearer
// check itself lives in lib/cronAuth.ts and is shared with the
// cleanup cron + the operator stats endpoint.

import { NextResponse } from "next/server";
import { dispatchAlerts } from "@/lib/pushDispatch";
import { captureException } from "@/lib/observability";
import { isCronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
// Cron invocations are dynamic by definition — fresh MTA fetch every
// tick. Tell Next not to attempt static rendering.
export const dynamic = "force-dynamic";
// Increase the function timeout — fetching the MTA feed + fanning
// out per-subscription pushes can take ~10–20s on a busy alert
// burst. 30s leaves headroom on Hobby (60s ceiling).
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await dispatchAlerts();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    captureException(err, { source: "cron/dispatch-alerts" });
    return NextResponse.json(
      { error: "Dispatch failed" },
      { status: 500 },
    );
  }
}
