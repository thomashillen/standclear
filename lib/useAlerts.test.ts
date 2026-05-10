// @vitest-environment node
import { describe, it, expect } from "vitest";
import { alertsForRoutes, alertsForStation } from "./useAlerts";
import type { AlertsResponse, ServiceAlert } from "@/app/api/alerts/route";

function alert(over: Partial<ServiceAlert> & Pick<ServiceAlert, "id" | "routeIds">): ServiceAlert {
  return {
    header: over.header ?? "",
    description: over.description ?? "",
    effect: over.effect ?? "OTHER_EFFECT",
    severity: over.severity ?? "info",
    stopIds: over.stopIds ?? [],
    startTime: over.startTime ?? null,
    endTime: over.endTime ?? null,
    ...over,
  };
}

describe("alertsForRoutes", () => {
  const data: AlertsResponse = {
    generatedAt: 0,
    alerts: [
      alert({ id: "a", routeIds: ["4", "5"] }),
      alert({ id: "b", routeIds: ["L"] }),
      alert({ id: "c", routeIds: ["N", "Q", "R", "W"] }),
      alert({ id: "d", routeIds: [] }),
    ],
  };

  it("returns alerts whose routeIds intersect the query set", () => {
    const r = alertsForRoutes(data, ["4"]);
    expect(r.map((a) => a.id)).toEqual(["a"]);
  });

  it("matches any of multiple route ids", () => {
    const r = alertsForRoutes(data, ["4", "L"]);
    expect(r.map((a) => a.id).sort()).toEqual(["a", "b"]);
  });

  it("returns [] when no routeIds intersect", () => {
    expect(alertsForRoutes(data, ["7"])).toEqual([]);
  });

  it("returns [] when data is null", () => {
    expect(alertsForRoutes(null, ["4"])).toEqual([]);
  });

  it("ignores alerts with an empty routeIds list", () => {
    const r = alertsForRoutes(data, ["X"]);
    expect(r.find((a) => a.id === "d")).toBeUndefined();
  });
});

describe("alertsForStation", () => {
  // Mix of:
  //  - line-wide alerts (no stopIds): match by route
  //  - station-scoped alerts (stopIds present): match only when the
  //    station is in the list, regardless of route overlap
  //  - facility-only alerts (stopIds present, no routes): match by stop
  const data: AlertsResponse = {
    generatedAt: 0,
    alerts: [
      // Line-wide R alert — should appear at every R station.
      alert({ id: "line-R", routeIds: ["R"] }),
      // Station-scoped R alert at Cortlandt only — should NOT appear at
      // other R stations, even though the route matches.
      alert({ id: "stop-cortlandt-R", routeIds: ["R"], stopIds: ["R23"] }),
      // Pure facility alert (elevator out at Union Sq), no routes.
      alert({ id: "elevator-635", routeIds: [], stopIds: ["635"] }),
      // Multi-stop alert affecting two specific stations.
      alert({ id: "multi-stop", routeIds: ["N"], stopIds: ["R23", "127"] }),
    ],
  };

  it("matches line-wide alerts by route at any station on the route", () => {
    const r = alertsForStation(data, ["R20"], ["R"]);
    expect(r.map((a) => a.id)).toContain("line-R");
    expect(r.map((a) => a.id)).not.toContain("stop-cortlandt-R");
  });

  it("matches station-scoped alerts only at the listed station", () => {
    const cortlandt = alertsForStation(data, ["R23"], ["R"]);
    expect(cortlandt.map((a) => a.id)).toEqual(
      expect.arrayContaining(["line-R", "stop-cortlandt-R", "multi-stop"]),
    );
    const otherR = alertsForStation(data, ["R20"], ["R"]);
    expect(otherR.map((a) => a.id)).not.toContain("stop-cortlandt-R");
    expect(otherR.map((a) => a.id)).not.toContain("multi-stop");
  });

  it("matches pure-facility alerts (no routes) by stopId", () => {
    const unionSq = alertsForStation(data, ["635"], ["L", "4", "5", "6", "N", "Q", "R", "W"]);
    expect(unionSq.map((a) => a.id)).toContain("elevator-635");
    const notUnionSq = alertsForStation(data, ["L02"], ["L"]);
    expect(notUnionSq.map((a) => a.id)).not.toContain("elevator-635");
  });

  it("matches when ANY of the complex's platform stopIds intersects", () => {
    // Times Sq complex spans multiple platform ids; the multi-stop
    // alert lists 127, so the complex matches via that platform even
    // if other platform ids in the complex don't.
    const timesSq = alertsForStation(data, ["127", "725", "902", "A27"], ["1", "2", "3", "7", "N", "Q", "R", "W", "S"]);
    expect(timesSq.map((a) => a.id)).toContain("multi-stop");
  });

  it("returns [] when data is null", () => {
    expect(alertsForStation(null, ["635"], ["L"])).toEqual([]);
  });

  it("returns [] when neither stop nor route matches anything", () => {
    expect(alertsForStation(data, ["ZZZ"], ["7"])).toEqual([]);
  });
});
