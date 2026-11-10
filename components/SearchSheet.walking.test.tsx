import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { WalkingRoute } from "@/lib/walkingDirections";
import SearchSheet from "./SearchSheet";

const { fetchWalkingRoute, requestGeolocation } = vi.hoisted(() => ({
  fetchWalkingRoute: vi.fn(), requestGeolocation: vi.fn(),
}));
vi.mock("@/lib/walkingDirections", () => ({ fetchWalkingRoute }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => null }));
vi.mock("@/lib/useNow", () => ({ useNow: () => 1_800_000_000_000 }));
vi.mock("@/lib/subwayData", () => {
  const lines = {
    A: {
      id: "A", routeId: "A", name: "A", color: "#0039A6", textColor: "white",
      shape: [[-74, 40.7]],
      stops: [
        { id: "walk-south", name: "South station", lng: -74, lat: 40.7, shapeIdx: 0 },
      ],
    },
    B: {
      id: "B", routeId: "B", name: "B", color: "#FF6319", textColor: "white",
      shape: [[-74, 40.704]],
      stops: [{ id: "walk-north", name: "North station", lng: -74, lat: 40.704, shapeIdx: 0 }],
    },
  };
  return { useLines: () => lines };
});
vi.mock("@/lib/useGeolocation", () => ({
  useGeolocation: () => ({ status: "idle", lat: null, lng: null, request: requestGeolocation }),
}));
vi.mock("@/lib/useFavorites", () => ({
  useCommute: () => ({ home: null, work: null }),
  useFavorites: () => ({ has: () => false, toggle: vi.fn() }),
}));

type Props = ComponentProps<typeof SearchSheet>;
type Endpoint = NonNullable<NonNullable<Props["presetTrip"]>["from"]>;
const origin = { lng: -74.001, lat: 40.7 };
const destination = { lng: -73.999, lat: 40.701 };
const replacement = { lng: -73.998, lat: 40.7 };
const from: Endpoint = { kind: "address", name: "Coffee shop", ...origin };
const to: Endpoint = { kind: "address", name: "Bookshop", ...destination };
const nextTo: Endpoint = { kind: "address", name: "Bakery", ...replacement };
const station: Endpoint = { kind: "station", stopId: "walk-south" };
const stationCoords = { lng: -74, lat: 40.7 };

function route(a = origin, b = destination): WalkingRoute {
  return {
    coordinates: [[a.lng, a.lat], [-74.0005, 40.7005], [b.lng, b.lat]],
    distance: 250, duration: 200, steps: [],
  };
}

function mount(start = from, end = to) {
  const changed = vi.fn();
  const props: Props = {
    open: true, initialMode: "directions", onClose: vi.fn(), onStationOpen: vi.fn(),
    presetTrip: { from: start, to: end }, onWalkOnlyChange: changed,
  };
  const view = render(<SearchSheet {...props} />);
  return { ...view, props, changed };
}

beforeEach(() => {
  fetchWalkingRoute.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("SearchSheet walk-only map route", () => {
  it.each([
    ["two addresses beside the same station", from, to, origin, destination],
    ["a station and an address", station, to, stationCoords, destination],
    ["an address and a station", from, station, origin, stationCoords],
    ["two stations", station, { kind: "station", stopId: "walk-north" }, stationCoords, { lng: -74, lat: 40.704 }],
  ] as const)("uses the selected endpoints for %s", (_label, start, end, expectedFrom, expectedTo) => {
    const { changed } = mount(start, end);
    expect(screen.getByText("Walking is faster")).toBeTruthy();
    expect(fetchWalkingRoute).toHaveBeenCalledExactlyOnceWith(expectedFrom, expectedTo, { signal: expect.any(AbortSignal) });
    expect(changed).toHaveBeenLastCalledWith({ from: expectedFrom, to: expectedTo, coords: undefined });
  });

  it("replaces a resolved route after editing an endpoint without publishing old geometry for the new pair", async () => {
    const first = route();
    fetchWalkingRoute.mockResolvedValueOnce(first);
    const { rerender, props, changed } = mount();
    await act(async () => {});
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ coords: first.coordinates }));
    changed.mockClear();

    rerender(<SearchSheet {...props} presetTrip={{ from, to: nextTo }} />);
    expect(fetchWalkingRoute).toHaveBeenCalledTimes(2);
    expect(fetchWalkingRoute).toHaveBeenLastCalledWith(origin, replacement, { signal: expect.any(AbortSignal) });
    expect(changed).toHaveBeenLastCalledWith({ from: origin, to: replacement, coords: undefined });
    expect(changed.mock.calls.some(([overlay]) => overlay?.coords === first.coordinates)).toBe(false);
  });

  it("aborts the previous pair on swap and ignores a late response even if transport ignores abort", async () => {
    let finish!: (result: WalkingRoute) => void;
    fetchWalkingRoute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { changed } = mount();
    const signal: AbortSignal = fetchWalkingRoute.mock.calls[0][2].signal;
    fireEvent.click(screen.getByRole("button", { name: "Swap from and to" }));
    expect(signal.aborted).toBe(true);
    expect(fetchWalkingRoute).toHaveBeenLastCalledWith(destination, origin, { signal: expect.any(AbortSignal) });
    expect(changed).toHaveBeenLastCalledWith({ from: destination, to: origin, coords: undefined });
    changed.mockClear();
    await act(async () => { finish(route()); });
    expect(changed).not.toHaveBeenCalled();
  });

  it("accepts only the latest geometry after rapid endpoint replacements", async () => {
    const finishes: Array<(result: WalkingRoute) => void> = [];
    fetchWalkingRoute.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const { rerender, props, changed } = mount();
    rerender(<SearchSheet {...props} presetTrip={{ from, to: nextTo }} />);
    rerender(<SearchSheet {...props} presetTrip={{ from: nextTo, to }} />);
    expect(fetchWalkingRoute).toHaveBeenCalledTimes(3);
    expect(fetchWalkingRoute.mock.calls.map(([, , options]) => options.signal.aborted)).toEqual([true, true, false]);

    const currentRoute = route(replacement, destination);
    await act(async () => { finishes[2](currentRoute); });
    expect(changed).toHaveBeenLastCalledWith({ from: replacement, to: destination, coords: currentRoute.coordinates });
    changed.mockClear();
    await act(async () => { finishes[1](route(origin, replacement)); finishes[0](route()); });
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(["no route", "network error"])("keeps the correct fallback after %s and resolves a fresh route on reopen", async (failure) => {
    if (failure === "no route") fetchWalkingRoute.mockResolvedValueOnce(null);
    else fetchWalkingRoute.mockRejectedValueOnce(new Error("offline"));
    const { rerender, props, changed } = mount();
    await act(async () => {});
    expect(changed).toHaveBeenLastCalledWith({ from: origin, to: destination, coords: undefined });
    expect(fetchWalkingRoute).toHaveBeenCalledTimes(1);

    rerender(<SearchSheet {...props} open={false} />);
    expect(changed).toHaveBeenLastCalledWith(null);
    const recovered = route();
    fetchWalkingRoute.mockResolvedValueOnce(recovered);
    rerender(<SearchSheet {...props} />);
    await act(async () => {});
    expect(fetchWalkingRoute).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith({ from: origin, to: destination, coords: recovered.coordinates });
  });

  it.each(["clear", "back", "close", "unmount"] as const)("cancels the pending route on %s and rejects its late geometry", async (action) => {
    let finish!: (result: WalkingRoute) => void;
    fetchWalkingRoute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { rerender, unmount, props, changed } = mount();
    const signal: AbortSignal = fetchWalkingRoute.mock.calls[0][2].signal;
    if (action === "clear") fireEvent.click(screen.getByRole("button", { name: "Clear to" }));
    if (action === "back") fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
    if (action === "close") rerender(<SearchSheet {...props} open={false} />);
    if (action === "unmount") unmount();
    expect(signal.aborted).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(null);
    changed.mockClear();
    await act(async () => { finish(route()); });
    expect(changed).not.toHaveBeenCalled();
  });
});
