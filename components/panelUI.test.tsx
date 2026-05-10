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

describe("TripPlanRow catch verdict", () => {
  // catchVerdict bands at walkFromMeters=300: runnable ≈ 131s, walkable
  // ≈ 299s, chill threshold ≈ 419s. Each test below picks ETA offsets
  // that put the arrival squarely in one band so the rendered class
  // is unambiguous.

  it("strikes through ETAs the rider can't physically catch", () => {
    const arrivals = [
      makeArrival("trip-miss", 60),
      makeArrival("trip-chill", 500),
    ];
    const { container } = render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        walkFromMeters={300}
      />,
    );
    // VERDICT_STYLES.miss carries `line-through` — the only place that
    // class appears in TripPlanRow's render tree.
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  it("tints a runnable ETA amber when walkFromMeters is set", () => {
    const arrivals = [makeArrival("trip-run", 200)];
    const { container } = render(
      <TripPlanRow
        plan={directLPlan}
        origin={origin}
        routeColors={routeColors}
        stationsByComplexId={stationsByComplexId}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        walkFromMeters={300}
      />,
    );
    expect(container.querySelectorAll(".text-amber-300").length).toBeGreaterThan(0);
  });

  it("leaves ETAs neutral when walkFromMeters is omitted (rider on platform)", () => {
    // Same eta that would be "miss" with a walk — without one, no
    // verdict tinting should apply.
    const arrivals = [makeArrival("trip-on-platform", 60)];
    const { container } = render(
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
    expect(container.querySelectorAll(".line-through")).toHaveLength(0);
  });

  it("verdict tint wins over stale tint when both apply", () => {
    // Rider is walking up (walkFromMeters=300) AND the next train's
    // VehiclePosition hasn't reported in 4 minutes (soft-stale). The
    // verdict should win for color — the train is in the "miss" band,
    // strikethrough-gray is more actionable than stale-amber. The
    // leadStale sub-line still surfaces "Updated 4m ago" textually.
    const arrivals = [makeArrival("trip-miss-stale", 60)];
    const lastReportedByTripId = new Map<string, number | undefined>([
      ["trip-miss-stale", NOW_SEC - 4 * 60],
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
        walkFromMeters={300}
        lastReportedByTripId={lastReportedByTripId}
        generatedAtSec={NOW_SEC}
      />,
    );
    // miss verdict applied to the chip — not amber.
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
    // Stale sub-line still rendered below the inline ETAs.
    expect(screen.getByText("Updated 4m ago")).toBeTruthy();
  });
});

describe("TripPlanRow trunk catch verdict (sibling routes)", () => {
  // Broadway BMT trunk: N/R/W co-run at e.g. Times Sq. The plan's
  // leg-1 routeId can be any of them — what matters for the render is
  // that `siblingRouteIds` populates so the per-arrival-bullet trunk
  // branch fires instead of the single-bullet branch.
  const trunkOrigin: StationEntry = {
    stopId: "R16",
    stopIds: ["R16"],
    name: "Times Sq-42 St",
    lat: 40.754672,
    lng: -73.986754,
    routes: [
      { id: "N", routeId: "N", color: "#FCCC0A", textColor: "black" },
      { id: "R", routeId: "R", color: "#FCCC0A", textColor: "black" },
      { id: "W", routeId: "W", color: "#FCCC0A", textColor: "black" },
    ],
  };

  const trunkPlan: TripPlan = {
    legs: [
      {
        routeId: "N",
        direction: "S",
        boardStopId: "R16",
        alightStopId: "R20",
        boardComplexId: "R16",
        alightComplexId: "R20",
        stopCount: 4,
        siblingRouteIds: ["R", "W"],
      },
    ],
    totalStops: 4,
  };

  const trunkRouteColors: RouteColorMap = new Map([
    ["N", { color: "#FCCC0A", textColor: "black", displayId: "N" }],
    ["R", { color: "#FCCC0A", textColor: "black", displayId: "R" }],
    ["W", { color: "#FCCC0A", textColor: "black", displayId: "W" }],
  ]);

  const trunkStations = new Map<string, StationEntry>([["R16", trunkOrigin]]);

  function trunkArrival(
    routeId: string,
    tripId: string,
    etaOffsetSec: number,
  ): Arrival {
    return {
      routeId,
      stopId: "R16",
      direction: "S",
      eta: NOW_SEC + etaOffsetSec,
      tripId,
    };
  }

  it("strikes through trunk ETAs the rider can't physically catch", () => {
    // Mix of arrivals across the N/R/W trunk. The 60s N is in the
    // "miss" band at walkFromMeters=300; the 500s W is "chill".
    const arrivals = [
      trunkArrival("N", "trip-miss-N", 60),
      trunkArrival("W", "trip-chill-W", 500),
    ];
    const { container } = render(
      <TripPlanRow
        plan={trunkPlan}
        origin={trunkOrigin}
        routeColors={trunkRouteColors}
        stationsByComplexId={trunkStations}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        walkFromMeters={300}
      />,
    );
    // The trunk branch ALSO renders the "Next:" prefix, but with
    // per-arrival route bullets — confirm we're in the trunk branch.
    expect(screen.getByText("Next:")).toBeTruthy();
    // Verdict tint reached the inline ETA chips.
    expect(
      container.querySelectorAll(".line-through").length,
    ).toBeGreaterThan(0);
  });

  it("leaves trunk ETAs neutral when walkFromMeters is omitted", () => {
    // Same arrivals — without the walk, no verdict tinting applies.
    const arrivals = [
      trunkArrival("N", "trip-on-platform-N", 60),
      trunkArrival("R", "trip-on-platform-R", 200),
    ];
    const { container } = render(
      <TripPlanRow
        plan={trunkPlan}
        origin={trunkOrigin}
        routeColors={trunkRouteColors}
        stationsByComplexId={trunkStations}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
      />,
    );
    expect(container.querySelectorAll(".line-through")).toHaveLength(0);
  });

  it("falls back to stale amber on the trunk when there's no walk verdict", () => {
    // No walkFromMeters, but the soonest train is soft-stale. The
    // chip should pick up the amber tint via the stale fallback, even
    // in the trunk render — matching the non-trunk path's behavior.
    const arrivals = [trunkArrival("R", "trip-stale-R", 60)];
    const lastReportedByTripId = new Map<string, number | undefined>([
      ["trip-stale-R", NOW_SEC - 4 * 60],
    ]);
    const { container } = render(
      <TripPlanRow
        plan={trunkPlan}
        origin={trunkOrigin}
        routeColors={trunkRouteColors}
        stationsByComplexId={trunkStations}
        arrivals={arrivals}
        now={NOW_MS}
        isPrimary={true}
        lastReportedByTripId={lastReportedByTripId}
        generatedAtSec={NOW_SEC}
      />,
    );
    expect(
      container.querySelectorAll(".text-amber-300").length,
    ).toBeGreaterThan(0);
  });
});
