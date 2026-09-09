// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

async function freshImport() {
  vi.resetModules();
  return await import("./useOnline");
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

describe("useOnline", () => {
  beforeEach(() => {
    setNavigatorOnline(true);
  });

  it("returns the initial navigator.onLine value", async () => {
    setNavigatorOnline(false);
    const { useOnline } = await freshImport();
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });

  it("flips when offline and online events fire", async () => {
    setNavigatorOnline(true);
    const { useOnline } = await freshImport();
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    await act(async () => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("subscribeOnline notifies its callback on offline/online events", async () => {
    setNavigatorOnline(true);
    const { subscribeOnline, isOnline } = await freshImport();
    const cb = vi.fn();
    const unsub = subscribeOnline(cb);

    setNavigatorOnline(false);
    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalled();
    expect(isOnline()).toBe(false);

    cb.mockClear();
    setNavigatorOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(cb).toHaveBeenCalled();
    expect(isOnline()).toBe(true);

    unsub();
  });

  it("reads a connectivity change before its browser event arrives", async () => {
    setNavigatorOnline(true);
    const { isOnline, subscribeOnline } = await freshImport();
    const cb = vi.fn();
    const unsub = subscribeOnline(cb);

    setNavigatorOnline(false);

    expect(isOnline()).toBe(false);
    expect(cb).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("offline"));
    expect(cb).toHaveBeenCalledOnce();

    unsub();
  });
});
