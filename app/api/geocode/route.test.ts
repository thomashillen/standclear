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

  // ───── Upstream failure modes ─────────────────────────────────────
  //
  // Each path below verifies one branch of the proxy's normalized
  // error handling. Without these, a Mapbox 5xx page (HTML body), a
  // client tab close mid-fetch (AbortError), or a network rejection
  // would throw out of the route handler and surface to the rider as
  // a generic Next.js 500.

  it("returns 499 + empty shape on client AbortError without logging", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");
    fetchMock.mockImplementation(() => {
      const e = new Error("aborted");
      e.name = "AbortError";
      return Promise.reject(e);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    const req = makeRequest("action=suggest&q=cancelled&session_token=t-abort");
    const res = await GET(req);

    expect(res.status).toBe(499);
    expect(await res.json()).toEqual({ suggestions: [] });
    // AbortError is normal client behavior (typeahead keystroke cancels
    // the previous suggest); logging would just be noise.
    const aborts = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("fetch failed"),
    );
    expect(aborts.length).toBe(0);
  });

  it("returns 502 + empty shape + warns when fetch rejects (network down)", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");
    fetchMock.mockRejectedValue(new Error("ENOTFOUND api.mapbox.com"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    const req = makeRequest("action=suggest&q=net-fail&session_token=t-net");
    const res = await GET(req);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ suggestions: [] });
    const failures = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("Mapbox suggest fetch failed"),
    );
    expect(failures.length).toBe(1);
  });

  it("returns 502 + empty shape + warns when Mapbox replies with malformed JSON", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");
    // Mapbox 5xx pages occasionally come back as HTML; the body parses
    // as text fine but .json() throws.
    fetchMock.mockResolvedValue(
      new Response("<html>Service Unavailable</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    const req = makeRequest("action=retrieve&mapbox_id=abc&session_token=t-malformed");
    const res = await GET(req);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ features: [] });
    const malformed = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("Mapbox retrieve malformed JSON"),
    );
    expect(malformed.length).toBe(1);
  });

  it("preserves upstream non-2xx status (e.g. 429) with the empty shape", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");
    fetchMock.mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );

    const GET = await loadGet();
    const req = makeRequest("action=suggest&q=throttled&session_token=t-429");
    const res = await GET(req);

    // Client's typeahead drops its cache on non-2xx; the status has to
    // round-trip rather than be flattened to 502.
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ suggestions: [] });
  });

  // ───── Suggest query trimming ─────────────────────────────────────
  //
  // The server's "minimum searchable query" gate must mirror the
  // client's documented `query.trim()` contract (lib/geocoding.ts):
  // trimmed length ≥ 2. Our own UI always trims first, so these guard
  // a direct / abusive API hit — a whitespace-only or -padded `q`
  // must not clear the gate and burn a billed Mapbox suggest call,
  // and a query that does proceed must be forwarded trimmed (a
  // trailing space only degrades the upstream prefix ranking).

  it("treats a whitespace-only q as below the minimum (no upstream call)", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");

    const GET = await loadGet();
    // %20%20 = two spaces; decodes to "  " which trims to "".
    const req = makeRequest("action=suggest&q=%20%20&session_token=t-ws");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a padded single character as below the minimum (no upstream call)", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");

    const GET = await loadGet();
    // " a " trims to "a" — length 1, still under the 2-char floor.
    const req = makeRequest("action=suggest&q=%20a%20&session_token=t-pad1");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the trimmed query to Mapbox, not the padded input", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "secret");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const GET = await loadGet();
    // "  br  " trims to "br" — clears the gate, must forward "br".
    const req = makeRequest("action=suggest&q=%20%20br%20%20&session_token=t-pad2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstream = new URL(String(fetchMock.mock.calls[0][0]));
    expect(upstream.searchParams.get("q")).toBe("br");
  });

  // captureWarning forwards to console.warn and doesn't dedupe; without
  // a module-level latch the per-request fallback warning would flood
  // operator logs under real traffic. Caught in PR #51 review by Codex.
  it("logs the fallback warning at most once per process", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "public-client-token");
    // Fresh Response per call — Response bodies are single-use, so a
    // shared mockResolvedValue would throw "Body has already been read"
    // on the second iteration.
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ suggestions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const GET = await loadGet();
    for (let i = 0; i < 5; i++) {
      const req = makeRequest(`action=suggest&q=q${i}&session_token=t${i}`);
      await GET(req);
    }

    const fallbackWarnings = warnSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("fell back to NEXT_PUBLIC_MAPBOX_TOKEN"),
    );
    expect(fallbackWarnings.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
