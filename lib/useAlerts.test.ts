// @vitest-environment node
import { describe, it, expect } from "vitest";
import { alertsForRoutes, alertsForStation } from "./useAlerts";
import type {
  AlertsResponse,
  AlertSelector,
  ServiceAlert,
} from "@/app/api/alerts/route";

function deriveSelectors(routeIds: string[], stopIds: string[]): AlertSelector[] {
  // Default factory shape: when both routes and stops are present,
  // emit the cross-product as AND selectors — this is the most common
  // MTA shape for stop-scoped alerts ("No [N] at Times Sq" tags one
  // informedEntity per direction with both routeId and stopId set).
  // Pure-route or pure-stop alerts get one selector per id.
  if (routeIds.length > 0 && stopIds.length > 0) {
    const out: AlertSelector[] = [];
    for (const r of routeIds) for (const s of stopIds) out.push({ routeId: r, stopId: s });
    return out;
  }
  if (routeIds.length > 0) return routeIds.map((r) => ({ routeId: r }));
  if (stopIds.length > 0) return stopIds.map((s) => ({ stopId: s }));
  return [];
}

function alert(over: Partial<ServiceAlert> & Pick<ServiceAlert, "id" | "routeIds">): ServiceAlert {
  const routeIds = over.routeIds;
  const stopIds = over.stopIds ?? [];
  return {
    header: over.header ?? "",
    description: over.description ?? "",
    effect: over.effect ?? "OTHER_EFFECT",
    severity: over.severity ?? "info",
    stopIds,
    selectors: over.selectors ?? deriveSelectors(routeIds, stopIds),
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
      // Multi-stop alert affecting two specific stations on the R.
      // (The N also runs through 127 but does not stop at R23, so
      // pinning this fixture to the R keeps each (route, stop) AND
      // selector consistent with the real MTA service map.)
      alert({ id: "multi-stop", routeIds: ["R"], stopIds: ["R23", "127"] }),
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

  // Codex-flagged P1 on PR #71: a single MTA alert can pair a
  // route-wide selector with a stop-specific selector ("R runs with
  // delays system-wide AND no service at Cortlandt"). Because GTFS-RT
  // selectors are independent per informedEntity (an OR across
  // entities), the route-wide piece must still surface at every R
  // station, not get scoped down to Cortlandt.
  it("preserves route-wide selectors even when a stop-specific selector is also present", () => {
    const mixed: AlertsResponse = {
      generatedAt: 0,
      alerts: [
        alert({
          id: "mixed",
          routeIds: ["R"],
          stopIds: ["R23"],
          selectors: [{ routeId: "R" }, { stopId: "R23" }],
        }),
      ],
    };
    // Random station on the R that is NOT Cortlandt should still see
    // the alert via the route-only selector.
    const otherR = alertsForStation(mixed, ["R20"], ["R"]);
    expect(otherR.map((a) => a.id)).toContain("mixed");
    // Cortlandt sees it too (stop-only selector matches).
    const cortlandt = alertsForStation(mixed, ["R23"], ["R"]);
    expect(cortlandt.map((a) => a.id)).toContain("mixed");
    // A station that is neither on the R nor at R23 doesn't see it.
    const unrelated = alertsForStation(mixed, ["L02"], ["L"]);
    expect(unrelated.map((a) => a.id)).not.toContain("mixed");
  });

  it("falls back to flattened routeIds/stopIds when selectors are absent (legacy cache)", () => {
    // Simulates a localStorage payload from the previous deploy that
    // doesn't carry the new `selectors` field. The helper should keep
    // working off the flattened arrays so the panel doesn't go silent
    // during the stale-while-revalidate window after a deploy.
    const legacyAlert: ServiceAlert = {
      id: "legacy",
      header: "",
      description: "",
      effect: "OTHER_EFFECT",
      severity: "info",
      routeIds: ["R"],
      stopIds: [],
      // @ts-expect-error simulating old payload missing selectors
      selectors: undefined,
      startTime: null,
      endTime: null,
    };
    const legacy: AlertsResponse = { generatedAt: 0, alerts: [legacyAlert] };
    expect(alertsForStation(legacy, ["R20"], ["R"]).map((a) => a.id)).toEqual(["legacy"]);
    expect(alertsForStation(legacy, ["L02"], ["L"]).map((a) => a.id)).toEqual([]);
  });
});
