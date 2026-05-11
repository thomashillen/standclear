// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getInterchanges } from "./lineInterchanges";
import type { RouteBadge, StationEntry } from "./stopsIndex";

const badge = (id: string, routeId: string): RouteBadge => ({
  id,
  routeId,
  color: "#000",
  textColor: "white",
});

const stationWith = (routes: RouteBadge[]): StationEntry => ({
  stopId: "X",
  stopIds: ["X"],
  name: "Test",
  lat: 0,
  lng: 0,
  routes,
});

describe("getInterchanges", () => {
  it("returns [] for a missing entry", () => {
    expect(getInterchanges(undefined, "A")).toEqual([]);
  });

  it("returns [] when the station only serves the current line", () => {
    const entry = stationWith([badge("A", "A")]);
    expect(getInterchanges(entry, "A")).toEqual([]);
  });

  it("returns every route except the current one, preserving order", () => {
    const entry = stationWith([
      badge("1", "1"),
      badge("2", "2"),
      badge("3", "3"),
      badge("7", "7"),
      badge("N", "N"),
      badge("S", "GS"),
    ]);
    const ids = getInterchanges(entry, "2").map((r) => r.id);
    expect(ids).toEqual(["1", "3", "7", "N", "S"]);
  });

  it("filters by routeId so a shuttle landing page drops its own bullet", () => {
    // Times Sq complex on the GS shuttle landing page: badges include
    // 1/2/3/7/N/Q/R/W and the S shuttle itself. The shuttle's display
    // id is "S" but its routeId is "GS"; the filter must hit on routeId
    // so "GS" === "GS" excludes only the current shuttle and never
    // collides with the other display-"S" routes (FS / H) that don't
    // actually serve Times Sq but could in principle.
    const entry = stationWith([
      badge("1", "1"),
      badge("N", "N"),
      badge("S", "GS"),
    ]);
    const result = getInterchanges(entry, "GS");
    expect(result.map((r) => r.routeId)).toEqual(["1", "N"]);
  });

  it("does not mutate the input entry's routes array", () => {
    const routes = [badge("A", "A"), badge("C", "C")];
    const entry = stationWith(routes);
    getInterchanges(entry, "A");
    expect(entry.routes).toEqual(routes);
    expect(entry.routes.length).toBe(2);
  });
});
