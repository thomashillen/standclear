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

// Shared mock harness. The forward path bundles `sanitize` →
// `sanitizeFields` → `safeMessage` / `safeStack` into one observable
// payload (the beacon body), so assertions on those helpers route
// through `captureException` + the sendBeacon call. Returning the
// beacon mock means each describe block can plug it into its own
// expectations without re-installing the mocks at the top level.
function installMocks(): {
  fetchMock: ReturnType<typeof vi.fn>;
  beaconMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const beaconMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: beaconMock,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  return { fetchMock, beaconMock };
}

function teardownMocks() {
  vi.restoreAllMocks();
  delete (navigator as unknown as { sendBeacon?: unknown }).sendBeacon;
}

async function readBeaconRecord(
  beaconMock: ReturnType<typeof vi.fn>,
  callIndex = 0,
): Promise<{
  severity: string;
  message: string;
  fields?: Record<string, unknown>;
  stack?: string;
}> {
  const blob = beaconMock.mock.calls[callIndex]?.[1] as Blob | undefined;
  if (!blob) throw new Error(`no beacon payload at call index ${callIndex}`);
  return JSON.parse(await blob.text());
}

describe("observability client→server forward", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const m = installMocks();
    fetchMock = m.fetchMock;
    beaconMock = m.beaconMock;
  });

  afterEach(() => {
    teardownMocks();
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

// ─── sanitize() — URL query-string redaction ─────────────────────────
// The shim's `sanitize` helper isn't exported, so we exercise it via
// the forward payload. The contract per the source comment: strings
// shaped like an http(s) URL with a non-empty query land in logs as
// `${origin}${pathname}?[redacted]`; everything else passes through.
// This is a PII boundary — address typeahead queries flow through
// captureException fields from /api/geocode and /api/walk error paths
// — so a silent regression (e.g. someone "trusting" the Mapbox host
// and skipping the redact, or dropping the regex guard) would land
// rider address strings in the operator log sink.
describe("observability sanitize (URL redaction)", () => {
  let beaconMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    beaconMock = installMocks().beaconMock;
  });
  afterEach(() => {
    teardownMocks();
  });

  it("strips the query string from a URL field value", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("upstream failed"), {
      url: "https://api.mapbox.com/search/v1/suggest?q=123+Main+St&access_token=pk.XYZ",
    });
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.fields?.url).toBe(
      "https://api.mapbox.com/search/v1/suggest?[redacted]",
    );
  });

  it("passes URLs with no query string through unchanged", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("oops"), {
      url: "https://example.com/path",
    });
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.fields?.url).toBe("https://example.com/path");
  });

  it("passes non-URL strings through unchanged", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("oops"), {
      detail: "Timeout after 3000ms",
      tag: "mapbox-walk",
    });
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.fields?.detail).toBe("Timeout after 3000ms");
    expect(rec.fields?.tag).toBe("mapbox-walk");
  });

  it("passes non-string field values through unchanged", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("oops"), {
      count: 42,
      ok: true,
      payload: { code: "ENOENT" },
    });
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.fields?.count).toBe(42);
    expect(rec.fields?.ok).toBe(true);
    expect(rec.fields?.payload).toEqual({ code: "ENOENT" });
  });

  it("returns malformed http(s) strings as-is (URL parse throws → caught)", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("oops"), {
      // Regex matches `^https?://` so this enters the URL branch, but
      // `new URL(...)` throws on the bracket; the catch hands the raw
      // value back rather than losing it to a swallowed error.
      weird: "http://[not-a-real-host",
    });
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.fields?.weird).toBe("http://[not-a-real-host");
  });

  it("redacts mid-pipeline so the console.error tag is also clean", async () => {
    // sanitize runs inside emit() before forward + before console.*, so
    // an operator scanning Vercel logs never sees the raw address either.
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const shim = await loadShim();
    shim.captureException(new Error("upstream failed"), {
      url: "https://api.mapbox.com/search/v1/suggest?q=secret-address",
    });
    expect(consoleSpy).toHaveBeenCalled();
    const detail = consoleSpy.mock.calls[0][1] as { url?: string };
    expect(detail.url).toBe(
      "https://api.mapbox.com/search/v1/suggest?[redacted]",
    );
  });
});

// ─── safeMessage / safeStack — captureException coercion ─────────────
// captureException must accept `unknown` (catch blocks routinely
// re-throw non-Error values from runtime code paths or upstream
// libraries) and never throw itself. The forward payload is the
// observable contract: `message` is always a string, `stack` is only
// set when the input was an Error. A regression that, say, dropped
// the `try { JSON.stringify }` and let a circular ref escape would
// take down every catch site that called captureException(err).
describe("observability captureException coercion", () => {
  let beaconMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    beaconMock = installMocks().beaconMock;
  });
  afterEach(() => {
    teardownMocks();
  });

  it("uses Error.message as the message and includes the stack", async () => {
    const shim = await loadShim();
    shim.captureException(new Error("boom"));
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.message).toBe("boom");
    expect(typeof rec.stack).toBe("string");
    expect(rec.stack).toMatch(/Error: boom/);
  });

  it("passes a string error through as the message with no stack", async () => {
    const shim = await loadShim();
    shim.captureException("plain-string error");
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.message).toBe("plain-string error");
    expect(rec.stack).toBeUndefined();
  });

  it("JSON-stringifies a plain object error", async () => {
    const shim = await loadShim();
    shim.captureException({ code: "ENOENT", path: "/tmp" });
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.message).toBe('{"code":"ENOENT","path":"/tmp"}');
    expect(rec.stack).toBeUndefined();
  });

  it("falls back to String() when JSON.stringify throws on a circular ref", async () => {
    const shim = await loadShim();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    // Must not throw — captureException is called from catch blocks
    // and a re-throw here would break the whole observability surface.
    expect(() => shim.captureException(circular)).not.toThrow();
    const rec = await readBeaconRecord(beaconMock);
    expect(rec.message).toBe("[object Object]");
  });
});
