import type { Lines } from "./subwayData";

export interface RouteBadge {
  id: string;
  routeId: string;
  color: string;
  textColor: "white" | "black";
}

export interface StationEntry {
  stopId: string; // canonical (first) stop id — used by favorites, keys
  // All stop ids that belong to this station complex. Union Square serves
  // 4/5/6 (id 635), N/Q/R/W (id R20), and L (id L03) via three separate
  // MTA stop records that share a name and sit within the same block —
  // merged into one entry here so the station panel surfaces every line
  // at the complex instead of whichever dot you happened to tap.
  stopIds: string[];
  name: string;
  lat: number;
  lng: number;
  routes: RouteBadge[];
}

export interface NearbyStation extends StationEntry {
  meters: number;
}

// Great-circle distance in meters. Good enough at NYC scale; the error vs.
// projected walking distance is dwarfed by the 1.3× grid-detour factor we
// apply when estimating walk time.
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Collapse per-line stop lists into one entry per physical station. Two
// layers of merging:
//
// 1) Same stop id across lines. The same stop appears in multiple SubwayLine
//    entries (e.g. the "6" and "4" entries both list stop id 635), and we
//    want a single entry with both route badges.
//
// 2) Station complexes. The MTA feed assigns different stop ids to different
//    physical platforms inside the same transfer complex: Union Square is
//    635 (4/5/6), R20 (N/Q/R/W), and L03 (L). All three share the name
//    "14 St-Union Sq" and sit within ~100m. The GTFS `transfers.txt` file
//    identifies these groupings officially, but we don't build from GTFS
//    at runtime, so we use a name+proximity heuristic: stops with identical
//    name within COMPLEX_RADIUS_M of an existing entry merge into it.
//    Catches every documented complex in the MTA system without pulling in
//    hundreds of false positives (two unrelated "23 St" stops on different
//    trunks are ~500m apart, well outside the radius).
//
// Complex entries carry every member's stopId in `stopIds` so the station
// panel can surface arrivals from any of them. The canonical `stopId` is
// the first member encountered — used as a stable favorites/React key.
const COMPLEX_RADIUS_M = 250;

export function buildStationIndex(lines: Lines): StationEntry[] {
  // First pass: one entry per unique stopId, carrying the union of its
  // routes. This is the existing "same stop across multiple lines" merge.
  const byStopId = new Map<string, StationEntry>();
  for (const line of Object.values(lines)) {
    const badge: RouteBadge = {
      id: line.id,
      routeId: line.routeId,
      color: line.color,
      textColor: line.textColor,
    };
    for (const stop of line.stops) {
      const existing = byStopId.get(stop.id);
      if (existing) {
        if (!existing.routes.some((r) => r.routeId === line.routeId)) {
          existing.routes.push(badge);
        }
      } else {
        byStopId.set(stop.id, {
          stopId: stop.id,
          stopIds: [stop.id],
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          routes: [badge],
        });
      }
    }
  }

  // Second pass: merge complexes. Walk every stop-id entry in a stable
  // order; for each, look for an already-accepted entry with the same name
  // whose coordinates are within COMPLEX_RADIUS_M — if one exists, fold the
  // new entry into it. Otherwise, start a new complex entry.
  const byNameBucket = new Map<string, StationEntry[]>();
  const complexes: StationEntry[] = [];
  for (const entry of byStopId.values()) {
    const bucket = byNameBucket.get(entry.name) ?? [];
    const match = bucket.find(
      (e) => haversineMeters(e, entry) <= COMPLEX_RADIUS_M,
    );
    if (match) {
      // Fold: extend stopIds, union routes (preserving first-seen order
      // so bullet ordering stays stable across polls).
      for (const id of entry.stopIds) {
        if (!match.stopIds.includes(id)) match.stopIds.push(id);
      }
      for (const r of entry.routes) {
        if (!match.routes.some((x) => x.routeId === r.routeId)) {
          match.routes.push(r);
        }
      }
    } else {
      bucket.push(entry);
      byNameBucket.set(entry.name, bucket);
      complexes.push(entry);
    }
  }
  return complexes;
}

// Simple multi-term substring search over station names. The MTA station
// list is small (~470) and names are short, so a full-text library would
// be overkill. Splitting by whitespace means "union sq" matches "14 St-
// Union Sq" without caring about order or extra punctuation.
export function searchStations(
  index: StationEntry[],
  query: string,
  limit = 30,
): StationEntry[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  const scored: { station: StationEntry; score: number }[] = [];
  for (const s of index) {
    const name = s.name.toLowerCase();
    if (!terms.every((t) => name.includes(t))) continue;
    // Lightweight scoring: earlier match position on the first term wins,
    // with a small bonus when the whole query starts the name. Good enough
    // to float "Union Square" above "14 St-Union Sq" if both match.
    const first = name.indexOf(terms[0]);
    const prefixBonus = name.startsWith(query.toLowerCase()) ? -100 : 0;
    scored.push({ station: s, score: first + prefixBonus });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((e) => e.station);
}

// Return the `limit` nearest stations to a given point, sorted ascending by
// distance. Brute-force over all ~470 stations; measured at <1ms on an iPhone
// 12, so not worth a spatial index yet.
export function nearestStations(
  index: StationEntry[],
  lng: number,
  lat: number,
  limit = 5,
): NearbyStation[] {
  const withDist: NearbyStation[] = index.map((s) => ({
    ...s,
    meters: haversineMeters({ lat, lng }, { lat: s.lat, lng: s.lng }),
  }));
  withDist.sort((a, b) => a.meters - b.meters);
  return withDist.slice(0, limit);
}

// Catchable-train verdict — the hero feature. Given how far away the user is
// and when a train is due, decide whether they can walk, need to run, or
// have already missed it.
//
// Model (deliberately simple, tuned for NYC):
//   walk_seconds = dist_m * 1.3 / 1.4 + 20s entry overhead
//   run_seconds  = dist_m * 1.3 / 2.5 + 20s entry overhead
//
//   1.3× grid-detour factor — haversine is as-the-crow-flies; NYC blocks
//     make the actual walk ~20–40% longer. 1.3 is a conservative middle.
//   1.4 m/s  — normative NYC walking pace (~3.1 mph).
//   2.5 m/s  — a brisk jog, not a sprint. Someone in business shoes can
//     sustain this for a few blocks.
//   20s entry overhead — stairs, turnstile, descend to platform. The MTA
//     countdown clocks trigger "arriving" at the station, not at the
//     platform edge, so some buffer is mandatory or every "Run" lies.
//
// Verdicts:
//   "miss" — even running won't make it
//   "run"  — running makes it, walking doesn't
//   "walk" — walking makes it with <2 min to spare
//   "chill" — 2+ min buffer even at walking pace (don't decorate the row)
export type CatchVerdict = "miss" | "run" | "walk" | "chill";

const WALK_MPS = 1.4;
const RUN_MPS = 2.5;
const GRID_FACTOR = 1.3;
const ENTRY_OVERHEAD_S = 20;
const CHILL_BUFFER_S = 120;

export function catchVerdict(
  distanceMeters: number,
  etaSec: number,
  nowSec: number,
): CatchVerdict {
  const remaining = etaSec - nowSec;
  const walkable = (distanceMeters * GRID_FACTOR) / WALK_MPS + ENTRY_OVERHEAD_S;
  const runnable = (distanceMeters * GRID_FACTOR) / RUN_MPS + ENTRY_OVERHEAD_S;
  if (remaining < runnable) return "miss";
  if (remaining < walkable) return "run";
  if (remaining < walkable + CHILL_BUFFER_S) return "walk";
  return "chill";
}
