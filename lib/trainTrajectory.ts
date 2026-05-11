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
  /** +1 if the train moves with shape order (arcLength increasing
   *  over time), -1 if against. Used by the consumer to enforce a
   *  forward-only constraint on the rendered marker (so the visual
   *  never rubber-bands backward when a poll re-anchors), and by
   *  positionAt to orient the bearing for parked trains whose
   *  trajectory has only one waypoint. */
  motionDir: 1 | -1;
}

export interface Position {
  lng: number;
  lat: number;
  bearing: number;
  /** Distance along line.shape from shape[0]. Echoed back from the
   *  position query so consumers can clamp / compare arc-space
   *  positions without re-computing the binary search. */
  arcLength: number;
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
    return endpointPosition(line, 0, motionDir, 0);
  }
  if (arcLength >= cum[last]) {
    return endpointPosition(line, last, motionDir, cum[last]);
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
    arcLength,
  };
}

function endpointPosition(
  line: SubwayLine,
  shapeIdx: number,
  motionDir: number,
  arcLength: number,
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
    arcLength,
  };
}

// Compass bearing (0=N, 90=E, 180=S, 270=W) from a→b, accounting for lat
// distortion of longitude. Good enough for drawing arrowheads at NYC scale.
// Shared by useTrains (per-train marker bearings) and the trajectory
// builder here (waypoint orientation for parked trains).
export function bearingDeg(
  a: [number, number],
  b: [number, number],
): number {
  const dLng = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  const dLat = b[1] - a[1];
  if (dLng === 0 && dLat === 0) return 0;
  return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
}

// Deterministic stagger in [0, maxMs) keyed off the trainId. Used to
// break up the feed-batching effect where multiple trains the GTFS-RT
// feed updates in the same poll all visually transition at the same
// instant — at a real stack platform (e.g. 4/5/6 N-bound at Union Sq)
// trains leave 5–15 seconds apart, but our 8s poll captures their
// status changes together. Hashing the trainId restores some of that
// spacing without inventing data we don't have.
//
// FNV-1a-style mix; trainIds are short MTA strings (e.g. "1#NQR234")
// so a 32-bit hash collides rarely enough at our scale. Same trainId
// always returns the same stagger — important so a train doesn't
// jitter its own departure time across re-builds within a single
// dwell.
export function trainIdStaggerMs(trainId: string, maxMs: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < trainId.length; i++) {
    h ^= trainId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = (h ^ (h >>> 16)) >>> 0;
  return h % maxMs;
}

/**
 * Build a time-keyed trajectory for one train, paced by the feed's
 * reported `status` so the visualization follows reality rather than
 * predicting against it.
 *
 * STOPPED_AT → single waypoint at the platform's arcLength. positionAt
 *   clamps to that point, so the marker parks until the next poll
 *   reports the train has left. We deliberately do NOT extend a
 *   trajectory toward the next stop's ETA: routes whose feed only
 *   refreshes at station boundaries (the R, certain peak express
 *   trips) would otherwise show every train continuously creeping
 *   forward and snapping back on each poll's reanchor.
 *
 * IN_TRANSIT_TO / INCOMING_AT → two waypoints: current interpolated
 *   position now, and the predicted ETA at the *next* stop only.
 *   Including further-future stops compounds prediction error —
 *   each new poll's small ETA correction would ripple into a multi-
 *   station chain and rubberband the whole length. One segment at
 *   a time keeps each per-poll correction small.
 *
 * Returns null only when the train can't be placed on the line at all
 * (unknown prev/next stop).
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

  const prevArc = metrics.cumLength[prev.shapeIdx];
  const nextArc = metrics.cumLength[next.shapeIdx];

  // STOPPED_AT: park at the platform, full stop. Cross-station glides
  // (A-stopped → B-stopped on the same trip) are produced by the
  // consumer's per-frame LERP smoothing the re-anchor when the next
  // poll lands with prev === B.
  //
  // motionDir is inferred from the first future arrival's shape index
  // — the direction the train will face when it leaves. Without
  // this, a parked southbound train on a line whose shape runs north
  // → south would default to motionDir=+1 and render its bearing
  // pointing the wrong way. Falling back to +1 (forward through
  // shape) only when no arrival is available — a terminus dwell.
  if (train.status === "STOPPED_AT") {
    return {
      trainId: train.id,
      routeId: train.routeId,
      waypoints: [{ arcLength: prevArc, time: generatedAtMs }],
      motionDir: inferParkedMotionDir(prev, tripArrivals, generatedAtMs, stopMap),
    };
  }

  // IN_TRANSIT_TO / INCOMING_AT: animate between current interpolated
  // position and the next stop. Current position is taken from the
  // segment progress (or pinned to prev if prev === next, e.g. an
  // INCOMING_AT report at the boundary).
  const currentArc =
    prev.shapeIdx === next.shapeIdx
      ? prevArc
      : prevArc + (nextArc - prevArc) * train.progress;

  // Find the predicted ETA at the *next* stop only. ETA is in seconds
  // (see app/api/trains/route.ts: toSec → unix seconds); we convert
  // at the boundary so all internal time arithmetic is in ms.
  const nextStopArrivals = tripArrivals
    .filter((a) => a.stopId === next.id && a.eta * 1000 > generatedAtMs)
    .sort((a, b) => a.eta - b.eta);

  let endArc: number;
  let endTime: number;
  if (nextStopArrivals.length > 0) {
    endArc = nextArc;
    endTime = nextStopArrivals[0].eta * 1000;
  } else if (prev.shapeIdx !== next.shapeIdx) {
    // No ETA available for the next stop (last leg of a trip, or
    // arrivals payload missing this entry). Fall back to typical
    // inter-station travel time scaled by remaining progress so the
    // marker still creeps forward instead of freezing mid-segment.
    const TYPICAL_TRAVEL_SEC = 60;
    const remaining = 1 - train.progress;
    endArc = nextArc;
    endTime = generatedAtMs + remaining * TYPICAL_TRAVEL_SEC * 1000;
  } else {
    // prev === next on an in-motion status — degenerate but safe;
    // park the marker at the stop with no forward motion.
    return {
      trainId: train.id,
      routeId: train.routeId,
      waypoints: [{ arcLength: prevArc, time: generatedAtMs }],
      motionDir: inferParkedMotionDir(prev, tripArrivals, generatedAtMs, stopMap),
    };
  }

  // For multi-waypoint trajectories, motionDir is unambiguous from
  // the arc direction of the first segment.
  const motionDir: 1 | -1 = endArc >= currentArc ? 1 : -1;

  // Stagger the apparent departure for trains that look like they
  // just left a platform. Without this, a stack platform (4/5/6 at
  // Union Sq) where the feed batch-updates several trains from
  // STOPPED_AT to IN_TRANSIT_TO on the same 8s poll has them all
  // leave the platform in unison — visually unrealistic. The
  // staggered window ends at the next-stop ETA so the journey
  // duration shrinks proportionally rather than the train arriving
  // late, keeping the visualization in agreement with the MTA's
  // prediction at the destination.
  const justDeparted =
    train.status === "IN_TRANSIT_TO" &&
    train.progress < 0.2 &&
    prev.shapeIdx !== next.shapeIdx;
  if (justDeparted) {
    const stagger = trainIdStaggerMs(train.id, 4000);
    if (stagger > 0 && generatedAtMs + stagger < endTime) {
      return {
        trainId: train.id,
        routeId: train.routeId,
        waypoints: [
          { arcLength: prevArc, time: generatedAtMs },
          { arcLength: prevArc, time: generatedAtMs + stagger },
          { arcLength: endArc, time: endTime },
        ],
        motionDir,
      };
    }
  }

  return {
    trainId: train.id,
    routeId: train.routeId,
    waypoints: [
      { arcLength: currentArc, time: generatedAtMs },
      { arcLength: endArc, time: endTime },
    ],
    motionDir,
  };
}

// Pick a direction for parked trains by looking at the first future
// arrival on the trip. The stop the train is heading to next tells
// us which way along the shape it will run; default to +1 if there's
// no usable arrival (a terminus, or a feed gap).
function inferParkedMotionDir(
  prev: Stop,
  tripArrivals: Arrival[],
  generatedAtMs: number,
  stopMap: Map<string, Stop>,
): 1 | -1 {
  const upcoming = tripArrivals
    .filter(
      (a) => a.stopId !== prev.id && a.eta * 1000 > generatedAtMs,
    )
    .sort((a, b) => a.eta - b.eta);
  for (const a of upcoming) {
    const stop = stopMap.get(a.stopId);
    if (!stop) continue;
    if (stop.shapeIdx === prev.shapeIdx) continue;
    return stop.shapeIdx > prev.shapeIdx ? 1 : -1;
  }
  return 1;
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
  const { waypoints, motionDir } = traj;
  if (waypoints.length === 0) return null;

  if (waypoints.length === 1) {
    return shapePositionAtArc(line, metrics, waypoints[0].arcLength, motionDir);
  }

  if (nowMs <= waypoints[0].time) {
    return shapePositionAtArc(line, metrics, waypoints[0].arcLength, motionDir);
  }

  const last = waypoints[waypoints.length - 1];
  if (nowMs >= last.time) {
    return shapePositionAtArc(line, metrics, last.arcLength, motionDir);
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
      return shapePositionAtArc(line, metrics, arcLength, motionDir);
    }
  }

  // Unreachable given the bounds checks above, but keep the function
  // total for callers.
  return null;
}
