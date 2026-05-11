// ─── POST /api/notifications/unsubscribe ────────────────────────────
// Soft-deletes the rider's push subscription by setting
// unsubscribed_at. The row stays so a future cleanup job can collect
// metrics on churn, and so the same anonymousId opting back in later
// updates the existing row rather than fragmenting history.
//
// The client should also call pushManager.unsubscribe() on its end
// — this route only invalidates the server-side record.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { captureException } from "@/lib/observability";

interface UnsubscribePayload {
  anonymousId?: unknown;
}

export async function POST(req: Request) {
  let body: UnsubscribePayload;
  try {
    body = (await req.json()) as UnsubscribePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const anonymousId = body.anonymousId;
  if (typeof anonymousId !== "string" || anonymousId.length === 0) {
    return NextResponse.json({ error: "Missing anonymousId" }, { status: 400 });
  }
  if (anonymousId.length > 64) {
    return NextResponse.json({ error: "anonymousId too long" }, { status: 400 });
  }

  try {
    const sql = getDb();
    // Idempotent — a re-call on an already-unsubscribed row is a no-op.
    await sql`
      UPDATE push_subscriptions
      SET unsubscribed_at = NOW()
      WHERE anonymous_id = ${anonymousId} AND unsubscribed_at IS NULL
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, { source: "notifications/unsubscribe" });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
