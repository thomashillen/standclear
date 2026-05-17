import { NextResponse } from "next/server";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { captureException, captureWarning } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MTA GTFS-Realtime feeds (no API key required since 2023-12)
const FEEDS = [
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
];

export type Train = {
  id: string;
  routeId: string;
  direction: "N" | "S";
  progress: number;
  prevStopId: string;
  nextStopId: string;
  status: "STOPPED_AT" | "INCOMING_AT" | "IN_TRANSIT_TO";
  /** Per-vehicle position timestamp (epoch seconds) — when MTA last
   *  received a report from this specific train. Falls back to the
   *  feed header's timestamp when the per-vehicle field is absent.
   *  Lets the client distinguish "the snapshot is fresh but this
   *  train hasn't been heard from in 4 minutes" from "the API is
   *  failing." Optional because GTFS-RT lets both timestamps be
   *  blank, in which case the client falls back to `generatedAt`. */
  lastReportedAt?: number;
  /** Parent stop id of the trip's final stopTimeUpdate — same realtime
   *  destination carried on `Arrival.destStopId`, mirrored here so the
   *  station panel can label a synthesized "Now" row (a train sitting
   *  STOPPED_AT the platform) with its true short-turn terminus. That
   *  row is built from `trains`, not `arrivals` — and the at-platform
   *  moment is exactly when the destination matters most — so without
   *  this field it would fall back to the static line terminus and
   *  re-introduce the very mislabel this exists to fix. Omitted only
   *  for a degenerate trip update with no stop ids. */
  destStopId?: string;
};

export type Arrival = {
  routeId: string;
  stopId: string;
  direction: "N" | "S";
  eta: number;
  tripId: string;
  /** Parent stop id of the trip's final stopTimeUpdate — the actual
   *  realtime destination for THIS run, not the static line terminus.
   *  They diverge on short-turns (a 6 ending at Parkchester instead of
   *  Pelham Bay Park — ~40% of northbound 6 trains at peak) and branch
   *  services (a 5 to Dyre Av vs Nereid Av). The static line geometry
   *  only knows one representative terminus per route, so labeling
   *  every train with it is an accuracy-first violation: a rider told
   *  "to Pelham Bay Park" who boards a Parkchester short-turn gets
   *  kicked off mid-route. MTA's NYCT feed carries the *complete*
   *  remaining trip (validated against the live 1/2/3/4/5/6 feed —
   *  never truncated to a sliding window), so the tail stop is the
   *  true terminus for this run. Omitted only for a degenerate trip
   *  update with no stop ids; the client falls back to the static
   *  line terminus then. */
  destStopId?: string;
};

export type TrainsResponse = {
  generatedAt: number;
  trains: Train[];
  arrivals: Arrival[];
};

type StopUpdate = {
  stopId?: string | null;
  arrival?: { time?: number | Long | null } | null;
  departure?: { time?: number | Long | null } | null;
};
type Long = { toNumber(): number };

const STATUS_NAMES = ["INCOMING_AT", "STOPPED_AT", "IN_TRANSIT_TO"] as const;

function toSec(t: number | Long | null | undefined): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  if (typeof t === "object" && typeof t.toNumber === "function") return t.toNumber();
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parentStop(id: string): string {
  return id.replace(/[NS]$/, "");
}

function dirFromStop(id: string): "N" | "S" {
  return id.endsWith("S") ? "S" : "N";
}

// The trip's realtime destination is its last future stop. Scan from
// the tail for the last entry that actually carries a stopId — a
// trailing entry with a null id must not erase the destination for
// the whole trip.
function destFromUpdates(updates: StopUpdate[]): string | undefined {
  for (let i = updates.length - 1; i >= 0; i--) {
    const sid = updates[i].stopId;
    if (sid) return parentStop(sid);
  }
  return undefined;
}

// Cross-poll memory of where each trip was last seen. MTA's GTFS-RT
// stopTimeUpdate only lists FUTURE stops, so an in-transit vehicle's
// `idx` in the update array is 0 and the prior stop is unrecoverable
// from a single snapshot. Persisting `(prev, cur)` between polls is
// the only way to keep a real previous stop available for the client
// to interpolate against — without it, every IN_TRANSIT_TO train
// arrives with prevStopId === nextStopId and renders pinned to the
// next platform until it teleports to the following one.
//
// Module scope on a Vercel Node runtime survives across requests in
// the same instance. A cold start drops the map, so the first poll
// after a new instance comes up will still teleport for one cycle —
// acceptable, and steady state recovers immediately.
type TripStopEntry = {
  prev: string;
  cur: string;
  sinceMs: number;
  lastSeenMs: number;
};
const tripStopCache = new Map<string, TripStopEntry>();
const TRIP_STOP_TTL_MS = 30 * 60 * 1000;

function pruneTripStopCache(nowMs: number) {
  const cutoff = nowMs - TRIP_STOP_TTL_MS;
  for (const [k, v] of tripStopCache) {
    if (v.lastSeenMs < cutoff) tripStopCache.delete(k);
  }
}

async function fetchFeed(url: string): Promise<{ trains: Train[]; arrivals: Arrival[] }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    captureWarning("MTA feed non-2xx", { feed: url, status: res.status });
    return { trains: [], arrivals: [] };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

  // Feed-header timestamp is the floor for per-train freshness: any
  // vehicle without its own `timestamp` is, at oldest, as fresh as the
  // header (the feed itself was assembled then). Decoded once here so
  // the per-entity loop doesn't pay for it repeatedly.
  const feedTs = toSec(feed.header?.timestamp);

  const updatesByTrip = new Map<string, StopUpdate[]>();
  const routeByTrip = new Map<string, string>();
  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    if (tu?.trip?.tripId) {
      updatesByTrip.set(tu.trip.tripId, (tu.stopTimeUpdate || []) as StopUpdate[]);
      if (tu.trip.routeId) routeByTrip.set(tu.trip.tripId, tu.trip.routeId);
    }
  }

  // Resolve each trip's destination once. Keyed by tripId so both the
  // vehicle loop (Train) and the stop-time loop (Arrival) stamp the
  // identical value — the synthesized "Now" row is built off Train, so
  // the two must not diverge.
  const destByTrip = new Map<string, string>();
  updatesByTrip.forEach((updates, tripId) => {
    const dest = destFromUpdates(updates);
    if (dest) destByTrip.set(tripId, dest);
  });

  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const trains: Train[] = [];
  const arrivals: Arrival[] = [];

  for (const e of feed.entity) {
    const v = e.vehicle;
    if (!v?.trip?.tripId || !v.stopId) continue;
    const tripId = v.trip.tripId;
    const stopId = v.stopId;
    const routeId = v.trip.routeId || routeByTrip.get(tripId) || "";
    const direction = dirFromStop(stopId);
    const updates = updatesByTrip.get(tripId) || [];
    const idx = updates.findIndex((u) => u.stopId === stopId);
    const parentCur = parentStop(stopId);

    // Update the cross-poll cache. When the train's current stopId
    // differs from the cached one, it advanced to a new stop —
    // promote the old `cur` to `prev` and reset the segment timer.
    // Otherwise, preserve the learned prev and the segment-entry
    // timestamp so progress can advance smoothly toward arrival.
    const cached = tripStopCache.get(tripId);
    let cachedPrev: string | null = null;
    let segmentSinceMs = nowMs;
    if (!cached) {
      tripStopCache.set(tripId, {
        prev: parentCur,
        cur: parentCur,
        sinceMs: nowMs,
        lastSeenMs: nowMs,
      });
    } else if (cached.cur !== parentCur) {
      cachedPrev = cached.cur;
      tripStopCache.set(tripId, {
        prev: cached.cur,
        cur: parentCur,
        sinceMs: nowMs,
        lastSeenMs: nowMs,
      });
    } else {
      cachedPrev = cached.prev !== parentCur ? cached.prev : null;
      segmentSinceMs = cached.sinceMs;
      cached.lastSeenMs = nowMs;
    }

    let prevStopId = parentCur;
    const nextStopId = parentCur;
    let progress = 0;
    const statusIdx = v.currentStatus ?? 2;
    const status = STATUS_NAMES[statusIdx] || "IN_TRANSIT_TO";

    if (status === "STOPPED_AT") {
      progress = 1;
    } else if (idx > 0) {
      // Trip update happens to include the prior stop — use it
      // directly so schedule-based progress stays accurate.
      const prev = updates[idx - 1];
      const cur = updates[idx];
      if (prev?.stopId) prevStopId = parentStop(prev.stopId);
      const prevDep = toSec(prev?.departure?.time) ?? toSec(prev?.arrival?.time);
      const curArr = toSec(cur?.arrival?.time);
      if (prevDep && curArr && curArr > prevDep) {
        progress = Math.max(0, Math.min(1, (now - prevDep) / (curArr - prevDep)));
      } else {
        progress = status === "INCOMING_AT" ? 0.9 : 0.5;
      }
    } else if (cachedPrev) {
      // Typical MTA shape: stopTimeUpdate is trimmed to future stops
      // only, so idx === 0 and the prior stop has to come from the
      // cross-poll cache. Progress is interpolated from the time we
      // first saw this segment to the next stop's scheduled arrival.
      prevStopId = cachedPrev;
      const curArr = idx >= 0 ? toSec(updates[idx]?.arrival?.time) : null;
      const sinceSec = Math.floor(segmentSinceMs / 1000);
      if (curArr && curArr > sinceSec) {
        progress = Math.max(0, Math.min(1, (now - sinceSec) / (curArr - sinceSec)));
      } else {
        progress = status === "INCOMING_AT" ? 0.9 : 0.5;
      }
    }

    // Per-vehicle timestamp wins; otherwise inherit the feed header.
    // Both can legitimately be missing (some MTA test feeds omit them
    // entirely), in which case we leave `lastReportedAt` undefined and
    // the client falls back to the snapshot's generatedAt.
    //
    // `> 0` because protobuf decodes a missing uint64 as 0, not null —
    // nullish coalescing alone would treat the proto-default zero as
    // a real timestamp and pin every vehicle to the epoch.
    const vTs = toSec(v.timestamp);
    const vehicleTs =
      vTs && vTs > 0 ? vTs : feedTs && feedTs > 0 ? feedTs : undefined;

    trains.push({
      id: tripId,
      routeId,
      direction,
      progress,
      prevStopId,
      nextStopId,
      status,
      ...(vehicleTs != null ? { lastReportedAt: vehicleTs } : {}),
      ...(destByTrip.has(tripId) ? { destStopId: destByTrip.get(tripId) } : {}),
    });
  }

  updatesByTrip.forEach((updates, tripId) => {
    const routeId = routeByTrip.get(tripId) || "";
    if (!routeId) return;
    const destStopId = destByTrip.get(tripId);
    for (const u of updates) {
      if (!u.stopId) continue;
      const eta = toSec(u.arrival?.time) ?? toSec(u.departure?.time);
      if (!eta || eta < now) continue;
      arrivals.push({
        routeId,
        stopId: parentStop(u.stopId),
        direction: dirFromStop(u.stopId),
        eta,
        tripId,
        destStopId,
      });
    }
  });

  return { trains, arrivals };
}

export async function GET() {
  pruneTripStopCache(Date.now());
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const trains: Train[] = [];
  const arrivals: Arrival[] = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      trains.push(...r.value.trains);
      arrivals.push(...r.value.arrivals);
    } else {
      failed++;
      captureException(r.reason, { what: "MTA feed fetch rejected" });
    }
  }
  // If every feed failed we still return a 200 with empty arrays so
  // the client renders the "stale / offline" state cleanly, but we
  // emit a structured warning so the outage is visible to whoever's
  // tailing logs / configured Sentry.
  if (failed === FEEDS.length) {
    captureWarning("All MTA feeds failed in one cycle", {
      failed,
      feeds: FEEDS.length,
    });
  } else if (failed > 0) {
    captureWarning("Partial MTA feed outage", {
      failed,
      feeds: FEEDS.length,
    });
  }

  // tripId-only dedup. MTA's feeds occasionally echo the same trip
  // across endpoints (the base nyct/gtfs feed and the route-specific
  // gtfs-ace / gtfs-bdfm overlap on some routes) — Map.set with
  // last-wins so the route-specific feed (listed after the base feed
  // in FEEDS) takes precedence.
  //
  // We deliberately do NOT dedup by (routeId, direction, stopId,
  // status). Earlier versions tried, but at TERMINUS stations
  // multiple trains legitimately queue up STOPPED_AT on the same
  // platform waiting to depart (the J at Broad St, the 1 at South
  // Ferry, etc.) — the layover queue is real, and dropping all but
  // one undercounts the actual schedule. IN_TRANSIT_TO bunching
  // during delays is the same kind of legitimate multi-train state.
  // Trust the feed; tripId is the only universally-safe dedup axis.
  const dedupedTrains = Array.from(
    trains.reduce((m, t) => m.set(t.id, t), new Map<string, Train>()).values(),
  );

  arrivals.sort((a, b) => a.eta - b.eta);
  const body: TrainsResponse = {
    generatedAt: Date.now(),
    trains: dedupedTrains,
    arrivals,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
