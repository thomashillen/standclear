import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainsResponse } from "./useTrains";
import { deriveLiveFeedState } from "./liveFeedState";

vi.mock("./useOnline", () => ({
  isOnline: () => true,
  subscribeOnline: () => () => {},
}));
vi.mock("./observability", () => ({ captureException: vi.fn() }));

const STORAGE_KEY = "standclear:trains:v1";
const NOW = 1_700_000_000_000;
const snapshot = (generatedAt = NOW): TrainsResponse => ({
  generatedAt,
  trains: [{ id: "T1", routeId: "4", direction: "N", progress: 1,
    prevStopId: "631", nextStopId: "631", status: "STOPPED_AT" }],
  arrivals: [{ routeId: "4", stopId: "631", direction: "N", eta: NOW / 1000 + 180, tripId: "T1" }],
});
const response = (data: TrainsResponse) => new Response(JSON.stringify(data), { status: 200 });

describe("train feed outage lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retains the last good snapshot, storage and freshness during outage, then recovers", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response(snapshot()));
    vi.stubGlobal("fetch", fetchMock);
    const { useTrains, useFeedHealth, refreshTrains } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), health: useFeedHealth() }));
    await act(async () => {});
    const good = result.current.data;
    const persisted = localStorage.getItem(STORAGE_KEY);
    const lastSuccessAt = result.current.health.lastSuccessAt;
    expect(good).toEqual(snapshot());
    expect(lastSuccessAt).toBe(NOW);

    fetchMock.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(result.current.health.consecutiveFailures).toBe(1);
    // The failure backs off to 16 seconds, then 32 seconds.
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(result.current.health).toMatchObject({
      consecutiveFailures: 2, degraded: true, lastSuccessAt,
      lastFailureAt: NOW + 24_000, lastError: "HTTP 503",
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(result.current.data).toBe(good);
    expect(Date.now() - result.current.data!.generatedAt).toBeGreaterThan(60_000);
    expect(result.current.health.lastSuccessAt).toBe(lastSuccessAt);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(persisted);

    const recovered = snapshot(Date.now());
    fetchMock.mockImplementation(async () => response(recovered));
    await act(async () => { await refreshTrains(); });
    expect(result.current.data).toEqual(recovered);
    expect(result.current.health).toMatchObject({
      consecutiveFailures: 0, degraded: false, lastSuccessAt: Date.now(),
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).data).toEqual(recovered);
  });

  it("surfaces repeated cold-boot failures without fabricating data and recovers", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { useTrains, useFeedHealth, refreshTrains } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), health: useFeedHealth() }));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(result.current.data).toBeNull();
    expect(result.current.health).toMatchObject({ lastSuccessAt: null, consecutiveFailures: 2, degraded: true });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(deriveLiveFeedState(true, result.current.data !== null, result.current.health.degraded, false)).toBe("degraded");

    const empty = { generatedAt: Date.now(), trains: [], arrivals: [] };
    fetchMock.mockImplementation(async () => response(empty));
    await act(async () => { await refreshTrains(); });
    expect(result.current.data).toEqual(empty);
    expect(result.current.health).toMatchObject({ consecutiveFailures: 0, degraded: false, lastSuccessAt: Date.now() });
    expect(deriveLiveFeedState(true, true, result.current.health.degraded, false)).toBe("live");
  });

  it("preserves a hydrated last-good snapshot when the first network polls fail", async () => {
    const saved = { data: snapshot(NOW - 120_000), ts: NOW - 120_000 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const { useTrains, useFeedHealth } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), health: useFeedHealth() }));
    await act(async () => {});
    expect(result.current.data).toEqual(saved.data);
    expect(result.current.health).toMatchObject({ consecutiveFailures: 1, lastSuccessAt: null });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(saved);
  });

  it("aborts stalled headers, releases coalesced refreshes and retries with existing backoff", async () => {
    let signal!: AbortSignal;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init!.signal!;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { useTrains, useFeedHealth, refreshTrains } = await import("./useTrains");
    const { result, unmount } = renderHook(() => ({ data: useTrains(), health: useFeedHealth() }));
    const refreshes = Promise.all([refreshTrains(), refreshTrains()]);
    await act(async () => { await vi.advanceTimersByTimeAsync(19_999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    expect(result.current.health.consecutiveFailures).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await refreshes; });
    expect(signal.aborted).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.health).toMatchObject({
      consecutiveFailures: 1, lastSuccessAt: null,
      lastFailureAt: NOW + 20_000, lastError: "Train refresh timed out after 20 seconds",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    fetchMock.mockImplementation(async () => response(snapshot(Date.now())));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data!.generatedAt).toBe(NOW + 36_000);
    expect(result.current.health).toMatchObject({ consecutiveFailures: 0, degraded: false, lastSuccessAt: NOW + 36_000 });
    expect(vi.getTimerCount()).toBe(1); // Next poll only; deadline is gone.
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds stalled body consumption while retaining last-good data, storage and freshness", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response(snapshot()));
    vi.stubGlobal("fetch", fetchMock);
    const { useTrains, useFeedHealth, refreshTrains } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), health: useFeedHealth() }));
    await act(async () => {});
    const good = result.current.data;
    const persisted = localStorage.getItem(STORAGE_KEY);
    let signal!: AbortSignal;
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      signal = init!.signal!;
      // Headers arrive, but no body bytes do. As with browser fetch, aborting
      // the originating signal errors the response stream during res.json().
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      } }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(signal.aborted).toBe(true);
    expect(result.current.data).toBe(good);
    expect(result.current.data!.generatedAt).toBe(NOW);
    expect(result.current.health).toMatchObject({ consecutiveFailures: 1, lastSuccessAt: NOW, lastFailureAt: NOW + 28_000 });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(persisted);
    const recovered = snapshot(Date.now());
    fetchMock.mockImplementation(async () => response(recovered));
    await act(async () => { await refreshTrains(); });
    expect(result.current.data).toEqual(recovered);
    expect(result.current.health).toMatchObject({ consecutiveFailures: 0, degraded: false, lastSuccessAt: NOW + 28_000 });
  });

  it("surfaces repeated cold-boot timeouts as degradation without fabricating data", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    })));
    const { useTrains, useFeedHealth } = await import("./useTrains");
    const { result } = renderHook(() => ({ data: useTrains(), health: useFeedHealth() }));
    // 20s deadline, 16s backoff, second 20s deadline.
    await act(async () => { await vi.advanceTimersByTimeAsync(56_000); });
    expect(result.current.health).toMatchObject({ consecutiveFailures: 2, degraded: true, lastSuccessAt: null });
    expect(result.current.data).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(deriveLiveFeedState(true, false, result.current.health.degraded, false)).toBe("degraded");
  });

  it.each(["success", "HTTP failure", "decode failure"] as const)("clears the request deadline after %s", async outcome => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      signal = init!.signal!;
      return outcome === "success" ? response(snapshot())
        : outcome === "HTTP failure" ? new Response("outage", { status: 503 })
        : new Response("not json");
    }));
    const { useTrains } = await import("./useTrains");
    const { unmount } = renderHook(() => useTrains());
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal.aborted).toBe(false);
  });

});
