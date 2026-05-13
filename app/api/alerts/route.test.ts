// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertsResponse, ServiceAlert } from "@/lib/mtaAlerts";

// Mock the shared fetcher rather than the upstream MTA feed. The
// classification + protobuf decode are exercised by lib/mtaAlerts
// tests (PRs #120, #123); this file's only job is to assert that the
// route forwards the body unchanged and pins the edge-cache headers.
const fetchActiveAlertsMock = vi.fn<() => Promise<AlertsResponse>>();
vi.mock("@/lib/mtaAlerts", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/mtaAlerts")>("@/lib/mtaAlerts");
  return {
    ...actual,
    fetchActiveAlerts: () => fetchActiveAlertsMock(),
  };
});

async function loadGet() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.GET;
}

function alert(overrides: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    id: "a1",
    header: "Suspended",
    description: "No service.",
    effect: "NO_SERVICE",
    severity: "severe",
    routeIds: ["A"],
    stopIds: [],
    selectors: [{ routeId: "A" }],
    startTime: 1_700_000_000,
    endTime: null,
    ...overrides,
  };
}

describe("/api/alerts", () => {
  beforeEach(() => {
    fetchActiveAlertsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with the AlertsResponse body verbatim", async () => {
    const payload: AlertsResponse = {
      generatedAt: 1_700_000_000_000,
      alerts: [alert(), alert({ id: "a2", severity: "warning" })],
    };
    fetchActiveAlertsMock.mockResolvedValue(payload);

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as AlertsResponse;

    expect(res.status).toBe(200);
    expect(body).toEqual(payload);
  });

  it("returns an empty alerts array (not 5xx) when the upstream is dark", async () => {
    // lib/mtaAlerts.ts swallows fetch / decode errors internally and
    // returns { generatedAt: now, alerts: [] } so the client never
    // sees a 5xx for a transient MTA hiccup. Pin that contract from
    // the route side too — a regression that lets an error bubble
    // would flip the live-feed pill on every consumer.
    fetchActiveAlertsMock.mockResolvedValue({
      generatedAt: 1_700_000_000_000,
      alerts: [],
    });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as AlertsResponse;

    expect(res.status).toBe(200);
    expect(body.alerts).toEqual([]);
    expect(typeof body.generatedAt).toBe("number");
  });

  it("pins the Cache-Control edge directives", async () => {
    // Alerts change far less often than trains and the client polls
    // at a low cadence; a 30s public cache + 120s SWR window keeps
    // the CDN absorbing most reads. A regression that drops the
    // header would silently 10x our upstream fan-out.
    fetchActiveAlertsMock.mockResolvedValue({
      generatedAt: 1_700_000_000_000,
      alerts: [],
    });

    const GET = await loadGet();
    const res = await GET();

    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=30, stale-while-revalidate=120",
    );
  });

  it("responds as application/json", async () => {
    // NextResponse.json wires this for us; the assertion is a guard
    // against a future refactor that swaps to `new Response(...)`
    // without re-setting the content-type.
    fetchActiveAlertsMock.mockResolvedValue({
      generatedAt: 1_700_000_000_000,
      alerts: [],
    });

    const GET = await loadGet();
    const res = await GET();

    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  });
});
