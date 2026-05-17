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

// Parsed once at module load. `null` when no DSN is set OR when the
// DSN is malformed — a bad DSN silently disables remote forwarding
// rather than throwing on every log call (the structured-console
// floor still works). See the Sentry transport section below.
const SENTRY_TARGET = SENTRY_DSN ? parseSentryDsn(SENTRY_DSN) : null;

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

  // Server-side transport to Sentry, when a DSN is configured. Gated
  // on `!IS_CLIENT` so a client error isn't double-counted — it has
  // already reached the server via the /api/log forward above, and
  // the server logger re-emits it through this same path with
  // runtime="server", so one server-side hop covers both origins.
  // Gating here (rather than at the browser) also keeps the client
  // bundle byte-for-byte the same. `info` is filtered out, matching
  // the /api/log forward policy and Sentry's event model (events are
  // for errors/warnings; routine info would just be volume).
  if (!IS_CLIENT && SENTRY_TARGET && record.severity !== "info") {
    sendToSentry(record);
  }
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

// ─── Sentry transport (optional, zero-dependency) ───────────────────
// When NEXT_PUBLIC_SENTRY_DSN is set we POST error/warn records to
// Sentry's envelope ingest endpoint with a plain fetch — no
// @sentry/* SDK, so no third-party runtime dependency and no DSN
// required for the structured-console floor. These helpers live in
// the isomorphic module, so the parse + envelope code (a few hundred
// bytes of pure JS, gzipped) does ride into the client bundle even
// though it never runs there — the `!IS_CLIENT` gate in forward()
// short-circuits before any of it executes browser-side. A separate
// server-only module would trade that for an extra indirection and
// a second source of truth; not worth it at this size. The DSN's
// public key is safe to expose by design (it's how every browser SDK
// authenticates), which is why the gate env var keeps its documented
// NEXT_PUBLIC_ prefix even though we only transmit from the server.
//
// Delivery is best-effort, same contract as the client→server
// forward: a fire-and-forget fetch that never blocks or throws into
// the caller. On a serverless platform that freezes the function the
// instant a fast handler returns (e.g. a 204 from /api/log), a
// forward may not flush — an accepted tradeoff for an error floor
// that must stay non-blocking.

interface SentryTarget {
  ingestUrl: string;
  publicKey: string;
}

// DSN shape: <scheme>://<publicKey>@<host>[:port][/<pathPrefix>]/<projectId>
//   sentry.io     → https://abc@o0.ingest.sentry.io/123
//   self-hosted   → https://abc@sentry.example.com/123
//   with a prefix → https://abc@sentry.example.com/base/path/123
// The project id is always the final path segment; anything before it
// is an ingest path prefix some self-hosted Relay setups require.
function parseSentryDsn(dsn: string): SentryTarget | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    if (!publicKey) return null;
    const segments = u.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!projectId) return null;
    const prefix = segments.length ? `/${segments.join("/")}` : "";
    return {
      publicKey,
      ingestUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`,
    };
  } catch {
    // Malformed DSN — disable the transport, don't throw. parseDsn
    // runs at module load, so a throw here would take the whole
    // logger down on import.
    return null;
  }
}

// Sentry levels are fatal|error|warning|info|debug. Our "warn" maps
// to "warning"; "info" never reaches here (filtered in forward()).
function sentryLevel(severity: Severity): "error" | "warning" {
  return severity === "warn" ? "warning" : "error";
}

// 32 lowercase hex chars, no dashes — the event_id shape Sentry
// expects. randomUUID exists on every runtime we ship to (Node ≥19,
// modern browsers); the loop only guards exotic embeds and doesn't
// need cryptographic strength (this id is a dedup key, not a secret).
function sentryEventId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}

function sendToSentry(record: LogRecord): void {
  if (!SENTRY_TARGET) return;
  try {
    const id = sentryEventId();
    const environment =
      (typeof process !== "undefined" &&
        (process.env.VERCEL_ENV || process.env.NODE_ENV)) ||
      "production";
    // Message-style event: we send the formatted message + level +
    // tags + extra rather than a parsed `exception` with frames.
    // Synthesizing Sentry stack frames from a raw JS stack string is
    // brittle and would be a second source of truth for line numbers;
    // the raw stack rides along in `extra.stack` instead, which keeps
    // grouping honest (by message) and the integration dependency-free.
    const event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: sentryLevel(record.severity),
      logger: PREFIX,
      environment,
      message: { formatted: record.message },
      tags: { runtime: record.runtime },
      extra: {
        ...record.fields,
        ...(record.stack ? { stack: record.stack } : {}),
      },
    };
    // Envelope = newline-delimited JSON: envelope header, item
    // header, item payload. The DSN public key authenticates via the
    // query string (no custom request header → no CORS preflight if
    // this ever moves client-side, and self-hosted Relay accepts it).
    const body = `${JSON.stringify({
      event_id: id,
      sent_at: new Date().toISOString(),
    })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
    const url = `${SENTRY_TARGET.ingestUrl}?sentry_key=${SENTRY_TARGET.publicKey}&sentry_version=7`;
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      keepalive: true,
    }).catch(() => {
      // A failed error-report POST can't itself be error-reported —
      // that recurses. Swallow; the console.* line already landed.
    });
  } catch {
    // Telemetry must never throw into the code it's observing.
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
