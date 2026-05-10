import { describe, it, expect } from "vitest";
import {
  buildStationIndex,
  catchVerdict,
  formatWalkSummary,
  haversineMeters,
  nearestStations,
  nearestStationsWithin,
  searchStations,
  walkMinutes,
  type StationEntry,
} from "./stopsIndex";
import type { Lines, SubwayLine } from "./subwayData";

function makeLine(over: Partial<SubwayLine> & Pick<SubwayLine, "id" | "routeId" | "stops">): SubwayLine {
  return {
    name: over.name ?? over.id,
    color: over.color ?? "#000000",
    textColor: over.textColor ?? "white",
    shape: over.shape ?? [],
    ...over,
  };
}

const UNION_SQ = { lat: 40.7349, lng: -73.9904 };
const TIMES_SQ = { lat: 40.7559, lng: -73.9871 };
const GRAND_CENTRAL = { lat: 40.7527, lng: -73.9772 };
const HERALD_SQ = { lat: 40.7497, lng: -73.9879 };

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(UNION_SQ, UNION_SQ)).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    const ab = haversineMeters(UNION_SQ, TIMES_SQ);
    const ba = haversineMeters(TIMES_SQ, UNION_SQ);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it("matches a known NYC distance within 5%", () => {
    // Union Sq → Times Sq is ~2.4 km along the actual subway, ~2.35 km
    // crow-flies. Allow a generous tolerance — we're verifying the
    // formula is in the right ballpark, not pinning to one decimal.
    const m = haversineMeters(UNION_SQ, TIMES_SQ);
    expect(m).toBeGreaterThan(2_200);
    expect(m).toBeLessThan(2_500);
  });
});

describe("walkMinutes", () => {
  it("returns 0 for non-positive or non-finite input", () => {
    expect(walkMinutes(0)).toBe(0);
    expect(walkMinutes(-50)).toBe(0);
    expect(walkMinutes(Number.NaN)).toBe(0);
    expect(walkMinutes(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("floors short walks at 1 minute", () => {
    // 50m × 1.3 / 1.4 m/s ≈ 46s — would round to 1 min anyway, but the
    // floor is the contract: a 5m walk also returns 1.
    expect(walkMinutes(50)).toBe(1);
    expect(walkMinutes(5)).toBe(1);
  });

  it("scales roughly linearly with distance", () => {
    // 800m at 1.4 m/s × 1.3 detour ≈ 12.4 min → rounds to 12.
    expect(walkMinutes(800)).toBe(12);
  });
});

describe("formatWalkSummary", () => {
  it("falls back to plain distance when sub-minute (rider on top of entrance)", () => {
    // walkMinutes(0) === 0, so we keep the "X m away" idiom rather
    // than rendering the misleading "0 min walk · 0 m".
    expect(formatWalkSummary(0)).toBe("0 m away");
  });

  it("renders walk-minute primary and meters secondary for typical distances", () => {
    // 320m × 1.3 / 1.4 / 60 ≈ 4.95 → 5 min.
    expect(formatWalkSummary(320)).toBe("5 min walk · 320 m");
  });

  it("switches the distance unit to km past 1km", () => {
    // 1500m → 23 min walk · 1.5 km. Mirrors the threshold in
    // fmtDistance so the two formatters agree visually if both
    // appear on the same screen.
    expect(formatWalkSummary(1500)).toBe("23 min walk · 1.5 km");
  });

  it("returns empty string for non-finite or negative input", () => {
    // Defensive — render layer expects a string and we never want a
    // "NaN min walk · NaN m" leaking through to a real rider.
    expect(formatWalkSummary(Number.NaN)).toBe("");
    expect(formatWalkSummary(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatWalkSummary(-50)).toBe("");
  });
});

describe("catchVerdict", () => {
  // 200m away. WALK_MPS=1.4, RUN_MPS=3.5, GRID=1.3, ENTRY=20s.
  //   walkable = 200*1.3/1.4 + 20 = 185.7 + 20 ≈ 205.7s
  //   runnable = 200*1.3/3.5 + 20 = 74.3 + 20  ≈ 94.3s
  const dist = 200;

  it("returns 'miss' when even running is too slow", () => {
    expect(catchVerdict(dist, 60, 0)).toBe("miss"); // 60s < 94s runnable
  });

  it("returns 'run' when running makes it but walking does not", () => {
    expect(catchVerdict(dist, 150, 0)).toBe("run"); // 94 < 150 < 206
  });

  it("returns 'walk' inside the 2-min chill buffer above walking", () => {
    expect(catchVerdict(dist, 250, 0)).toBe("walk"); // 206 < 250 < 326
  });

  it("returns 'chill' with comfortable lead time", () => {
    expect(catchVerdict(dist, 600, 0)).toBe("chill"); // 600 > 326
  });

  it("respects the nowSec offset", () => {
    // Same scenario as 'walk' but shift everything by 1000s.
    expect(catchVerdict(dist, 1_250, 1_000)).toBe("walk");
  });
});

describe("buildStationIndex", () => {
  it("merges Union Sq across 4/5/6 + L + N/Q/R/W into a single complex", () => {
    const lines: Lines = {
      "6": makeLine({
        id: "6", routeId: "6", color: "#00933C", textColor: "white",
        stops: [{ id: "635", name: "14 St-Union Sq", lat: 40.7349, lng: -73.9904, shapeIdx: 0 }],
      }),
      "L": makeLine({
        id: "L", routeId: "L", color: "#A7A9AC", textColor: "white",
        stops: [{ id: "L03", name: "14 St-Union Sq", lat: 40.7349, lng: -73.9905, shapeIdx: 0 }],
      }),
      "N": makeLine({
        id: "N", routeId: "N", color: "#FCCC0A", textColor: "black",
        stops: [{ id: "R20", name: "14 St-Union Sq", lat: 40.7351, lng: -73.9907, shapeIdx: 0 }],
      }),
    };
    const idx = buildStationIndex(lines);
    expect(idx).toHaveLength(1);
    const sq = idx[0];
    expect(sq.stopIds.sort()).toEqual(["635", "L03", "R20"]);
    expect(sq.routes.map((r) => r.routeId).sort()).toEqual(["6", "L", "N"]);
    // Centroid latitude is the mean of the three platform lats.
    expect(sq.lat).toBeCloseTo((40.7349 + 40.7349 + 40.7351) / 3, 6);
  });

  it("does not merge same-named stations not in KNOWN_COMPLEXES (Rector St trap)", () => {
    // Rector St on the 1 (139) and Rector St on the R/W (R26) sit ~50m
    // apart and share a name — but they are NOT a complex. They must
    // remain separate entries.
    const lines: Lines = {
      "1": makeLine({
        id: "1", routeId: "1", stops: [
          { id: "139", name: "Rector St", lat: 40.7077, lng: -74.0136, shapeIdx: 0 },
        ],
      }),
      "R": makeLine({
        id: "R", routeId: "R", stops: [
          { id: "R26", name: "Rector St", lat: 40.7081, lng: -74.0131, shapeIdx: 0 },
        ],
      }),
    };
    const idx = buildStationIndex(lines);
    expect(idx).toHaveLength(2);
    expect(idx.flatMap((s) => s.stopIds).sort()).toEqual(["139", "R26"]);
  });

  it("collapses a single stop appearing on multiple lines into one entry with both badges", () => {
    // Stop 635 is on the 4, 5, and 6. One station, three route badges.
    const stop = { id: "635", name: "14 St-Union Sq", lat: 40.7349, lng: -73.9904, shapeIdx: 0 };
    const lines: Lines = {
      "4": makeLine({ id: "4", routeId: "4", color: "#00933C", textColor: "white", stops: [stop] }),
      "5": makeLine({ id: "5", routeId: "5", color: "#00933C", textColor: "white", stops: [stop] }),
      "6": makeLine({ id: "6", routeId: "6", color: "#00933C", textColor: "white", stops: [stop] }),
    };
    const idx = buildStationIndex(lines);
    expect(idx).toHaveLength(1);
    expect(idx[0].routes.map((r) => r.routeId).sort()).toEqual(["4", "5", "6"]);
    expect(idx[0].stopIds).toEqual(["635"]);
  });

  it("keeps a complex group with only one present member as a plain station", () => {
    // KNOWN_COMPLEXES lists ["635", "L03", "R20"] — but if only 635 is
    // present, it should appear as an unmerged station, not be lost.
    const lines: Lines = {
      "6": makeLine({
        id: "6", routeId: "6", stops: [
          { id: "635", name: "14 St-Union Sq", lat: 40.7349, lng: -73.9904, shapeIdx: 0 },
        ],
      }),
    };
    const idx = buildStationIndex(lines);
    expect(idx).toHaveLength(1);
    expect(idx[0].stopIds).toEqual(["635"]);
  });
});

const SAMPLE_INDEX: StationEntry[] = [
  { stopId: "635", stopIds: ["635"], name: "14 St-Union Sq", lat: UNION_SQ.lat, lng: UNION_SQ.lng, routes: [] },
  { stopId: "127", stopIds: ["127"], name: "Times Sq-42 St", lat: TIMES_SQ.lat, lng: TIMES_SQ.lng, routes: [] },
  { stopId: "631", stopIds: ["631"], name: "Grand Central-42 St", lat: GRAND_CENTRAL.lat, lng: GRAND_CENTRAL.lng, routes: [] },
  { stopId: "D17", stopIds: ["D17"], name: "34 St-Herald Sq", lat: HERALD_SQ.lat, lng: HERALD_SQ.lng, routes: [] },
];

describe("searchStations", () => {
  it("returns [] for an empty query", () => {
    expect(searchStations(SAMPLE_INDEX, "")).toEqual([]);
    expect(searchStations(SAMPLE_INDEX, "   ")).toEqual([]);
  });

  it("matches multi-word substrings out of order", () => {
    const r = searchStations(SAMPLE_INDEX, "union sq");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("14 St-Union Sq");
  });

  it("is case-insensitive", () => {
    const r = searchStations(SAMPLE_INDEX, "UNION");
    expect(r[0].name).toBe("14 St-Union Sq");
  });

  it("matches '42 st' across both 42 St complexes", () => {
    const r = searchStations(SAMPLE_INDEX, "42 st");
    expect(r.map((s) => s.name).sort()).toEqual(["Grand Central-42 St", "Times Sq-42 St"]);
  });

  it("respects the limit", () => {
    const r = searchStations(SAMPLE_INDEX, "st", 2);
    expect(r).toHaveLength(2);
  });
});

describe("nearestStations", () => {
  it("returns stations sorted by ascending distance", () => {
    // Standing at Herald Sq itself: closest is Herald Sq, then Times
    // Sq (~7 blocks), then Grand Central, then Union Sq.
    const r = nearestStations(SAMPLE_INDEX, HERALD_SQ.lng, HERALD_SQ.lat, 4);
    expect(r.map((s) => s.name)).toEqual([
      "34 St-Herald Sq",
      "Times Sq-42 St",
      "Grand Central-42 St",
      "14 St-Union Sq",
    ]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].meters).toBeGreaterThanOrEqual(r[i - 1].meters);
    }
  });

  it("respects the limit", () => {
    const r = nearestStations(SAMPLE_INDEX, HERALD_SQ.lng, HERALD_SQ.lat, 2);
    expect(r).toHaveLength(2);
  });
});

describe("nearestStationsWithin", () => {
  it("returns only stations within the radius", () => {
    // 1500m around Herald Sq covers Times Sq (~700m) and Grand Central
    // (~900m), but not Union Sq (~1.7km).
    const r = nearestStationsWithin(SAMPLE_INDEX, HERALD_SQ.lng, HERALD_SQ.lat, 1_500);
    const names = r.map((s) => s.name);
    expect(names).toContain("34 St-Herald Sq");
    expect(names).toContain("Times Sq-42 St");
    expect(names).toContain("Grand Central-42 St");
    expect(names).not.toContain("14 St-Union Sq");
  });

  it("falls back to the absolute nearest when nothing is within radius", () => {
    // 1m radius around a point in the middle of the Hudson — no station
    // qualifies, but we should still get the nearest one as fallback.
    const r = nearestStationsWithin(SAMPLE_INDEX, -74.05, 40.74, 1);
    expect(r).toHaveLength(1);
  });

  it("respects the limit", () => {
    const r = nearestStationsWithin(SAMPLE_INDEX, HERALD_SQ.lng, HERALD_SQ.lat, 10_000, 2);
    expect(r).toHaveLength(2);
  });
});
