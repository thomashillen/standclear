import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/subwayData", () => ({ useLines: () => null }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => null }));
vi.mock("@/lib/useNow", () => ({ useNow: () => 100_000 }));
// The projection is covered in lib/nearbyGlance.test.ts. This fixture isolates
// surface eligibility against the real shared location lifecycle and callbacks.
vi.mock("@/lib/nearbyGlance", () => ({
  glanceEta: () => "2m",
  nearbyGlanceRows: () => [{
    station: { stopId: "127", name: "Times Sq" }, color: "#ee352e",
    routes: [{ routeId: "1", id: "1", color: "#ee352e", textColor: "white" }],
    northEta: 220, southEta: null, northRouteId: "1", southRouteId: null,
  }],
}));

let permission: EventTarget & { state: PermissionState };
let width: number;
let height: number;
let visibility: DocumentVisibilityState;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
let success: PositionCallback[];
let geo: { watchPosition: ReturnType<typeof vi.fn>; getCurrentPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn> };
const position = { coords: { longitude: -73.987, latitude: 40.755, accuracy: 10 } } as GeolocationPosition;
const region = () => screen.queryByRole("region", { name: "Nearby train arrivals" });

beforeEach(() => {
  vi.resetModules();
  width = 350; height = 200; visibility = "visible"; success = [];
  permission = Object.assign(new EventTarget(), { state: "granted" as PermissionState });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn().mockResolvedValue(permission) } });
  geo = {
    watchPosition: vi.fn((callback: PositionCallback) => { success.push(callback); return success.length; }),
    getCurrentPosition: vi.fn(), clearWatch: vi.fn(),
  };
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: geo });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("map-glance-space") ? { width, height } as DOMRect : original.call(this);
  });
  disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  const { default: NearbyGlance } = await import("./NearbyGlance");
  const onStationOpen = vi.fn();
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<NearbyGlance onStationOpen={onStationOpen} />); });
  return { ...view, onStationOpen };
}
function permissionChange(state: PermissionState) {
  act(() => { permission.state = state; permission.dispatchEvent(new Event("change")); });
}
function visibilityChange(state: DocumentVisibilityState) {
  act(() => { visibility = state; document.dispatchEvent(new Event("visibilitychange")); });
}

describe("automatic nearby location lifecycle", () => {
  it.each(["prompt", "denied"] as const)("does not prompt or watch with %s permission", async state => {
    permission.state = state;
    await mount();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(region()).toBeNull();
  });

  it("does not start while desktop-hidden, and resumes with a fresh watch after resizing", async () => {
    width = 0; height = 0;
    const view = await mount();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    act(() => { width = 350; height = 200; resize(); });
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    act(() => success[0](position));
    fireEvent.click(screen.getByRole("button", { name: /Open station/ }));
    expect(view.onStationOpen).toHaveBeenCalledWith("127");
    act(() => { width = 0; height = 0; resize(); });
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(region()).toBeNull();
    act(() => success[0](position));
    expect(region()).toBeNull();
    act(() => { width = 350; height = 200; resize(); });
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(region()).toBeNull();
    act(() => success[1](position));
    expect(region()).toBeTruthy();
  });

  it("stops when the CSS container query hides the glance on a cramped screen", async () => {
    const view = await mount();
    act(() => success[0](position));
    const content = view.container.querySelector<HTMLElement>(".nearby-glance")!;
    // jsdom has no container queries; emulate the browser's computed display.
    act(() => { content.style.display = "none"; height = 20; resize(); });
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(region()).toBeNull();
    act(() => { content.style.display = "flex"; height = 200; resize(); });
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });

  it("waits while backgrounded and invalidates late fixes when hidden again", async () => {
    visibility = "hidden";
    await mount();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    visibilityChange("visible");
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    visibilityChange("hidden");
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    act(() => success[0](position));
    expect(region()).toBeNull();
    visibilityChange("visible");
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(region()).toBeNull();
  });

  it("leaves an explicit location consumer running but hides rows after permission returns to prompt", async () => {
    const { useGeolocation } = await import("@/lib/useGeolocation");
    const explicit = renderHook(() => useGeolocation(true));
    await mount();
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    permissionChange("prompt");
    expect(region()).toBeNull();
    expect(geo.clearWatch).not.toHaveBeenCalled();
    expect(explicit.result.current.status).toBe("granted");
    permissionChange("granted");
    expect(region()).toBeTruthy();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("disconnects observers and stops the final watch on unmount", async () => {
    const view = await mount();
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    visibilityChange("visible");
    act(() => window.dispatchEvent(new Event("resize")));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("keeps the explicit Near me path when permissions query is unsupported", async () => {
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    await mount();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(region()).toBeNull();
  });
});
