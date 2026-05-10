// jsdom default — useAlerts touches `window`, `document`, and
// `localStorage` during subscribe; the node-env directive on the
// adjacent useAlerts.test.ts only applies to that file's pure
// `alertsForRoutes` cases.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Hoisted observability mock — replaces the real shim so we can
// assert `captureException` is called rather than the bare
// `console.warn` the previous implementation used. Module-scope
// mocks must be declared before the dynamic import below.
const captureException = vi.fn();
vi.mock("./observability", () => ({
  captureException,
}));

async function freshImport() {
  vi.resetModules();
  // Re-establish the mock after resetModules so the freshly imported
  // useAlerts picks up our spy and not the real shim.
  vi.doMock("./observability", () => ({ captureException }));
  return await import("./useAlerts");
}

describe("useAlerts refresh failure", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException.mockReset();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Drop any persisted alerts cache so the hydrate path doesn't
    // satisfy the snapshot before refresh() runs.
    try {
      window.localStorage.removeItem("standclear:alerts:v1");
    } catch {
      // ignore — jsdom localStorage is always available
    }
    // Quiet the noisy fetch-rejection traces emitted by the shim's
    // emit() console.error fallback in the mocked path; the assertion
    // is on the captureException call, not on stdout.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("forwards a fetch rejection through observability.captureException", async () => {
    const err = new Error("network down");
    fetchMock.mockRejectedValue(err);

    const { useAlerts } = await freshImport();

    // Mount the hook — subscribe() fires startPolling() which calls
    // refresh() synchronously; the rejection settles on the next
    // microtask.
    await act(async () => {
      renderHook(() => useAlerts());
      // Yield twice: once for refresh()'s outer await fetch(), once
      // for the catch-block re-throw to settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/alerts", expect.any(Object));
    expect(captureException).toHaveBeenCalledTimes(1);
    const [forwarded, fields] = captureException.mock.calls[0];
    expect(forwarded).toBe(err);
    expect(fields).toEqual({ source: "useAlerts" });
  });

  it("forwards an HTTP-error rejection through observability.captureException", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    const { useAlerts } = await freshImport();

    await act(async () => {
      renderHook(() => useAlerts());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    const [forwarded, fields] = captureException.mock.calls[0];
    expect(forwarded).toBeInstanceOf(Error);
    expect((forwarded as Error).message).toBe("HTTP 503");
    expect(fields).toEqual({ source: "useAlerts" });
  });
});
