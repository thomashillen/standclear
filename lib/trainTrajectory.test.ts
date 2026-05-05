// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SubwayLine } from "./subwayData";
import type { Arrival, Train } from "@/app/api/trains/route";
import {
  buildTrajectory,
  computeShapeMetrics,
  positionAt,
  shapePositionAtArc,
  trainIdStaggerMs,
} from "./trainTrajectory";

// 5 evenly spaced points heading due south. Stops sit on shape
// indices 0, 2, 4 — A at the top, B in the middle, C at the bottom.
const STRAIGHT_NS_LINE: SubwayLine = {
  id: "T",
  routeId: "T",
  name: "Test",
  color: "#000",
  textColor: "white",
  shape: [
    [-74.0, 40.8],
    [-74.0, 40.78],
    [-74.0, 40.76],
    [-74.0, 40.74],
    [-74.0, 40.72],
  ],
  stops: [
    { id: "A", name: "A", lat: 40.8, lng: -74.0, shapeIdx: 0 },
    { id: "B", name: "B", lat: 40.76, lng: -74.0, shapeIdx: 2 },
    { id: "C", name: "C", lat: 40.72, lng: -74.0, shapeIdx: 4 },
  ],
};

function train(over: Partial<Train> = {}): Train {
  return {
    id: over.id ?? "t1",
    routeId: over.routeId ?? "T",
    direction: over.direction ?? "S",
    progress: over.progress ?? 0,
    prevStopId: over.prevStopId ?? "A",
    nextStopId: over.nextStopId ?? "B",
    status: over.status ?? "IN_TRANSIT_TO",
  };
}

function arrival(over: Partial<Arrival> & Pick<Arrival, "stopId" | "eta">): Arrival {
  return {
    routeId: over.routeId ?? "T",
    direction: over.direction ?? "S",
    tripId: over.tripId ?? "t1",
    stopId: over.stopId,
    eta: over.eta,
  };
}

describe("trainIdStaggerMs", () => {
  it("returns a value in [0, max)", () => {
    for (let i = 0; i < 50; i++) {
      const v = trainIdStaggerMs(`trip-${i}`, 4000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4000);
    }
  });

  it("is deterministic — same id always returns the same value", () => {
    const id = "1#NQR234";
    expect(trainIdStaggerMs(id, 4000)).toBe(trainIdStaggerMs(id, 4000));
  });

  it("spreads ids across the range (different ids → different values, mostly)", () => {
    const samples = new Set<number>();
    for (let i = 0; i < 30; i++) samples.add(trainIdStaggerMs(`t-${i}`, 4000));
    // Hash collisions are possible but most should be distinct.
    expect(samples.size).toBeGreaterThan(20);
  });
});

describe("computeShapeMetrics", () => {
  it("cum length is 0 at index 0 and total at the last index", () => {
    const m = computeShapeMetrics(STRAIGHT_NS_LINE);
    expect(m.cumLength[0]).toBe(0);
    expect(m.cumLength[m.cumLength.length - 1]).toBe(m.total);
  });

  it("monotonically increases", () => {
    const m = computeShapeMetrics(STRAIGHT_NS_LINE);
    for (let i = 1; i < m.cumLength.length; i++) {
      expect(m.cumLength[i]).toBeGreaterThanOrEqual(m.cumLength[i - 1]);
    }
  });

  it("each segment of an evenly spaced shape contributes equal length", () => {
    const m = computeShapeMetrics(STRAIGHT_NS_LINE);
    const seg = m.cumLength[1] - m.cumLength[0];
    for (let i = 1; i < m.cumLength.length; i++) {
      expect(m.cumLength[i] - m.cumLength[i - 1]).toBeCloseTo(seg, 9);
    }
  });
});

describe("shapePositionAtArc", () => {
  const line = STRAIGHT_NS_LINE;
  const metrics = computeShapeMetrics(line);

  it("places the train exactly at shape[0] for arcLength 0", () => {
    const p = shapePositionAtArc(line, metrics, 0, 1);
    expect(p.lng).toBeCloseTo(-74.0, 6);
    expect(p.lat).toBeCloseTo(40.8, 6);
  });

  it("places the train at the last shape vertex for arcLength = total", () => {
    const p = shapePositionAtArc(line, metrics, metrics.total, 1);
    expect(p.lng).toBeCloseTo(-74.0, 6);
    expect(p.lat).toBeCloseTo(40.72, 6);
  });

  it("interpolates between two adjacent shape vertices", () => {
    const half = metrics.cumLength[1] / 2;
    const p = shapePositionAtArc(line, metrics, half, 1);
    expect(p.lng).toBeCloseTo(-74.0, 6);
    expect(p.lat).toBeCloseTo(40.79, 6);
  });

  it("flips bearing 180° when motionDir is negative", () => {
    const fwd = shapePositionAtArc(line, metrics, metrics.total / 2, 1);
    const rev = shapePositionAtArc(line, metrics, metrics.total / 2, -1);
    expect(rev.bearing).toBeCloseTo((fwd.bearing + 180) % 360, 6);
  });
});

describe("buildTrajectory", () => {
  const line = STRAIGHT_NS_LINE;
  const metrics = computeShapeMetrics(line);
  const NOW_MS = 1_700_000_000_000; // arbitrary fixed reference
  const NOW_SEC = NOW_MS / 1000;

  it("returns null when prev or next stop isn't on the line", () => {
    expect(
      buildTrajectory(
        train({ prevStopId: "MISSING", nextStopId: "B" }),
        [],
        line,
        metrics,
        NOW_MS,
      ),
    ).toBeNull();
  });

  it("anchors the first waypoint at the train's current arcLength", () => {
    const traj = buildTrajectory(
      train({ prevStopId: "A", nextStopId: "B", progress: 0.5 }),
      [],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints[0].time).toBe(NOW_MS);
    const arcA = metrics.cumLength[0];
    const arcB = metrics.cumLength[2];
    expect(traj.waypoints[0].arcLength).toBeCloseTo((arcA + arcB) / 2, 9);
  });

  it("STOPPED_AT yields a single parked waypoint with no future motion", () => {
    const traj = buildTrajectory(
      train({
        prevStopId: "B",
        nextStopId: "B",
        progress: 1,
        status: "STOPPED_AT",
      }),
      [arrival({ stopId: "C", eta: NOW_SEC + 90 })],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(1);
    expect(traj.waypoints[0].arcLength).toBeCloseTo(metrics.cumLength[2], 9);
  });

  it("IN_TRANSIT_TO appends only the next stop's ETA, not further-future stops", () => {
    // progress 0.5 keeps the train past the stagger threshold so this
    // case exercises the plain 2-waypoint shape rather than the dwell
    // form (covered by its own test below).
    const traj = buildTrajectory(
      train({
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.5,
        status: "IN_TRANSIT_TO",
      }),
      [
        arrival({ stopId: "B", eta: NOW_SEC + 60 }),
        arrival({ stopId: "C", eta: NOW_SEC + 180 }),
      ],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(2);
    expect(traj.waypoints[1].time).toBe((NOW_SEC + 60) * 1000);
    expect(traj.waypoints[1].arcLength).toBeCloseTo(metrics.cumLength[2], 9);
  });

  it("drops a past ETA at the next stop (and falls back to default travel)", () => {
    const traj = buildTrajectory(
      train({
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.5,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ stopId: "B", eta: NOW_SEC - 30 })],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(2);
    expect(traj.waypoints[1].arcLength).toBeCloseTo(metrics.cumLength[2], 9);
    // Default 60s journey scaled by remaining progress (0.5 → 30 s).
    expect(traj.waypoints[1].time).toBe(NOW_MS + 30_000);
  });

  it("synthesizes a fallback waypoint when no next-stop ETA exists", () => {
    const traj = buildTrajectory(
      train({
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.5,
        status: "IN_TRANSIT_TO",
      }),
      [],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(2);
    expect(traj.waypoints[1].arcLength).toBeCloseTo(metrics.cumLength[2], 9);
    // Default 60s journey scaled by remaining progress (0.5 → 30 s).
    expect(traj.waypoints[1].time).toBe(NOW_MS + 30_000);
  });

  it("inserts a stagger dwell so two just-departed trains don't share an instant", () => {
    // Two trains that the feed batch-updated from STOPPED_AT to
    // IN_TRANSIT_TO on the same poll. Without the per-id stagger
    // they'd both anchor at platform A at the same instant; the
    // stagger pushes one's apparent departure 0–4 s past the other's
    // so they leave the stack at different times.
    const eta = NOW_SEC + 60;
    const t1 = buildTrajectory(
      train({
        id: "trip-aaa",
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.05,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ tripId: "trip-aaa", stopId: "B", eta })],
      line,
      metrics,
      NOW_MS,
    )!;
    const t2 = buildTrajectory(
      train({
        id: "trip-zzz",
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.05,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ tripId: "trip-zzz", stopId: "B", eta })],
      line,
      metrics,
      NOW_MS,
    )!;
    // Both trajectories should have a 3-waypoint shape: dwell, then
    // glide to next stop. The dwell duration differs by trainId.
    expect(t1.waypoints).toHaveLength(3);
    expect(t2.waypoints).toHaveLength(3);
    expect(t1.waypoints[1].time).not.toBe(t2.waypoints[1].time);
    // Both end at the same MTA-predicted next-stop ETA — stagger
    // shrinks the journey, not the predicted destination time.
    expect(t1.waypoints[2].time).toBe(eta * 1000);
    expect(t2.waypoints[2].time).toBe(eta * 1000);
  });

  it("the stagger is bounded by the next-stop ETA (never inserts a dwell that would push past arrival)", () => {
    // Imminent ETA — the stagger window would overshoot the next
    // stop, so we bail out and use the plain 2-waypoint trajectory.
    const eta = NOW_SEC + 1;
    const traj = buildTrajectory(
      train({
        id: "trip-aaa",
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.05,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ tripId: "trip-aaa", stopId: "B", eta })],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(2);
  });

  it("doesn't stagger trains already mid-segment (progress > threshold)", () => {
    const traj = buildTrajectory(
      train({
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.5,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ stopId: "B", eta: NOW_SEC + 60 })],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(2);
  });

  it("ignores a future-stop ETA that doesn't match the train's next stop", () => {
    // Train heading A→B, but only an ETA for C is present in
    // arrivals. We should NOT use C's ETA to pace the A→B animation;
    // fall back to the default travel time for the current segment
    // instead.
    const traj = buildTrajectory(
      train({
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.5,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ stopId: "C", eta: NOW_SEC + 90 })],
      line,
      metrics,
      NOW_MS,
    )!;
    expect(traj.waypoints).toHaveLength(2);
    expect(traj.waypoints[1].arcLength).toBeCloseTo(metrics.cumLength[2], 9);
    expect(traj.waypoints[1].time).toBe(NOW_MS + 30_000);
  });
});

describe("positionAt", () => {
  const line = STRAIGHT_NS_LINE;
  const metrics = computeShapeMetrics(line);
  const NOW_MS = 1_700_000_000_000;
  const NOW_SEC = NOW_MS / 1000;

  it("clamps to the first waypoint before the trajectory starts", () => {
    const traj = buildTrajectory(
      train({ prevStopId: "A", nextStopId: "B", progress: 0 }),
      [arrival({ stopId: "B", eta: NOW_SEC + 60 })],
      line,
      metrics,
      NOW_MS,
    )!;
    const p = positionAt(traj, line, metrics, NOW_MS - 5_000)!;
    expect(p.lat).toBeCloseTo(40.8, 6); // at A
  });

  it("clamps to the last waypoint after the trajectory ends", () => {
    const traj = buildTrajectory(
      train({ prevStopId: "A", nextStopId: "B", progress: 0 }),
      [arrival({ stopId: "B", eta: NOW_SEC + 60 })],
      line,
      metrics,
      NOW_MS,
    )!;
    const p = positionAt(traj, line, metrics, NOW_MS + 999_999)!;
    expect(p.lat).toBeCloseTo(40.76, 6); // at B
  });

  it("interpolates linearly in time between two waypoints", () => {
    // Train at the A→B midpoint heading to B in 60 s. Halfway through
    // the trajectory, it should sit at lat 40.77 — midpoint of the
    // remaining segment from 40.78 (current) to 40.76 (B). progress
    // 0.5 keeps it past the stagger threshold so the trajectory is
    // the simple 2-waypoint form.
    const traj = buildTrajectory(
      train({
        prevStopId: "A",
        nextStopId: "B",
        progress: 0.5,
        status: "IN_TRANSIT_TO",
      }),
      [arrival({ stopId: "B", eta: NOW_SEC + 60 })],
      line,
      metrics,
      NOW_MS,
    )!;
    const p = positionAt(traj, line, metrics, NOW_MS + 30_000)!;
    expect(p.lat).toBeCloseTo(40.77, 4);
  });

  it("STOPPED_AT trajectories don't drift forward over time (no rubber-band)", () => {
    // Train parked at B. Even far in the future, the marker stays at
    // B — the consumer's per-frame LERP handles the cross-station
    // glide when the *next* poll moves the train to C.
    const traj = buildTrajectory(
      train({
        prevStopId: "B",
        nextStopId: "B",
        progress: 1,
        status: "STOPPED_AT",
      }),
      [arrival({ stopId: "C", eta: NOW_SEC + 90 })],
      line,
      metrics,
      NOW_MS,
    )!;
    const pNow = positionAt(traj, line, metrics, NOW_MS)!;
    const pLater = positionAt(traj, line, metrics, NOW_MS + 60_000)!;
    expect(pNow.lat).toBeCloseTo(40.76, 6);
    expect(pLater.lat).toBeCloseTo(40.76, 6);
  });

  it("orients southbound trains to ~180°", () => {
    const traj = buildTrajectory(
      train({ prevStopId: "A", nextStopId: "B", progress: 0 }),
      [arrival({ stopId: "B", eta: NOW_SEC + 60 })],
      line,
      metrics,
      NOW_MS,
    )!;
    const p = positionAt(traj, line, metrics, NOW_MS + 30_000)!;
    expect(p.bearing).toBeGreaterThan(170);
    expect(p.bearing).toBeLessThan(190);
  });

  it("orients northbound trains to ~0°", () => {
    const traj = buildTrajectory(
      train({
        prevStopId: "C",
        nextStopId: "B",
        progress: 0,
        direction: "N",
      }),
      [arrival({ stopId: "B", eta: NOW_SEC + 60, direction: "N" })],
      line,
      metrics,
      NOW_MS,
    )!;
    const p = positionAt(traj, line, metrics, NOW_MS + 30_000)!;
    const bearing = p.bearing;
    const wrapped = bearing > 180 ? 360 - bearing : bearing;
    expect(wrapped).toBeLessThan(10);
  });
});
