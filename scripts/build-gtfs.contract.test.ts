// @vitest-environment node
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
