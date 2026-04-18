import type { Lines } from "./subwayData";

export interface RouteBadge {
  id: string;
  routeId: string;
  color: string;
  textColor: "white" | "black";
}

export interface StationEntry {
  stopId: string; // parent station id (N/S suffixes stripped upstream)
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

// Collapse per-line stop lists into one entry per physical station. The same
// stop appears in multiple SubwayLine entries (e.g. Union Sq shows up on
// 4/5/6, N/Q/R/W, L) — we merge so the panel shows one row with every route
// serving it. Coordinates come from the first occurrence, which is fine:
// GTFS coordinates for the same parent_station agree across lines in the
// MTA feed.
export function buildStationIndex(lines: Lines): StationEntry[] {
  const map = new Map<string, StationEntry>();
  for (const line of Object.values(lines)) {
    const badge: RouteBadge = {
      id: line.id,
      routeId: line.routeId,
      color: line.color,
      textColor: line.textColor,
    };
    for (const stop of line.stops) {
      const existing = map.get(stop.id);
      if (existing) {
        if (!existing.routes.some((r) => r.routeId === line.routeId)) {
          existing.routes.push(badge);
        }
      } else {
        map.set(stop.id, {
          stopId: stop.id,
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          routes: [badge],
        });
      }
    }
  }
  return [...map.values()];
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
