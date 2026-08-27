// @vitest-environment node

import { describe, expect, it } from "vitest";
import { summarizeFleetStaleness } from "./trainStaleness";

const NOW_MS = new Date("2026-08-27T04:00:00Z").getTime();

describe("summarizeFleetStaleness snapshot timestamp units", () => {
  it("treats a stale millisecond generatedAt as stale when vehicle timestamps are missing", () => {
    const generatedAtMs = NOW_MS - 10 * 60 * 1000;

    expect(
      summarizeFleetStaleness([{}, {}, {}], NOW_MS, generatedAtMs),
    ).toEqual({ stale: 3, veryStale: 3 });
  });

  it("preserves the documented epoch-seconds contract", () => {
    const generatedAtSec = NOW_MS / 1000 - 10 * 60;

    expect(
      summarizeFleetStaleness([{}, {}], NOW_MS, generatedAtSec),
    ).toEqual({ stale: 2, veryStale: 2 });
  });
});
