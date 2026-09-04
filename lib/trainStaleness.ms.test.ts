// @vitest-environment node

import { expect, it } from "vitest";
import { summarizeFleetStaleness } from "./trainStaleness";

const NOW_MS = new Date("2026-05-09T18:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

it("normalizes a millisecond generatedAt fallback when vehicle timestamps are missing", () => {
  const trains = [
    {},
    {},
    { lastReportedAt: NOW_SEC - 30 },
  ];

  expect(
    summarizeFleetStaleness(trains, NOW_MS, NOW_MS - 600_000),
  ).toEqual({
    stale: 2,
    veryStale: 2,
  });
});
