import { describe, it, expect } from "vitest";
import {
  directRoutesBetween,
  estimateTripTimeSec,
  legGeometry,
  planTrips,
  rankPlansByTime,
  type TripPlan,
} from "./commuteRouting";
import { buildStationIndex, type StationEntry } from "./stopsIndex";
import type { Lines, Stop, SubwayLine } from "./subwayData";
import type { Arrival } from "./useTrains";

// ─── Synthetic line factory ─────────────────────────────────────────
//
// Stop coordinates use realistic NYC lats/lngs so travelDirection's
// north/south inference (first.lat > last.lat) lands correctly without
// us hand-tuning per test. Lines are listed terminus-to-terminus,
// matching how GTFS orders line.stops.
//
// Stop ids match real MTA ids where they're meaningful for the
// stopsIndex KNOWN_COMPLEXES lookup (e.g., 635/L03/R20 → Union Sq).
// Other ids are arbitrary placeholders (419 for Wall St, etc.).

function stop(id: string, name: string, lat: number, lng: number, shapeIdx = 0): Stop {
  return { id, name, lat, lng, shapeIdx };
}

function line(opts: {
  id: string;
  routeId: string;
  stops: Stop[];
  shape?: [number, number][];
}): SubwayLine {
  return {
    id: opts.id,
    routeId: opts.routeId,
    name: opts.id,
    color: "#000000",
    textColor: "white",
    shape: opts.shape ?? [],
    stops: opts.stops,
  };
}

// Stops we reuse across tests.
const GRAND_CENTRAL = stop("631", "Grand Central-42 St", 40.7527, -73.9772);
const UNION_SQ_456   = stop("635", "14 St-Union Sq",     40.7349, -73.9904);
const WALL_45        = stop("419", "Wall St",            40.7070, -74.0118);
const HARLEM_125     = stop("601", "125 St",             40.8043, -73.9376);
const BROOKLYN_6     = stop("640", "Brooklyn Bridge",    40.7131, -74.0042);

const UNION_SQ_L     = stop("L03", "14 St-Union Sq",     40.7349, -73.9905);
const EIGHTH_AV_L    = stop("L01", "8 Av",               40.7397, -74.0023);
const BEDFORD_L      = stop("L08", "Bedford Av",         40.7173, -73.9568);

const TIMES_SQ_NQRW  = stop("R16", "Times Sq-42 St",     40.7559, -73.9871);
const HERALD_SQ_NQRW = stop("R17", "34 St-Herald Sq",    40.7497, -73.9879);
const UNION_SQ_NQRW  = stop("R20", "14 St-Union Sq",     40.7351, -73.9907);
const BROOKLYN_N     = stop("R31", "Atlantic Av",        40.6840, -73.9776);

function buildSampleLines(): Lines {
  // 4 and 5 share trunk: GC → Union Sq → Wall St. Used to test
  // trunk-route dedup ("4 and 5 both go direct, so 4→5 transfer is noise").
  const four  = line({ id: "4", routeId: "4", stops: [GRAND_CENTRAL, UNION_SQ_456, WALL_45] });
  const five  = line({ id: "5", routeId: "5", stops: [GRAND_CENTRAL, UNION_SQ_456, WALL_45] });
  const six   = line({ id: "6", routeId: "6", stops: [HARLEM_125, GRAND_CENTRAL, UNION_SQ_456, BROOKLYN_6] });
  // L runs east-west; the algorithm still maps direction onto N/S using
  // the lat of the first vs last stop, so L01 (slightly more north)
  // becomes the "north" terminus.
  const l     = line({ id: "L", routeId: "L", stops: [EIGHTH_AV_L, UNION_SQ_L, BEDFORD_L] });
  const n     = line({ id: "N", routeId: "N", stops: [TIMES_SQ_NQRW, HERALD_SQ_NQRW, UNION_SQ_NQRW, BROOKLYN_N] });
  return { "4": four, "5": five, "6": six, L: l, N: n };
}

function buildSampleIndex(lines: Lines): StationEntry[] {
  return buildStationIndex(lines);
}

// ─── directRoutesBetween ────────────────────────────────────────────

describe("directRoutesBetween", () => {
  const lines = buildSampleLines();

  it("finds direct routes between two stops on the same line", () => {
    // Grand Central → Wall St on 4 and 5 (shared trunk).
    const r = directRoutesBetween(lines, ["631"], ["419"]);
    const ids = r.map((d) => d.routeId).sort();
    expect(ids).toEqual(["4", "5"]);
    for (const d of r) {
      expect(d.direction).toBe("S");
      expect(d.stopCount).toBe(2);
    }
  });

  it("returns the opposite direction for the reverse trip", () => {
    const r = directRoutesBetween(lines, ["419"], ["631"]);
    const four = r.find((d) => d.routeId === "4");
    expect(four?.direction).toBe("N");
  });

  it("returns no routes when stops aren't both on any one line", () => {
    // Wall St (4/5) → Bedford (L). No single line touches both.
    expect(directRoutesBetween(lines, ["419"], ["L08"])).toEqual([]);
  });

  it("returns no routes when from and to are the same stop", () => {
    expect(directRoutesBetween(lines, ["635"], ["635"])).toEqual([]);
  });

  it("ranks express stop counts by number of stops between endpoints", () => {
    // Grand Central → Union Sq is 1 stop on 4/5 (just one intermediate)
    // and 1 stop on 6 too in this sample (no extra local stops modeled).
    const r = directRoutesBetween(lines, ["631"], ["635"]);
    expect(r.every((d) => d.stopCount === 1)).toBe(true);
  });
});

// ─── planTrips ──────────────────────────────────────────────────────

describe("planTrips", () => {
  const lines = buildSampleLines();
  const index = buildSampleIndex(lines);

  it("returns [] when origin and destination are the same complex", () => {
    // 635 and L03 both belong to the Union Sq complex (canonical "635")
    // so they overlap → no trip to plan.
    expect(planTrips(lines, index, ["635"], ["L03"])).toEqual([]);
  });

  it("returns [] when neither endpoint maps to any known stop", () => {
    expect(planTrips(lines, index, ["XXX"], ["YYY"])).toEqual([]);
  });

  it("plans a direct trip on a single line", () => {
    const plans = planTrips(lines, index, ["L01"], ["L08"]);
    expect(plans.length).toBeGreaterThan(0);
    const direct = plans[0];
    expect(direct.legs).toHaveLength(1);
    expect(direct.legs[0].routeId).toBe("L");
    expect(direct.legs[0].boardStopId).toBe("L01");
    expect(direct.legs[0].alightStopId).toBe("L08");
    expect(direct.legs[0].direction).toBe("S");
    expect(direct.legs[0].stopCount).toBe(2);
    expect(direct.transferComplexId).toBeUndefined();
  });

  it("plans a one-transfer trip through a complex (L → Lex at Union Sq)", () => {
    // L01 → 419 requires transferring at Union Sq (L03/635 merged complex)
    // onto the 4 or 5. The path-dedup will collapse L→4 and L→5 into one
    // because both share the same boardComplex>alightComplex sequence.
    const plans = planTrips(lines, index, ["L01"], ["419"]);
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[0].routeId).toBe("L");
    expect(plan.legs[0].alightComplexId).toBe("635");
    expect(plan.legs[1].routeId === "4" || plan.legs[1].routeId === "5").toBe(true);
    expect(plan.legs[1].boardComplexId).toBe("635");
    expect(plan.legs[1].alightComplexId).toBe("419");
    expect(plan.transferComplexId).toBe("635");
  });

  it("plans a cross-trunk transfer (N → 4) when neither line alone reaches the destination", () => {
    const plans = planTrips(lines, index, ["R16"], ["L08"]);
    // N reaches Union Sq (R20→complex 635) but not Bedford (L08); L
    // reaches Bedford but not Times Sq. Only path: N then L at Union Sq.
    expect(plans.length).toBeGreaterThan(0);
    const plan = plans[0];
    expect(plan.legs.map((l) => l.routeId)).toEqual(["N", "L"]);
    expect(plan.transferComplexId).toBe("635");
  });

  it("strips redundant trunk transfers when a direct route exists", () => {
    // 4 and 5 both go GC → Union Sq → Wall, so any 4→5 (or 5→4) plan is
    // noise — the rider would just board whichever Lex express comes
    // first. Output should contain ONLY a direct plan.
    const plans = planTrips(lines, index, ["631"], ["419"]);
    expect(plans.every((p) => p.legs.length === 1)).toBe(true);
    expect(plans[0].legs[0].alightStopId).toBe("419");
  });

  it("ranks fewer-leg plans ahead of more-leg plans, then by total stops", () => {
    // 631 → 635: direct on 4/5/6 (1 stop each) is the only option after
    // dedup. Even if a transfer plan existed, it would sort below.
    const plans = planTrips(lines, index, ["631"], ["635"]);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0].legs).toHaveLength(1);
    // Sorted ascending by totalStops.
    for (let i = 1; i < plans.length; i++) {
      if (plans[i - 1].legs.length === plans[i].legs.length) {
        expect(plans[i - 1].totalStops).toBeLessThanOrEqual(plans[i].totalStops);
      }
    }
  });

  it("respects maxResults", () => {
    const plans = planTrips(lines, index, ["L01"], ["419"], { maxResults: 1 });
    expect(plans.length).toBeLessThanOrEqual(1);
  });

  it("respects maxTransfers=0 (direct only)", () => {
    // L01 → 419 has no direct route; with maxTransfers=0 we get nothing.
    const plans = planTrips(lines, index, ["L01"], ["419"], { maxTransfers: 0 });
    expect(plans).toEqual([]);
  });
});

// ─── estimateTripTimeSec ────────────────────────────────────────────

const FALLBACK_WAIT_S = 4 * 60;
const TRAVEL_PER_STOP_S = 90;
const TRANSFER_S = 3 * 60;

const ONE_LEG_PLAN: TripPlan = {
  legs: [
    {
      routeId: "4",
      direction: "S",
      boardStopId: "631",
      alightStopId: "635",
      boardComplexId: "631",
      alightComplexId: "635",
      stopCount: 1,
    },
  ],
  totalStops: 1,
};

const TWO_LEG_PLAN: TripPlan = {
  legs: [
    {
      routeId: "L",
      direction: "S",
      boardStopId: "L01",
      alightStopId: "L03",
      boardComplexId: "L01",
      alightComplexId: "635",
      stopCount: 1,
    },
    {
      routeId: "4",
      direction: "S",
      boardStopId: "635",
      alightStopId: "419",
      boardComplexId: "635",
      alightComplexId: "419",
      stopCount: 2,
    },
  ],
  totalStops: 3,
  transferComplexId: "635",
};

describe("estimateTripTimeSec", () => {
  it("uses the fallback wait when no live arrivals are provided", () => {
    expect(estimateTripTimeSec(ONE_LEG_PLAN)).toBe(FALLBACK_WAIT_S + 1 * TRAVEL_PER_STOP_S);
  });

  it("substitutes a live ETA for the first-leg wait when one matches", () => {
    const arrivals: Arrival[] = [
      { routeId: "4", stopId: "631", direction: "S", eta: 60, tripId: "t1" },
    ];
    const map = new Map<string, Arrival[]>([["631", arrivals]]);
    const t = estimateTripTimeSec(ONE_LEG_PLAN, { arrivalsByStation: map, nowSec: 0 });
    expect(t).toBe(60 + 1 * TRAVEL_PER_STOP_S);
  });

  it("ignores live arrivals that have already left", () => {
    const arrivals: Arrival[] = [
      { routeId: "4", stopId: "631", direction: "S", eta: -100, tripId: "old" },
    ];
    const map = new Map<string, Arrival[]>([["631", arrivals]]);
    const t = estimateTripTimeSec(ONE_LEG_PLAN, { arrivalsByStation: map, nowSec: 0 });
    expect(t).toBe(FALLBACK_WAIT_S + 1 * TRAVEL_PER_STOP_S);
  });

  it("ignores live arrivals on the wrong route or direction", () => {
    const arrivals: Arrival[] = [
      { routeId: "6", stopId: "631", direction: "S", eta: 30, tripId: "wrong-route" },
      { routeId: "4", stopId: "631", direction: "N", eta: 30, tripId: "wrong-direction" },
    ];
    const map = new Map<string, Arrival[]>([["631", arrivals]]);
    const t = estimateTripTimeSec(ONE_LEG_PLAN, { arrivalsByStation: map, nowSec: 0 });
    expect(t).toBe(FALLBACK_WAIT_S + 1 * TRAVEL_PER_STOP_S);
  });

  it("adds walk time from origin and to destination", () => {
    const t = estimateTripTimeSec(ONE_LEG_PLAN, { walkFromMeters: 140, walkToMeters: 70 });
    // walk = (140 + 70) * (1.3 / 1.4) = 195 sec
    const walk = (140 + 70) * (1.3 / 1.4);
    expect(t).toBeCloseTo(walk + FALLBACK_WAIT_S + 1 * TRAVEL_PER_STOP_S, 6);
  });

  it("computes per-plan walks from anchor coordinates when stationsByComplexId is provided", () => {
    const lines = buildSampleLines();
    const index = buildSampleIndex(lines);
    const stationsByComplexId = new Map<string, StationEntry>();
    for (const s of index) stationsByComplexId.set(s.stopId, s);

    // Put the rider 200m roughly north of Grand Central. The walkFrom
    // should be derived from the ACTUAL board station, not a constant.
    const board = stationsByComplexId.get("631")!;
    const origin = { lat: board.lat + 0.0018, lng: board.lng };

    const t = estimateTripTimeSec(ONE_LEG_PLAN, {
      walkFromAnchor: origin,
      stationsByComplexId,
    });
    // Walk distance ≈ 0.0018 deg lat ≈ 200m → walkSec ≈ 186s.
    expect(t).toBeGreaterThan(FALLBACK_WAIT_S + TRAVEL_PER_STOP_S + 150);
    expect(t).toBeLessThan(FALLBACK_WAIT_S + TRAVEL_PER_STOP_S + 230);
  });

  it("adds a transfer penalty and a second wait for two-leg trips", () => {
    const t = estimateTripTimeSec(TWO_LEG_PLAN);
    // wait1 + leg1 + wait2 + transfer + leg2 (no walks)
    const expected =
      FALLBACK_WAIT_S + 1 * TRAVEL_PER_STOP_S +
      FALLBACK_WAIT_S + TRANSFER_S + 2 * TRAVEL_PER_STOP_S;
    expect(t).toBe(expected);
  });
});

// ─── rankPlansByTime ───────────────────────────────────────────────

describe("rankPlansByTime", () => {
  const planFast: TripPlan = {
    legs: [
      {
        routeId: "4", direction: "S", boardStopId: "631", alightStopId: "419",
        boardComplexId: "631", alightComplexId: "419", stopCount: 2,
      },
    ],
    totalStops: 2,
  };
  const planSlow: TripPlan = {
    legs: [
      {
        routeId: "5", direction: "S", boardStopId: "631", alightStopId: "419",
        boardComplexId: "631", alightComplexId: "419", stopCount: 8,
      },
    ],
    totalStops: 8,
  };

  it("orders plans ascending by estimated time", () => {
    const sorted = rankPlansByTime([planSlow, planFast]);
    expect(sorted[0]).toBe(planFast);
    expect(sorted[1]).toBe(planSlow);
  });

  it("flips order when live arrivals make the longer route faster overall", () => {
    // Slow plan has stopCount=8 (720s travel); fast plan has stopCount=2
    // (180s travel). Default wait of 240s on each makes fast win by 540s.
    // Now: give slow plan a live ETA of 0s, fast plan stays on fallback
    // 240s. Slow total = 720s; fast total = 240+180 = 420s. Fast still
    // wins. To force a flip we need to also delay fast (no arrival
    // matches fast's route) AND make slow's ETA arrive immediately —
    // but the math above shows fast is still faster. So instead make
    // fast extremely-soon-but-irrelevant: give slow a 0s ETA AND make
    // fast arrive in 600s (live).
    const arrivalsSlow: Arrival[] = [
      { routeId: "5", stopId: "631", direction: "S", eta: 0, tripId: "soon" },
    ];
    const arrivalsFast: Arrival[] = [
      { routeId: "4", stopId: "631", direction: "S", eta: 600, tripId: "late" },
    ];
    const arrivalsByStation = new Map<string, Arrival[]>([
      ["631", [...arrivalsSlow, ...arrivalsFast]],
    ]);
    const sorted = rankPlansByTime([planFast, planSlow], { arrivalsByStation, nowSec: 0 });
    // Fast: 600 + 180 = 780; Slow: 0 + 720 = 720. Slow now wins.
    expect(sorted[0]).toBe(planSlow);
    expect(sorted[1]).toBe(planFast);
  });

  it("does not mutate the input array", () => {
    const input = [planSlow, planFast];
    const before = [...input];
    rankPlansByTime(input);
    expect(input).toEqual(before);
  });
});

// ─── legGeometry ───────────────────────────────────────────────────

describe("legGeometry", () => {
  const shape: [number, number][] = [
    [-74.0, 40.70],
    [-74.0, 40.71],
    [-74.0, 40.72],
    [-74.0, 40.73],
    [-74.0, 40.74],
  ];
  const lineWithShape: SubwayLine = {
    id: "T", routeId: "T", name: "Test", color: "#000", textColor: "white",
    shape,
    stops: [
      stop("A", "A", 40.71, -74.0, 1),
      stop("B", "B", 40.73, -74.0, 3),
      stop("C", "C", 40.74, -74.0, 4),
    ],
  };

  it("returns the shape slice between two stops in travel order", () => {
    const r = legGeometry(lineWithShape, "A", "B");
    expect(r).toEqual([
      [-74.0, 40.71],
      [-74.0, 40.72],
      [-74.0, 40.73],
    ]);
  });

  it("reverses the slice when board > alight in shape index", () => {
    const r = legGeometry(lineWithShape, "B", "A");
    expect(r).toEqual([
      [-74.0, 40.73],
      [-74.0, 40.72],
      [-74.0, 40.71],
    ]);
  });

  it("returns null when board and alight resolve to the same shape index", () => {
    // Two stops can share a shapeIdx if the data is malformed; legGeometry
    // must guard against zero-length geometry.
    const collapsed: SubwayLine = {
      ...lineWithShape,
      stops: [stop("A", "A", 0, 0, 2), stop("B", "B", 0, 0, 2)],
    };
    expect(legGeometry(collapsed, "A", "B")).toBeNull();
  });

  it("returns null when a stop id isn't on the line", () => {
    expect(legGeometry(lineWithShape, "A", "Z")).toBeNull();
    expect(legGeometry(lineWithShape, "Z", "A")).toBeNull();
  });
});
