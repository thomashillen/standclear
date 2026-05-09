// ─── Observability shim ──────────────────────────────────────────────
// Structured client + server logging with a single, vendor-neutral
// surface. `logEvent` and `captureException` are called from API
// routes, hooks, and the error boundary. The default implementation
// writes structured records to console.* AND — when running in a
// browser at error/warn severity — fire-and-forget POSTs them to
// /api/log so the operator's server log sink (Vercel, etc.) actually
// captures client-side errors. Bring-your-own external transport
// (Sentry, Datadog, Logtail, Axiom, posthog) by extending `forward()`
// below or by reading server logs.
//
// Design notes:
//   • No external runtime dependency, so this ships no new bundle
//     weight and no DSN is required for the floor.
//   • Records carry `runtime` ("client" | "server") and `ts` so logs
//     are useful even when shipped through a single sink.
//   • PII discipline: callers should pass primitives + IDs in
//     `fields`; never an entire request URL with embedded address
//     queries. We sanitize obvious cases (mapbox URLs → host).
//   • Client→server forward is opt-out via NEXT_PUBLIC_LOG_FORWARD =
//     "off". Useful for local development or when an operator is
//     wiring a different transport and doesn't want duplicates.

export type Severity = "info" | "warn" | "error";

export interface Fields {
  [key: string]: unknown;
}

const PREFIX = "[standclear]";
const IS_CLIENT = typeof window !== "undefined";

const SENTRY_DSN =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SENTRY_DSN ?? null
    : null;

// Operator opt-out. Most deploys want the forward (it's how a
// client-side error becomes ops-visible at all), so the default is
// on. Setting NEXT_PUBLIC_LOG_FORWARD="off" disables only the network
// hop — console.* output is unaffected.
const LOG_FORWARD_ENABLED =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_LOG_FORWARD !== "off"
    : true;

// Endpoint the client posts to. Same-origin so no CORS dance and the
// rider's session cookies are preserved if the route ever evolves to
// authenticate. Static so the path can't drift between client + server.
const LOG_FORWARD_URL = "/api/log";

// Module-scope budget. A renderer that loops on an exception would
// otherwise post once per render — the route also rate-limits, but
// stopping the requests at the source keeps devtools quiet and saves
// the rider's battery / radio. Per-page-load, 30 forwards is plenty
// to surface a real cluster of failures while shutting off a runaway.
const FORWARD_BUDGET = 30;
let forwardsSent = 0;
let forwardDisabled = false;

// Detected at module load time. Off by default under vitest so unit
// tests that mock `globalThis.fetch` don't double-count this forward
// hop. Tests that want to exercise the forward path explicitly opt
// in via `__setForwardEnabledForTests(true)` below.
const TEST_MODE =
  typeof process !== "undefined" && process.env.NODE_ENV === "test";
let forwardTestOverride: boolean | null = null;

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function safeStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

// Strip query strings from URLs to avoid logging address typeahead
// payloads. Caller-provided fields are passed through otherwise.
function sanitize(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!/^https?:\/\//.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.searchParams.size === 0) return value;
    return `${u.origin}${u.pathname}?[redacted]`;
  } catch {
    return value;
  }
}

function sanitizeFields(fields?: Fields): Fields | undefined {
  if (!fields) return undefined;
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = sanitize(v);
  return out;
}

interface LogRecord {
  severity: Severity;
  message: string;
  ts: string;
  runtime: "client" | "server";
  fields?: Fields;
  stack?: string;
}

function emit(record: LogRecord): void {
  const tag = `${PREFIX} ${record.severity.toUpperCase()} ${record.message}`;
  const detail = { ...record.fields, ts: record.ts, runtime: record.runtime };
  if (record.severity === "error") {
    if (record.stack) console.error(tag, detail, record.stack);
    else console.error(tag, detail);
  } else if (record.severity === "warn") {
    console.warn(tag, detail);
  } else {
    console.info(tag, detail);
  }
  forward(record);
}

// Vendor hook — wire Sentry/Datadog/Logtail here. Kept synchronous
// (fire-and-forget for client) so the call site never has to await.
function forward(record: LogRecord): void {
  // Client → server forward of error/warn records. The server route
  // (/api/log) re-emits through this same module so server logs are
  // the one sink an operator has to read. Skip on server (we're
  // already in the right runtime), skip info (volume not worth it),
  // and skip any future case where the rider has explicitly opted
  // out of the forward.
  const testOverride = forwardTestOverride;
  const enabledByDefault = !TEST_MODE && LOG_FORWARD_ENABLED;
  const shouldForward =
    testOverride === null ? enabledByDefault : testOverride;
  if (
    IS_CLIENT &&
    shouldForward &&
    record.runtime === "client" &&
    record.severity !== "info" &&
    !forwardDisabled
  ) {
    if (forwardsSent >= FORWARD_BUDGET) {
      forwardDisabled = true;
    } else {
      forwardsSent += 1;
      sendToServer(record);
    }
  }

  if (!SENTRY_DSN) return;
  // Placeholder: when the Sentry SDK is added, call:
  //   import * as Sentry from "@sentry/nextjs";
  //   Sentry.captureMessage(record.message, { level: record.severity, extra: record.fields });
  // We intentionally don't pull in @sentry/nextjs by default to keep
  // the bundle weight at zero until a deployer opts in.
  void record;
}

// Fire-and-forget POST to /api/log. Uses sendBeacon when available so
// records survive the page-unload race a fetch() would lose; falls
// back to fetch with keepalive otherwise. Failures are swallowed —
// the caller is logging a problem, so a follow-up problem here would
// just compound noise.
function sendToServer(record: LogRecord): void {
  try {
    const body = JSON.stringify({
      severity: record.severity,
      message: record.message,
      fields: record.fields,
      stack: record.stack,
      href: typeof location !== "undefined" ? location.href : undefined,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    });
    const beacon =
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon.bind(navigator)
        : null;
    if (beacon) {
      const blob = new Blob([body], { type: "application/json" });
      // sendBeacon returns false if the user agent refused (e.g. body
      // too large); in that case fall through to fetch so the record
      // still has a chance to land.
      if (beacon(LOG_FORWARD_URL, blob)) return;
    }
    void fetch(LOG_FORWARD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Network noise is normal during navigation / offline; the
      // server can't help with a forward it never received.
    });
  } catch {
    // If we can't even build the payload, give up silently. The
    // console.* call already happened above so the rider's devtools
    // still have the record.
  }
}

// Test seam: lets the route + observability tests reset the
// per-page-load budget without reaching into module internals. Not
// part of the public API.
export function __resetForwardBudgetForTests(): void {
  forwardsSent = 0;
  forwardDisabled = false;
}

// Test seam: explicitly enable / disable the client→server forward
// during a vitest run. The default in test mode is off so unrelated
// tests don't accidentally count the forward fetch; observability's
// own tests opt in. Pass null to restore the default.
export function __setForwardEnabledForTests(value: boolean | null): void {
  forwardTestOverride = value;
}

export function logEvent(
  severity: Severity,
  message: string,
  fields?: Fields,
): void {
  emit({
    severity,
    message,
    ts: new Date().toISOString(),
    runtime: IS_CLIENT ? "client" : "server",
    fields: sanitizeFields(fields),
  });
}

export function captureException(err: unknown, fields?: Fields): void {
  emit({
    severity: "error",
    message: safeMessage(err),
    ts: new Date().toISOString(),
    runtime: IS_CLIENT ? "client" : "server",
    fields: sanitizeFields(fields),
    stack: safeStack(err),
  });
}

// Convenience for non-fatal warnings — a shorter spelling at call
// sites that want to flag a soft failure (rate limit, partial feed
// outage) without the heavier "exception" verb.
export function captureWarning(message: string, fields?: Fields): void {
  logEvent("warn", message, fields);
}
