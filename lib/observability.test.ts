// jsdom default — we need `window`, `navigator`, and `Blob` so the
// browser-only forward path is exercised.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadShim() {
  vi.resetModules();
  const mod = await import("./observability");
  // Default-off in test mode (so unrelated suites don't double-count
  // the forward fetch); flip it on for THIS suite specifically.
  mod.__setForwardEnabledForTests(true);
  mod.__resetForwardBudgetForTests();
  return mod;
}

describe("observability client→server forward", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // sendBeacon — install per-test so we can assert it was called.
    beaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: beaconMock,
    });
    // Quiet console during these tests — emit() always console.errors
    // first; we don't want noisy test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Drop the navigator.sendBeacon override so it can be redefined
    // in the next test without "redefining non-configurable property".
    delete (navigator as unknown as { sendBeacon?: unknown }).sendBeacon;
  });

  it("forwards an error record to /api/log via sendBeacon", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("kaboom"), { what: "test" });

    expect(beaconMock).toHaveBeenCalledTimes(1);
    const [url, blob] = beaconMock.mock.calls[0];
    expect(url).toBe("/api/log");
    expect(blob).toBeInstanceOf(Blob);
    const text = await (blob as Blob).text();
    const parsed = JSON.parse(text);
    expect(parsed.severity).toBe("error");
    expect(parsed.message).toBe("kaboom");
    expect(parsed.fields.what).toBe("test");
    expect(typeof parsed.stack).toBe("string");
    // fetch must NOT also fire when beacon succeeded.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to fetch with keepalive when sendBeacon refuses", async () => {
    beaconMock.mockReturnValue(false);
    const shim = await loadShim();
    shim.logEvent("warn", "soft fail");

    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/log");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(String(init.body));
    expect(parsed.severity).toBe("warn");
  });

  it("does not forward info-level events", async () => {
    const shim = await loadShim();
    shim.logEvent("info", "navigation", { url: "https://example.com" });

    expect(beaconMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps forwards per page-load to defend against render loops", async () => {
    const shim = await loadShim();
    for (let i = 0; i < 50; i++) {
      shim.captureException(new Error(`loop-${i}`));
    }
    // FORWARD_BUDGET = 30 inside the shim.
    expect(beaconMock).toHaveBeenCalledTimes(30);
  });
});
