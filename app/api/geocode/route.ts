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

// Module-scope latch so the fallback-misconfig warning fires at most
// once per Vercel function instance (~ once per cold start). Without
// this, a deploy running on the public-token fallback would emit a
// per-request warning under real traffic — flooding the operator's
// log sink and inflating cost. captureWarning itself doesn't dedupe.
let fallbackWarningLogged = false;

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
  if (!process.env.MAPBOX_TOKEN && !fallbackWarningLogged) {
    fallbackWarningLogged = true;
    captureWarning(
      "MAPBOX_TOKEN unset; geocode proxy fell back to NEXT_PUBLIC_MAPBOX_TOKEN. Set MAPBOX_TOKEN to keep PII-adjacent queries off the public token.",
    );
  }

  const { searchParams } = req.nextUrl;
  const action = searchParams.get("action");

  if (action === "suggest") {
    // Mirror the client's `query.trim()` (lib/geocoding.ts): the
    // "minimum searchable query" contract is *trimmed* length ≥ 2.
    // Our own UI already trims before calling, but a direct/abusive
    // API hit with a whitespace-only or -padded `q` would otherwise
    // clear this gate and burn a billed Mapbox suggest call — and a
    // trailing space only degrades the upstream prefix ranking.
    const q = (searchParams.get("q") ?? "").trim();
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

    return await proxyMapbox(url.toString(), { suggestions: [] }, "suggest", req);
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

    return await proxyMapbox(url.toString(), { features: [] }, "retrieve", req);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

// Forwards a Mapbox upstream call and normalizes the failure modes the
// raw `await fetch` chain would otherwise let escape:
//   • `AbortError` from `req.signal` — fires when the client cancels
//     mid-flight (typeahead keystroke aborting the previous suggest).
//     Returns 499 with the empty shape; no log entry, the client has
//     already moved on and noisy operator logs would obscure real
//     upstream incidents.
//   • Network rejection — DNS, TCP, TLS, or upstream-timeout. Returns
//     502 with the empty shape; logs the cause via captureWarning so
//     the operator sees clustered failures.
//   • Malformed JSON body — Mapbox 5xx pages return HTML, and a
//     mid-deploy edge can drop a partial body. Returns 502 with the
//     empty shape; logs.
//   • Upstream non-2xx — preserved status (so the client's typeahead
//     cache-drop logic still fires on 401 / 429), empty body.
async function proxyMapbox(
  upstreamUrl: string,
  emptyShape: Record<string, unknown>,
  label: "suggest" | "retrieve",
  req: NextRequest,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { signal: req.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(emptyShape, { status: 499 });
    }
    captureWarning(`Mapbox ${label} fetch failed`, {
      detail: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(emptyShape, { status: 502 });
  }
  if (!upstream.ok) {
    logEvent("warn", `Mapbox ${label} upstream error`, {
      status: upstream.status,
    });
    return NextResponse.json(emptyShape, { status: upstream.status });
  }
  try {
    const data: unknown = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    captureWarning(`Mapbox ${label} malformed JSON`, {
      detail: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(emptyShape, { status: 502 });
  }
}
