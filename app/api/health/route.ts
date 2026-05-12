import { statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { VERSION } from "@/lib/site";
import { captureWarning } from "@/lib/observability";

// ─── Health endpoint ─────────────────────────────────────────────────
// GET /api/health → { status, checks, version, timestamp }
//
// Three check buckets:
//   • mta — HEAD against one MTA GTFS-RT feed. If it 5xx's or times
//     out, the upstream data plane is degraded and the live-pill on
//     the client should reflect that.
//   • runtime — process uptime + memory snapshot, useful for an
//     uptime probe to distinguish "host is up but we're stuck in a
//     bad state" from "host is down".
//   • static — `public/gtfsData.json` reachable + non-truncated on
//     the deployed instance. Every panel in the client app depends
//     on this 429 KB blob (routes, stops, line geometry); a missing
//     or zero-byte deploy renders the live map but every panel is
//     empty, while /status would otherwise still report "all systems
//     operational" since this used to be a hardcoded sentinel.
//
// The endpoint never throws — it returns a fully-formed payload even
// when individual checks fail. HTTP status:
//   200 → all checks ok
//   503 → at least one critical check failing
//
// Used by external uptime monitors (UptimeRobot, Better Stack, etc.)
// and by the in-app /status page added in Phase 4.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MTA_CHECK_URL =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs";

const MTA_CHECK_TIMEOUT_MS = 3_000;

// The full GTFS blob the build script emits hovers around 430 KB. A
// well-below-floor of 100 KB catches any deploy that shipped an empty
// scaffold, a partial truncation, or a stale tiny version while
// leaving plenty of headroom for the real file to grow as the MTA
// adds routes (the M's full Queens extension, a Phase-2 SAS, etc.).
const STATIC_BLOB_PATH = path.join(
  process.cwd(),
  "public",
  "gtfsData.json",
);
const STATIC_BLOB_MIN_BYTES = 100_000;

const STARTED_AT = Date.now();

type CheckStatus = "ok" | "degraded" | "down";

interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

interface HealthResponse {
  status: CheckStatus;
  version: string;
  uptimeMs: number;
  timestamp: number;
  checks: {
    mta: CheckResult;
    static: CheckResult;
    runtime: CheckResult;
  };
}

async function checkMta(): Promise<CheckResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), MTA_CHECK_TIMEOUT_MS);
  const start = Date.now();
  try {
    // HEAD avoids transferring the full protobuf payload. Some MTA
    // endpoints don't honor HEAD perfectly — fall back to GET with a
    // short range if HEAD returns a non-success status.
    let res = await fetch(MTA_CHECK_URL, {
      method: "HEAD",
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok && res.status !== 405) {
      // Fall through; the status is reflected below.
    } else if (res.status === 405) {
      res = await fetch(MTA_CHECK_URL, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: ctrl.signal,
        cache: "no-store",
      });
    }
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    if (res.status >= 500) {
      return {
        status: "down",
        latencyMs,
        detail: `MTA feed returned ${res.status}`,
      };
    }
    if (!res.ok && res.status !== 206) {
      return {
        status: "degraded",
        latencyMs,
        detail: `MTA feed returned ${res.status}`,
      };
    }
    return { status: "ok", latencyMs };
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const detail =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout after ${MTA_CHECK_TIMEOUT_MS}ms`
          : err.message
        : "Unknown error";
    captureWarning("health: MTA check failed", { detail, latencyMs });
    return { status: "down", latencyMs, detail };
  }
}

function checkStatic(): CheckResult {
  const start = Date.now();
  try {
    const stat = statSync(STATIC_BLOB_PATH);
    const latencyMs = Date.now() - start;
    const sizeKb = Math.round(stat.size / 1024);
    if (stat.size < STATIC_BLOB_MIN_BYTES) {
      // Present but truncated: same rider-visible blast radius as
      // missing entirely — useLines() either parses garbage or sees
      // zero routes. Treat as "down" so the rollup flips and uptime
      // monitors page the operator.
      captureWarning("health: static blob truncated", {
        size: stat.size,
        path: STATIC_BLOB_PATH,
      });
      return {
        status: "down",
        latencyMs,
        detail: `gtfsData.json truncated (${sizeKb} KB; expected ≥ ${Math.round(
          STATIC_BLOB_MIN_BYTES / 1024,
        )} KB)`,
      };
    }
    return { status: "ok", latencyMs, detail: `${sizeKb} KB` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const detail = err instanceof Error ? err.message : "Unknown error";
    captureWarning("health: static blob unreachable", {
      detail,
      path: STATIC_BLOB_PATH,
    });
    return { status: "down", latencyMs, detail };
  }
}

function checkRuntime(): CheckResult {
  // Memory pressure isn't dispositive on Vercel Functions but a
  // sentinel value is easy to add later.
  const uptimeMs = Date.now() - STARTED_AT;
  return { status: "ok", detail: `up ${Math.round(uptimeMs / 1000)}s` };
}

function rollupStatus(checks: HealthResponse["checks"]): CheckStatus {
  if (Object.values(checks).some((c) => c.status === "down")) return "down";
  if (Object.values(checks).some((c) => c.status === "degraded"))
    return "degraded";
  return "ok";
}

export async function GET() {
  const [mta] = await Promise.all([checkMta()]);
  const checks: HealthResponse["checks"] = {
    mta,
    static: checkStatic(),
    runtime: checkRuntime(),
  };
  const status = rollupStatus(checks);
  const body: HealthResponse = {
    status,
    version: VERSION,
    uptimeMs: Date.now() - STARTED_AT,
    timestamp: Date.now(),
    checks,
  };
  return NextResponse.json(body, {
    status: status === "down" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      // Surface key signals as headers so a probe doesn't have to
      // parse JSON to make a routing decision.
      "X-Health-Status": status,
      "X-Health-Version": VERSION,
    },
  });
}
