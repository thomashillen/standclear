// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Lazily-imported route GET — re-imported per test so vi.stubEnv
// changes are picked up before the module reads process.env, and so
// the module-scope `fallbackWarningLogged` latch resets between cases.
async function loadGet() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.GET;
}

function makeRequest(query: string): NextRequest {
  // Distinct caller key per test so the in-process rate limiter
  // doesn't carry state across runs.
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  return new NextRequest(`http://localhost/api/walk?${query}`, {
    headers: { "x-forwarded-for": ip },
  });
}

const VALID = "from=-73.9857,40.7484&to=-73.9772,40.7527";

describe("/api/walk upstream failure handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.unstubAllEnvs();
    vi.stubEnv("MAPBOX_TOKEN", "secret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects malformed coordinates with 400 before calling Mapbox", async () => {
    const GET = await loadGet();
    const req = makeRequest("from=notacoord&to=-73.9772,40.7527");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 499 + null on client AbortError without logging", async () => {
    fetchMock.mockImplementation(() => {
      const e = new Error("aborted");
      e.name = "AbortError";
      return Promise.reject(e);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    const res = await GET(makeRequest(VALID));

    expect(res.status).toBe(499);
    expect(await res.json()).toBeNull();
    // The client cancelled the directions request (rider closed the
    // trip panel mid-flight); logging would just be noise.
    const aborts = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("fetch failed"),
    );
    expect(aborts.length).toBe(0);
  });

  it("returns 502 + null + warns when fetch rejects (network down)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    const res = await GET(makeRequest(VALID));

    expect(res.status).toBe(502);
    expect(await res.json()).toBeNull();
    const failures = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("Mapbox directions fetch failed"),
    );
    expect(failures.length).toBe(1);
  });

  it("returns 502 + null + warns when Mapbox replies with malformed JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Service Unavailable</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    const res = await GET(makeRequest(VALID));

    expect(res.status).toBe(502);
    expect(await res.json()).toBeNull();
    const malformed = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("Mapbox directions malformed JSON"),
    );
    expect(malformed.length).toBe(1);
  });

  it("preserves upstream non-2xx status (e.g. 401, 429) with null body", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));

    const GET = await loadGet();
    const res = await GET(makeRequest(VALID));

    // The client's walkingDirections cache drops on non-2xx; preserving
    // the status keeps that branch reachable.
    expect(res.status).toBe(401);
    expect(await res.json()).toBeNull();
  });

  it("forwards a successful Mapbox directions payload through verbatim", async () => {
    const payload = { routes: [{ duration: 240, distance: 320 }] };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const GET = await loadGet();
    const res = await GET(makeRequest(VALID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    // Confirms the walking profile + format flags survived the
    // forward (the call site assumes geometries=geojson, steps=true).
    const upstreamUrl = String(fetchMock.mock.calls[0][0]);
    expect(upstreamUrl).toContain("/directions/v5/mapbox/walking/");
    expect(upstreamUrl).toContain("geometries=geojson");
    expect(upstreamUrl).toContain("steps=true");
    expect(upstreamUrl).toContain("access_token=secret");
  });
});
