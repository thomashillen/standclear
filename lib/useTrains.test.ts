// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextArrivals, trainLatLng, trainsForLine, type Arrival, type Train } from "./useTrains";
import type { SubwayLine } from "./subwayData";
import type { TrainsResponse } from "@/app/api/trains/route";

function train(over: Partial<Train> = {}): Train {
  return {
    id: over.id ?? "t1",
    routeId: over.routeId ?? "4",
    direction: over.direction ?? "S",
    progress: over.progress ?? 0.5,
    prevStopId: over.prevStopId ?? "631",
    nextStopId: over.nextStopId ?? "635",
    status: over.status ?? "IN_TRANSIT_TO",
  };
}

const STRAIGHT_NS_LINE: SubwayLine = {
  id: "T", routeId: "T", name: "Test", color: "#000", textColor: "white",
  // 5 evenly spaced points, due-south chord (lat decreasing).
  shape: [
    [-74.0, 40.80],
    [-74.0, 40.78],
    [-74.0, 40.76],
    [-74.0, 40.74],
    [-74.0, 40.72],
  ],
  stops: [
    { id: "S0", name: "S0", lat: 40.80, lng: -74.0, shapeIdx: 0 },
    { id: "S2", name: "S2", lat: 40.76, lng: -74.0, shapeIdx: 2 },
    { id: "S4", name: "S4", lat: 40.72, lng: -74.0, shapeIdx: 4 },
  ],
};

describe("trainLatLng", () => {
  it("returns null when prev or next stop isn't on the line", () => {
    expect(trainLatLng(STRAIGHT_NS_LINE, train({ prevStopId: "X", nextStopId: "S2" }))).toBeNull();
    expect(trainLatLng(STRAIGHT_NS_LINE, train({ prevStopId: "S0", nextStopId: "Y" }))).toBeNull();
  });

  it("interpolates linearly along the shape between two stops", () => {
    // Train halfway between S0 (idx 0, lat 40.80) and S2 (idx 2, lat 40.76).
    // Halfway = lat 40.78, lng -74.0.
    const r = trainLatLng(
      STRAIGHT_NS_LINE,
      train({ prevStopId: "S0", nextStopId: "S2", progress: 0.5 }),
    );
    expect(r).not.toBeNull();
    expect(r!.lng).toBeCloseTo(-74.0, 6);
    expect(r!.lat).toBeCloseTo(40.78, 6);
  });

  it("places the train at the stop coords when dwelling (prev === next)", () => {
    const r = trainLatLng(
      STRAIGHT_NS_LINE,
      train({ prevStopId: "S2", nextStopId: "S2", progress: 1, status: "STOPPED_AT" }),
    );
    expect(r).not.toBeNull();
    expect(r!.lng).toBeCloseTo(-74.0, 6);
    expect(r!.lat).toBeCloseTo(40.76, 6);
  });

  it("orients southbound trains to ~180° on a due-south track", () => {
    const r = trainLatLng(
      STRAIGHT_NS_LINE,
      train({ prevStopId: "S0", nextStopId: "S2", direction: "S", progress: 0.5 }),
    );
    expect(r!.bearing).toBeGreaterThan(170);
    expect(r!.bearing).toBeLessThan(190);
  });

  it("orients northbound trains to ~0° on the same track", () => {
    // Reverse: prev=S2 (south), next=S0 (north), direction N.
    const r = trainLatLng(
      STRAIGHT_NS_LINE,
      train({ prevStopId: "S2", nextStopId: "S0", direction: "N", progress: 0.5 }),
    );
    // Bearing returned in [0, 360); allow either ~0 or ~360.
    const bearing = r!.bearing;
    const wrapped = bearing > 180 ? 360 - bearing : bearing;
    expect(wrapped).toBeLessThan(10);
  });
});

describe("trainsForLine", () => {
  const data: TrainsResponse = {
    generatedAt: 0,
    trains: [
      train({ id: "a", routeId: "4" }),
      train({ id: "b", routeId: "4" }),
      train({ id: "c", routeId: "5" }),
    ],
    arrivals: [],
  };

  it("returns trains matching the routeId", () => {
    const r = trainsForLine(data, "4");
    expect(r.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("returns [] for an unknown route", () => {
    expect(trainsForLine(data, "Z")).toEqual([]);
  });

  it("returns [] when data is null", () => {
    expect(trainsForLine(null, "4")).toEqual([]);
  });
});

describe("nextArrivals", () => {
  const arrivals: Arrival[] = [
    { routeId: "4", stopId: "631", direction: "S", eta: 100, tripId: "t1" },
    { routeId: "4", stopId: "631", direction: "S", eta: 200, tripId: "t2" },
    { routeId: "4", stopId: "631", direction: "S", eta: 300, tripId: "t3" },
    { routeId: "4", stopId: "631", direction: "S", eta: 400, tripId: "t4" },
    { routeId: "4", stopId: "631", direction: "N", eta: 110, tripId: "t5" },
    { routeId: "5", stopId: "631", direction: "S", eta: 120, tripId: "t6" },
    { routeId: "4", stopId: "635", direction: "S", eta: 130, tripId: "t7" },
  ];
  const data: TrainsResponse = { generatedAt: 0, trains: [], arrivals };

  it("filters to the requested route + stop", () => {
    const r = nextArrivals(data, "4", "631");
    expect(r.every((a) => a.routeId === "4" && a.stopId === "631")).toBe(true);
  });

  it("further filters by direction when provided", () => {
    const r = nextArrivals(data, "4", "631", "N");
    expect(r).toHaveLength(1);
    expect(r[0].tripId).toBe("t5");
  });

  it("respects the limit (default 3)", () => {
    expect(nextArrivals(data, "4", "631", "S")).toHaveLength(3);
    expect(nextArrivals(data, "4", "631", "S", 2)).toHaveLength(2);
  });

  it("returns [] when data is null", () => {
    expect(nextArrivals(null, "4", "631")).toEqual([]);
  });
});
