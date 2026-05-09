import type { Lines, SubwayLine } from "./subwayData";
import { haversineMeters, type StationEntry } from "./stopsIndex";
import type { Arrival } from "./useTrains";

export interface DirectRoute {
  routeId: string;
  direction: "N" | "S";
  /** How many stops between origin and destination on this route. Used to
   *  rank "best" routes when multiple options exist (the express that
   *  saves stops wins over the local that touches both ends). */
  stopCount: number;
}

export interface TripLeg {
  routeId: string;
  direction: "N" | "S";
  /** Specific platform stop_id where the rider boards. */
  boardStopId: string;
  /** Specific platform stop_id where the rider alights. */
  alightStopId: string;
  /** Canonical complex stopId of the boarding station — what the
   *  StationEntry uses as a stable id. May equal boardStopId when the
   *  station isn't part of a multi-platform complex. */
  boardComplexId: string;
  /** Canonical complex stopId of the alighting station. */
  alightComplexId: string;
  /** Stops traveled on this leg (alightIdx − boardIdx, sign-stripped). */
  stopCount: number;
  /** Other routeIds that traverse the same physical board→alight
   *  segment in the same direction. Populated by the path-aware dedup
   *  in `planTrips` when co-running routes (e.g., N/R/W on Broadway
   *  BMT, A/C on 8 Av) collapse into one plan. From the rider's
   *  perspective these are interchangeable: board whichever arrives
   *  first. The UI uses this to show all relevant route bullets and
   *  to surface live arrivals across siblings, not just the nominal
   *  `routeId` survivor. Undefined or empty when no siblings exist. */
  siblingRouteIds?: string[];
}

export interface TripPlan {
  legs: TripLeg[];
  /** Sum of `stopCount` across all legs. Used as the primary ranking
   *  metric within a (legCount) bucket. */
  totalStops: number;
  /** When `legs.length > 1`, the canonical complex stopId where the
   *  rider transfers. Undefined for direct trips. */
  transferComplexId?: string;
}

interface TripPlanOptions {
  /** Cap legs at `maxTransfers + 1`. Default 1 (so up to one transfer). */
  maxTransfers?: number;
  /** Cap returned plan count after sorting. Default 4. */
  maxResults?: number;
}

// Determine the compass direction (N/S) the rider must board to travel
// from `fromIdx` to `toIdx` along the line's stop array. GTFS lists
// stops terminus-to-terminus, and the lat of stops[0] vs stops[last]
// tells us which end is north.
function travelDirection(
  line: SubwayLine,
  fromIdx: number,
  toIdx: number,
): "N" | "S" | null {
  if (fromIdx === toIdx) return null;
  const first = line.stops[0];
  const last = line.stops[line.stops.length - 1];
  const firstIsNorth = first.lat > last.lat;
  const towardEnd = toIdx > fromIdx;
  return towardEnd ? (firstIsNorth ? "S" : "N") : firstIsNorth ? "N" : "S";
}

/**
 * Direct (no-transfer) routes between two complexes. Kept as a thin
 * wrapper around `planTrips({ maxTransfers: 0 })` so existing callers
 * (and tests) don't have to change shape, but the underlying engine is
 * the same.
 */
export function directRoutesBetween(
  lines: Lines,
  fromStopIds: string[],
  toStopIds: string[],
): DirectRoute[] {
  const fromSet = new Set(fromStopIds);
  const toSet = new Set(toStopIds);
  const out: DirectRoute[] = [];

  for (const line of Object.values(lines)) {
    if (line.stops.length < 2) continue;
    let fromIdx = -1;
    let toIdx = -1;
    for (let i = 0; i < line.stops.length; i++) {
      const id = line.stops[i].id;
      if (fromIdx === -1 && fromSet.has(id)) fromIdx = i;
      if (toIdx === -1 && toSet.has(id)) toIdx = i;
      if (fromIdx !== -1 && toIdx !== -1) break;
    }
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) continue;
    const direction = travelDirection(line, fromIdx, toIdx);
    if (!direction) continue;
    out.push({
      routeId: line.routeId,
      direction,
      stopCount: Math.abs(toIdx - fromIdx),
    });
  }
  return out;
}

/**
 * Plan trips between two complexes. Returns ranked trip plans with up
 * to one transfer (configurable via `maxTransfers`).
 *
 * Why complex-aware:
 *
 *   Riders treat a station complex as one place: at Union Sq the L
 *   (L03), the 4/5/6 (635), and the N/Q/R/W (R20) all share a transfer
 *   passage and one fare. The line.stops array, though, uses the
 *   individual platform stop_ids. Without a complex map, a "transfer
 *   from the L to the 4 at Union Sq" never lights up because no single
 *   stop_id appears on both lines. We use the StationEntry index (which
 *   already knows complex membership via the curated KNOWN_COMPLEXES
 *   list) to map stop_id → canonical complex_id, then route in
 *   complex-space. The TripLeg returned still carries the actual
 *   platform stop_ids so the UI can display the right station name and
 *   query arrivals on the correct platform.
 *
 * Algorithm:
 *
 *   1. Resolve the from/to stopId arrays into sets of complex_ids.
 *      If they overlap, return [] — the rider is already there.
 *   2. For each line, precompute its sequence of (complex_id, idx)
 *      pairs so the inner loops can scan a small array instead of
 *      re-iterating line.stops.
 *   3. DIRECT trips: for each line, if it touches both a from-complex
 *      and a to-complex (in different positions), it's a direct route.
 *      Direction comes from travelDirection.
 *   4. ONE-TRANSFER trips: for each line A serving any from-complex,
 *      walk every other complex on line A (in either direction). For
 *      each such candidate transfer complex C, look at every other
 *      line B that also touches C — if B reaches a to-complex from C,
 *      that's a valid 2-leg trip. Direction of each leg derived
 *      independently.
 *   5. Sort: prefer fewer legs, then fewer total stops. Dedup by
 *      (route_ids, transfer_complex) so we don't return three "L
 *      then transfer to 4 at Union Sq" plans that differ only in
 *      which platform_id was matched first.
 *
 * Limitations:
 *
 *   • Single transfer max. Real NYC trips occasionally need two (e.g.
 *     Brooklyn outer to Bronx outer), but >95% of intra-borough trips
 *     are direct or single-transfer.
 *   • Doesn't yet penalize for transfer time. A transfer that's fast
 *     in real life (cross-platform L↔M at Lorimer) ranks the same as
 *     a slow one (deep tunnel walks at Times Sq). Real arrival times
 *     on leg 2 would let us refine this; for now we trust the rider
 *     to choose between alternatives.
 *   • Express vs local share track on some segments but have different
 *     stop lists. We treat each route's stop list as authoritative —
 *     so an "express" plan that skips local stops shows fewer total
 *     stops than its local sibling, which is the rider-correct ranking.
 */
// Per-leg time model. These are tuned for NYC subway service:
// average headway off-peak is ~6–10 minutes (so half a headway is a
// reasonable wait estimate without live data), per-stop time on
// local lines averages ~90 seconds, and a typical in-system transfer
// takes 2–3 minutes (walk + wait). We override the wait term with
// the actual live next-train ETA whenever it's available.
const FALLBACK_WAIT_S = 4 * 60;
const TRAVEL_PER_STOP_S = 90;
const TRANSFER_S = 3 * 60;
// Walk-time helper assumes WALK_MPS = 1.4 m/s × GRID_FACTOR = 1.3
// (kept as constants here so this module doesn't take a circular
// import on stopsIndex).
const WALK_S_PER_M = 1.3 / 1.4;

export interface RankPlanOptions {
  /** Live arrivals at the boarding station, used to substitute the
   *  fallback first-leg wait with the actual next-train ETA. */
  arrivalsByStation?: Map<string, Arrival[]> | null;
  /** Wall-clock now in seconds (Date.now() / 1000). Required when
   *  arrivalsByStation is provided so the wait calculation is
   *  meaningful. */
  nowSec?: number;
  /** Walk distance in meters from the rider's actual origin (an
   *  address) to the boarding station. Adds to the leg-1 wait so
   *  trip totals reflect "leave home now to catch this."
   *  Used as a constant fallback when walkFromAnchor isn't
   *  provided. */
  walkFromMeters?: number;
  /** Walk distance in meters from the alighting station to the
   *  rider's actual destination (an address). Constant fallback. */
  walkToMeters?: number;
  /** Geocoded origin (address) coordinates. When provided alongside
   *  `stationsByComplexId`, the walk distance is computed PER PLAN
   *  using the plan's actual board station — so two plans that
   *  board at different complexes get walks specific to their
   *  boarding station rather than one shared "anchor walk." */
  walkFromAnchor?: { lng: number; lat: number };
  /** Geocoded destination (address) coordinates. Same per-plan
   *  walk computation as walkFromAnchor but for the alight side. */
  walkToAnchor?: { lng: number; lat: number };
  /** Map of complex stopId → StationEntry, needed to look up the
   *  lng/lat of a plan's board/alight complex when computing
   *  per-plan walks. */
  stationsByComplexId?: Map<string, StationEntry>;
}

/**
 * Estimate the total time for a trip plan in seconds. Components:
 *
 *   walk from origin
 * + first-leg wait (live ETA when available, else FALLBACK_WAIT_S)
 * + first-leg travel (stops × TRAVEL_PER_STOP_S)
 * + (optional) transfer (TRANSFER_S) + second-leg wait + travel
 * + walk to destination
 *
 * Does NOT model weekend/late-night frequency dropoff or service
 * changes; the live wait term is the strongest correction we can
 * apply with the data we have today.
 */
export function estimateTripTimeSec(
  plan: TripPlan,
  options: RankPlanOptions = {},
): number {
  const {
    arrivalsByStation,
    nowSec,
    walkFromMeters: walkFromConst = 0,
    walkToMeters: walkToConst = 0,
    walkFromAnchor,
    walkToAnchor,
    stationsByComplexId,
  } = options;

  // Resolve per-plan walks when anchors are provided. The plan's actual
  // board/alight complex tells us which station to measure to — so two
  // plans that board at different complexes (e.g. one at Wall St on the
  // 4/5, another at Rector St on the 1) get walks specific to their
  // boarding station rather than the same constant.
  const firstLeg = plan.legs[0];
  const lastLeg = plan.legs[plan.legs.length - 1];
  let walkFromMeters = walkFromConst;
  if (walkFromAnchor && stationsByComplexId && firstLeg) {
    const board = stationsByComplexId.get(firstLeg.boardComplexId);
    if (board) {
      walkFromMeters = haversineMeters(
        { lat: walkFromAnchor.lat, lng: walkFromAnchor.lng },
        { lat: board.lat, lng: board.lng },
      );
    }
  }
  let walkToMeters = walkToConst;
  if (walkToAnchor && stationsByComplexId && lastLeg) {
    const alight = stationsByComplexId.get(lastLeg.alightComplexId);
    if (alight) {
      walkToMeters = haversineMeters(
        { lat: walkToAnchor.lat, lng: walkToAnchor.lng },
        { lat: alight.lat, lng: alight.lng },
      );
    }
  }

  let total = walkFromMeters * WALK_S_PER_M;

  for (let i = 0; i < plan.legs.length; i++) {
    const leg = plan.legs[i];
    // Wait time for THIS leg's first train.
    let waitSec = FALLBACK_WAIT_S;
    if (
      i === 0 &&
      arrivalsByStation &&
      typeof nowSec === "number"
    ) {
      // Look up the soonest upcoming arrival at the boarding complex
      // matching this leg's route + direction. The arrivals lookup
      // is keyed on canonical complex stopId; the leg already
      // carries that.
      // Co-running routes (siblingRouteIds — N/R/W on Broadway BMT
      // etc.) count as the same option from the rider's perspective:
      // they share the platform, traverse the same complexes, so
      // whichever arrives first is "the train." Including siblings
      // here keeps the wait estimate truthful when the live next
      // train happens to be a sibling of the nominal routeId.
      const validRoutes = new Set<string>([leg.routeId]);
      if (leg.siblingRouteIds) {
        for (const sib of leg.siblingRouteIds) validRoutes.add(sib);
      }
      const arrivals = arrivalsByStation.get(leg.boardComplexId);
      if (arrivals) {
        let earliest = Infinity;
        for (const a of arrivals) {
          if (!validRoutes.has(a.routeId)) continue;
          if (a.direction !== leg.direction) continue;
          if (a.eta < nowSec - 5) continue; // already left
          if (a.eta < earliest) earliest = a.eta;
        }
        if (Number.isFinite(earliest)) {
          waitSec = Math.max(0, earliest - nowSec);
        }
      }
    } else if (i > 0) {
      // Transfer wait — we don't have live data for the rider's
      // arrival time at the transfer station, so use a constant.
      // The TRANSFER_S walk is added separately below.
      waitSec = FALLBACK_WAIT_S;
    }
    total += waitSec;
    if (i > 0) total += TRANSFER_S;
    total += leg.stopCount * TRAVEL_PER_STOP_S;
  }

  total += walkToMeters * WALK_S_PER_M;
  return total;
}

/**
 * Re-rank a planTrips() result by estimated total time. Returns a
 * new array; doesn't mutate. Useful when the rider has live arrivals
 * and walk distances — a route with a longer subway segment can be
 * faster overall if its next train arrives sooner.
 */
export function rankPlansByTime(
  plans: TripPlan[],
  options: RankPlanOptions = {},
): TripPlan[] {
  return plans
    .map((plan) => ({
      plan,
      seconds: estimateTripTimeSec(plan, options),
    }))
    .sort((a, b) => a.seconds - b.seconds)
    .map((p) => p.plan);
}

/**
 * Walk `line.shape` from the boarding stop's shape index to the
 * alighting stop's, returning the [lng, lat] coordinates of the leg.
 * The shape array runs terminus-to-terminus; depending on direction
 * the rider may travel toward higher or lower indices, so we slice
 * either way and return points in travel order.
 *
 * Returns `null` if either stop isn't on the line (defensive — a
 * well-formed TripLeg shouldn't hit this path) or if the indices
 * collapse to a single point. The `[lng, lat]` ordering matches the
 * GTFS shapes already in `line.shape`, so the result is drop-in for
 * a Mapbox LineString feature.
 */
export function legGeometry(
  line: SubwayLine,
  boardStopId: string,
  alightStopId: string,
): [number, number][] | null {
  const board = line.stops.find((s) => s.id === boardStopId);
  const alight = line.stops.find((s) => s.id === alightStopId);
  if (!board || !alight) return null;
  const a = board.shapeIdx;
  const b = alight.shapeIdx;
  if (a === b) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const slice = line.shape.slice(lo, hi + 1);
  // Reverse if the rider travels from higher to lower shape index, so
  // the returned points are in travel order (board → alight). Mapbox
  // doesn't care for line rendering but ordering matters if we ever
  // animate along the polyline.
  return a < b ? slice : slice.slice().reverse();
}

export function planTrips(
  lines: Lines,
  index: StationEntry[],
  fromStopIds: string[],
  toStopIds: string[],
  options: TripPlanOptions = {},
): TripPlan[] {
  const maxTransfers = options.maxTransfers ?? 1;
  const maxResults = options.maxResults ?? 4;

  // stop_id → canonical complex_id, populated from the index. Single
  // map covers every platform in every known complex; stations not in
  // a complex map to themselves.
  const stopToComplex = new Map<string, string>();
  for (const station of index) {
    for (const sid of station.stopIds) {
      stopToComplex.set(sid, station.stopId);
    }
  }

  const fromComplexes = new Set<string>();
  for (const sid of fromStopIds) {
    const c = stopToComplex.get(sid);
    if (c) fromComplexes.add(c);
  }
  const toComplexes = new Set<string>();
  for (const sid of toStopIds) {
    const c = stopToComplex.get(sid);
    if (c) toComplexes.add(c);
  }

  // Origin and destination overlap → the rider is already at their
  // destination (or origin and destination are the same complex). No
  // trip to plan.
  for (const c of fromComplexes) {
    if (toComplexes.has(c)) return [];
  }

  // Per-line sequence of (complex_id, idx, stopId). Skips line.stops
  // entries whose ids aren't in any complex (shouldn't happen, but
  // guards against future GTFS surprises).
  type LineComplex = { complexId: string; idx: number; stopId: string };
  const lineComplexes = new Map<string, LineComplex[]>();
  for (const line of Object.values(lines)) {
    if (line.stops.length < 2) continue;
    const arr: LineComplex[] = [];
    for (let i = 0; i < line.stops.length; i++) {
      const stopId = line.stops[i].id;
      const complexId = stopToComplex.get(stopId);
      if (complexId) {
        arr.push({ complexId, idx: i, stopId });
      }
    }
    if (arr.length >= 2) lineComplexes.set(line.routeId, arr);
  }

  const results: TripPlan[] = [];

  // ─── Direct trips ──────────────────────────────────────────────
  for (const line of Object.values(lines)) {
    const arr = lineComplexes.get(line.routeId);
    if (!arr) continue;
    let fromMatch: LineComplex | null = null;
    let toMatch: LineComplex | null = null;
    for (const lc of arr) {
      if (!fromMatch && fromComplexes.has(lc.complexId)) fromMatch = lc;
      if (!toMatch && toComplexes.has(lc.complexId)) toMatch = lc;
      if (fromMatch && toMatch) break;
    }
    if (!fromMatch || !toMatch || fromMatch.idx === toMatch.idx) continue;
    const direction = travelDirection(line, fromMatch.idx, toMatch.idx);
    if (!direction) continue;

    results.push({
      legs: [
        {
          routeId: line.routeId,
          direction,
          boardStopId: fromMatch.stopId,
          alightStopId: toMatch.stopId,
          boardComplexId: fromMatch.complexId,
          alightComplexId: toMatch.complexId,
          stopCount: Math.abs(toMatch.idx - fromMatch.idx),
        },
      ],
      totalStops: Math.abs(toMatch.idx - fromMatch.idx),
    });
  }

  // ─── One-transfer trips ────────────────────────────────────────
  if (maxTransfers >= 1) {
    for (const lineA of Object.values(lines)) {
      const arrA = lineComplexes.get(lineA.routeId);
      if (!arrA) continue;

      // First from-complex on line A. Bail if line A doesn't reach
      // any of the rider's origin complexes.
      let fromMatchA: LineComplex | null = null;
      for (const lc of arrA) {
        if (fromComplexes.has(lc.complexId)) {
          fromMatchA = lc;
          break;
        }
      }
      if (!fromMatchA) continue;

      // Walk every OTHER complex on line A as a candidate transfer.
      // Skip complexes that are already in the destination set —
      // those are handled by the direct trip pass.
      for (const candA of arrA) {
        if (candA.idx === fromMatchA.idx) continue;
        if (toComplexes.has(candA.complexId)) continue;
        if (fromComplexes.has(candA.complexId)) continue;

        const dirA = travelDirection(lineA, fromMatchA.idx, candA.idx);
        if (!dirA) continue;

        // For each OTHER line B serving the candidate complex
        for (const lineB of Object.values(lines)) {
          if (lineB.routeId === lineA.routeId) continue;
          const arrB = lineComplexes.get(lineB.routeId);
          if (!arrB) continue;

          // Find candidate complex on line B and the closest to-complex.
          let candB: LineComplex | null = null;
          let toMatchB: LineComplex | null = null;
          for (const lc of arrB) {
            if (!candB && lc.complexId === candA.complexId) candB = lc;
            if (!toMatchB && toComplexes.has(lc.complexId)) toMatchB = lc;
            if (candB && toMatchB) break;
          }
          if (!candB || !toMatchB || candB.idx === toMatchB.idx) continue;

          const dirB = travelDirection(lineB, candB.idx, toMatchB.idx);
          if (!dirB) continue;

          const stopsA = Math.abs(candA.idx - fromMatchA.idx);
          const stopsB = Math.abs(toMatchB.idx - candB.idx);

          results.push({
            legs: [
              {
                routeId: lineA.routeId,
                direction: dirA,
                boardStopId: fromMatchA.stopId,
                alightStopId: candA.stopId,
                boardComplexId: fromMatchA.complexId,
                alightComplexId: candA.complexId,
                stopCount: stopsA,
              },
              {
                routeId: lineB.routeId,
                direction: dirB,
                boardStopId: candB.stopId,
                alightStopId: toMatchB.stopId,
                boardComplexId: candB.complexId,
                alightComplexId: toMatchB.complexId,
                stopCount: stopsB,
              },
            ],
            totalStops: stopsA + stopsB,
            transferComplexId: candA.complexId,
          });
        }
      }
    }
  }

  // Sort: fewer legs, then fewer total stops.
  results.sort((a, b) => {
    if (a.legs.length !== b.legs.length) return a.legs.length - b.legs.length;
    return a.totalStops - b.totalStops;
  });

  // Dedupe in two passes:
  //
  //   1. Exact dedup by (routeId-direction|...) — kills truly identical
  //      plans (same line on same path).
  //
  //   2. Path dedup by (boardComplex→alightComplex|stopCount|...) —
  //      collapses co-running routes that share a physical track
  //      segment AND make the same number of stops between endpoints.
  //      The classic NYC case: between Times Sq and 5Av/59 St the N,
  //      R, and W all run the same Broadway BMT tunnel and stop at
  //      the same intermediate stations. From the rider's perspective
  //      that's ONE option ("take any Broadway-line train"), not
  //      three.
  //
  //      stopCount is part of the key on purpose: a 4 (express) and a
  //      6 (local) sharing endpoints (e.g. 125 St → 86 St) traverse
  //      the same trunk but make a very different number of stops.
  //      Collapsing them would either hide the local entirely or
  //      pair a sibling local's live wait with the express survivor's
  //      stopCount in `estimateTripTimeSec` — physically inconsistent.
  //      Keying on stopCount keeps express and local as distinct plans
  //      and reserves the sibling list for true peer trains.
  //
  //      We dedupe AFTER sorting so the surviving plan in each path
  //      group is the first one (already the lowest-stop bucket
  //      because of the sort). Collapsed routeIds are recorded on the
  //      survivor's leg as siblingRouteIds, so the UI can show all
  //      the bullets and aggregate live arrivals across the trunk
  //      rather than just the nominal survivor.
  const seen = new Set<string>();
  const seenPathToPlan = new Map<string, TripPlan>();
  const deduped: TripPlan[] = [];
  for (const plan of results) {
    const exactKey =
      plan.legs.map((l) => `${l.routeId}-${l.direction}`).join("|") +
      (plan.transferComplexId ? `:${plan.transferComplexId}` : "");
    if (seen.has(exactKey)) continue;
    seen.add(exactKey);

    const pathKey = plan.legs
      .map(
        (l) =>
          `${l.boardComplexId}>${l.alightComplexId}-${l.direction}-${l.stopCount}`,
      )
      .join("|");
    const survivor = seenPathToPlan.get(pathKey);
    if (survivor) {
      // Same path, different routeId(s). Merge each differing leg's
      // routeId into the survivor's per-leg sibling list. Mutating
      // the survivor is safe — it was constructed in this function
      // and hasn't escaped yet.
      for (let i = 0; i < survivor.legs.length; i++) {
        const survLeg = survivor.legs[i];
        const dupLeg = plan.legs[i];
        if (!dupLeg || dupLeg.routeId === survLeg.routeId) continue;
        if (!survLeg.siblingRouteIds) survLeg.siblingRouteIds = [];
        if (!survLeg.siblingRouteIds.includes(dupLeg.routeId)) {
          survLeg.siblingRouteIds.push(dupLeg.routeId);
        }
      }
      continue;
    }
    seenPathToPlan.set(pathKey, plan);
    deduped.push(plan);
  }

  // Strip redundant trunk transfers. If the 4 reaches the destination
  // directly AND the 5 reaches the destination directly, then a 4→5
  // (or 5→4) transfer plan is noise — the rider would just take
  // whichever train arrives first and stay on it. Same for N/R/W on
  // the BMT Broadway line, A/C on 8th Ave, etc. Generalized check:
  // any transfer plan whose first OR second leg's route also appears
  // in the direct-plan set is dropped. Riders who actually need a
  // cross-trunk transfer (e.g., 4 → L) keep their plan because
  // neither route alone reaches the destination.
  // Siblings of a direct plan's leg count too — if the rider has a
  // direct N/R/W via Broadway BMT, a transfer plan whose first leg
  // is "W to <somewhere>" is the same noise.
  const directRoutes = new Set<string>();
  for (const plan of deduped) {
    if (plan.legs.length !== 1) continue;
    const leg = plan.legs[0];
    directRoutes.add(leg.routeId);
    if (leg.siblingRouteIds) {
      for (const sib of leg.siblingRouteIds) directRoutes.add(sib);
    }
  }
  const trimmed = deduped.filter((plan) => {
    if (plan.legs.length === 1) return true;
    if (directRoutes.has(plan.legs[0].routeId)) return false;
    if (directRoutes.has(plan.legs[1].routeId)) return false;
    return true;
  });

  return trimmed.slice(0, maxResults);
}
