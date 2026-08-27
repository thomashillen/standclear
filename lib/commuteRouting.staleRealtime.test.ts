// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  estimateTripTimeSec,
  hasReachableFirstLegArrival,
  rankPlansByTime,
  type TripPlan,
} from "./commuteRouting";
import type { Arrival } from "./useTrains";

const NOW_SEC = new Date("2026-08-27T04:00:00Z").getTime() / 1000;

function directPlan(routeId: string, stopCount: number): TripPlan {
  return {
    legs: [
      {
        routeId,
        direction: "N",
        boardStopId: "A01N",
        alightStopId: "B01N",
        boardComplexId: "A01",
        alightComplexId: "B01",
        stopCount,
      },
    ],
    totalStops: stopCount,
  };
}

const shortFallbackPlan = directPlan("1", 1);
const longerLivePlan = directPlan("2", 4);
const liveArrival: Arrival = {
  routeId: "2",
  stopId: "A01N",
  direction: "N",
  eta: NOW_SEC + 30,
  tripId: "trip-2",
};
const arrivalsByStation = new Map<string, Arrival[]>([["A01", [liveArrival]]]);

describe("stale realtime commute fallback", () => {
  it("keeps preferring a reachable route while the snapshot is fresh", () => {
    const ranked = rankPlansByTime([shortFallbackPlan, longerLivePlan], {
      arrivalsByStation,
      nowSec: NOW_SEC,
      liveSnapshotGeneratedAtSec: NOW_SEC - 15,
      preferReachableFirstLeg: true,
    });

    expect(ranked[0]).toBe(longerLivePlan);
    expect(
      hasReachableFirstLegArrival(longerLivePlan, {
        arrivalsByStation,
        nowSec: NOW_SEC,
        liveSnapshotGeneratedAtSec: NOW_SEC - 15,
      }),
    ).toBe(true);
  });

  it("treats a stale snapshot as unknown and returns to deterministic fallback ranking", () => {
    const options = {
      arrivalsByStation,
      nowSec: NOW_SEC,
      liveSnapshotGeneratedAtSec: NOW_SEC - 120,
      preferReachableFirstLeg: true,
    };

    expect(hasReachableFirstLegArrival(longerLivePlan, options)).toBeNull();
    expect(hasReachableFirstLegArrival(shortFallbackPlan, options)).toBeNull();

    const ranked = rankPlansByTime([longerLivePlan, shortFallbackPlan], options);
    expect(ranked[0]).toBe(shortFallbackPlan);
  });

  it("does not substitute an old live ETA into the time estimate", () => {
    const fresh = estimateTripTimeSec(longerLivePlan, {
      arrivalsByStation,
      nowSec: NOW_SEC,
      liveSnapshotGeneratedAtSec: NOW_SEC - 15,
    });
    const stale = estimateTripTimeSec(longerLivePlan, {
      arrivalsByStation,
      nowSec: NOW_SEC,
      liveSnapshotGeneratedAtSec: NOW_SEC - 120,
    });

    // Fresh: 30 s live wait + 4 * 90 s travel.
    expect(fresh).toBe(390);
    // Stale: 4 min fallback wait + 4 * 90 s travel.
    expect(stale).toBe(600);
  });
});
