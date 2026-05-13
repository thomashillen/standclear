// @vitest-environment node
//
// fetchActiveAlerts() pipeline coverage — separate file from
// `lib/mtaAlerts.test.ts` (PR #120's severityOf classifier suite) so
// the two can be authored in parallel without conflicting on a shared
// describe block.
//
// What's pinned here, and why it matters:
//
//   1. Active-window filter (`isActive`). A planned-future alert
//      (`start > now`) leaking into the rider-facing list would
//      announce a Sunday outage on Wednesday morning; an expired
//      alert (`end < now`) would leave a stale "no service" badge
//      on a station after the work train cleared. Pin both drop
//      paths plus the "no period = always-on" pass.
//
//   2. Selector preservation. `lib/useAlerts.ts::alertsForStation`
//      depends on per-`informedEntity` selectors keeping their
//      route+stop AND shape (see the Codex P1 comment on PR #71).
//      If a future refactor flattens selectors into independent
//      `routeIds` + `stopIds` arrays here in the parser, the
//      downstream AND logic has nothing to work with. Pin the
//      pass-through.
//
//   3. parentStop suffix strip. MTA tags directional stopIds
//      (`R23N`, `R23S`); the rider-facing station model uses the
//      parent (`R23`). A regression that emits the directional id
//      breaks every station-scoped alert match.
//
//   4. toSec on Long protobufs. `gtfs-realtime-bindings` decodes
//      32-bit-overflow timestamps as `long.js` objects (`{low, high,
//      unsigned, toNumber()}`); a regression that treats them as
//      raw numbers gives NaN at every Unix-epoch comparison.
//
//   5. Error fallback. HTTP non-2xx and network rejection must
//      both surface as `{ generatedAt, alerts: [] }` so the panel
//      goes empty instead of crashing, AND captureException must
//      fire so an MTA outage shows up in the operator log sink
//      instead of being silently invisible.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;

const captureException = vi.fn();
vi.mock("./observability", () => ({ captureException }));

async function freshImport() {
  vi.resetModules();
  vi.doMock("./observability", () => ({ captureException }));
  return await import("./mtaAlerts");
}

// Encode a list of alert entities into the binary protobuf payload an
// MTA endpoint would return. Mirrors the helper in
// `app/api/trains/route.test.ts` so the two suites read alike.
type FeedEntity = NonNullable<
  Parameters<typeof FeedMessage.create>[0]
>["entity"] extends (infer E)[] | null | undefined
  ? E
  : never;

function feed(entities: FeedEntity[]): Buffer {
  const message = FeedMessage.create({
    header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp: 0 },
    entity: entities,
  });
  return Buffer.from(FeedMessage.encode(message).finish());
}

function feedResponse(buf: Buffer): Response {
  const ab = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  return new Response(ab, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

// Helper: enable timers and pin Date.now to a fixed second. The route
// reads `Math.floor(Date.now() / 1000)` for its active-window probe.
const NOW_SEC = 1_700_000_000;

beforeEach(() => {
  captureException.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_SEC * 1000));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("fetchActiveAlerts — active-window filter", () => {
  it("keeps alerts whose period contains now", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "a1",
            alert: {
              activePeriod: [{ start: NOW_SEC - 100, end: NOW_SEC + 100 }],
              effect: 1, // NO_SERVICE
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0].id).toBe("a1");
  });

  it("drops alerts whose only period has already ended", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "expired",
            alert: {
              activePeriod: [{ start: NOW_SEC - 1000, end: NOW_SEC - 100 }],
              effect: 1,
              headerText: { translation: [{ language: "en", text: "old" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    expect(res.alerts).toHaveLength(0);
  });

  it("drops alerts whose only period starts in the future", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "planned",
            alert: {
              activePeriod: [{ start: NOW_SEC + 1000, end: NOW_SEC + 2000 }],
              effect: 1,
              headerText: { translation: [{ language: "en", text: "future" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    expect(res.alerts).toHaveLength(0);
  });

  it("passes alerts with no active_period (always-on)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "permanent",
            alert: {
              // intentionally omit activePeriod
              effect: 4, // DETOUR
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "B" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    expect(res.alerts.map((a) => a.id)).toEqual(["permanent"]);
  });

  it("passes when any of multiple periods contains now", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "rolling",
            alert: {
              // first window already ended, second window contains now
              activePeriod: [
                { start: NOW_SEC - 1000, end: NOW_SEC - 500 },
                { start: NOW_SEC - 50, end: NOW_SEC + 50 },
              ],
              effect: 3, // SIGNIFICANT_DELAYS
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "L" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    expect(res.alerts.map((a) => a.id)).toEqual(["rolling"]);
  });

});

// Note on unbounded period fields: the function signature has a
// `?? -Infinity` / `?? Infinity` fallback for a missing `start` /
// `end` on a TimeRange, but in practice the protobuf decoder
// materializes omitted Long fields as `Long(0)` rather than null
// (proto3 numeric default), so the fallback never fires on a
// real round-trip. The MTA feed always emits both endpoints
// today; not pinning that brittle edge case here on purpose.

describe("fetchActiveAlerts — selectors & stop normalization", () => {
  it("strips N/S suffix from informedEntity stopIds in both the aggregate and the selector list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "stop-scoped",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [
                { routeId: "R", stopId: "R23N" },
                { routeId: "R", stopId: "R23S" },
              ],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    const a = res.alerts[0];
    // De-duped to the parent stop:
    expect(a.stopIds).toEqual(["R23"]);
    // Selectors preserve the AND shape but also use the parent stop id:
    expect(a.selectors).toEqual([
      { routeId: "R", stopId: "R23" },
      { routeId: "R", stopId: "R23" },
    ]);
  });

  it("preserves per-selector route+stop AND shape across multiple informedEntities", async () => {
    // PR #71's Codex P1: a single alert can pair a route-wide
    // selector with a stop-specific selector; the parser must keep
    // them as two distinct selectors so alertsForStation can evaluate
    // each one's AND independently.
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "mixed",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [
                { routeId: "R" }, // line-wide
                { stopId: "R23N" }, // stop-only
              ],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const res = await fetchActiveAlerts();
    expect(res.alerts[0].selectors).toEqual([
      { routeId: "R" },
      { stopId: "R23" },
    ]);
    expect(res.alerts[0].routeIds).toEqual(["R"]);
    expect(res.alerts[0].stopIds).toEqual(["R23"]);
  });

  it("aggregates unique routeIds + stopIds across selectors (no duplicates)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "multi",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [
                { routeId: "R", stopId: "R23N" },
                { routeId: "R", stopId: "R23S" }, // duplicate route + parent stop
                { routeId: "N", stopId: "R23N" }, // new route, same parent stop
              ],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(new Set(a.routeIds)).toEqual(new Set(["R", "N"]));
    expect(a.stopIds).toEqual(["R23"]);
  });

  it("drops informed_entities with neither route nor stop", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "empty-ie",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{}, { routeId: "L" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(a.selectors).toEqual([{ routeId: "L" }]);
    expect(a.routeIds).toEqual(["L"]);
    expect(a.stopIds).toEqual([]);
  });
});

describe("fetchActiveAlerts — effect mapping & translations", () => {
  it("maps the numeric effect enum to its canonical GTFS-RT name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          // Mix of effects that survive the active-window filter and
          // exercise distinct branches of `EFFECT_NAMES`.
          {
            id: "a-noservice",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
          {
            id: "a-detour",
            alert: {
              effect: 4,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "N" }],
            },
          },
          {
            id: "a-unknown",
            alert: {
              effect: 8,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "L" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const byId = new Map(
      (await fetchActiveAlerts()).alerts.map((a) => [a.id, a]),
    );
    expect(byId.get("a-noservice")?.effect).toBe("NO_SERVICE");
    expect(byId.get("a-detour")?.effect).toBe("DETOUR");
    expect(byId.get("a-unknown")?.effect).toBe("UNKNOWN_EFFECT");
  });

  it("prefers the english translation when multiple languages are present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "translated",
            alert: {
              effect: 1,
              headerText: {
                translation: [
                  { language: "es", text: "Sin servicio" },
                  { language: "en", text: "No service" },
                  { language: "zh", text: "暂无服务" },
                ],
              },
              descriptionText: {
                translation: [
                  { language: "es", text: "ES desc" },
                  { language: "en", text: "EN desc" },
                ],
              },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(a.header).toBe("No service");
    expect(a.description).toBe("EN desc");
  });

  it("falls back to the first translation when no english entry is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "no-en",
            alert: {
              effect: 1,
              headerText: {
                translation: [
                  { language: "es", text: "ES first" },
                  { language: "zh", text: "ZH second" },
                ],
              },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(a.header).toBe("ES first");
  });

  it("emits an empty header when headerText is omitted entirely", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "no-header",
            alert: {
              effect: 1,
              // headerText intentionally absent
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(a.header).toBe("");
    expect(a.description).toBe("");
  });

  it("falls back to alert-{n} when entity.id is empty so downstream Map keys stay unique", async () => {
    // `lib/pushDispatch.ts` uses the alert id as the dedup key in
    // alert_dispatch_log — empty ids would collapse every nameless
    // alert into a single dispatch row. The fallback prevents that.
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
          {
            id: "",
            alert: {
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "L" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const ids = (await fetchActiveAlerts()).alerts.map((a) => a.id);
    expect(ids).toEqual(["alert-0", "alert-1"]);
  });
});

describe("fetchActiveAlerts — time conversion", () => {
  it("converts protobuf Long timestamps via toNumber() (32-bit-overflow safe)", async () => {
    // The encode/decode round trip turns numeric timestamps into
    // long.js objects; `toSec` must call `.toNumber()` on them. If a
    // regression strips the branch and falls through to `Number(t)`
    // for the object, the result becomes NaN and `startTime` flips
    // to `null` instead of the original seconds.
    const start = NOW_SEC - 50;
    const end = NOW_SEC + 50;
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "long-ts",
            alert: {
              activePeriod: [{ start, end }],
              effect: 1,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(a.startTime).toBe(start);
    expect(a.endTime).toBe(end);
  });

  it("emits null for startTime/endTime when activePeriod is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "no-period",
            alert: {
              effect: 4,
              headerText: { translation: [{ language: "en", text: "h" }] },
              informedEntity: [{ routeId: "R" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const a = (await fetchActiveAlerts()).alerts[0];
    expect(a.startTime).toBeNull();
    expect(a.endTime).toBeNull();
  });
});

describe("fetchActiveAlerts — error paths", () => {
  it("returns an empty AlertsResponse when the upstream returns a non-2xx status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("oops", { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const r = await fetchActiveAlerts();
    expect(r.alerts).toEqual([]);
    expect(r.generatedAt).toBeGreaterThan(0);
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, fields] = captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("HTTP 503");
    expect(fields).toMatchObject({
      what: "alerts feed failed",
      url: expect.stringContaining("subway-alerts"),
    });
  });

  it("returns an empty AlertsResponse when fetch rejects (DNS / TCP / TLS)", async () => {
    const networkErr = new TypeError("fetch failed");
    const fetchMock = vi.fn().mockRejectedValue(networkErr);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const r = await fetchActiveAlerts();
    expect(r.alerts).toEqual([]);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBe(networkErr);
  });

  it("does not throw if the upstream body is not valid protobuf — falls back to empty + warns", async () => {
    // A truncated CDN response or an upstream 200 wrapping an HTML
    // error page would decode-fail at the protobuf step. The route
    // catches that and lands on the empty-response branch so the
    // panel doesn't crash on malformed bytes.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xff, 0xff, 0xff]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const r = await fetchActiveAlerts();
    expect(r.alerts).toEqual([]);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe("fetchActiveAlerts — happy path shape", () => {
  it("emits a generatedAt millisecond timestamp + alert list, severity classified via severityOf", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      feedResponse(
        feed([
          {
            id: "happy",
            alert: {
              activePeriod: [{ start: NOW_SEC - 50, end: NOW_SEC + 50 }],
              effect: 1, // NO_SERVICE → severityOf returns "severe"
              headerText: {
                translation: [{ language: "en", text: "No [R] service" }],
              },
              descriptionText: {
                translation: [{ language: "en", text: "details" }],
              },
              informedEntity: [{ routeId: "R", stopId: "R23N" }],
            },
          },
        ]),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { fetchActiveAlerts } = await freshImport();

    const r = await fetchActiveAlerts();
    // generatedAt is wall-clock milliseconds — the test's fake clock
    // pins Date.now() to NOW_SEC * 1000.
    expect(r.generatedAt).toBe(NOW_SEC * 1000);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({
      id: "happy",
      header: "No [R] service",
      description: "details",
      effect: "NO_SERVICE",
      severity: "severe",
      routeIds: ["R"],
      stopIds: ["R23"],
      startTime: NOW_SEC - 50,
      endTime: NOW_SEC + 50,
    });
    expect(r.alerts[0].selectors).toEqual([{ routeId: "R", stopId: "R23" }]);
  });
});
