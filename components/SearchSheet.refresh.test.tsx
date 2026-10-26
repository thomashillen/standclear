import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchSheet from "./SearchSheet";

const { refreshTrains } = vi.hoisted(() => ({ refreshTrains: vi.fn() }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => null, refreshTrains }));
vi.mock("@/lib/subwayData", () => { const lines = {
  A: { id: "A", routeId: "A", name: "A", color: "#0039A6", textColor: "white",
    shape: [[-74, 40.7], [-74, 40.8]], stops: [
      { id: "refresh-home", name: "Home station", lng: -74, lat: 40.7, shapeIdx: 0 },
      { id: "refresh-work", name: "Work station", lng: -74, lat: 40.8, shapeIdx: 1 },
    ] },
}; return { useLines: () => lines }; });
vi.mock("@/lib/useGeolocation", () => ({ useGeolocation: () => ({ status: "idle", lat: null, lng: null, request: vi.fn() }) }));
vi.mock("@/lib/useFavorites", () => ({
  useCommute: () => ({ home: null, work: null }),
  useFavorites: () => ({ favorites: new Set(), has: () => false, toggle: vi.fn() }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  refreshTrains.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount() {
  render(<SearchSheet open initialMode="directions" onClose={vi.fn()} onStationOpen={vi.fn()}
    presetTrip={{ from: { kind: "station", stopId: "refresh-home" }, to: { kind: "station", stopId: "refresh-work" } }} />);
  return screen.getByRole<HTMLButtonElement>("button", { name: "Refresh routes" });
}

describe("accessible route refresh", () => {
  it("exposes pending state, retains keyboard focus and coalesces activations until refresh feedback finishes", async () => {
    let finish!: () => void;
    refreshTrains.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const button = mount();
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.getAttribute("aria-disabled")).toBe("false");
    button.focus();
    fireEvent.click(button);
    expect(refreshTrains).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    // aria-disabled keeps the control focusable; its existing handler guard
    // blocks both pointer and keyboard-generated click activations.
    fireEvent.click(button, { detail: 0 });
    fireEvent.click(button);
    expect(refreshTrains).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(button.getAttribute("aria-busy")).toBe("true");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(refreshTrains).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
  });

  it("provides pending feedback for an immediately completed refresh before allowing retry", async () => {
    refreshTrains.mockResolvedValue(undefined);
    const button = mount();
    await act(async () => { fireEvent.click(button); });
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(refreshTrains).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(screen.getByRole("button", { name: "Refresh routes" })).toBe(button);
    await act(async () => { fireEvent.click(button); });
    expect(refreshTrains).toHaveBeenCalledTimes(2);
  });
});
