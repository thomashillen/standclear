// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { GET, type TrainsResponse } from "./route";

const FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;

// Build a GTFS-RT FeedMessage as the binary payload an MTA endpoint would
// return, then wrap it in a Response so the route's fetch sees something
// realistic instead of a hand-rolled stub. Keeping it as a small helper
// makes each test fixture readable.
type FeedEntity = NonNullable<
  Parameters<typeof FeedMessage.create>[0]
>["entity"] extends (infer E)[] | null | undefined
  ? E
  : never;

function feed(entities: FeedEntity[], timestampSec = 1_700_000_000): Buffer {
  const message = FeedMessage.create({
    header: {
      gtfsRealtimeVersion: "2.0",
      incrementality: 0,
      timestamp: timestampSec,
    },
    entity: entities,
  });
  return Buffer.from(FeedMessage.encode(message).finish());
}

function feedResponse(buf: Buffer): Response {
  // Use a clone of the underlying ArrayBuffer so each call to
  // arrayBuffer() returns the right bytes (Buffer→ArrayBuffer slicing).
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Response(ab, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
}

describe("GET /api/trains", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Pin Date.now so progress / arrival cutoffs are deterministic. The
    // route uses Math.floor(Date.now() / 1000) as `now`.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_500_000));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("decodes a single in-transit vehicle and computes interpolated progress", async () => {
    // Trip T1 on the 4 with two stops in stop_time_update. Vehicle is
    // currently at stop 635N, IN_TRANSIT_TO. Halfway between prev stop's
    // departure (1_700_000_400) and current stop's arrival (1_700_000_600).
    const entity = {
      id: "T1",
      tripUpdate: {
        trip: { tripId: "T1", routeId: "4" },
        stopTimeUpdate: [
          {
            stopId: "631N",
            arrival: { time: 1_700_000_300 },
            departure: { time: 1_700_000_400 },
          },
          {
            stopId: "635N",
            arrival: { time: 1_700_000_600 },
            departure: { time: 1_700_000_700 },
          },
        ],
      },
      vehicle: {
        trip: { tripId: "T1", routeId: "4" },
        stopId: "635N",
        currentStatus: 2, // IN_TRANSIT_TO
      },
    };

    fetchMock.mockResolvedValue(feedResponse(feed([entity])));

    const res = await GET();
    const body = (await res.json()) as TrainsResponse;

    expect(body.trains).toHaveLength(1);
    const t = body.trains[0];
    expect(t.id).toBe("T1");
    expect(t.routeId).toBe("4");
    expect(t.direction).toBe("N"); // suffix "N" on stopId 635N
    expect(t.prevStopId).toBe("631"); // parent stop, suffix stripped
    expect(t.nextStopId).toBe("635");
    expect(t.status).toBe("IN_TRANSIT_TO");
    // now=1_700_000_500, prevDep=1_700_000_400, curArr=1_700_000_600 →
    // progress = 100 / 200 = 0.5
    expect(t.progress).toBeCloseTo(0.5, 6);
  });

  it("snaps progress to 1 for STOPPED_AT vehicles", async () => {
    const entity = {
      id: "T2",
      tripUpdate: {
        trip: { tripId: "T2", routeId: "L" },
        stopTimeUpdate: [
          { stopId: "L03N", arrival: { time: 1_700_000_490 }, departure: { time: 1_700_000_510 } },
        ],
      },
      vehicle: {
        trip: { tripId: "T2", routeId: "L" },
        stopId: "L03N",
        currentStatus: 1, // STOPPED_AT
      },
    };
    fetchMock.mockResolvedValue(feedResponse(feed([entity])));

    const body = (await (await GET()).json()) as TrainsResponse;
    expect(body.trains).toHaveLength(1);
    expect(body.trains[0].status).toBe("STOPPED_AT");
    expect(body.trains[0].progress).toBe(1);
  });

  it("emits arrivals filtered to those still in the future, sorted ascending", async () => {
    // Two trips on the same stop; one ETA already past should be dropped.
    const entityFuture = {
      id: "T3",
      tripUpdate: {
        trip: { tripId: "T3", routeId: "4" },
        stopTimeUpdate: [
          { stopId: "631S", arrival: { time: 1_700_000_700 } },
          { stopId: "635S", arrival: { time: 1_700_000_900 } },
        ],
      },
    };
    const entityStale = {
      id: "T4",
      tripUpdate: {
        trip: { tripId: "T4", routeId: "4" },
        stopTimeUpdate: [
          { stopId: "631S", arrival: { time: 1_700_000_100 } }, // < now=1_700_000_500
        ],
      },
    };
    fetchMock.mockResolvedValue(feedResponse(feed([entityFuture, entityStale])));

    const body = (await (await GET()).json()) as TrainsResponse;
    const arrivalsAt631 = body.arrivals.filter((a) => a.stopId === "631");
    expect(arrivalsAt631.map((a) => a.tripId)).toEqual(["T3"]);
    // Sort: ascending eta across the whole array.
    for (let i = 1; i < body.arrivals.length; i++) {
      expect(body.arrivals[i].eta).toBeGreaterThanOrEqual(body.arrivals[i - 1].eta);
    }
    // Direction derived from stopId suffix ("S").
    expect(arrivalsAt631[0].direction).toBe("S");
  });

  it("dedupes duplicate trips by tripId across multiple feeds", async () => {
    // The base feed and a route-specific feed both echo trip T5.
    // FEEDS sets the route-specific feed AFTER the base feed, so
    // last-wins should keep the route-specific copy.
    const baseEntity = {
      id: "T5",
      vehicle: {
        trip: { tripId: "T5", routeId: "4" },
        stopId: "631N",
        currentStatus: 1,
      },
      tripUpdate: {
        trip: { tripId: "T5", routeId: "4" },
        stopTimeUpdate: [{ stopId: "631N", arrival: { time: 1_700_000_700 } }],
      },
    };
    const overrideEntity = {
      id: "T5",
      vehicle: {
        trip: { tripId: "T5", routeId: "4" },
        // Different stop on the override — proves which feed survived.
        stopId: "635N",
        currentStatus: 1,
      },
      tripUpdate: {
        trip: { tripId: "T5", routeId: "4" },
        stopTimeUpdate: [{ stopId: "635N", arrival: { time: 1_700_000_700 } }],
      },
    };

    // First call (base feed) returns baseEntity, second call (and beyond)
    // returns overrideEntity; remaining feeds return empty payloads.
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call++;
      if (call === 1) return feedResponse(feed([baseEntity]));
      if (call === 2) return feedResponse(feed([overrideEntity]));
      return feedResponse(feed([]));
    });

    const body = (await (await GET()).json()) as TrainsResponse;
    const t5 = body.trains.filter((t) => t.id === "T5");
    expect(t5).toHaveLength(1);
    // Override should have won (last-wins); its vehicle was at 635.
    expect(t5[0].nextStopId).toBe("635");
  });

  it("survives a single feed failure via Promise.allSettled", async () => {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call++;
      if (call === 3) throw new Error("network blip");
      return feedResponse(feed([]));
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrainsResponse;
    // No trains were queued, but the response still parses.
    expect(body.trains).toEqual([]);
    expect(body.arrivals).toEqual([]);
    // We don't assert exact call count because the route fans out across
    // FEEDS in parallel and we don't pin that list shape here.
    expect(call).toBeGreaterThanOrEqual(1);
  });

  it("treats a non-2xx feed response as empty rather than throwing", async () => {
    fetchMock.mockResolvedValue(new Response("server error", { status: 503 }));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrainsResponse;
    expect(body.trains).toEqual([]);
  });
});
