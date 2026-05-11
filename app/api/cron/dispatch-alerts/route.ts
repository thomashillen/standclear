// ─── /api/cron/dispatch-alerts ──────────────────────────────────────
// Vercel Cron entry point. Configured in vercel.json to fire every
// 2 minutes. Verifies the Vercel-supplied bearer token (CRON_SECRET)
// before invoking the dispatch path so a public hit can't trigger
// fan-outs.
//
// The route is the thin glue; all the dispatch logic lives in
// lib/pushDispatch.ts so it's unit-testable without HTTP.

import { NextResponse } from "next/server";
import { dispatchAlerts } from "@/lib/pushDispatch";
import { captureException } from "@/lib/observability";

export const runtime = "nodejs";
// Cron invocations are dynamic by definition — fresh MTA fetch every
// tick. Tell Next not to attempt static rendering.
export const dynamic = "force-dynamic";
// Increase the function timeout — fetching the MTA feed + fanning
// out per-subscription pushes can take ~10–20s on a busy alert
// burst. 30s leaves headroom on Hobby (60s ceiling).
export const maxDuration = 30;

function isAuthorized(req: Request): boolean {
  // Vercel Cron sets `Authorization: Bearer <CRON_SECRET>` on every
  // scheduled invocation. Locally / for manual testing, the same
  // header works when sent explicitly.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // No secret configured = misconfigured deploy. Refuse to run
    // rather than silently fanning out on every public hit.
    return false;
  }
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
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
