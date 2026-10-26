import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ linesReady: true, dataReady: true, error: false, failures: 0, online: true, empty: false, generatedAt: 100_000 }));
vi.mock("@/lib/subwayData", () => ({ useLines: () => source.linesReady ? {} : null, useSubwayDataStatus: () => ({ error: source.error }) }));
vi.mock("@/lib/useTrains", () => ({ useTrains: () => source.dataReady ? { generatedAt: source.generatedAt, trains: [], arrivals: [] } : null, useFeedHealth: () => ({ consecutiveFailures: source.failures }) }));
vi.mock("@/lib/useOnline", () => ({ useOnline: () => source.online }));
vi.mock("@/lib/useNow", () => ({ useNow: () => 100_000 }));
// The projection is covered in lib/nearbyGlance.test.ts. This fixture isolates
// surface eligibility against the real shared location lifecycle and callbacks.
vi.mock("@/lib/nearbyGlance", () => ({
  glanceEta: () => "2m",
  nearbyGlanceRows: () => source.empty ? [] : [{
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
  Object.assign(source, { linesReady: true, dataReady: true, error: false, failures: 0, online: true, empty: false, generatedAt: 100_000 });
  vi.spyOn(Date, "now").mockReturnValue(100_000);
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
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  const { default: NearbyGlance } = await import("./NearbyGlance");
  const onStationOpen = vi.fn();
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<NearbyGlance onStationOpen={onStationOpen} />); });
  return { ...view, onStationOpen, refresh: (hidden = false) => view.rerender(<NearbyGlance hidden={hidden} onStationOpen={onStationOpen} />) };
}
function permissionChange(state: PermissionState) {
  act(() => { permission.state = state; permission.dispatchEvent(new Event("change")); });
}
async function visibilityChange(state: DocumentVisibilityState) {
  await act(async () => { visibility = state; document.dispatchEvent(new Event("visibilitychange")); });
}

describe("automatic nearby location lifecycle", () => {
  it("does not request location with known denied permission", async () => {
    permission.state = "denied";
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
    await visibilityChange("visible");
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    await visibilityChange("hidden");
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    act(() => success[0](position));
    expect(region()).toBeNull();
    await visibilityChange("visible");
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(region()).toBeNull();
  });

  it("keeps badges and the shared watch when metadata returns prompt but location remains valid", async () => {
    const { useGeolocation } = await import("@/lib/useGeolocation");
    const explicit = renderHook(() => useGeolocation(true));
    await mount();
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    permissionChange("prompt");
    expect(region()).toBeTruthy();
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
    await visibilityChange("visible");
    act(() => window.dispatchEvent(new Event("resize")));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("requests location on startup when permissions query is unsupported", async () => {
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    await mount();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(region()).toBeNull();
    act(() => success[0](position));
    expect(region()).toBeTruthy();
  });
});


describe("initial nearby arrival discovery", () => {
  it("requests prompt-state location on launch and shows badges without opening Near me", async () => {
    permission.state = "prompt";
    await mount();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Finding nearby arrivals");
    const skeleton = screen.getByRole("status").querySelector("[aria-hidden]")!;
    expect(skeleton.className).toContain("motion-safe:animate-pulse");
    act(() => success[0](position)); // Safari's metadata can remain prompt after a valid fix.
    expect(region()).toBeTruthy();
    expect(screen.queryByText("Use Near me for arrivals")).toBeNull();
  });

  it("shows a truthful denial instead of a perpetual skeleton or arrival badges", async () => {
    permission.state = "prompt";
    const view = await mount();
    const error = geo.watchPosition.mock.calls[0][1] as PositionErrorCallback;
    act(() => error({ code: 1, PERMISSION_DENIED: 1, message: "Denied" } as GeolocationPositionError));
    expect(screen.getByRole("status").textContent).toBe("Location is blocked");
    expect(region()).toBeNull();
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    act(() => success[0](position)); // A late callback cannot restore revoked coordinates.
    view.refresh();
    expect(region()).toBeNull();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it.each(["reject", "throw"])("requests location even if permission metadata queries %s", async failure => {
    vi.mocked(navigator.permissions.query).mockImplementation(() => {
      if (failure === "throw") throw new Error("Unsupported");
      return Promise.reject(new Error("Unsupported"));
    });
    await mount();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    act(() => success[0](position));
    expect(region()).toBeTruthy();
  });

  it("does not request prompt-state location while backgrounded or covered by a panel", async () => {
    permission.state = "prompt";
    visibility = "hidden";
    const view = await mount();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    await act(async () => view.refresh(true));
    await visibilityChange("visible");
    expect(geo.watchPosition).not.toHaveBeenCalled();
    await act(async () => view.refresh(false));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    await visibilityChange("hidden");
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    act(() => success[0](position));
    expect(region()).toBeNull();
  });

  it("shows a compact loading status then arrivals on fresh load without a tap", async () => {
    await mount();
    expect(screen.getByRole("status").textContent).toBe("Finding nearby arrivals");
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(region()).toBeNull();
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("bounds slow location loading and recovers when a late valid fix arrives", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("status").textContent).toBe("Nearby arrivals taking longer");
    expect(region()).toBeNull();
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("keeps placeholders until both station and live-feed data arrive", async () => {
    source.linesReady = false;
    source.dataReady = false;
    const view = await mount();
    act(() => success[0](position));
    expect(region()).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Finding nearby arrivals");
    source.linesReady = true;
    view.refresh();
    expect(region()).toBeNull();
    source.dataReady = true;
    view.refresh();
    expect(region()).toBeTruthy();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable location without inventing arrivals", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    await mount();
    expect(screen.getByRole("status").textContent).toBe("Location unavailable");
    expect(region()).toBeNull();
  });

  it("bounds stalled permission queries then requests location without waiting for Near me", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    let finish!: (permission: EventTarget) => void;
    Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: () => new Promise(resolve => { finish = resolve; }) } });
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByRole("status").textContent).toBe("Finding nearby arrivals");
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    await act(async () => { finish(permission); });
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["feed failure", { failures: 1, dataReady: false }, "Arrival update delayed"],
    ["retained failed feed", { failures: 1 }, "Arrival update delayed"],
    ["stale feed", { generatedAt: -20_000 }, "Waiting for fresh arrivals"],
    ["offline", { online: false }, "Offline · arrivals unavailable"],
    ["static failure", { error: true }, "Stations unavailable"],
    ["empty arrivals", { empty: true }, "No nearby arrivals"],
  ] as const)("shows truthful %s state and recovers with updated data", async (_name, patch, message) => {
    Object.assign(source, patch);
    const view = await mount();
    act(() => success[0](position));
    expect(screen.getByRole("status").textContent).toBe(message);
    expect(region()).toBeNull();
    Object.assign(source, { failures: 0, dataReady: true, generatedAt: 100_000, online: true, error: false, empty: false });
    view.refresh();
    expect(region()).toBeTruthy();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("retains discovery across panel handoff without duplicate watches", async () => {
    const view = await mount();
    act(() => success[0](position));
    const { useGeolocation } = await import("@/lib/useGeolocation");
    const panel = renderHook(() => useGeolocation(true));
    await act(async () => view.refresh(true));
    expect(region()).toBeNull();
    expect(geo.clearWatch).not.toHaveBeenCalled();
    await act(async () => view.refresh(false));
    expect(region()).toBeTruthy();
    panel.unmount();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });
});


describe("permission refresh without browser change events", () => {
  it("recovers badges after Near me closes when the first permission snapshot stays prompt", async () => {
    permission.state = "prompt";
    const query = vi.mocked(navigator.permissions.query);
    const view = await mount();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    await act(async () => view.refresh(true));
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    const granted = Object.assign(new EventTarget(), { state: "granted" });
    query.mockResolvedValue(granted as PermissionStatus);
    await act(async () => view.refresh(false));
    expect(permission.state).toBe("prompt"); // No synthetic change event.
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    act(() => success[1](position));
    expect(region()).toBeTruthy();
  });

  it("rechecks on focus and stops discovery on a later revocation", async () => {
    permission.state = "prompt";
    await mount();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    const fresh = Object.assign(new EventTarget(), { state: "granted" });
    vi.mocked(navigator.permissions.query).mockResolvedValue(fresh as PermissionStatus);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    act(() => success[1](position));
    expect(region()).toBeTruthy();
    const denied = Object.assign(new EventTarget(), { state: "denied" });
    vi.mocked(navigator.permissions.query).mockResolvedValue(denied as PermissionStatus);
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(region()).toBeNull();
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(screen.getByRole("status").textContent).toBe("Location is blocked");
  });

  it("discovers a grant on foreground return when there was no permission change event", async () => {
    permission.state = "prompt";
    await mount();
    await visibilityChange("hidden");
    vi.mocked(navigator.permissions.query).mockResolvedValue(Object.assign(new EventTarget(), { state: "granted" }) as PermissionStatus);
    await visibilityChange("visible");
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });

  it("ignores an older permission response arriving after a fresh focus query", async () => {
    let finish!: (value: PermissionStatus) => void;
    vi.mocked(navigator.permissions.query).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    await act(async () => finish(Object.assign(new EventTarget(), { state: "prompt" }) as PermissionStatus));
    act(() => success[0](position));
    expect(region()).toBeTruthy();
    expect(geo.clearWatch).not.toHaveBeenCalled();
  });

  it("removes focus refresh and permission listeners on unmount", async () => {
    const view = await mount();
    const calls = vi.mocked(navigator.permissions.query).mock.calls.length;
    view.unmount();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      permission.state = "prompt";
      permission.dispatchEvent(new Event("change"));
    });
    expect(navigator.permissions.query).toHaveBeenCalledTimes(calls);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("does not let an old grant event restart GPS while a fresh permission check is pending", async () => {
    await mount();
    let finish!: (value: PermissionStatus) => void;
    vi.mocked(navigator.permissions.query).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    act(() => permission.dispatchEvent(new Event("change")));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    await act(async () => finish(Object.assign(new EventTarget(), { state: "denied" }) as PermissionStatus));
    expect(screen.getByRole("status").textContent).toBe("Location is blocked");
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh answer after a rapid panel round trip with pending queries", async () => {
    const view = await mount();
    vi.mocked(navigator.permissions.query).mockImplementation(() => new Promise(() => {}));
    await act(async () => view.refresh(true));
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    await act(async () => view.refresh(false));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(region()).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Finding nearby arrivals");
  });
});
