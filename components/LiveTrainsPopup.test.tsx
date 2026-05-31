import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TrainsResponse, Train } from "@/app/api/trains/route";
import type { Lines, SubwayLine } from "@/lib/subwayData";

// Mock the data hooks at module load. The component is otherwise pure:
// useNow drives the per-second age recomputation, but the initial state
// already reads Date.now() via the lazy useState initializer, so we
// don't need to mock it for first-render assertions.
const trainsRef = vi.hoisted(() => ({
  current: null as TrainsResponse | null,
}));
const linesRef = vi.hoisted(() => ({
  current: null as Lines | null,
}));

vi.mock("@/lib/useTrains", () => ({
  useTrains: () => trainsRef.current,
}));

vi.mock("@/lib/subwayData", () => ({
  useLines: () => linesRef.current,
}));

import LiveTrainsPopup from "./LiveTrainsPopup";

function makeLine(id: string, color = "#000", textColor: "white" | "black" = "white"): SubwayLine {
  return {
    id,
    routeId: id,
    name: `Line ${id}`,
    color,
    textColor,
    stops: [],
    shape: [],
  };
}

function makeShuttle(routeId: string): SubwayLine {
  // Shuttles render display id "S" but route id is GS/FS/H — pins the
  // routeId-vs-display-id split that the /line/[slug] href relies on.
  return {
    id: "S",
    routeId,
    name: `Shuttle ${routeId}`,
    color: "#6D6E71",
    textColor: "white",
    stops: [],
    shape: [],
  };
}

function makeTrain(id: string, routeId: string, over: Partial<Train> = {}): Train {
  return {
    id,
    routeId,
    direction: "N",
    progress: 0,
    prevStopId: "A",
    nextStopId: "B",
    status: "IN_TRANSIT_TO",
    ...over,
  };
}

function makeResponse(trains: Train[]): TrainsResponse {
  return {
    generatedAt: Date.now(),
    trains,
    arrivals: [],
  };
}

describe("LiveTrainsPopup", () => {
  beforeEach(() => {
    trainsRef.current = null;
    linesRef.current = null;
  });
  // Manual cleanup between cases so Radix's portal-managed dialog tears
  // down between mounts — without this the previous dialog stays attached
  // to body and screen.getAllByRole("link") sees duplicate matches.
  afterEach(() => {
    cleanup();
  });

  it("does not render the dialog body when open is false", () => {
    trainsRef.current = makeResponse([makeTrain("t1", "1")]);
    linesRef.current = { "1": makeLine("1", "#EE352E") };
    render(<LiveTrainsPopup open={false} onClose={vi.fn()} />);
    // Title is portalled only when the Radix dialog opens; closed dialog
    // emits nothing observable to the rider.
    expect(screen.queryByText("System Pulse")).toBeNull();
  });

  it("each per-line row is a Link to /line/[routeId-lower]", () => {
    trainsRef.current = makeResponse([
      makeTrain("t1", "1"),
      makeTrain("t2", "F"),
    ]);
    linesRef.current = {
      "1": makeLine("1", "#EE352E"),
      F: makeLine("F", "#FF6319"),
    };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    const oneLink = screen.getByRole("link", { name: /Open 1 line · 1 train in service/ });
    const fLink = screen.getByRole("link", { name: /Open F line · 1 train in service/ });
    expect(oneLink.getAttribute("href")).toBe("/line/1");
    expect(fLink.getAttribute("href")).toBe("/line/f");
  });

  it("shuttle routeId drives the href; display id renders in the bullet glyph", () => {
    // routeId "GS" must drive /line/gs, but the bullet glyph stays "S".
    // A regression that swapped these would land every shuttle on the
    // 404 /line/s instead of the real /line/gs page.
    trainsRef.current = makeResponse([makeTrain("t1", "GS")]);
    linesRef.current = { GS: makeShuttle("GS") };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    const link = screen.getByRole("link", { name: /Open S line/ });
    expect(link.getAttribute("href")).toBe("/line/gs");
    expect(within(link).getByText("S")).toBeTruthy();
  });

  it("tapping a row fires onClose so the dialog closes in lockstep with the soft-nav", () => {
    // Without this callback the Radix portal stays mounted for a frame
    // after Next.js's soft-nav unmounts the underlying surface, painting
    // a stale System Pulse over the /line/[slug] first frame.
    trainsRef.current = makeResponse([makeTrain("t1", "1")]);
    linesRef.current = { "1": makeLine("1", "#EE352E") };
    const onClose = vi.fn();
    render(<LiveTrainsPopup open onClose={onClose} />);

    const link = screen.getByRole("link", { name: /Open 1 line/ });
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("orders rows by current train count, descending", () => {
    // L has 3 trains, F has 2, 1 has 1 — list must read L → F → 1.
    trainsRef.current = makeResponse([
      makeTrain("a", "L"),
      makeTrain("b", "L"),
      makeTrain("c", "L"),
      makeTrain("d", "F"),
      makeTrain("e", "F"),
      makeTrain("f", "1"),
    ]);
    linesRef.current = {
      L: makeLine("L"),
      F: makeLine("F"),
      "1": makeLine("1"),
    };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    const links = screen.getAllByRole("link");
    // Each row is a single Link; the order of links is the row order.
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/line/l",
      "/line/f",
      "/line/1",
    ]);
  });

  it("express variants ('6X') roll up onto their base routeId for the count + link", () => {
    // The aggregation in stats normalizes "6X" → "6". The rider sees one
    // row for the 6 with count 3, linking to /line/6, not a separate
    // /line/6x row.
    trainsRef.current = makeResponse([
      makeTrain("a", "6"),
      makeTrain("b", "6X"),
      makeTrain("c", "6X"),
    ]);
    linesRef.current = { "6": makeLine("6", "#00933C") };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    // One Link, count = 3 (express variants merged into base).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/line/6");
    expect(links[0].getAttribute("aria-label")).toContain("3 trains in service");
  });

  it("skips rows whose routeId is absent from the lines map (no broken /line/[slug] Links)", () => {
    // A live train on a route the lines map doesn't know about (e.g. a
    // brand-new MTA route id we haven't shipped a /line page for) must
    // not render a Link — there's no destination to navigate to.
    trainsRef.current = makeResponse([
      makeTrain("a", "1"),
      makeTrain("b", "MYSTERY"),
    ]);
    linesRef.current = { "1": makeLine("1", "#EE352E") };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/line/1");
  });

  it("singular vs plural train labelling matches count exactly", () => {
    // Plural matters for screen readers: "1 train" not "1 trains".
    trainsRef.current = makeResponse([
      makeTrain("a", "1"),
      makeTrain("b", "F"),
      makeTrain("c", "F"),
    ]);
    linesRef.current = {
      "1": makeLine("1"),
      F: makeLine("F"),
    };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: /Open 1 line · 1 train in service/ })
        .getAttribute("aria-label"),
    ).toBe("Open 1 line · 1 train in service");
    expect(
      screen.getByRole("link", { name: /Open F line · 2 trains in service/ })
        .getAttribute("aria-label"),
    ).toBe("Open F line · 2 trains in service");
  });

  it("empty-fleet state renders the placeholder copy and no Links", () => {
    trainsRef.current = makeResponse([]);
    linesRef.current = { "1": makeLine("1") };
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    expect(screen.getByText(/Waiting on the feed/)).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("null data (pre-first-poll) keeps the dialog mounted with the connecting copy", () => {
    // The hero count and lines-running list both depend on the stats
    // memo, which is null while data is null. The dialog should still
    // render its chrome — riders opening the System Pulse during a
    // cold boot need to see *something* (and the live-feed pill is the
    // only entry point into the dialog at all).
    trainsRef.current = null;
    linesRef.current = null;
    render(<LiveTrainsPopup open onClose={vi.fn()} />);

    expect(screen.getByText("System Pulse")).toBeTruthy();
    expect(
      screen.getByText(/Connecting to MTA realtime feed/),
    ).toBeTruthy();
  });
});
