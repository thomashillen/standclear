import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SearchSheet from "./SearchSheet";

vi.mock("@/lib/subwayData", () => ({ useLines: () => null }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => null }));
vi.mock("@/lib/useGeolocation", () => ({
  useGeolocation: () => ({
    status: "idle",
    lat: null,
    lng: null,
    request: vi.fn(),
  }),
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

describe("SearchSheet expanded control behavior", () => {
  it("opens More from its header without starting a sheet drag", () => {
    const onOpenMore = vi.fn();
    render(<SearchSheet open onClose={vi.fn()} onStationOpen={vi.fn()} onOpenMore={onOpenMore} />);
    const more = screen.getByRole("button", { name: "More options" });
    fireEvent.pointerDown(more, { clientY: 80, pointerId: 1 });
    expect(screen.getByRole("region", { name: "Search and directions" }).hasAttribute("data-glass-active")).toBe(false);
    fireEvent.click(more);
    expect(onOpenMore).toHaveBeenCalledOnce();
  });

  it("clears the query and closes the sheet from the expanded targets without starting a drag", () => {
    const onClose = vi.fn();
    render(<SearchSheet open onClose={onClose} onStationOpen={vi.fn()} />);
    const input = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search NYC" });
    fireEvent.change(input, { target: { value: "a" } });

    fireEvent.click(hitArea(screen.getByRole("button", { name: "Clear search" })));
    expect(input.value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    const close = screen.getByRole("button", { name: "Close panel" });
    fireEvent.pointerDown(hitArea(close), { clientY: 80, pointerId: 1 });
    expect(screen.getByRole("region", { name: "Search and directions" }).hasAttribute("data-glass-active")).toBe(false);
    fireEvent.click(hitArea(close));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps an empty swap disabled and returns to search through the expanded back target", () => {
    const onTripSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <SearchSheet open initialMode="directions" onClose={onClose} onStationOpen={vi.fn()} onTripSelect={onTripSelect} />,
    );
    const swap = screen.getByRole<HTMLButtonElement>("button", { name: "Swap from and to" });
    expect(swap.disabled).toBe(true);
    fireEvent.click(hitArea(swap));
    expect(swap.disabled).toBe(true);

    const back = screen.getByRole("button", { name: "Back to search" });
    const area = hitArea(back);
    expect(area.getAttribute("aria-hidden")).toBe("true");
    expect(area.querySelector("button, [tabindex]")).toBeNull();
    fireEvent.pointerDown(area, { clientY: 80, pointerId: 1 });
    expect(screen.getByRole("region", { name: "Search and directions" }).hasAttribute("data-glass-active")).toBe(false);
    fireEvent.click(area);
    expect(screen.getByRole("searchbox", { name: "Search NYC" })).toBeTruthy();
    expect(onTripSelect).toHaveBeenLastCalledWith(null);
    expect(onClose).not.toHaveBeenCalled();
  });
});
