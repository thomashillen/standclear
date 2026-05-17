import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ArrivalRow,
  DirectionSection,
  resolveDestinationName,
} from "./StationPanel";
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

  it("speaks the single-sourced `trainStaleness.ariaLabel` on the stale sub-line", () => {
    // The sub-line's accessible name must be exactly what
    // `trainStaleness` produced — not a separately re-derived
    // "Position last updated …" string (the old inline path, which
    // also drifted from LinePanel's lowercase phrasing). Pin both that
    // the helper builds the spelled-out form and that ArrivalRow
    // echoes it verbatim.
    const softStale = trainStaleness(NOW_SEC - 4 * 60, NOW_MS, NOW_SEC);
    expect(softStale.ariaLabel).toBe("position last updated 4 minutes ago");
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
    // Visible compact label and the spoken long form both present,
    // both off the same age — and the old capitalized "Position …"
    // wording is gone.
    expect(screen.getByText("Updated 4m ago")).toBeTruthy();
    expect(
      screen.getByLabelText("position last updated 4 minutes ago"),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^Position last updated/)).toBeNull();
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

describe("resolveDestinationName", () => {
  const names = new Map<string, string>([
    ["619", "Parkchester"],
    ["601", "Pelham Bay Park"],
  ]);

  it("prefers the realtime destination over the static line terminus", () => {
    // The accuracy case: a 6 short-turning at Parkchester. Static
    // geometry says "to Pelham Bay Park"; the feed says 619. The rider
    // must see the short-turn so they don't board a train that quits
    // mid-route.
    expect(resolveDestinationName("619", names, "Pelham Bay Park")).toBe(
      "Parkchester",
    );
  });

  it("falls back to the static terminus when the feed omitted a destination", () => {
    expect(resolveDestinationName(undefined, names, "Pelham Bay Park")).toBe(
      "Pelham Bay Park",
    );
  });

  it("falls back to the static terminus when the dest stop isn't in any loaded line", () => {
    // A future MTA destination we don't carry on any representative
    // shape must degrade to the static label, never a bare stop id.
    expect(resolveDestinationName("999", names, "Pelham Bay Park")).toBe(
      "Pelham Bay Park",
    );
  });

  it("returns undefined when neither realtime nor static is available", () => {
    expect(resolveDestinationName(undefined, names, undefined)).toBeUndefined();
    expect(resolveDestinationName("999", names, undefined)).toBeUndefined();
  });

  it("renders the resolved realtime terminus through ArrivalRow", () => {
    // End-to-end at the row: a short-turning arrival shows the live
    // destination, not the static one.
    render(
      <ArrivalRow
        arrival={{ ...baseArrival, routeId: "6", destStopId: "619" }}
        now={NOW_MS}
        badge={{ id: "6", color: "#00933C", textColor: "white" }}
        isExpress={false}
        terminusName={resolveDestinationName("619", names, "Pelham Bay Park")}
        onTapRoute={vi.fn()}
        staleness={null}
      />,
    );
    expect(screen.getByText("to Parkchester")).toBeTruthy();
    expect(screen.queryByText("to Pelham Bay Park")).toBeNull();
  });
});
