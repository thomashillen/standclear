import { type NextRequest, NextResponse } from "next/server";
import { logEvent, captureWarning } from "@/lib/observability";
import { isRateLimited, callerKey } from "@/lib/rateLimit";

// ─── Geocode proxy ───────────────────────────────────────────────────
// Wraps Mapbox Search Box suggest + retrieve so the private MAPBOX_TOKEN
// never leaves the server. The client's geocoding.ts drives session-token
// rotation and result caching; this route just injects the credential and
// forwards the upstream response verbatim.
//
// Why not NEXT_PUBLIC_MAPBOX_TOKEN here? The client token must be public
// for GL JS (tile rendering), but geocoding calls carry the full plaintext
// query — "550 madison ave" is PII-adjacent. Keeping those requests
// behind the server halves the blast radius of a leaked token.
//
// Rate limiting: 60 suggest+retrieve requests per minute per IP. A real
// user typing quickly in the search box triggers ~1 suggest per keystroke
// (~10–20/min); 60/min is generous. Sustained abuse above this rate is
// rejected with 429 before the Mapbox call is made.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAPBOX_SEARCH_BASE = "https://api.mapbox.com/search/searchbox/v1";

// 60 requests/min per IP — generous for typeahead, blocks bots.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Forward a fixed allow-list of search-box parameters from the client
// request. Unknown params are silently dropped so a malicious client
// can't inject stray Mapbox options.
const SUGGEST_FORWARD = [
  "session_token",
  "limit",
  "bbox",
  "types",
  "country",
  "proximity",
  "language",
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = callerKey(req.headers);
  if (isRateLimited(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    captureWarning("geocode proxy rate limited", { ip });
    return NextResponse.json(
      { suggestions: [], features: [] },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // Prefer the dedicated server-only MAPBOX_TOKEN — that's the
  // production-correct setup and keeps PII-adjacent address queries
  // out of any leak window for the public token. Fall back to
  // NEXT_PUBLIC_MAPBOX_TOKEN as a backstop so a deploy that has only
  // the public token configured still has working address search
  // instead of silently returning a 503 (the failure mode that
  // shipped to standclear.app and broke /550 madison/ for users).
  const token =
    process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    captureWarning(
      "Neither MAPBOX_TOKEN nor NEXT_PUBLIC_MAPBOX_TOKEN set — geocode proxy unavailable",
    );
    return NextResponse.json({ suggestions: [], features: [] }, { status: 503 });
  }
  if (!process.env.MAPBOX_TOKEN) {
    // Rate-limited inside captureWarning is fine — every request that
    // arrives here would log identically, but logEvent dedupes only
    // on identity, so once per cold start is enough to flag the
    // misconfig in operator logs without flooding.
    captureWarning(
      "MAPBOX_TOKEN unset; geocode proxy fell back to NEXT_PUBLIC_MAPBOX_TOKEN. Set MAPBOX_TOKEN to keep PII-adjacent queries off the public token.",
    );
  }

  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (action === "suggest") {
    const q = searchParams.get("q") ?? "";
    if (q.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    const url = new URL(`${MAPBOX_SEARCH_BASE}/suggest`);
    url.searchParams.set("q", q);
    url.searchParams.set("access_token", token);
    for (const key of SUGGEST_FORWARD) {
      const val = searchParams.get(key);
      if (val) url.searchParams.set(key, val);
    }

    const upstream = await fetch(url.toString(), { signal: req.signal });
    if (!upstream.ok) {
      logEvent("warn", "Mapbox suggest upstream error", { status: upstream.status });
      return NextResponse.json({ suggestions: [] }, { status: upstream.status });
    }
    const data: unknown = await upstream.json();
    return NextResponse.json(data);
  }

  if (action === "retrieve") {
    const mapboxId = searchParams.get("mapbox_id");
    if (!mapboxId) {
      return NextResponse.json({ error: "missing mapbox_id" }, { status: 400 });
    }

    const url = new URL(
      `${MAPBOX_SEARCH_BASE}/retrieve/${encodeURIComponent(mapboxId)}`,
    );
    url.searchParams.set("access_token", token);
    const sessionToken = searchParams.get("session_token");
    if (sessionToken) url.searchParams.set("session_token", sessionToken);

    const upstream = await fetch(url.toString(), { signal: req.signal });
    if (!upstream.ok) {
      logEvent("warn", "Mapbox retrieve upstream error", { status: upstream.status });
      return NextResponse.json({ features: [] }, { status: upstream.status });
    }
    const data: unknown = await upstream.json();
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
