// @vitest-environment node
import { describe, it, expect } from "vitest";
import { aggregateInterchanges, getInterchanges } from "./lineInterchanges";
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

describe("aggregateInterchanges", () => {
  // Build a fresh entry each call so order-preservation assertions
  // can't accidentally pass via shared reference state.
  const stop = (routes: RouteBadge[]): StationEntry => ({
    stopId: "X",
    stopIds: ["X"],
    name: "Test",
    lat: 0,
    lng: 0,
    routes,
  });

  it("returns [] for an empty iterable", () => {
    expect(aggregateInterchanges([], "A")).toEqual([]);
  });

  it("returns [] when every stop only serves the current line", () => {
    const stops = [stop([badge("A", "A")]), stop([badge("A", "A")])];
    expect(aggregateInterchanges(stops, "A")).toEqual([]);
  });

  it("dedups by routeId across stops and preserves first-appearance order", () => {
    // Simulate a slice of the 1 train: 242 St serves 1/2/3; Times Sq
    // adds 2/3/7/N/Q/R/W/S; South Ferry adds nothing new. The 2 and 3
    // bullets first appear at 242 St, the rest at Times Sq, and South
    // Ferry contributes no new routes — output must reflect that order
    // exactly, regardless of the order each stop's routes array lists
    // them in.
    const stops: StationEntry[] = [
      stop([badge("1", "1"), badge("2", "2"), badge("3", "3")]),
      stop([
        badge("1", "1"),
        badge("2", "2"),
        badge("3", "3"),
        badge("7", "7"),
        badge("N", "N"),
        badge("Q", "Q"),
        badge("R", "R"),
        badge("W", "W"),
        badge("S", "GS"),
      ]),
      stop([badge("1", "1")]),
    ];
    const ids = aggregateInterchanges(stops, "1").map((r) => r.id);
    expect(ids).toEqual(["2", "3", "7", "N", "Q", "R", "W", "S"]);
  });

  it("skips undefined entries silently (stop with no matching StationEntry)", () => {
    const stops: (StationEntry | undefined)[] = [
      undefined,
      stop([badge("A", "A"), badge("C", "C")]),
      undefined,
    ];
    expect(aggregateInterchanges(stops, "A").map((r) => r.id)).toEqual(["C"]);
  });

  it("dedup is keyed on routeId so a shuttle never sees its own bullet across the line", () => {
    // GS shuttle on its own /line/gs page: every stop on the shuttle
    // serves "S" with routeId "GS" plus various transfer routes at the
    // shuttle's terminals (Times Sq + Grand Central). The aggregate
    // must drop "GS" itself even though it appears at every stop, and
    // must NOT collide with a hypothetical other display-"S" route
    // (FS / H) appearing on the same complex — same shape as the
    // per-stop filter on getInterchanges.
    const stops: StationEntry[] = [
      stop([badge("S", "GS"), badge("1", "1"), badge("2", "2")]),
      stop([badge("S", "GS"), badge("4", "4"), badge("5", "5")]),
    ];
    const result = aggregateInterchanges(stops, "GS");
    expect(result.map((r) => r.routeId)).toEqual(["1", "2", "4", "5"]);
    // No leftover "GS" sneaked through.
    expect(result.find((r) => r.routeId === "GS")).toBeUndefined();
  });

  it("preserves the RouteBadge shape verbatim (color/textColor passthrough)", () => {
    const c = (id: string, routeId: string, color: string): RouteBadge => ({
      id,
      routeId,
      color,
      textColor: "white",
    });
    const stops: StationEntry[] = [
      stop([c("A", "A", "#0039A6"), c("C", "C", "#0039A6")]),
    ];
    const out = aggregateInterchanges(stops, "A");
    expect(out).toEqual([
      { id: "C", routeId: "C", color: "#0039A6", textColor: "white" },
    ]);
  });

  it("does not mutate the input entries", () => {
    const routes = [badge("1", "1"), badge("2", "2"), badge("3", "3")];
    const entry = stop(routes);
    aggregateInterchanges([entry, entry], "1");
    expect(entry.routes).toEqual(routes);
    expect(entry.routes.length).toBe(3);
  });
});
