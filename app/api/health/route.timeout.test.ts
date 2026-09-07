// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const statSyncMock = vi.fn();
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    statSync: (...args: Parameters<typeof actual.statSync>) =>
      statSyncMock(...args),
  };
});

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

describe("/api/health MTA probe deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statSyncMock.mockReset();
    statSyncMock.mockReturnValue({ size: 430_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reserves time for the ranged GET when advisory HEAD stalls", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 206 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const GET = await loadGet();
    const pending = GET();

    // HEAD is deliberately capped below the 3s overall deadline so
    // its timeout still leaves a meaningful budget for the GET.
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await pending;
    const body = (await res.json()) as {
      status: string;
      checks: { mta: { status: string; latencyMs?: number } };
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.mta.status).toBe("ok");
    expect(body.checks.mta.latencyMs).toBe(1_000);
  });
});
