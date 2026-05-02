// @vitest-environment node
import { describe, it, expect } from "vitest";
import { alertsForRoutes } from "./useAlerts";
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
