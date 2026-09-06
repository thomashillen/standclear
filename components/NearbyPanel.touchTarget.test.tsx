import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NearbyPanel from "./NearbyPanel";

const { lines, commute } = vi.hoisted(() => ({
  lines: {
    A: {
      id: "A", routeId: "A", name: "A", color: "#0039A6", textColor: "white",
      shape: [[-74, 40.7], [-74, 40.8]],
      stops: [
        { id: "test-home", name: "Home station", lng: -74, lat: 40.7, shapeIdx: 0 },
        { id: "test-work", name: "Work station", lng: -74, lat: 40.8, shapeIdx: 1 },
      ],
    },
  },
  commute: {
    home: { kind: "station", stopId: "test-home" },
    work: { kind: "station", stopId: "test-work" },
    anchorOf: () => null,
  },
}));

vi.mock("@/lib/subwayData", () => ({ useLines: () => lines }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => null }));
vi.mock("@/lib/useGeolocation", () => ({
  useGeolocation: () => ({ lat: 40.7, lng: -74, status: "granted" }),
}));
vi.mock("@/lib/useFavorites", () => ({
  useCommute: () => commute,
  useFavorites: () => ({ favorites: new Set(), has: () => false, toggle: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

function hitArea(button: HTMLElement): HTMLElement {
  const area = button.querySelector<HTMLElement>("[data-compact-control-hit-area]");
  expect(area).not.toBeNull();
  return area!;
}

describe("NearbyPanel expanded control behavior", () => {
  it("swaps the saved destination from the expanded target without opening a station", () => {
    const onStationOpen = vi.fn();
    render(<NearbyPanel open onClose={vi.fn()} onStationOpen={onStationOpen} />);
    expect(screen.getByRole("heading", { name: "Going to Work" })).toBeTruthy();

    const area = hitArea(screen.getByRole("button", { name: "Swap destination" }));
    expect(area.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(area);
    expect(screen.getByRole("heading", { name: "Going Home" })).toBeTruthy();
    expect(onStationOpen).not.toHaveBeenCalled();
  });

  it("closes from the expanded target without initiating the header drag", () => {
    const onClose = vi.fn();
    render(<NearbyPanel open onClose={onClose} onStationOpen={vi.fn()} />);
    const area = hitArea(screen.getByRole("button", { name: "Close panel" }));

    fireEvent.pointerDown(area, { clientY: 80, pointerId: 1 });
    expect(screen.getByRole("region", { name: "Near me" }).hasAttribute("data-glass-active")).toBe(false);
    fireEvent.click(area);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
