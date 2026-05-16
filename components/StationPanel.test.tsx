import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArrivalRow, DirectionSection } from "./StationPanel";
import { trainStaleness } from "@/lib/trainStaleness";

const NOW_MS = new Date("2026-05-10T00:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

const baseArrival = {
  routeId: "F",
  stopId: "F18",
  direction: "S" as const,
  eta: NOW_SEC + 5 * 60,
  tripId: "trip-stale",
};

const badge = { id: "F", color: "#FF6319", textColor: "white" as const };

describe("ArrivalRow staleness label", () => {
  it("renders no staleness sub-line when fresh", () => {
    const fresh = trainStaleness(NOW_SEC - 30, NOW_MS, NOW_SEC);
    render(
      <ArrivalRow
        arrival={baseArrival}
        now={NOW_MS}
        badge={badge}
        isExpress={false}
        terminusName="Coney Island"
        onTapRoute={vi.fn()}
        staleness={fresh}
      />,
    );
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.queryByText(/Stale/)).toBeNull();
    expect(screen.getByText("to Coney Island")).toBeTruthy();
    expect(screen.getByText("5 min")).toBeTruthy();
  });

  it("renders 'Updated Nm ago' for soft-stale (90s < age <= 360s)", () => {
    const softStale = trainStaleness(NOW_SEC - 4 * 60, NOW_MS, NOW_SEC);
    render(
      <ArrivalRow
        arrival={baseArrival}
        now={NOW_MS}
        badge={badge}
        isExpress={false}
        terminusName="Coney Island"
        onTapRoute={vi.fn()}
        staleness={softStale}
      />,
    );
    expect(screen.getByText("Updated 4m ago")).toBeTruthy();
  });

  it("renders 'Stale · Nm' past the hard-stale floor", () => {
    const hardStale = trainStaleness(NOW_SEC - 10 * 60, NOW_MS, NOW_SEC);
    render(
      <ArrivalRow
        arrival={baseArrival}
        now={NOW_MS}
        badge={badge}
        isExpress={false}
        terminusName="Coney Island"
        onTapRoute={vi.fn()}
        staleness={hardStale}
      />,
    );
    expect(screen.getByText("Stale · 10m")).toBeTruthy();
  });

  it("renders no staleness sub-line when staleness is null (no Train entry for the trip)", () => {
    // Mirrors the StationPanel branch where lastReportedByTripId.has(tripId)
    // is false — the trip showed up in stop_time_updates without a paired
    // VehiclePosition, so by definition the prediction is as fresh as the
    // most recent poll and no staleness chrome should render.
    render(
      <ArrivalRow
        arrival={baseArrival}
        now={NOW_MS}
        badge={badge}
        isExpress={false}
        terminusName="Coney Island"
        onTapRoute={vi.fn()}
        staleness={null}
      />,
    );
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.queryByText(/Stale/)).toBeNull();
  });
});

const routeInfo = new Map([["F", badge]]);
const terminusByRoute = new Map([["F", { N: "Jamaica", S: "Coney Island" }]]);

function renderSection(opts: {
  arrivals: typeof baseArrival[];
  hasData: boolean;
}) {
  return render(
    <DirectionSection
      label="Northbound"
      icon={<span data-testid="dir-icon" />}
      arrivals={opts.arrivals}
      now={NOW_MS}
      routeInfo={routeInfo}
      terminusByRoute={terminusByRoute}
      direction="S"
      onSelectLine={vi.fn()}
      lastReportedByTripId={new Map()}
      generatedAtSec={NOW_SEC}
      hasData={opts.hasData}
    />,
  );
}

describe("DirectionSection loading vs. empty", () => {
  // The bug: on a cold first visit (no localStorage cache) `data` is
  // null until the first /api/trains poll resolves, so `arrivals` is
  // []. Before this fix the section unconditionally rendered the
  // definitive "No upcoming trains in the next 45 min." for both
  // directions while the parent simultaneously showed "Loading live
  // arrivals…" — a contradictory, inaccurate cold-open state for
  // exactly the brand-new rider the product is meant to win.
  it("suppresses the negative empty copy while loading (hasData=false)", () => {
    renderSection({ arrivals: [], hasData: false });
    expect(
      screen.queryByText("No upcoming trains in the next 45 min."),
    ).toBeNull();
    // The count placeholder reads as "0 / none"; while loading we don't
    // know the count yet, so it must not render the "—" either.
    expect(screen.queryByText("—")).toBeNull();
    // The section header still renders during load so the panel's
    // structure communicates "what the app is" on first paint.
    expect(screen.getByText("Northbound")).toBeTruthy();
  });

  it("shows the negative empty copy once loaded and genuinely empty (hasData=true)", () => {
    renderSection({ arrivals: [], hasData: true });
    expect(
      screen.getByText("No upcoming trains in the next 45 min."),
    ).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders arrivals + an upcoming count when loaded with data", () => {
    renderSection({ arrivals: [baseArrival], hasData: true });
    expect(screen.getByText("to Coney Island")).toBeTruthy();
    expect(screen.getByText("1 upcoming")).toBeTruthy();
    expect(
      screen.queryByText("No upcoming trains in the next 45 min."),
    ).toBeNull();
  });

  it("never hides real arrivals even if hasData is still false", () => {
    // ACCURACY-FIRST invariant: hasData gates only the empty-state
    // *messaging*. A future refactor that short-circuits the whole
    // body on !hasData would hide trains a rider needs — pin against
    // it. (In production hasData=false implies arrivals=[]; this
    // asserts the gate's scope, not a reachable state.)
    renderSection({ arrivals: [baseArrival], hasData: false });
    expect(screen.getByText("to Coney Island")).toBeTruthy();
  });
});
