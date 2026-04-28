import { NextResponse } from "next/server";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

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
};

export type Arrival = {
  routeId: string;
  stopId: string;
  direction: "N" | "S";
  eta: number;
  tripId: string;
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

async function fetchFeed(url: string): Promise<{ trains: Train[]; arrivals: Arrival[] }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.warn(`MTA feed ${url} → ${res.status}`);
    return { trains: [], arrivals: [] };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);

  const updatesByTrip = new Map<string, StopUpdate[]>();
  const routeByTrip = new Map<string, string>();
  for (const e of feed.entity) {
    const tu = e.tripUpdate;
    if (tu?.trip?.tripId) {
      updatesByTrip.set(tu.trip.tripId, (tu.stopTimeUpdate || []) as StopUpdate[]);
      if (tu.trip.routeId) routeByTrip.set(tu.trip.tripId, tu.trip.routeId);
    }
  }

  const now = Math.floor(Date.now() / 1000);
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

    let prevStopId = parentStop(stopId);
    let nextStopId = parentStop(stopId);
    let progress = 0;
    const statusIdx = v.currentStatus ?? 2;
    const status = STATUS_NAMES[statusIdx] || "IN_TRANSIT_TO";

    if (status === "STOPPED_AT") {
      progress = 1;
    } else if (idx > 0) {
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
    }

    trains.push({
      id: tripId,
      routeId,
      direction,
      progress,
      prevStopId,
      nextStopId,
      status,
    });
  }

  updatesByTrip.forEach((updates, tripId) => {
    const routeId = routeByTrip.get(tripId) || "";
    if (!routeId) return;
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
      });
    }
  });

  return { trains, arrivals };
}

export async function GET() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const trains: Train[] = [];
  const arrivals: Arrival[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      trains.push(...r.value.trains);
      arrivals.push(...r.value.arrivals);
    } else {
      console.warn("Feed fetch failed:", r.reason);
    }
  }

  // Two-pass dedup. MTA's feeds occasionally echo the same physical
  // train across multiple endpoints — sometimes with the same tripId,
  // sometimes with a different one (the base nyct/gtfs feed and the
  // route-specific gtfs-ace / gtfs-bdfm / etc. occasionally name the
  // same trip differently after route reassignments). Without dedup
  // the map renders phantom stacks of "4 E trains" or "3 R trains" at
  // the same physical location.
  //
  // Pass 1: tripId — collapses obvious cross-feed dups where MTA was
  // consistent.
  // Pass 2: compound key (routeId, direction, prevStopId, nextStopId,
  // status). Two real physical trains physically can't share all five
  // — signaling enforces a minimum spacing of one block, so any pair
  // matching this key is the same train under different tripIds.
  // Last write wins in both passes; route-specific feeds listed after
  // the base feed in FEEDS naturally take precedence.
  const byId = new Map<string, Train>();
  for (const t of trains) byId.set(t.id, t);

  const seenSegmentKey = new Set<string>();
  const dedupedTrains: Train[] = [];
  for (const t of byId.values()) {
    const segmentKey = `${t.routeId}|${t.direction}|${t.prevStopId}|${t.nextStopId}|${t.status}`;
    if (seenSegmentKey.has(segmentKey)) continue;
    seenSegmentKey.add(segmentKey);
    dedupedTrains.push(t);
  }

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
