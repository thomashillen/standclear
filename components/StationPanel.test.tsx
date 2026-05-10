import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArrivalRow } from "./StationPanel";
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
