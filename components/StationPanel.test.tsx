import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("DirectionSection disclosure button", () => {
  const routeInfo = new Map([
    ["F", { id: "F", color: "#FF6319", textColor: "white" as const }],
  ]);
  const terminusByRoute = new Map([
    ["F", { N: "Jamaica-179 St", S: "Coney Island" }],
  ]);

  function makeArrivals(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      routeId: "F",
      stopId: "F18",
      direction: "S" as const,
      // Strictly future so none are dropped by the eta-expiry filter.
      eta: NOW_SEC + (i + 1) * 60,
      tripId: `trip-${i}`,
    }));
  }

  function renderSection(n: number) {
    return render(
      <DirectionSection
        label="Southbound"
        icon={<span />}
        arrivals={makeArrivals(n)}
        now={NOW_MS}
        routeInfo={routeInfo}
        terminusByRoute={terminusByRoute}
        direction="S"
        onSelectLine={vi.fn()}
        lastReportedByTripId={new Map()}
        generatedAtSec={NOW_SEC}
      />,
    );
  }

  // The route bullets render their own buttons, so the disclosure
  // control is always queried by its visible accessible name.
  const disclosure = () =>
    screen.queryByRole("button", { name: /show all|show less/i });

  it("renders no disclosure button when arrivals fit the default cap", () => {
    renderSection(3);
    expect(disclosure()).toBeNull();
    expect(screen.getAllByText("to Coney Island")).toHaveLength(3);
  });

  it("collapsed disclosure advertises aria-expanded=false and the overflow count", () => {
    renderSection(6);
    const btn = disclosure()!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("Show all (2 more)");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    // Default cap is 4 — the extra two stay hidden until expansion.
    expect(screen.getAllByText("to Coney Island")).toHaveLength(4);
  });

  it("flips aria-expanded to true and reveals every row when expanded", () => {
    renderSection(6);
    fireEvent.click(disclosure()!);
    const btn = disclosure()!;
    expect(btn.textContent).toBe("Show less");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("to Coney Island")).toHaveLength(6);
  });
});
