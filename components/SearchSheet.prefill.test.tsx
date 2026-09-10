import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lines } from "@/lib/subwayData";
import SearchSheet from "./SearchSheet";

const { useLines, useCommute, geo, requestGeolocation, recentSearches } = vi.hoisted(() => ({
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
  requestGeolocation.mockReset();
  recentSearches.current = [];
});

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
});
