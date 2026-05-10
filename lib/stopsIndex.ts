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

// Authoritative list of multi-line transfer complexes. Each inner array is
// the parent_stop_ids that share a single physical complex (in-system
// transfer between platforms, no fare needed). Merging happens ONLY for
// stop_ids listed here — anything else stays as its own station.
//
// Why an explicit list and not name+proximity heuristics:
//
//   The previous heuristic merged any same-name stops within 250m. That
//   caught real complexes like Union Sq, Times Sq, and W 4 St, but also
//   produced false positives. A real example: Rector St on the 1 train
//   (139, at Greenwich St) and Rector St on the R/W (R26, at Trinity Pl)
//   sit ~49m apart and share a name, yet have NO underground connection
//   — they're separate stations across the street from each other.
//   Same trap with Wall St (2/3) vs Wall St (4/5) at 247m, and others.
//
//   Distance alone can't separate "platforms inside one complex" from
//   "two stations across the street" — they overlap. Using an allowlist
//   curated from MTA's station_complex data eliminates the false
//   positives. Stations missing from the list are merely not merged
//   (riders see them as distinct entries); the only cost of an
//   incomplete list is that a connected complex shows as multiple rows
//   instead of one. That's recoverable, vs. the prior bug where two
//   unrelated stations were impossible to tell apart.
//
//   Future work: parse transfers.txt during the GTFS build step and emit
//   the complex map into gtfsData.json so this table is data-driven.
const KNOWN_COMPLEXES: string[][] = [
  ["635", "L03", "R20"],          // 14 St-Union Sq (4/5/6 + L + N/Q/R/W)
  ["132", "A31", "L01", "L02", "D19"], // West 14 St (1/2/3 + A/C/E + L + F/M) — connected via passageways across 7/8/6 Aves
  ["127", "725", "R16", "902"],   // Times Sq-42 St (1/2/3 + 7 + N/Q/R/W + S shuttle)
  ["631", "723", "901"],          // Grand Central-42 St (4/5/6 + 7 + S shuttle)
  ["D17", "R17"],                 // 34 St-Herald Sq (B/D/F/M + N/Q/R/W)
  ["125", "A24"],                 // 59 St-Columbus Circle (1 + A/B/C/D)
  ["629", "R11"],                 // Lexington Av/59 St (4/5/6 + N/R/W)
  ["630", "F11"],                 // 51 St (6) + Lexington Av/53 St (E)
  ["A32", "D20"],                 // W 4 St-Wash Sq (A/C/E + B/D/F/M)
  ["637", "D21"],                 // Bleecker St (6) + Broadway-Lafayette (B/D/F/M)
  ["235", "D24", "R31"],          // Atlantic Av-Barclays Ctr (2/3/4/5 + B/Q + D/N/R/W)
  ["A51", "J27", "L22"],          // Broadway Junction (A/C + J/Z + L)
  ["719", "G22", "F09"],          // Court Sq (7 + G + E/M)
  ["232", "423"],                 // Borough Hall (R + 4/5)
  ["A41", "R29"],                 // Jay St-MetroTech (A/C/F + R)
  ["229", "418", "A38", "M22"],   // Fulton St (2/3 + 4/5 + A/C + J/Z) — NOT G36 in Brooklyn
  ["F15", "M18"],                 // Delancey St-Essex St (F + J/M/Z)
];

export function buildStationIndex(lines: Lines): StationEntry[] {
  // First pass: one entry per unique stopId, carrying the union of its
  // routes. The same stop appears in multiple SubwayLine entries (e.g.
  // the "6" and "4" entries both list stop id 635), and we want a single
  // entry with both route badges attached.
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

  // Second pass: merge across stop_ids only when an authoritative complex
  // group declares them connected. Coordinates of the merged entry use the
  // centroid of present members so distance-from-user calcs are balanced
  // (Times Sq's centroid sits between the 1/2/3 and N/Q/R/W platforms,
  // not skewed to whichever stop_id was listed first).
  const merged = new Set<string>();
  const complexes: StationEntry[] = [];

  for (const group of KNOWN_COMPLEXES) {
    const members = group
      .map((id) => byStopId.get(id))
      .filter((e): e is StationEntry => Boolean(e));
    if (members.length === 0) continue;
    if (members.length === 1) {
      // A complex with only one member present in the data isn't really
      // a merged complex — fall through and let it be added as a plain
      // station below (avoids a redundant entry).
      continue;
    }
    const canonical = members[0];
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
    const entry: StationEntry = {
      stopId: canonical.stopId,
      stopIds: [],
      name: canonical.name,
      lat,
      lng,
      routes: [],
    };
    for (const m of members) {
      for (const id of m.stopIds) {
        if (!entry.stopIds.includes(id)) entry.stopIds.push(id);
        merged.add(id);
      }
      for (const r of m.routes) {
        if (!entry.routes.some((x) => x.routeId === r.routeId)) {
          entry.routes.push(r);
        }
      }
    }
    complexes.push(entry);
  }

  // Anything not absorbed into a known complex stays as its own station.
  for (const entry of byStopId.values()) {
    if (entry.stopIds.every((id) => !merged.has(id))) {
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

/**
 * Return all stations within `maxMeters` of the given point, plus the
 * absolute nearest as a guaranteed fallback so the caller never gets an
 * empty list. Capped to `limit` results so the routing engine doesn't
 * explode when the rider is in a station-dense area like Midtown.
 *
 * Used by the trip planner: when the rider's origin or destination is a
 * geocoded address, we want to consider EVERY nearby station as a
 * boarding/alighting candidate. The single-nearest approach (used by
 * earlier versions) misses cases like 5 Av/59 St (N/R/W) vs Lexington
 * Av/59 St (4/5/6) — different complexes, same address, very different
 * trip implications. ~700m ≈ 9 min walk, the threshold most riders
 * tolerate before it becomes a bus or cab decision.
 */
export function nearestStationsWithin(
  index: StationEntry[],
  lng: number,
  lat: number,
  maxMeters: number,
  limit = 8,
): NearbyStation[] {
  const withDist: NearbyStation[] = index.map((s) => ({
    ...s,
    meters: haversineMeters({ lat, lng }, { lat: s.lat, lng: s.lng }),
  }));
  withDist.sort((a, b) => a.meters - b.meters);
  const within = withDist.filter((s) => s.meters <= maxMeters);
  // Always include the nearest station even if it's outside the radius
  // — better to walk an extra block than show "no routes" because the
  // address is in a station-thin neighborhood.
  if (within.length === 0 && withDist.length > 0) return [withDist[0]];
  return within.slice(0, limit);
}

// Catchable-train verdict — the hero feature. Given how far away the user is
// and when a train is due, decide whether they can walk, need to run, or
// have already missed it.
//
// Model (deliberately simple, tuned for NYC):
//   walk_seconds = dist_m * 1.3 / 1.4 + 20s entry overhead
//   run_seconds  = dist_m * 1.3 / 3.5 + 20s entry overhead
//
//   1.3× grid-detour factor — haversine is as-the-crow-flies; NYC blocks
//     make the actual walk ~20–40% longer. 1.3 is a conservative middle.
//   1.4 m/s  — normative NYC walking pace (~3.1 mph).
//   3.5 m/s  — a real run, not a jog. The previous 2.5 m/s was a brisk
//     jog and made the verdict too pessimistic: a 100m / 60s arrival
//     came back as "miss" when most adults can sprint that comfortably.
//     3.5 m/s ≈ 7.8 mph — short-distance "running for the train" pace,
//     achievable for a fit adult over 100–300m without elite training.
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
const RUN_MPS = 3.5;
const GRID_FACTOR = 1.3;
const ENTRY_OVERHEAD_S = 20;
const CHILL_BUFFER_S = 120;

/**
 * Estimate walking time in minutes for a given as-the-crow-flies
 * distance, using the same NYC pedestrian model as `catchVerdict`:
 * 1.4 m/s walking pace × 1.3 grid-detour factor. Floor of 1 min so
 * a 50-meter walk doesn't render as "0 min walk" in the trip planner.
 */
export function walkMinutes(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  const seconds = (meters * GRID_FACTOR) / WALK_MPS;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * "5 min walk · 320 m" summary for nearby/search station rows. The
 * walk-minute estimate uses the same NYC pedestrian model as
 * `walkMinutes` / `catchVerdict`; meters are right-sized to "X m" or
 * "Y.Z km" via the same threshold the trip-planner walking legs use.
 *
 * For a sub-minute distance (rider standing on top of the entrance,
 * meters === 0) we fall back to "0 m away" so the row still has a
 * usable label rather than a misleading "0 min walk · 0 m". Apple
 * Maps surfaces walking minutes prominently because that's the unit
 * a NYC rider actually budgets in — meters stay alongside as a
 * secondary spatial check.
 */
export function formatWalkSummary(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  const dist =
    meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1)} km`;
  const min = walkMinutes(meters);
  if (min <= 0) return `${dist} away`;
  return `${min} min walk · ${dist}`;
}

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
