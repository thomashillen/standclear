// @vitest-environment node
//
// Sentry transport lives behind the server-side branch of
// `forward()`, so it must be exercised in the node environment
// (jsdom would set IS_CLIENT=true and the branch never runs — that's
// the double-count guard, covered by observability.test.ts). The
// client→server forward path is the jsdom suite's concern; this file
// owns only the DSN parse + envelope shape + best-effort delivery.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SENTRY_IO_DSN = "https://pubkey123@o42.ingest.sentry.io/777";

// Load the shim with a specific NEXT_PUBLIC_SENTRY_DSN. The module
// parses the DSN once at import time, so each test resets modules and
// re-imports under the env it wants.
async function loadShim(dsn: string | undefined) {
  vi.resetModules();
  if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
  return import("./observability");
}

function installFetch() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  return fetchMock;
}

// Envelope = three newline-delimited JSON segments: envelope header,
// item header, item payload.
function parseEnvelope(body: string) {
  const [header, itemHeader, payload] = body.split("\n");
  return {
    header: JSON.parse(header),
    itemHeader: JSON.parse(itemHeader),
    event: JSON.parse(payload),
  };
}

describe("observability Sentry transport", () => {
  const ORIGINAL_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
  });

  it("POSTs an error envelope to the parsed sentry.io ingest URL", async () => {
    const shim = await loadShim(SENTRY_IO_DSN);
    shim.captureException(new Error("kaboom"), { what: "trains-feed" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://o42.ingest.sentry.io/api/777/envelope/?sentry_key=pubkey123&sentry_version=7",
    );
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers["Content-Type"]).toBe(
      "application/x-sentry-envelope",
    );

    const { header, itemHeader, event } = parseEnvelope(String(init.body));
    expect(itemHeader).toEqual({ type: "event" });
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    // Envelope header event_id must match the payload's so Sentry
    // attributes the item to the right event.
    expect(header.event_id).toBe(event.event_id);
    expect(typeof header.sent_at).toBe("string");
    expect(event.level).toBe("error");
    expect(event.message.formatted).toBe("kaboom");
    // Server runtime tag — the double-count guard means every Sentry
    // event is emitted server-side, even ones that originated client.
    expect(event.tags.runtime).toBe("server");
    expect(event.extra.what).toBe("trains-feed");
    expect(typeof event.extra.stack).toBe("string");
  });

  it("maps warn severity to Sentry's 'warning' level", async () => {
    const shim = await loadShim(SENTRY_IO_DSN);
    shim.captureWarning("partial feed outage", { feed: "ace" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { event } = parseEnvelope(String(fetchMock.mock.calls[0][1].body));
    expect(event.level).toBe("warning");
    expect(event.message.formatted).toBe("partial feed outage");
    expect(event.extra.feed).toBe("ace");
    // No Error was thrown, so no stack rides along.
    expect(event.extra.stack).toBeUndefined();
  });

  it("does not forward info-level events to Sentry", async () => {
    const shim = await loadShim(SENTRY_IO_DSN);
    shim.logEvent("info", "cold boot", { ms: 12 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when no DSN is configured", async () => {
    const shim = await loadShim(undefined);
    shim.captureException(new Error("boom"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently disables on a malformed DSN without throwing on import or log", async () => {
    const shim = await loadShim("not-a-valid-dsn");
    expect(() => shim.captureException(new Error("boom"))).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects a self-hosted DSN with an ingest path prefix", async () => {
    const shim = await loadShim(
      "https://abc@sentry.example.com/base/path/9",
    );
    shim.captureException(new Error("x"));
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://sentry.example.com/base/path/api/9/envelope/?sentry_key=abc&sentry_version=7",
    );
  });

  it("swallows a rejected delivery fetch (fire-and-forget, never throws)", async () => {
    const shim = await loadShim(SENTRY_IO_DSN);
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(() =>
      shim.captureException(new Error("boom")),
    ).not.toThrow();
    // Give the swallowed rejection a microtask to settle so an
    // unhandled-rejection wouldn't slip past the assertion.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
