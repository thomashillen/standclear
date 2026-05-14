import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  isGlassTiltGated,
  isGlassTiltGranted,
  requestGlassTiltPermission,
} from "./GlassTilt";

// GlassTilt's three exported helpers gate the iOS opt-in path surfaced
// by MoreSheet's "Reactive glass on tilt" row:
//
//   isGlassTiltGated()           — should this rider see a toggle at all?
//   isGlassTiltGranted()         — has the rider already opted in?
//   requestGlassTiltPermission() — drive the iOS-Safari prompt, persist
//                                  the grant, fan out a custom event so
//                                  the live <GlassTilt /> can attach
//                                  the orientation listener mid-session
//                                  without unmounting.
//
// Every code path here is reachable from one rider tap (MoreSheet reads
// both booleans on mount and calls the request helper from a click
// handler), so the three helpers are the entire cross-boundary contract
// between the toggle UI and the provider effect.

// Wire-format strings: pinned literally instead of imported so a rename
// to either the storage key or the custom-event name would silently
// break MoreSheet's stored-grant detection / the in-page dispatch path.
// These strings are the contract; the test exists to prevent drift.
const PERMISSION_STORAGE_KEY = "standclear:glass-tilt-permission";
const PERMISSION_EVENT = "standclear:glass-tilt-permission-granted";

function setDeviceOrientationEvent(value: unknown) {
  // jsdom doesn't define DeviceOrientationEvent natively; tests plant
  // a fresh constructor-shaped value per case. `undefined` deletes —
  // the desktop-Chrome branch where the global is missing entirely.
  if (value === undefined) {
    delete (window as { DeviceOrientationEvent?: unknown })
      .DeviceOrientationEvent;
    return;
  }
  Object.defineProperty(window, "DeviceOrientationEvent", {
    configurable: true,
    value,
    writable: true,
  });
}

describe("isGlassTiltGated", () => {
  beforeEach(() => {
    setDeviceOrientationEvent(undefined);
  });
  afterEach(() => {
    setDeviceOrientationEvent(undefined);
  });

  it("returns false when DeviceOrientationEvent is absent (desktop)", () => {
    expect(isGlassTiltGated()).toBe(false);
  });

  it("returns false when DeviceOrientationEvent has no requestPermission (Android / older iOS)", () => {
    setDeviceOrientationEvent({});
    expect(isGlassTiltGated()).toBe(false);
  });

  it("returns true when requestPermission is a function (iOS 13+)", () => {
    setDeviceOrientationEvent({
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });
    expect(isGlassTiltGated()).toBe(true);
  });

  it("returns false when requestPermission is the wrong type (defensive)", () => {
    // The gate uses `typeof === "function"`; a future polyfill that
    // attached a non-function value at the same key must not flip
    // the toggle on for that rider.
    setDeviceOrientationEvent({ requestPermission: "not-a-function" });
    expect(isGlassTiltGated()).toBe(false);
  });
});

describe("isGlassTiltGranted", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns false with no stored value", () => {
    expect(isGlassTiltGranted()).toBe(false);
  });

  it('returns true after "granted" is stored at the pinned key', () => {
    window.localStorage.setItem(PERMISSION_STORAGE_KEY, "granted");
    expect(isGlassTiltGranted()).toBe(true);
  });

  it('returns false for any non-"granted" stored value', () => {
    // A stale "denied" / legacy value must NOT auto-attach the
    // orientation listener.
    window.localStorage.setItem(PERMISSION_STORAGE_KEY, "denied");
    expect(isGlassTiltGranted()).toBe(false);
  });

  it("returns false when localStorage access throws (private mode / quota)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    try {
      expect(isGlassTiltGranted()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("requestGlassTiltPermission", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDeviceOrientationEvent(undefined);
  });
  afterEach(() => {
    setDeviceOrientationEvent(undefined);
  });

  it("returns 'unsupported' when DeviceOrientationEvent is absent", async () => {
    expect(await requestGlassTiltPermission()).toBe("unsupported");
    // Did NOT store anything — confirms "unsupported" never spoofs a grant.
    expect(window.localStorage.getItem(PERMISSION_STORAGE_KEY)).toBeNull();
  });

  it("returns 'unsupported' when requestPermission isn't a function", async () => {
    setDeviceOrientationEvent({});
    expect(await requestGlassTiltPermission()).toBe("unsupported");
    expect(window.localStorage.getItem(PERMISSION_STORAGE_KEY)).toBeNull();
  });

  it("on grant: returns 'granted', persists to localStorage, dispatches the custom event", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    setDeviceOrientationEvent({ requestPermission });

    const eventSpy = vi.fn();
    window.addEventListener(PERMISSION_EVENT, eventSpy);
    try {
      expect(await requestGlassTiltPermission()).toBe("granted");
    } finally {
      window.removeEventListener(PERMISSION_EVENT, eventSpy);
    }

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(PERMISSION_STORAGE_KEY)).toBe(
      "granted",
    );
    expect(eventSpy).toHaveBeenCalledTimes(1);
    // The event MUST carry the pinned type — the live <GlassTilt />
    // listens for exactly this name to attach the orientation handler.
    const evt = eventSpy.mock.calls[0][0] as Event;
    expect(evt.type).toBe(PERMISSION_EVENT);
  });

  it("on denial: returns 'denied', leaves storage clean, does NOT dispatch", async () => {
    const requestPermission = vi.fn().mockResolvedValue("denied");
    setDeviceOrientationEvent({ requestPermission });

    const eventSpy = vi.fn();
    window.addEventListener(PERMISSION_EVENT, eventSpy);
    try {
      expect(await requestGlassTiltPermission()).toBe("denied");
    } finally {
      window.removeEventListener(PERMISSION_EVENT, eventSpy);
    }

    expect(window.localStorage.getItem(PERMISSION_STORAGE_KEY)).toBeNull();
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("on rejected requestPermission: returns 'denied' (a thrown rejection is functionally a denial)", async () => {
    const requestPermission = vi
      .fn()
      .mockRejectedValue(new Error("user cancelled"));
    setDeviceOrientationEvent({ requestPermission });

    const eventSpy = vi.fn();
    window.addEventListener(PERMISSION_EVENT, eventSpy);
    try {
      expect(await requestGlassTiltPermission()).toBe("denied");
    } finally {
      window.removeEventListener(PERMISSION_EVENT, eventSpy);
    }

    expect(window.localStorage.getItem(PERMISSION_STORAGE_KEY)).toBeNull();
    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("a granted result with localStorage failing still returns 'granted' and dispatches", async () => {
    // Private browsing / quota: persistence is best-effort, but the
    // in-session listener attach MUST still happen — otherwise the
    // rider taps "On," sees a successful native prompt, and the
    // highlight stays frozen until next reload.
    const requestPermission = vi.fn().mockResolvedValue("granted");
    setDeviceOrientationEvent({ requestPermission });

    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const eventSpy = vi.fn();
    window.addEventListener(PERMISSION_EVENT, eventSpy);
    try {
      expect(await requestGlassTiltPermission()).toBe("granted");
    } finally {
      window.removeEventListener(PERMISSION_EVENT, eventSpy);
      setItemSpy.mockRestore();
    }

    expect(eventSpy).toHaveBeenCalledTimes(1);
  });

  it("cross-session round-trip: grant → isGlassTiltGranted() reads true on a subsequent call", async () => {
    // Pins the wire-format equivalence between the two helpers: a
    // grant captured by requestGlassTiltPermission() must be visible
    // to isGlassTiltGranted() without any code path in between.
    const requestPermission = vi.fn().mockResolvedValue("granted");
    setDeviceOrientationEvent({ requestPermission });

    expect(isGlassTiltGranted()).toBe(false);
    await requestGlassTiltPermission();
    expect(isGlassTiltGranted()).toBe(true);
  });
});
