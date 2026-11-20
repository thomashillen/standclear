import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainsResponse } from "./useTrains";

vi.mock("./useOnline", () => ({
  isOnline: () => true,
  subscribeOnline: () => () => {},
}));
vi.mock("./observability", () => ({ captureException: vi.fn() }));

const NOW = 1_700_000_000_000;
const payload = (): TrainsResponse => ({
  generatedAt: Date.now(),
  trains: [],
  arrivals: [],
});

describe("bounded web live demo request lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.clear();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("makes zero passive requests, polls only during an explicit session, and stops immediately", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", fetchMock);
    const { startLiveDemo, stopLiveDemo, useLiveDemo, useTrains } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), demo: useLiveDemo() }));

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.demo).toEqual({ active: false, endsAt: null });

    await act(async () => { startLiveDemo(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/trains", expect.objectContaining({ cache: "no-store" }));
    expect(result.current.data).toEqual(payload());

    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    act(() => { stopLiveDemo(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.demo).toEqual({ active: false, endsAt: null });
  });

  it("expires automatically and makes no requests after expiry", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", fetchMock);
    const { startLiveDemo, useLiveDemo, useTrains } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), demo: useLiveDemo() }));

    await act(async () => { startLiveDemo(17_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(17_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.demo).toEqual({ active: false, endsAt: null });

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resumes the same active session when subscribers return", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload())));
    vi.stubGlobal("fetch", fetchMock);
    const { startLiveDemo, useTrains } = await import("./useTrains");
    const first = renderHook(() => useTrains());

    await act(async () => { startLiveDemo(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useTrains());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    second.unmount();
  });

  it("manual refresh makes exactly one compatible request without enabling polling", async () => {
    const expected = payload();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(expected)));
    vi.stubGlobal("fetch", fetchMock);
    const { refreshTrains, useLiveDemo, useTrains } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), demo: useLiveDemo() }));

    await act(async () => { await refreshTrains(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(expected);
    expect(result.current.demo).toEqual({ active: false, endsAt: null });

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
