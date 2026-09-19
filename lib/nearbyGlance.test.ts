import { describe, expect, it } from "vitest";
import type { StationEntry } from "./stopsIndex";
import type { TrainsResponse } from "./useTrains";
import { glanceEta, nearbyGlanceRows } from "./nearbyGlance";

const stations: StationEntry[] = [
  {
    stopId: "139", stopIds: ["139"], name: "Rector St",
    lng: -74.012, lat: 40.707,
    routes: [{ id: "1", routeId: "1", color: "#ee352e", textColor: "white" }],
  },
  {
    stopId: "R26", stopIds: ["R26"], name: "Rector St",
    lng: -74.0115, lat: 40.707,
    routes: [
      { id: "R", routeId: "R", color: "#fccc0a", textColor: "black" },
      { id: "W", routeId: "W", color: "#fccc0a", textColor: "black" },
    ],
  },
];

const feed: TrainsResponse = {
  generatedAt: 100_000,
  trains: [],
  arrivals: [
    { routeId: "1", stopId: "139", direction: "N", eta: 340, tripId: "one-n" },
    { routeId: "1", stopId: "139", direction: "S", eta: 520, tripId: "one-s" },
    { routeId: "R", stopId: "R26", direction: "N", eta: 280, tripId: "r-n" },
    { routeId: "W", stopId: "R26", direction: "S", eta: 460, tripId: "w-s" },
  ],
};

describe("nearby glance", () => {
  it("keeps same-named Rector stations separate and groups R/W times at their station", () => {
    const rows = nearbyGlanceRows(stations, feed, { lng: -74.012, lat: 40.707 }, 100);
    expect(rows.map((row) => row.station.stopId)).toEqual(["139", "R26"]);
    expect(rows[0]).toMatchObject({ northEta: 340, southEta: 520 });
    expect(rows[1]).toMatchObject({ northEta: 280, southEta: 460, northRouteId: "R", southRouteId: "W" });
    expect(rows[1].routes.map((route) => route.id)).toEqual(["R", "W"]);
    expect(glanceEta(rows[0].northEta, 100)).toBe("4m");
  });

  it("shows a train at the platform as Now, but suppresses stale snapshots", () => {
    const atPlatform: TrainsResponse = {
      generatedAt: 100_000,
      arrivals: [],
      trains: [{
        id: "current", routeId: "1", direction: "N", progress: 0,
        prevStopId: "139", nextStopId: "139", status: "STOPPED_AT",
        lastReportedAt: 98,
      }],
    };
    expect(glanceEta(nearbyGlanceRows(stations, atPlatform, { lng: -74.012, lat: 40.707 }, 100)[0].northEta, 100)).toBe("Now");
    expect(nearbyGlanceRows(stations, atPlatform, { lng: -74.012, lat: 40.707 }, 161)).toEqual([]);
  });

  it("does not show an arrival from a stale vehicle in a fresh snapshot", () => {
    const staleVehicle: TrainsResponse = {
      ...feed,
      trains: [{
        id: "one-n", routeId: "1", direction: "N", progress: 0,
        prevStopId: "139", nextStopId: "139", status: "IN_TRANSIT_TO",
        lastReportedAt: 1,
      }],
    };
    const rows = nearbyGlanceRows(stations, staleVehicle, { lng: -74.012, lat: 40.707 }, 100);
    expect(rows[0]).toMatchObject({ northEta: null, southEta: 520 });
  });
});
