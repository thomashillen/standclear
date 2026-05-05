// Time-keyed trajectory model for a train along its line shape.
//
// Why this exists: the previous animation predicted forward motion
// from per-train velocity learning over poll-to-poll progress deltas.
// That model assumed the GTFS-RT feed kept progress continuous
// between station snapshots. Several routes (the R is a frequent
// offender, plus some peak express trips) only refresh their feed
// when a train arrives at a station — between stations the feed
// reports STOPPED_AT_A indefinitely, so observed velocity decays to
// zero and the marker teleports station-to-station on each poll.
//
// What we use instead: each train's *future ETAs* (the `arrivals`
// payload, filtered to this train's tripId) tell us when the MTA
// expects this exact train to reach each upcoming stop. We anchor
// the train's current position at `generatedAt` and stitch the
// future ETAs onto a single trajectory expressed as
// `(arcLength along line shape, wall-clock time)` waypoints. Linear
// interpolation between waypoints gives a continuous position
// function in time — the animation is paced by the MTA's actual
// predictions instead of guessed velocity, and segment boundaries
// no longer require special-casing because arcLength is unbroken
// across them.
//
// On each poll, trajectories are rebuilt from the fresh data. A
// small per-frame LERP in the consumer (useTrainMarkers) smooths
// the visual when the new trajectory's position-at-now differs from
// the prior one's.

import type { Arrival, Train } from "@/app/api/trains/route";
import type { Stop, SubwayLine } from "./subwayData";

// Cumulative chord-length distance from shape[0] up to each shape
// index, plus the total. Units are raw degrees (Math.hypot of
// lng/lat deltas) — fine for relative timing within a single line
// because numerator and denominator are in the same unit. Computed
// once per `lines` change and reused across every poll/frame.
export interface ShapeMetrics {
  cumLength: number[];
  total: number;
}

export function computeShapeMetrics(line: SubwayLine): ShapeMetrics {
  const shape = line.shape;
  const cumLength = new Array<number>(shape.length).fill(0);
  let total = 0;
  for (let i = 1; i < shape.length; i++) {
    const dx = shape[i][0] - shape[i - 1][0];
    const dy = shape[i][1] - shape[i - 1][1];
    total += Math.hypot(dx, dy);
    cumLength[i] = total;
  }
  return { cumLength, total };
}

export interface Waypoint {
  /** Distance along line.shape from shape[0] (in raw degrees). */
  arcLength: number;
  /** Wall-clock ms when the train is expected to be at this arcLength. */
  time: number;
}

export interface Trajectory {
  trainId: string;
  routeId: string;
  /** Sorted by `time` ascending. `arcLength` is monotonic in one
   *  direction (increasing for trains running with the shape order,
   *  decreasing for the opposite direction). */
  waypoints: Waypoint[];
}

export interface Position {
  lng: number;
  lat: number;
  bearing: number;
}

/**
 * Convert a fractional arcLength back to [lng, lat] + the local
 * bearing along the shape. `motionDir` is +1 if the train is moving
 * with shape order (arcLength increasing over time) and -1 if
 * against (arcLength decreasing); it flips the bearing 180° in the
 * latter case so the train icon faces its actual travel direction.
 */
export function shapePositionAtArc(
  line: SubwayLine,
  metrics: ShapeMetrics,
  arcLength: number,
  motionDir: number,
): Position {
  const cum = metrics.cumLength;
  const last = cum.length - 1;
  // Clamp before binary search so out-of-range queries land at an
  // endpoint instead of falling off the array.
  if (arcLength <= 0) {
    return endpointPosition(line, 0, motionDir);
  }
  if (arcLength >= cum[last]) {
    return endpointPosition(line, last, motionDir);
  }
  // Binary search for the index where cum[lo] <= arcLength < cum[hi].
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (cum[mid] <= arcLength) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const f = segLen > 0 ? (arcLength - cum[lo]) / segLen : 0;
  const a = line.shape[lo];
  const b = line.shape[hi];
  const lng = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const fwd = bearingDeg(a, b);
  return {
    lng,
    lat,
    bearing: motionDir >= 0 ? fwd : (fwd + 180) % 360,
  };
}

function endpointPosition(
  line: SubwayLine,
  shapeIdx: number,
  motionDir: number,
): Position {
  const shape = line.shape;
  const idx = Math.min(Math.max(shapeIdx, 0), shape.length - 1);
  // Use a neighbor to compute a stable tangent at the endpoint.
  const a =
    idx > 0 ? shape[idx - 1] : shape[Math.min(1, shape.length - 1)];
  const b =
    idx < shape.length - 1
      ? shape[idx + 1]
      : shape[Math.max(shape.length - 2, 0)];
  const fwd = bearingDeg(a, b);
  return {
    lng: shape[idx][0],
    lat: shape[idx][1],
    bearing: motionDir >= 0 ? fwd : (fwd + 180) % 360,
  };
}

// Compass bearing (0=N, 90=E, …) from a→b, accounting for lat
// distortion of longitude. Mirrors the helper inside useTrains so we
// stay consistent across modules.
export function bearingDeg(
  a: [number, number],
  b: [number, number],
): number {
  const dLng = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  const dLat = b[1] - a[1];
  if (dLng === 0 && dLat === 0) return 0;
  return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
}

/**
 * Build a time-keyed trajectory for one train. Anchors at the train's
 * current arcLength (computed from `prevStopId`/`nextStopId`/`progress`)
 * at `generatedAtMs`, then appends the trip's future ETAs as waypoints.
 *
 * Returns null only when the train can't be placed on the line at all
 * (unknown prev/next stop) — callers should fall back to skipping the
 * train rather than rendering a stale state.
 */
export function buildTrajectory(
  train: Train,
  tripArrivals: Arrival[],
  line: SubwayLine,
  metrics: ShapeMetrics,
  generatedAtMs: number,
): Trajectory | null {
  // Stop lookup by id so we can resolve arrival.stopId → shapeIdx.
  // Computed per-train rather than passed in: at NYC scale each
  // line has ≤ ~50 stops, the cost is negligible, and it keeps the
  // function pure (no caller-managed scratch state to leak).
  const stopMap = new Map<string, Stop>();
  for (const s of line.stops) stopMap.set(s.id, s);

  const prev = stopMap.get(train.prevStopId);
  const next = stopMap.get(train.nextStopId);
  if (!prev || !next) return null;

  // Current arcLength: dwelling at a stop (prev === next) parks
  // exactly at the stop's shape index; mid-segment trains
  // interpolate by `progress`.
  const prevArc = metrics.cumLength[prev.shapeIdx];
  const nextArc = metrics.cumLength[next.shapeIdx];
  const currentArc =
    prev.shapeIdx === next.shapeIdx
      ? prevArc
      : prevArc + (nextArc - prevArc) * train.progress;

  const waypoints: Waypoint[] = [
    { arcLength: currentArc, time: generatedAtMs },
  ];

  // Future ETAs become the rest of the trajectory. ETA is in seconds
  // (see app/api/trains/route.ts: toSec → unix seconds), generatedAt
  // is in ms — we convert at the boundary so all internal time
  // arithmetic is in ms.
  const futureArrivals = tripArrivals
    .filter((a) => a.eta * 1000 > generatedAtMs)
    .slice() // tripArrivals is already sorted in upstream pipeline,
    // but defensive sort is cheap (≤ ~30 entries per trip).
    .sort((a, b) => a.eta - b.eta);

  for (const a of futureArrivals) {
    const stop = stopMap.get(a.stopId);
    if (!stop) continue;
    waypoints.push({
      arcLength: metrics.cumLength[stop.shapeIdx],
      time: a.eta * 1000,
    });
  }

  // Direction sign: arcLength either increases or decreases over
  // time, depending on whether the train runs with or against
  // shape order. We pick the sign from the FIRST forward gap
  // (current → first arrival) and drop any later waypoints that
  // contradict it. A non-monotonic ETA list is a feed anomaly —
  // showing the train teleporting backward to satisfy the data
  // would be worse than dropping the bad point.
  if (waypoints.length >= 2) {
    const dir = Math.sign(waypoints[1].arcLength - waypoints[0].arcLength);
    if (dir !== 0) {
      const filtered: Waypoint[] = [waypoints[0]];
      let lastArc = waypoints[0].arcLength;
      let lastTime = waypoints[0].time;
      for (let i = 1; i < waypoints.length; i++) {
        const w = waypoints[i];
        if (
          Math.sign(w.arcLength - lastArc) === dir &&
          w.time > lastTime
        ) {
          filtered.push(w);
          lastArc = w.arcLength;
          lastTime = w.time;
        }
      }
      waypoints.length = 0;
      waypoints.push(...filtered);
    }
  }

  // Fallback: no future ETAs (last stop on a trip, or arrivals data
  // hadn't caught up yet). Synthesize one waypoint at the next stop
  // using a typical inter-station travel time so the marker still
  // creeps forward instead of freezing.
  if (waypoints.length === 1 && prev.shapeIdx !== next.shapeIdx) {
    const TYPICAL_TRAVEL_SEC = 90;
    const remaining = 1 - train.progress;
    waypoints.push({
      arcLength: nextArc,
      time: generatedAtMs + remaining * TYPICAL_TRAVEL_SEC * 1000,
    });
  }

  return { trainId: train.id, routeId: train.routeId, waypoints };
}

/**
 * Sample the trajectory at a wall-clock time. Outside the trajectory
 * window (before first waypoint or after last) the position is
 * clamped to the nearest endpoint — a train that has run past the
 * end of its known trajectory just dwells at the last predicted
 * stop rather than spilling off the line.
 */
export function positionAt(
  traj: Trajectory,
  line: SubwayLine,
  metrics: ShapeMetrics,
  nowMs: number,
): Position | null {
  const { waypoints } = traj;
  if (waypoints.length === 0) return null;

  if (waypoints.length === 1) {
    return shapePositionAtArc(line, metrics, waypoints[0].arcLength, 1);
  }

  if (nowMs <= waypoints[0].time) {
    const dir = Math.sign(waypoints[1].arcLength - waypoints[0].arcLength) || 1;
    return shapePositionAtArc(line, metrics, waypoints[0].arcLength, dir);
  }

  const last = waypoints[waypoints.length - 1];
  if (nowMs >= last.time) {
    const prevW = waypoints[waypoints.length - 2];
    const dir = Math.sign(last.arcLength - prevW.arcLength) || 1;
    return shapePositionAtArc(line, metrics, last.arcLength, dir);
  }

  // Find the segment containing nowMs. Linear scan is fine — typical
  // trip has ≤ ~30 waypoints, and rebuilding trajectories every
  // ~8s amortizes against per-frame searches.
  for (let i = 0; i < waypoints.length - 1; i++) {
    const w0 = waypoints[i];
    const w1 = waypoints[i + 1];
    if (nowMs >= w0.time && nowMs <= w1.time) {
      const span = Math.max(1, w1.time - w0.time);
      const t = (nowMs - w0.time) / span;
      const arcLength = w0.arcLength + (w1.arcLength - w0.arcLength) * t;
      const dir = Math.sign(w1.arcLength - w0.arcLength) || 1;
      return shapePositionAtArc(line, metrics, arcLength, dir);
    }
  }

  // Unreachable given the bounds checks above, but keep the function
  // total for callers.
  return null;
}
