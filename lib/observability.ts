// ─── Observability shim ──────────────────────────────────────────────
// Structured client + server logging with a single, vendor-neutral
// surface. `logEvent` and `captureException` are called from API
// routes, hooks, and the error boundary. The default implementation
// just writes structured records to console.* — bring-your-own
// transport (Sentry, Datadog, Logtail, Axiom, posthog) by editing
// `forward()` below.
//
// Design notes:
//   • No external runtime dependency, so Phase 2 ships no new bundle
//     weight and no DSN is required for the floor.
//   • Records carry `runtime` ("client" | "server") and `ts` so logs
//     are useful even when shipped through a single sink.
//   • PII discipline: callers should pass primitives + IDs in
//     `fields`; never an entire request URL with embedded address
//     queries. We sanitize obvious cases (mapbox URLs → host).

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
  if (!SENTRY_DSN) return;
  // Placeholder: when the Sentry SDK is added, call:
  //   import * as Sentry from "@sentry/nextjs";
  //   Sentry.captureMessage(record.message, { level: record.severity, extra: record.fields });
  // We intentionally don't pull in @sentry/nextjs by default to keep
  // the bundle weight at zero until a deployer opts in.
  void record;
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
