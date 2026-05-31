// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-call stub so each test composes its own gtfsData.json state
// without touching the real file in the workspace. `vi.mock("node:fs",
// ...)` hoists above any import, so the route reads through this stub
// the moment it loads. `importActual` preserves every other node:fs
// export — Next's own internals also pull from this module.
const statSyncMock = vi.fn();
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    statSync: (...args: Parameters<typeof actual.statSync>) =>
      statSyncMock(...args),
  };
});

// Observability shim mocked to a no-op so the truncated / missing
// branches don't fan their captureWarning calls through to a real
// /api/log POST during the test run.
vi.mock("@/lib/observability", () => ({
  captureWarning: vi.fn(),
  captureException: vi.fn(),
  logEvent: vi.fn(),
}));

async function loadGet() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.GET;
}

describe("/api/health", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    statSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok rollup when MTA + static + runtime all pass", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: {
        mta: { status: string };
        static: { status: string; detail?: string };
        runtime: { status: string };
      };
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.mta.status).toBe("ok");
    expect(body.checks.static.status).toBe("ok");
    expect(body.checks.static.detail).toMatch(/KB$/);
    expect(body.checks.runtime.status).toBe("ok");
  });

  it("flips static + rollup to down when gtfsData.json is missing", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    statSyncMock.mockImplementation(() => {
      const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: { static: { status: string; detail?: string } };
    };

    expect(res.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.checks.static.status).toBe("down");
    expect(body.checks.static.detail).toContain("ENOENT");
  });

  it("flips static + rollup to down when blob is truncated below the floor", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    // 50 KB — present, but well below the 100 KB floor. The full file
    // is ~430 KB; anything under 100 KB is either an empty scaffold,
    // a stale tiny version, or a deploy that lost the build step.
    statSyncMock.mockReturnValue({ size: 50_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: { static: { status: string; detail?: string } };
    };

    expect(res.status).toBe(503);
    expect(body.checks.static.status).toBe("down");
    expect(body.checks.static.detail).toContain("truncated");
  });

  it("a passing static check does not mask an MTA failure in the rollup", async () => {
    // Regression guard: the static check previously masked nothing
    // (it was a hardcoded "ok" sentinel), but its new implementation
    // sits on the same rollup path. Make sure it doesn't accidentally
    // override an upstream MTA outage.
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: {
        mta: { status: string };
        static: { status: string };
      };
    };

    expect(res.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.checks.mta.status).toBe("down");
    expect(body.checks.static.status).toBe("ok");
  });

  it("405 HEAD falls back to a ranged GET and reports ok when it serves", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 206 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as { checks: { mta: { status: string } } };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    expect(res.status).toBe(200);
    expect(body.checks.mta.status).toBe("ok");
  });

  it("403 HEAD (proxy rejects the method) is confirmed ok via the GET fallback", async () => {
    // Regression guard: the fallback used to fire only on exactly 405,
    // so a CDN that answered HEAD with 403/400/501 was reported
    // degraded even though the feed itself was healthy — a false alarm
    // to uptime monitors and the rider-facing /status page.
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: { mta: { status: string } };
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.mta.status).toBe("ok");
  });

  it("a real outage still flips to down when the GET fallback 5xx's", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: { mta: { status: string; detail?: string } };
    };

    expect(res.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.checks.mta.status).toBe("down");
    expect(body.checks.mta.detail).toContain("503");
  });

  it("a non-5xx GET-fallback failure degrades (not downs) the rollup", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      checks: { mta: { status: string; detail?: string } };
    };

    // degraded is not a critical rollup → HTTP stays 200 so an uptime
    // probe doesn't page on a partial-but-reachable upstream.
    expect(res.status).toBe(200);
    expect(body.checks.mta.status).toBe("degraded");
    expect(body.checks.mta.detail).toContain("404");
  });

  it("a 2xx HEAD short-circuits without the GET fallback", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();
    const body = (await res.json()) as { checks: { mta: { status: string } } };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    expect(body.checks.mta.status).toBe("ok");
  });

  it("response surfaces X-Health-Status + X-Health-Version routing headers", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    statSyncMock.mockReturnValue({ size: 430_000 });

    const GET = await loadGet();
    const res = await GET();

    // Uptime monitors short-circuit on the header so they don't have
    // to parse the JSON body to make a routing decision; keep that
    // contract honest.
    expect(res.headers.get("X-Health-Status")).toBe("ok");
    expect(res.headers.get("X-Health-Version")).toBeTruthy();
  });
});
