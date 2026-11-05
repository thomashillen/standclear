// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("static GTFS generator contract", () => {
  it("does not add a wall-clock field that turns unchanged data into a refresh diff", () => {
    const source = readFileSync(resolve(__dirname, "build-gtfs.mjs"), "utf8");

    expect(source).toContain("const out = { lines };");
    expect(source).not.toContain("generatedAt: new Date()");
  });
});

describe("GTFS platform direction provenance", () => {
  it("requires a consistent explicit child-platform suffix instead of guessing direction_id", () => {
    const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { platformDirection } from "./scripts/gtfs-platform-direction.mjs";
      assert.equal(platformDirection(["G05S", "E01S"]), "S");
      assert.equal(platformDirection(["M23N", "G05N"]), "N");
      for (const ids of [[], ["G05S"], ["G05", "E01"], ["G05N", "E01S"], ["G05X", "E01X"]]) {
        assert.throws(() => platformDirection(ids));
      }
      console.log("verified");
    `], { cwd: resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.trim()).toBe("verified");
    const generator = readFileSync(resolve(__dirname, "build-gtfs.mjs"), "utf8");
    expect(generator).toContain("directionTowardEnd: platformDirection(tripStops[tripId].map(stop => stop.stopId))");
  });

  it("ships the verified E/J/Z southbound representative order", () => {
    const { lines } = JSON.parse(readFileSync(resolve(__dirname, "../public/gtfsData.json"), "utf8"));
    for (const route of ["E", "J", "Z"]) {
      expect(lines[route].directionTowardEnd).toBe("S");
      expect(lines[route].stops[0].id).toBe("G05");
      expect(lines[route].stops.at(-1).id).toBe(route === "E" ? "E01" : "M23");
    }
  });
});
