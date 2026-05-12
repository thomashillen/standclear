import { type NextRequest, NextResponse } from "next/server";
import { logEvent, captureWarning } from "@/lib/observability";
import { isRateLimited, callerKey } from "@/lib/rateLimit";

// ─── Client log forwarder ───────────────────────────────────────────
// Receives best-effort error/warn records from the client-side
// observability shim (lib/observability.ts) and re-emits them through
// the server-side logEvent so they land in the same sink ops actually
// reads (Vercel function logs / whatever vendor `forward` is pointed
// at). Without this route, an error caught by the client error
// boundary writes to the rider's devtools console and nothing else.
//
// Hardening choices:
//   • POST only; payload is JSON with strict schema.
//   • Accept only {"error","warn"} — info-level chatter would balloon
//     server log volume without operational value.
//   • Strings are truncated and URL query strings are scrubbed before
//     re-emission (defense-in-depth; the client shim already does this
//     for caller-provided fields, but a malicious payload could ignore
//     the shim entirely).
//   • Rate-limited per IP. A run-away client (e.g. a render loop that
//     captures the same exception every frame) hits the limit and
//     stops costing us function invocations.
//   • Caller IP is used **in-memory only** for the rate-limiter's
//     sliding window — it is never written into the persisted log
//     line. The Map in `lib/rateLimit.ts` resets on cold start and
//     never reaches the operator's log sink, so an IP-keyed abuse
//     defense doesn't compromise the /privacy promise that no
//     identifier tied to a rider is persisted on our servers.
//   • Body size capped (~4 KB) so a single request can't fill a log
//     line with a multi-megabyte stack.
//   • Always answers 204 on accepted writes. We never expose whether a
//     payload was rate-limited vs. malformed vs. swallowed — the
//     client treats this endpoint as fire-and-forget regardless.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 30 records/min per IP. A real client surfaces single-digit errors
// per session; even a noisy session shouldn't outpace this. Keep this
// well under the geocode proxy's limit since errors are unbounded
// (clients can synthesize them) and we want to be cheap to defend.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const MAX_BODY_BYTES = 4_096;
const MAX_STRING_LEN = 1_000;
const MAX_STACK_LEN = 4_000;
const MAX_FIELDS = 16;

type ClientSeverity = "error" | "warn";

interface ClientLogPayload {
  severity: ClientSeverity;
  message: string;
  fields?: Record<string, unknown>;
  stack?: string;
  // Browser-provided context. Free-form strings; same sanitize pass
  // applies. The shim populates these so a server-side reader can
  // group errors by URL / UA without trusting the client's runtime
  // label.
  href?: string;
  userAgent?: string;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Strip query strings from URL-shaped values to avoid persisting any
// PII-adjacent payload (typed addresses, search queries) in server
// logs. Mirrors the client shim's sanitize() — doing it here too is
// defense-in-depth so a forged payload still gets scrubbed.
function sanitizeString(value: string): string {
  const truncated = truncate(value, MAX_STRING_LEN);
  if (!/^https?:\/\//.test(truncated)) return truncated;
  try {
    const u = new URL(truncated);
    if (u.searchParams.size === 0) return truncated;
    return `${u.origin}${u.pathname}?[redacted]`;
  } catch {
    return truncated;
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // Objects / arrays come through as JSON-stringified text so a
  // malicious nested structure can't blow up the log line. Truncate
  // on the way out.
  try {
    return truncate(JSON.stringify(value), MAX_STRING_LEN);
  } catch {
    return "[unserializable]";
  }
}

function sanitizeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const entries = Object.entries(fields).slice(0, MAX_FIELDS);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    // Keys are also bounded — a hostile client could otherwise cram a
    // 50 KB key into a 4 KB body via wire compression artifacts.
    out[truncate(k, 64)] = sanitizeValue(v);
  }
  return out;
}

function isClientSeverity(value: unknown): value is ClientSeverity {
  return value === "error" || value === "warn";
}

function parsePayload(raw: unknown): ClientLogPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isClientSeverity(obj.severity)) return null;
  if (typeof obj.message !== "string" || obj.message.length === 0) return null;
  const fields =
    obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)
      ? (obj.fields as Record<string, unknown>)
      : undefined;
  return {
    severity: obj.severity,
    message: obj.message,
    fields,
    stack: typeof obj.stack === "string" ? obj.stack : undefined,
    href: typeof obj.href === "string" ? obj.href : undefined,
    userAgent: typeof obj.userAgent === "string" ? obj.userAgent : undefined,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = callerKey(req.headers);
  if (isRateLimited(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    // Don't re-log the rate-limit hit — that's exactly the loop this
    // route is defending against.
    return new NextResponse(null, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 413 });
    }
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    // Malformed JSON — silently drop. The client treats /api/log as
    // fire-and-forget, so a 400 here would just cause a console error
    // in their devtools and no operator value.
    return new NextResponse(null, { status: 204 });
  }

  const payload = parsePayload(body);
  if (!payload) {
    return new NextResponse(null, { status: 204 });
  }

  const message = sanitizeString(payload.message);
  // `ip` stays scoped to this function — it drove the rate-limit
  // decision above and is dropped on the way out. We deliberately do
  // NOT include it in the persisted record: the rate-limiter's
  // in-memory window already handles abuse, and the /privacy page
  // promises no rider-identifying data is stored on our servers.
  void ip;
  const fields: Record<string, unknown> = {
    ...sanitizeFields(payload.fields),
    source: "client-forward",
  };
  if (payload.href) fields.href = sanitizeString(payload.href);
  if (payload.userAgent) {
    fields.userAgent = truncate(payload.userAgent, 200);
  }
  if (payload.stack) {
    fields.stack = truncate(payload.stack, MAX_STACK_LEN);
  }

  // Re-emit through the same path server code uses so the operator
  // sees one consistent log shape. logEvent will tag runtime="server"
  // here — that's correct: this is a server log line ABOUT a client
  // event, and the source field carries the original origin.
  if (payload.severity === "error") {
    logEvent("error", message, fields);
  } else {
    captureWarning(message, fields);
  }

  return new NextResponse(null, { status: 204 });
}
