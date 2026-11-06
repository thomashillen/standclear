import { useCallback, useState, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lines } from "@/lib/subwayData";
import SearchSheet from "./SearchSheet";

const { useLines, useCommute, geo, requestGeolocation, recentSearches, clock } = vi.hoisted(() => ({
  clock: { now: 1_800_000_000_000 },
  useLines: vi.fn(),
  useCommute: vi.fn(),
  geo: {
    status: "idle",
    lat: null as number | null,
    lng: null as number | null,
  },
  requestGeolocation: vi.fn(),
  recentSearches: { current: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/lib/subwayData", () => ({ useLines }));
vi.mock("@/lib/useNow", () => ({ useNow: () => clock.now }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => null }));
vi.mock("@/lib/useGeolocation", () => ({
  useGeolocation: () => ({ ...geo, request: requestGeolocation }),
}));
vi.mock("@/lib/useFavorites", () => ({
  useCommute,
  useFavorites: () => ({ favorites: new Set(), has: () => false, toggle: vi.fn() }),
}));
vi.mock("@/lib/useRecentSearches", () => ({
  useRecentSearches: () => ({
    recents: recentSearches.current,
    addStation: vi.fn(),
    addPlace: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("@/lib/geocoding", () => ({
  makeDebouncedSuggester: () => (query: string, _options: unknown, done: (items: unknown[]) => void) =>
    done(query === "New address" ? [{ mapboxId: "new-address", name: "New address", context: "Manhattan" }] : []),
  retrievePlace: async () => ({ id: "new-address", name: "New address", context: "Manhattan", lng: -74.0002, lat: 40.8002 }),
}));

const lines: Lines = {
  A: {
    id: "A", routeId: "A", name: "A", color: "#0039A6", textColor: "white",
    shape: [[-74, 40.7], [-74, 40.8]],
    stops: [
      { id: "test-home", name: "Home station", lng: -74, lat: 40.7, shapeIdx: 0 },
      { id: "test-work", name: "Work station", lng: -74, lat: 40.8, shapeIdx: 1 },
    ],
  },
};

const savedCommute = {
  home: { kind: "station", stopId: "test-home" },
  work: { kind: "station", stopId: "test-work" },
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  useLines.mockReturnValue(lines);
  useCommute.mockReturnValue(savedCommute);
  Object.assign(geo, { status: "idle", lat: null, lng: null });
  clock.now = 1_800_000_000_000;
  requestGeolocation.mockReset();
  recentSearches.current = [];
});

type TripSelection = Parameters<NonNullable<ComponentProps<typeof SearchSheet>["onTripSelect"]>>[0];

function SelectedTripHarness({ changed, open = true }: { changed: (selection: TripSelection) => void; open?: boolean }) {
  const [selection, setSelection] = useState<TripSelection>(null);
  const select = useCallback((next: TripSelection) => {
    changed(next);
    setSelection(next);
  }, [changed]);
  return <SearchSheet open={open} initialMode="directions" onClose={() => setSelection(null)} onStationOpen={vi.fn()}
    onTripSelect={select} selectedTripKey={selection ? "selected-plan" : null} />;
}

describe("SearchSheet directions prefill", () => {
  it("keeps a deliberately cleared saved destination empty and focused, then prefills on reopen", () => {
    const props = { onClose: vi.fn(), onStationOpen: vi.fn(), initialMode: "directions" as const };
    const { rerender } = render(<SearchSheet open {...props} />);
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear to" }));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "To station search" });
    expect(input.placeholder).toBe("Search destination");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear to" })).toBeNull();

    rerender(<SearchSheet open={false} {...props} />);
    rerender(<SearchSheet open {...props} />);
    expect(screen.getByRole("button", { name: "From: Home station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();
  });

  it("keeps focus in To when clearing a destination while From is empty", () => {
    useCommute.mockReturnValue({ home: null, work: null });
    render(
      <SearchSheet open initialMode="directions" onClose={vi.fn()} onStationOpen={vi.fn()}
        presetTrip={{ to: { kind: "station", stopId: "test-work" } }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear to" }));
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "To station search" });
    expect(input.placeholder).toBe("Search destination");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("textbox", { name: "From station search" })).toBeNull();
  });

  it.each([false, true])("requests the missing current-location origin for a destination-only preset (delayed index: %s)", (delayed) => {
    useCommute.mockReturnValue({ home: null, work: null });
    if (delayed) useLines.mockReturnValue(null);
    const props = {
      onClose: vi.fn(), onStationOpen: vi.fn(), initialMode: "directions" as const,
      presetTrip: { to: { kind: "station" as const, stopId: "test-work" } },
    };
    const { rerender } = render(<SearchSheet open {...props} />);
    if (delayed) {
      useLines.mockReturnValue(lines);
      rerender(<SearchSheet open {...props} />);
    }
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();
    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "From station search" });
    expect(input.placeholder).toBe("Search start");
    expect(document.activeElement).toBe(input);
    expect(requestGeolocation).toHaveBeenCalled();
  });

  it("fills Current location when a requested fix arrives", () => {
    useCommute.mockReturnValue({ home: null, work: null });
    const props = {
      onClose: vi.fn(), onStationOpen: vi.fn(), initialMode: "directions" as const,
      presetTrip: { to: { kind: "station" as const, stopId: "test-work" } },
    };
    const { rerender } = render(<SearchSheet open {...props} />);
    expect(requestGeolocation).toHaveBeenCalled();

    Object.assign(geo, { status: "granted", lat: 40.7001, lng: -74.0001 });
    rerender(<SearchSheet open {...props} />);

    expect(
      screen.getByRole("button", { name: "From: Current location" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("requests Current location when a search destination is chosen", () => {
    useCommute.mockReturnValue({ home: null, work: null });
    recentSearches.current = [
      {
        kind: "place",
        id: "coffee",
        name: "Coffee shop",
        context: "Broadway",
        lng: -74,
        lat: 40.8,
      },
    ];
    render(
      <SearchSheet open onClose={vi.fn()} onStationOpen={vi.fn()} />,
    );

    fireEvent.click(screen.getByText("Coffee shop").closest("button")!);

    expect(requestGeolocation).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "To: Coffee shop" })).toBeTruthy();
  });

  it("uses saved Home for a destination-only preset and keeps the completed trip out of input mode", () => {
    render(
      <SearchSheet open initialMode="directions" onClose={vi.fn()} onStationOpen={vi.fn()}
        presetTrip={{ to: { kind: "station", stopId: "test-work" } }} />,
    );
    expect(screen.getByRole("button", { name: "From: Home station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(requestGeolocation).not.toHaveBeenCalled();
  });

  it("waits for the station index before filling saved anchors", () => {
    useLines.mockReturnValue(null);
    const props = { onClose: vi.fn(), onStationOpen: vi.fn(), initialMode: "directions" as const };
    const { rerender } = render(<SearchSheet open {...props} />);
    expect(screen.queryByRole("button", { name: "To: Work station" })).toBeNull();

    useLines.mockReturnValue(lines);
    rerender(<SearchSheet open {...props} />);
    expect(screen.getByRole("button", { name: "From: Home station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();
  });

  it("resolves an explicit trip preset after the index loads without replacing it with saved anchors", () => {
    useLines.mockReturnValue(null);
    const props = { onClose: vi.fn(), onStationOpen: vi.fn(), initialMode: "directions" as const };
    const presetTrip = {
      from: { kind: "station" as const, stopId: "test-work" },
      to: { kind: "station" as const, stopId: "test-home" },
    };
    const { rerender } = render(<SearchSheet open {...props} presetTrip={presetTrip} />);
    expect(screen.queryByRole("button", { name: "To: Home station" })).toBeNull();

    useLines.mockReturnValue(lines);
    rerender(<SearchSheet open {...props} presetTrip={presetTrip} />);
    expect(screen.getByRole("button", { name: "From: Work station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Home station" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear to" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "To station search" }).placeholder).toBe("Search destination");
  });

  it("lets a rider clear and swap endpoints from a complete preset", () => {
    useCommute.mockReturnValue({ home: null, work: null });
    render(
      <SearchSheet open initialMode="directions" onClose={vi.fn()} onStationOpen={vi.fn()}
        presetTrip={{
          from: { kind: "station", stopId: "test-home" },
          to: { kind: "station", stopId: "test-work" },
        }} />,
    );
    expect(screen.getByRole("button", { name: "From: Home station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Swap from and to" }));
    expect(screen.getByRole("button", { name: "From: Work station" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "To: Home station" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear from" }));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "From station search" }).placeholder).toBe("Search start");
    expect(screen.getByRole("button", { name: "To: Home station" })).toBeTruthy();
  });
  it("replaces a selected map trip after a destination edit and swap, preserving the untouched endpoint", () => {
    useLines.mockReturnValue({
      ...lines,
      A: { ...lines.A, stops: [...lines.A.stops, { id: "test-third", name: "Third station", lng: -74, lat: 40.9, shapeIdx: 2 }] },
    });
    const changed = vi.fn();
    const { rerender } = render(<SelectedTripHarness changed={changed} />);
    expect(changed.mock.lastCall?.[0]?.plan.legs.at(-1).alightStopId).toBe("test-work");
    changed.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "To: Work station" }));
    fireEvent.change(screen.getByRole("textbox", { name: "To station search" }), { target: { value: "Third" } });
    fireEvent.click(screen.getByRole("button", { name: /Third station/ }));
    expect(screen.getByRole("button", { name: "From: Home station" })).toBeTruthy();
    expect(changed.mock.calls[0]?.[0]).toBeNull();
    expect(changed.mock.lastCall?.[0]?.plan.legs.at(-1).alightStopId).toBe("test-third");

    changed.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Swap from and to" }));
    expect(changed.mock.calls[0]?.[0]).toBeNull();
    expect(changed.mock.lastCall?.[0]?.plan.legs[0].boardStopId).toBe("test-third");
    expect(changed.mock.lastCall?.[0]?.plan.legs.at(-1).alightStopId).toBe("test-home");
    changed.mockClear();
    clock.now += 1000;
    rerender(<SelectedTripHarness changed={changed} />);
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear from" }));
    expect(changed.mock.lastCall?.[0]).toBeNull();
    changed.mockClear();
    clock.now += 1000;
    rerender(<SelectedTripHarness changed={changed} />);
    expect(changed).not.toHaveBeenCalled();
    rerender(<SelectedTripHarness changed={changed} open={false} />);
    expect(changed.mock.calls.every(([selection]) => selection === null)).toBe(true);
  });

  it("replaces the destination walking anchor even when the subway plan is identical", async () => {
    const changed = vi.fn();
    render(<SelectedTripHarness changed={changed} />);
    const originalPlan = changed.mock.lastCall?.[0]?.plan;
    expect(originalPlan).toBeTruthy();
    changed.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "To: Work station" }));
    fireEvent.change(screen.getByRole("textbox", { name: "To station search" }), { target: { value: "New address" } });
    fireEvent.click(screen.getByRole("button", { name: /New address Manhattan/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "To: New address" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "From: Home station" })).toBeTruthy();
    expect(changed.mock.calls[0]?.[0]).toBeNull();
    await waitFor(() => expect(changed.mock.lastCall?.[0]?.plan).toEqual(originalPlan));
    expect(changed.mock.lastCall?.[0]?.walkTo).toEqual({ name: "New address", lng: -74.0002, lat: 40.8002 });
  });

  it("replaces the map route when the origin is edited without clearing the destination", () => {
    useLines.mockReturnValue({
      ...lines,
      A: { ...lines.A, stops: [...lines.A.stops, { id: "test-third", name: "Third station", lng: -74, lat: 40.9, shapeIdx: 2 }] },
    });
    const changed = vi.fn();
    render(<SelectedTripHarness changed={changed} />);
    changed.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "From: Home station" }));
    fireEvent.change(screen.getByRole("textbox", { name: "From station search" }), { target: { value: "Third" } });
    fireEvent.click(screen.getByRole("button", { name: /Third station/ }));
    expect(screen.getByRole("button", { name: "To: Work station" })).toBeTruthy();
    expect(changed.mock.calls[0]?.[0]).toBeNull();
    expect(changed.mock.lastCall?.[0]?.plan.legs[0].boardStopId).toBe("test-third");
    expect(changed.mock.lastCall?.[0]?.plan.legs.at(-1).alightStopId).toBe("test-work");
  });

});
