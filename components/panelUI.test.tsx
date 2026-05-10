import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TripPlanRow, type RouteColorMap } from "./panelUI";
import type { Arrival } from "@/lib/useTrains";
import type { TripPlan } from "@/lib/commuteRouting";
import type { StationEntry } from "@/lib/stopsIndex";

// Anchor "now" deterministically so trainStaleness's age math + the
// fmtEta countdown both line up against fixed offsets in the fixture.
const NOW_MS = new Date("2026-05-10T00:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

const origin: StationEntry = {
  stopId: "L03",
  stopIds: ["L03"],
  name: "1 Av",
  lat: 40.730953,
  lng: -73.981628,
  routes: [{ id: "L", routeId: "L", color: "#A7A9AC", textColor: "white" }],
};

const directLPlan: TripPlan = {
  legs: [
    {
      routeId: "L",
      direction: "N",
      boardStopId: "L03",
      alightStopId: "L01",
      boardComplexId: "L03",
      alightComplexId: "L01",
      stopCount: 2,
    },
  ],
  totalStops: 2,
};

const routeColors: RouteColorMap = new Map([
  ["L", { color: "#A7A9AC", textColor: "white", displayId: "L" }],
]);

const stationsByComplexId = new Map<string, StationEntry>([
  ["L03", origin],
]);

function makeArrival(tripId: string, etaOffsetSec: number): Arrival {
  return {
    routeId: "L",
    stopId: "L03",
    direction: "N",
    eta: NOW_SEC + etaOffsetSec,
    tripId,
  };
}

describe("TripPlanRow staleness", () => {
  it("renders no staleness chrome when all upcoming trains are fresh", () => {
    const arrivals = [
      makeArrival("trip-fresh-1", 60),
      makeArrival("trip-fresh-2", 5 * 60),
    ];
    const lastReportedByTripId = new Map<string, number | undefined>([
      ["trip-fresh-1", NOW_SEC - 30],
      ["trip-fresh-2", NOW_SEC - 60],
    ]);
    render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        lastReportedByTripId={lastReportedByTripId}
        generatedAtSec={NOW_SEC}
      />,
    );
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.queryByText(/Stale/)).toBeNull();
  });

  it("colors a stale ETA amber and renders the soonest stale label below", () => {
    const arrivals = [
      makeArrival("trip-fresh", 60),
      makeArrival("trip-soft", 4 * 60),
      makeArrival("trip-fresh-2", 9 * 60),
    ];
    const lastReportedByTripId = new Map<string, number | undefined>([
      ["trip-fresh", NOW_SEC - 30],
      // 4-min-stale train — soft-stale band (90 < age <= 360).
      ["trip-soft", NOW_SEC - 4 * 60],
      ["trip-fresh-2", NOW_SEC - 60],
    ]);
    const { container } = render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        lastReportedByTripId={lastReportedByTripId}
        generatedAtSec={NOW_SEC}
      />,
    );
    expect(screen.getByText("Updated 4m ago")).toBeTruthy();
    // The amber ETA chip lives on the soft-stale entry; assert it
    // exists rather than measuring class strings on every chip — the
    // sub-line is the user-visible signal that proves the branch fired.
    const amberNodes = container.querySelectorAll(".text-amber-300");
    expect(amberNodes.length).toBeGreaterThan(0);
  });

  it("uses the soonest stale train's band even when later trains are also stale", () => {
    // Both trains stale, but the soonest is in the soft band — the
    // sub-line should reflect that one, not the older harder-stale one.
    const arrivals = [
      makeArrival("trip-soft", 90),
      makeArrival("trip-hard", 10 * 60),
    ];
    const lastReportedByTripId = new Map<string, number | undefined>([
      ["trip-soft", NOW_SEC - 4 * 60],
      ["trip-hard", NOW_SEC - 12 * 60],
    ]);
    render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        lastReportedByTripId={lastReportedByTripId}
        generatedAtSec={NOW_SEC}
      />,
    );
    expect(screen.getByText("Updated 4m ago")).toBeTruthy();
    expect(screen.queryByText(/Stale ·/)).toBeNull();
  });

  it("ignores tripIds absent from lastReportedByTripId (no Train entry)", () => {
    // stop_time_update without a paired VehiclePosition: the prediction
    // is by definition as fresh as the latest poll, so no chrome.
    const arrivals = [makeArrival("trip-untracked", 3 * 60)];
    const lastReportedByTripId = new Map<string, number | undefined>();
    render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        lastReportedByTripId={lastReportedByTripId}
        generatedAtSec={NOW_SEC}
      />,
    );
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.queryByText(/Stale/)).toBeNull();
  });

  it("keeps the row calm when the staleness props are omitted entirely", () => {
    // Back-compat case: a call site that hasn't been threaded yet
    // should still render without any amber chrome.
    const arrivals = [makeArrival("trip-x", 3 * 60)];
    render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
      />,
    );
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.queryByText(/Stale/)).toBeNull();
  });

  it("forwards onSelect taps for the row container", () => {
    const onSelect = vi.fn();
    const arrivals = [makeArrival("trip-x", 3 * 60)];
    render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        onSelect={onSelect}
      />,
    );
    const button = screen.getByRole("button");
    button.click();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
