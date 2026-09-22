import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Reset module state per test so the singleton watch / fast-fix flags
// don't leak between cases.
async function freshImport() {
  vi.resetModules();
  return await import("./useGeolocation");
}

interface MockGeolocation {
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
  getCurrentPosition: ReturnType<typeof vi.fn>;
}

function installMockGeolocation(): MockGeolocation {
  const mock: MockGeolocation = {
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: mock,
    configurable: true,
    writable: true,
  });
  return mock;
}

function makePosition(over: Partial<GeolocationCoordinates> = {}): GeolocationPosition {
  return {
    coords: {
      latitude: 40.7349,
      longitude: -73.9904,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...over,
    } as GeolocationCoordinates,
    timestamp: Date.now(),
  } as GeolocationPosition;
}

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

function makeError(code: number, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

describe("useGeolocation", () => {
  let geo: MockGeolocation;

  beforeEach(() => {
    geo = installMockGeolocation();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in 'idle' status before activation", async () => {
    const { useGeolocationState } = await freshImport();
    const { result } = renderHook(() => useGeolocationState());
    expect(result.current.status).toBe("idle");
    expect(result.current.lng).toBeNull();
  });

  it("transitions to 'granted' and exposes coords once watchPosition fires success", async () => {
    let watchSuccess: ((p: GeolocationPosition) => void) | null = null;
    geo.watchPosition.mockImplementation((onSuccess: (p: GeolocationPosition) => void) => {
      watchSuccess = onSuccess;
      return 42;
    });

    const { useGeolocation } = await freshImport();
    const { result } = renderHook(() => useGeolocation(true));

    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("prompting");

    act(() => {
      watchSuccess!(makePosition({ longitude: -73.99, latitude: 40.73, accuracy: 5 }));
    });

    expect(result.current.status).toBe("granted");
    expect(result.current.lng).toBe(-73.99);
    expect(result.current.lat).toBe(40.73);
    expect(result.current.accuracy).toBe(5);
  });

  it("transitions to 'denied', clears stale coords, and clears the watch", async () => {
    let watchSuccess: ((p: GeolocationPosition) => void) | null = null;
    let watchError: ((e: GeolocationPositionError) => void) | null = null;
    geo.watchPosition.mockImplementation(
      (
        onSuccess: (p: GeolocationPosition) => void,
        onError: (e: GeolocationPositionError) => void,
      ) => {
        watchSuccess = onSuccess;
        watchError = onError;
        return 7;
      },
    );

    const { useGeolocation } = await freshImport();
    const { result } = renderHook(() => useGeolocation(true));

    act(() => {
      watchSuccess!(makePosition());
    });
    expect(result.current.lng).not.toBeNull();

    act(() => {
      watchError!(makeError(PERMISSION_DENIED, "User denied geolocation"));
    });

    expect(result.current.status).toBe("denied");
    expect(result.current.lng).toBeNull();
    expect(result.current.lat).toBeNull();
    expect(result.current.accuracy).toBeNull();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it("invalidates the last fix when the active watch errors", async () => {
    let watchSuccess: ((p: GeolocationPosition) => void) | null = null;
    let watchError: ((e: GeolocationPositionError) => void) | null = null;
    geo.watchPosition.mockImplementation(
      (
        onSuccess: (p: GeolocationPosition) => void,
        onError: (e: GeolocationPositionError) => void,
      ) => {
        watchSuccess = onSuccess;
        watchError = onError;
        return 8;
      },
    );

    const { useGeolocation } = await freshImport();
    const { result } = renderHook(() => useGeolocation(true));

    act(() => {
      watchSuccess!(makePosition({ longitude: -73.99, latitude: 40.73 }));
    });
    expect(result.current.status).toBe("granted");
    expect(result.current.lng).toBe(-73.99);

    act(() => {
      watchError!(makeError(POSITION_UNAVAILABLE, "Watch lost position"));
    });

    expect(result.current.status).toBe("error");
    expect(result.current.lng).toBeNull();
    expect(result.current.lat).toBeNull();
    expect(result.current.accuracy).toBeNull();
  });

  it("ignores POSITION_UNAVAILABLE errors from the fast fast-fix path", async () => {
    let fastError: ((e: GeolocationPositionError) => void) | null = null;
    geo.getCurrentPosition.mockImplementation(
      (_ok: unknown, onError: (e: GeolocationPositionError) => void) => {
        fastError = onError;
      },
    );
    geo.watchPosition.mockReturnValue(1);

    const { useGeolocation } = await freshImport();
    const { result } = renderHook(() => useGeolocation(true));

    act(() => {
      fastError!(makeError(POSITION_UNAVAILABLE, "Coarse fix failed"));
    });

    expect(result.current.status).toBe("prompting");
  });

  it("reports 'unavailable' when navigator.geolocation is missing", async () => {
    Object.defineProperty(globalThis.navigator, "geolocation", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { useGeolocation } = await freshImport();
    const { result } = renderHook(() => useGeolocation(true));
    expect(result.current.status).toBe("unavailable");
  });

  it("does not start a watch when active=false", async () => {
    const { useGeolocation } = await freshImport();
    renderHook(() => useGeolocation(false));
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("stops the watch and clears the last fix when an active consumer becomes inactive", async () => {
    let watchSuccess: ((p: GeolocationPosition) => void) | null = null;
    geo.watchPosition.mockImplementation((onSuccess: (p: GeolocationPosition) => void) => {
      watchSuccess = onSuccess;
      return 42;
    });

    const { useGeolocation } = await freshImport();
    const { result, rerender } = renderHook(
      ({ active }) => useGeolocation(active),
      { initialProps: { active: true } },
    );

    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).not.toHaveBeenCalled();

    act(() => {
      watchSuccess!(makePosition());
    });
    expect(result.current.status).toBe("granted");

    rerender({ active: false });

    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
    expect(result.current.status).toBe("idle");
    expect(result.current.lng).toBeNull();
    expect(result.current.lat).toBeNull();
  });

  it("ignores a pending coarse-location success after the final active consumer stops", async () => {
    let fastSuccess: ((p: GeolocationPosition) => void) | null = null;
    geo.getCurrentPosition.mockImplementation((onSuccess: (p: GeolocationPosition) => void) => {
      fastSuccess = onSuccess;
    });
    geo.watchPosition.mockReturnValue(42);

    const { useGeolocation } = await freshImport();
    const { result, rerender } = renderHook(
      ({ active }) => useGeolocation(active),
      { initialProps: { active: true } },
    );

    expect(result.current.status).toBe("prompting");
    rerender({ active: false });
    expect(result.current.status).toBe("idle");

    act(() => {
      fastSuccess!(makePosition({ longitude: -73.98, latitude: 40.72 }));
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.lng).toBeNull();
    expect(result.current.lat).toBeNull();
  });

  it("keeps the singleton watch alive until the last active consumer pauses", async () => {
    geo.watchPosition.mockReturnValue(42);

    const { useGeolocation } = await freshImport();
    const first = renderHook(
      ({ active }) => useGeolocation(active),
      { initialProps: { active: true } },
    );
    const second = renderHook(
      ({ active }) => useGeolocation(active),
      { initialProps: { active: true } },
    );

    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    first.rerender({ active: false });
    expect(geo.clearWatch).not.toHaveBeenCalled();

    second.rerender({ active: false });
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });
});
