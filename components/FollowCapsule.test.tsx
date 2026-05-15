import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FollowCapsule from "./FollowCapsule";
import type { Lines } from "@/lib/subwayData";
import type { Train, Arrival, TrainsResponse } from "@/lib/useTrains";

// Pin a stable `now` so eyebrow/ETA assertions are deterministic.
const NOW_MS = new Date("2026-05-14T12:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

function makeTrain(over: Partial<Train> = {}): Train {
  return {
    id: "trip-1",
    routeId: "F",
    direction: "N",
    progress: 0.4,
    prevStopId: "F17",
    nextStopId: "F18",
    status: "IN_TRANSIT_TO",
    lastReportedAt: NOW_SEC - 10, // fresh by default
    ...over,
  };
}

function makeArrival(over: Partial<Arrival> = {}): Arrival {
  return {
    routeId: "F",
    stopId: "F18",
    direction: "N",
    eta: NOW_SEC + 120, // 2 min away
    tripId: "trip-1",
    ...over,
  };
}

function makeData(over: Partial<TrainsResponse> = {}): TrainsResponse {
  return {
    generatedAt: NOW_MS,
    trains: [makeTrain()],
    arrivals: [makeArrival()],
    ...over,
  };
}

const lines: Lines = {
  F: {
    id: "F",
    routeId: "F",
    name: "F",
    color: "#FF6319",
    textColor: "white",
    stops: [
      { id: "F17", name: "York St", lat: 0, lng: 0, shapeIdx: 0 },
      { id: "F18", name: "2nd Ave", lat: 0, lng: 0, shapeIdx: 1 },
    ],
    shape: [[0, 0], [1, 1]],
  },
  // Yellow-line bullet — confirms the textColor === "black" branch fires.
  N: {
    id: "N",
    routeId: "N",
    name: "N",
    color: "#FCCC0A",
    textColor: "black",
    stops: [{ id: "R20", name: "Union Sq", lat: 0, lng: 0, shapeIdx: 0 }],
    shape: [[0, 0]],
  },
};

describe("FollowCapsule", () => {
  it("renders nothing when data is null", () => {
    const { container } = render(
      <FollowCapsule
        trainId="trip-1"
        data={null}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when lines is null", () => {
    const { container } = render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData()}
        lines={null}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when trainId is not in data.trains", () => {
    const { container } = render(
      <FollowCapsule
        trainId="trip-missing"
        data={makeData()}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the train's routeId is missing from lines", () => {
    const { container } = render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({ trains: [makeTrain({ routeId: "ZZ" })] })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the route bullet, next stop name, and ETA on the happy path", () => {
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData()}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    // Route bullet shows the display id.
    expect(screen.getByText("F")).toBeTruthy();
    // Next stop name from the stops index.
    expect(screen.getByText("2nd Ave")).toBeTruthy();
    // Eyebrow defaults to "Next stop" for in-transit trains.
    expect(screen.getByText("Next stop")).toBeTruthy();
    // 120 s away → "2 min" via formatEtaCountdown.
    expect(screen.getByText("2 min")).toBeTruthy();
  });

  it("swaps the eyebrow to 'Stopped at' and hides the ETA when status is STOPPED_AT", () => {
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({
          trains: [makeTrain({ status: "STOPPED_AT" })],
        })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(screen.getByText("Stopped at")).toBeTruthy();
    expect(screen.queryByText("Next stop")).toBeNull();
    // ETA pill is suppressed — the train is at the platform, no
    // future arrival to count down to.
    expect(screen.queryByText("2 min")).toBeNull();
  });

  it("hides the ETA when no arrival matches the trip + next stop", () => {
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({ arrivals: [] })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(screen.queryByText("2 min")).toBeNull();
  });

  it("matches arrivals by (tripId, stopId) — a sibling trip's arrival at the same stop is ignored", () => {
    // Two arrivals at F18: one belongs to a different tripId. The
    // capsule must not surface that one as the follow-target's ETA.
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({
          arrivals: [
            makeArrival({ tripId: "trip-other", eta: NOW_SEC + 30 }),
          ],
        })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(screen.queryByText("30 sec")).toBeNull();
    expect(screen.queryByText(/\bmin\b/)).toBeNull();
  });

  it("renders an up arrow for northbound and a down arrow for southbound", () => {
    const { rerender, container } = render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({ trains: [makeTrain({ direction: "N" })] })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    // lucide-react renders the icon name into the lucide class list.
    expect(container.querySelector(".lucide-arrow-up")).toBeTruthy();
    expect(container.querySelector(".lucide-arrow-down")).toBeNull();

    rerender(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({ trains: [makeTrain({ direction: "S" })] })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(container.querySelector(".lucide-arrow-down")).toBeTruthy();
    expect(container.querySelector(".lucide-arrow-up")).toBeNull();
  });

  it("renders '—' for the next stop when the stop id is unknown on the line", () => {
    // The MTA feed can surface a nextStopId that doesn't appear on the
    // route's representative shape (work re-routes, shuttle bridging,
    // shape staleness). Capsule should degrade to the em-dash placeholder
    // rather than crash on undefined.name.
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({
          trains: [makeTrain({ nextStopId: "F999" })],
          // Drop the now-unmatchable arrival so we isolate the placeholder.
          arrivals: [],
        })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders the stale eyebrow + amber tint when the per-vehicle position is > 90s old", () => {
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({
          trains: [makeTrain({ lastReportedAt: NOW_SEC - 4 * 60 })],
        })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    const eyebrow = screen.getByText("Updated 4m ago");
    expect(eyebrow).toBeTruthy();
    // The eyebrow is the load-bearing signal that the marker fade has
    // a textual companion — pin the amber class so a refactor that
    // breaks the visual cue trips the test.
    expect(eyebrow.className).toMatch(/text-amber-300/);
    // And "Next stop" should be gone; the swap is mutually exclusive.
    expect(screen.queryByText("Next stop")).toBeNull();
  });

  it("falls back to data.generatedAt when the per-vehicle timestamp is absent", () => {
    // lastReportedAt omitted → trainStaleness reads the snapshot's
    // generatedAt instead. Set generatedAt 5 min in the past so the
    // capsule should render the stale label even with no per-vehicle
    // timestamp on the train.
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({
          generatedAt: NOW_MS - 5 * 60 * 1000,
          trains: [makeTrain({ lastReportedAt: undefined })],
        })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    expect(screen.getByText("Updated 5m ago")).toBeTruthy();
  });

  it("applies the line's color to the bullet, and routes textColor='black' to a black bullet", () => {
    // Switch the followed trip to the N line so the textColor='black'
    // branch fires alongside the yellow fill.
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData({
          trains: [makeTrain({ routeId: "N", nextStopId: "R20" })],
          arrivals: [],
        })}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    const bullet = screen.getByText("N");
    expect(bullet.getAttribute("style")).toMatch(/background-color:\s*rgb\(252,\s*204,\s*10\)/);
    expect(bullet.getAttribute("style")).toMatch(/color:\s*rgb\(0,\s*0,\s*0\)/);
  });

  it("invokes onExit exactly once when the close button is tapped", () => {
    const onExit = vi.fn();
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData()}
        lines={lines}
        now={NOW_MS}
        onExit={onExit}
      />,
    );
    fireEvent.click(screen.getByLabelText("Stop following train"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("announces itself as a polite live region for screen readers", () => {
    render(
      <FollowCapsule
        trainId="trip-1"
        data={makeData()}
        lines={lines}
        now={NOW_MS}
        onExit={vi.fn()}
      />,
    );
    // Followers should hear ETA updates as they change, but never
    // interrupt — polite, not assertive. role=status mirrors the
    // wider StatusPanel/AlertsSection idiom.
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });
});
