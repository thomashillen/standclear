import { type NextRequest, NextResponse } from "next/server";
import { logEvent, captureWarning } from "@/lib/observability";
import { isRateLimited, callerKey } from "@/lib/rateLimit";

// ─── Walking-directions proxy ────────────────────────────────────────
// Wraps Mapbox Directions API (walking profile) so the private
// MAPBOX_TOKEN never ships to the browser. The client's
// walkingDirections.ts handles the in-memory cache and the short-walk
// synthetic-route shortcut; this route only handles the network call.
//
// Coordinate pairs are passed as "lng,lat" strings — same format the
// Mapbox Directions URL uses — so the client can forward them directly.
//
// Rate limiting: 20 requests per minute per IP. A real user plans a
// route once per trip leg; the client caches results so the same pair
// only calls this endpoint once per session. 20/min covers pathological
// rapid replanning while blocking automated scanning.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 20 requests/min per IP — walks are cached client-side, so 20 is
// far above any realistic human usage rate.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Module-scope latch — see /api/geocode for the rationale. The
// public-token fallback warning must not fire per-request.
let fallbackWarningLogged = false;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = callerKey(req.headers);
  if (isRateLimited(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    captureWarning("walk proxy rate limited", { ip });
    return NextResponse.json(null, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  // Prefer the dedicated server-only MAPBOX_TOKEN; fall back to
  // NEXT_PUBLIC_MAPBOX_TOKEN if it isn't set. See the matching
  // comment in /api/geocode for the deploy-mode rationale.
  const token =
    process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    captureWarning(
      "Neither MAPBOX_TOKEN nor NEXT_PUBLIC_MAPBOX_TOKEN set — walk proxy unavailable",
    );
    // null signals "no route" to the client; it falls back to the
    // synthetic straight-line path rather than showing an error.
    return NextResponse.json(null, { status: 503 });
  }
  if (!process.env.MAPBOX_TOKEN && !fallbackWarningLogged) {
    fallbackWarningLogged = true;
    captureWarning(
      "MAPBOX_TOKEN unset; walk proxy fell back to NEXT_PUBLIC_MAPBOX_TOKEN.",
    );
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "missing from or to" }, { status: 400 });
  }

  // Basic coordinate sanity: each param must be "number,number".
  // Rejects path traversal or injection attempts before they hit Mapbox.
  const COORD_RE = /^-?\d+\.?\d*,-?\d+\.?\d*$/;
  if (!COORD_RE.test(from) || !COORD_RE.test(to)) {
    return NextResponse.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/walking/${from};${to}`,
  );
  url.searchParams.set("access_token", token);
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "full");
  url.searchParams.set("steps", "true");
  url.searchParams.set("language", "en");

  const upstream = await fetch(url.toString(), { signal: req.signal });
  if (!upstream.ok) {
    logEvent("warn", "Mapbox directions upstream error", { status: upstream.status });
    // Preserve the status so the client's cache-drop logic on non-2xx fires.
    return NextResponse.json(null, { status: upstream.status });
  }

  const data: unknown = await upstream.json();
  return NextResponse.json(data);
}
