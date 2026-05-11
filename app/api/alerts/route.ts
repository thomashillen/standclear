import { NextResponse } from "next/server";
import { fetchActiveAlerts } from "@/lib/mtaAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-export the shared types so existing consumers (lib/useAlerts.ts,
// tests) that import from this path keep compiling. The actual
// parsing + classification lives in lib/mtaAlerts.ts so the
// dispatch cron can reuse it without going back through HTTP.
export type {
  AlertSelector,
  AlertSeverity,
  AlertsResponse,
  ServiceAlert,
} from "@/lib/mtaAlerts";

export async function GET() {
  const body = await fetchActiveAlerts();
  return NextResponse.json(body, {
    // Cache briefly at the edge — alerts change far less often than
    // trains and the client polls at a low cadence anyway.
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
