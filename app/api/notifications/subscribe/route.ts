// ─── POST /api/notifications/subscribe ──────────────────────────────
// Upsert the rider's push subscription. Called once when they opt in,
// and again on subsequent visits if the browser rotates the push
// endpoint (which Chrome does on profile sync, Firefox on extended
// idle, Safari on user-clears-website-data).
//
// Payload shape mirrors PushSubscription.toJSON() so the client can
// just stringify the subscription and add the anonymous id + lines:
//
//   {
//     "anonymousId": "uuid-v4",
//     "endpoint":    "https://web.push.apple.com/QAB...",
//     "keys": { "p256dh": "BLc...", "auth": "k7..." },
//     "lines":       ["Q", "N", "R"]   // routeIds rider opted in for
//   }
//
// The dispatch path queries by line, so the array is what matters.
// Anonymous ID is the unique upsert key so the same device updating
// its line opt-ins doesn't create duplicate rows.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { captureException } from "@/lib/observability";

interface SubscribePayload {
  anonymousId?: unknown;
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  lines?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseLines(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return null;
    // MTA routeIds are short uppercase strings. Cap length and
    // reject obvious garbage so we don't store user-supplied data
    // in an unbounded TEXT[] column.
    if (x.length === 0 || x.length > 4) return null;
    out.push(x);
  }
  return out;
}

export async function POST(req: Request) {
  let body: SubscribePayload;
  try {
    body = (await req.json()) as SubscribePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const anonymousId = body.anonymousId;
  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  const lines = parseLines(body.lines);

  if (
    !isNonEmptyString(anonymousId) ||
    !isNonEmptyString(endpoint) ||
    !isNonEmptyString(p256dh) ||
    !isNonEmptyString(auth) ||
    lines === null
  ) {
    return NextResponse.json(
      { error: "Missing or malformed fields" },
      { status: 400 },
    );
  }

  // Defense-in-depth length caps. Real push endpoints are typically
  // 200-400 chars; cap at 2048 so a misbehaving client can't fill the
  // table with megabyte URLs.
  if (
    anonymousId.length > 64 ||
    endpoint.length > 2048 ||
    p256dh.length > 256 ||
    auth.length > 64 ||
    lines.length > 32
  ) {
    return NextResponse.json({ error: "Field too long" }, { status: 400 });
  }

  try {
    const sql = getDb();
    await sql`
      INSERT INTO push_subscriptions
        (anonymous_id, endpoint, p256dh, auth, subscribed_lines, last_seen_at, unsubscribed_at)
      VALUES
        (${anonymousId}, ${endpoint}, ${p256dh}, ${auth}, ${lines}, NOW(), NULL)
      ON CONFLICT (anonymous_id) DO UPDATE SET
        endpoint = EXCLUDED.endpoint,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        subscribed_lines = EXCLUDED.subscribed_lines,
        last_seen_at = NOW(),
        unsubscribed_at = NULL
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, { source: "notifications/subscribe" });
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
