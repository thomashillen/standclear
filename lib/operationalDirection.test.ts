import { describe, expect, it } from "vitest";
import { directionalTermini } from "./operationalDirection";
import type { SubwayLine } from "./subwayData";

function line(route: string): SubwayLine {
  const south = route === "E" ? "E01" : "M23";
  return {
    id: route, routeId: route, name: route, color: "#000000", textColor: "white", shape: [],
    stops: [
      { id: "G05", name: "Jamaica Center", lat: 40.702147, lng: -73.801109, shapeIdx: 0 },
      { id: south, name: route === "E" ? "World Trade Center" : "Broad St", lat: route === "E" ? 40.712582 : 40.706476, lng: -74.01, shapeIdx: 1 },
    ],
  };
}

describe("static terminus direction labels", () => {
  for (const route of ["E", "J", "Z"]) {
    it(`${route} labels Jamaica northbound with cached or verified metadata in either order`, () => {
      const original = line(route);
      const expected = { N: "Jamaica Center", S: original.stops[1].name };
      expect(directionalTermini(original)).toEqual(expected);
      expect(directionalTermini({ ...original, directionTowardEnd: "S" })).toEqual(expected);
      const reverse = { ...original, stops: [...original.stops].reverse() };
      expect(directionalTermini(reverse)).toEqual(expected);
      expect(directionalTermini({ ...reverse, directionTowardEnd: "N" })).toEqual(expected);
    });
  }

  it("does not invent names from an incomplete static line", () => {
    expect(directionalTermini({ ...line("E"), stops: [] })).toBeNull();
    expect(directionalTermini({ ...line("E"), stops: line("E").stops.slice(0, 1) })).toBeNull();
  });
});
