// @vitest-environment node

import { describe, expect, it } from "vitest";
import { findLineBySlug, lineSlug } from "./lineSlug";
import type { Lines, SubwayLine } from "./subwayData";

const fakeLine = (id: string, name: string): SubwayLine => ({
  id,
  routeId: id,
  name,
  color: "#000",
  textColor: "white",
  stops: [],
  shape: [],
});

// Mirrors `scripts/build-gtfs.mjs`: shuttle routeIds (GS/FS/H) carry
// the display alias `"S"` in the `id` field. The Record key matches
// `routeId`, never `id`, so consumers must route URL/state lookups
// through `routeId` for shuttles to work.
const fakeShuttle = (routeId: string, name: string): SubwayLine => ({
  id: "S",
  routeId,
  name,
  color: "#808183",
  textColor: "white",
  stops: [],
  shape: [],
});

const fixture: Lines = {
  "1": fakeLine("1", "Broadway - 7 Avenue Local"),
  A: fakeLine("A", "8 Avenue Express"),
  GS: fakeShuttle("GS", "42 St Shuttle"),
  FS: fakeShuttle("FS", "Franklin Av Shuttle"),
  H: fakeShuttle("H", "Rockaway Park Shuttle"),
  SI: fakeLine("SI", "Staten Island Railway"),
};

describe("lineSlug", () => {
  it("lowercases the id", () => {
    expect(lineSlug("A")).toBe("a");
    expect(lineSlug("FS")).toBe("fs");
    expect(lineSlug("1")).toBe("1");
  });
});

describe("findLineBySlug", () => {
  it("resolves canonical lowercase slugs", () => {
    expect(findLineBySlug(fixture, "a")?.routeId).toBe("A");
    expect(findLineBySlug(fixture, "fs")?.routeId).toBe("FS");
    expect(findLineBySlug(fixture, "si")?.routeId).toBe("SI");
    expect(findLineBySlug(fixture, "1")?.routeId).toBe("1");
  });

  it("is case-insensitive (so /line/A still resolves)", () => {
    expect(findLineBySlug(fixture, "A")?.routeId).toBe("A");
    expect(findLineBySlug(fixture, "Fs")?.routeId).toBe("FS");
  });

  it("returns null for unknown slugs", () => {
    expect(findLineBySlug(fixture, "xyz")).toBeNull();
    expect(findLineBySlug(fixture, "")).toBeNull();
  });

  // Regression: the three shuttles share the display alias `id: "S"`
  // but live under distinct Record keys. Looking them up by slug must
  // resolve to the right routeId — and never to the (non-existent)
  // `lines["S"]` which would alias all three to a single page.
  it("disambiguates shuttle lines by their routeId, not the 'S' alias", () => {
    expect(findLineBySlug(fixture, "gs")?.routeId).toBe("GS");
    expect(findLineBySlug(fixture, "fs")?.routeId).toBe("FS");
    expect(findLineBySlug(fixture, "h")?.routeId).toBe("H");
    expect(findLineBySlug(fixture, "s")).toBeNull();
  });
});
