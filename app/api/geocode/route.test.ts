// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Lazily-imported route GET — re-imported per test so `vi.stubEnv`
// changes are picked up before the module reads `process.env`.
async function loadGet() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.GET;
}

function makeRequest(query: string): NextRequest {
  // Distinct caller key per test so the in-process rate limiter
  // doesn't carry state across runs.
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  return new NextRequest(`http://localhost/api/geocode?${query}`, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("/api/geocode token resolution", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses MAPBOX_TOKEN when set", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret-server-token");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "public-client-token");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const GET = await loadGet();
    const req = makeRequest("action=suggest&q=550+madison&session_token=t1");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = String(fetchMock.mock.calls[0][0]);
    expect(upstreamUrl).toContain("access_token=secret-server-token");
    expect(upstreamUrl).not.toContain("access_token=public-client-token");
  });

  // The deploy that broke /550 madison/ on standclear.app had the
  // public token configured (the map rendered) but no MAPBOX_TOKEN.
  // Falling back keeps search working while a one-line operator
  // warning surfaces the misconfig in server logs.
  it("falls back to NEXT_PUBLIC_MAPBOX_TOKEN when MAPBOX_TOKEN is absent", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "public-client-token");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const GET = await loadGet();
    const req = makeRequest("action=suggest&q=550+madison&session_token=t2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = String(fetchMock.mock.calls[0][0]);
    expect(upstreamUrl).toContain("access_token=public-client-token");
  });

  it("returns 503 when neither token is set", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");

    const GET = await loadGet();
    const req = makeRequest("action=suggest&q=550+madison&session_token=t3");
    const res = await GET(req);

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
