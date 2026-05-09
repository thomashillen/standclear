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

const fixture: Lines = {
  "1": fakeLine("1", "Broadway - 7 Avenue Local"),
  A: fakeLine("A", "8 Avenue Express"),
  FS: fakeLine("FS", "Franklin Av Shuttle"),
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
    expect(findLineBySlug(fixture, "a")?.id).toBe("A");
    expect(findLineBySlug(fixture, "fs")?.id).toBe("FS");
    expect(findLineBySlug(fixture, "si")?.id).toBe("SI");
    expect(findLineBySlug(fixture, "1")?.id).toBe("1");
  });

  it("is case-insensitive (so /line/A still resolves)", () => {
    expect(findLineBySlug(fixture, "A")?.id).toBe("A");
    expect(findLineBySlug(fixture, "Fs")?.id).toBe("FS");
  });

  it("returns null for unknown slugs", () => {
    expect(findLineBySlug(fixture, "xyz")).toBeNull();
    expect(findLineBySlug(fixture, "")).toBeNull();
  });
});
