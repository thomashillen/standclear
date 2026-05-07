// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

async function freshImport() {
  vi.resetModules();
  return await import("./subwayData");
}

describe("subwayData — retry + error state", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("flips error true when /gtfsData.json fails, then back to false on a successful retry", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lines: {
              "1": {
                id: "1",
                routeId: "1",
                name: "Broadway-7 Av Local",
                color: "#EE352E",
                textColor: "white",
                stops: [],
                shape: [],
              },
            },
          }),
          { status: 200 },
        ),
      );

    const { useLines, useSubwayDataStatus, retryLoadLines } = await freshImport();
    const { result: lines } = renderHook(() => useLines());
    const { result: status } = renderHook(() => useSubwayDataStatus());

    // Wait a microtask for the initial fetch to fail and flip error.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(status.current.error).toBe(true);
    expect(lines.current).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      retryLoadLines();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(status.current.error).toBe(false);
    expect(lines.current).not.toBeNull();
    expect(lines.current!["1"].name).toBe("Broadway-7 Av Local");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("increments the attempt counter on each failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 }),
    );

    const { useLines, useSubwayDataStatus, retryLoadLines } =
      await freshImport();
    // useLines is what kicks off the initial fetch on subscribe; the
    // status hook only observes.
    renderHook(() => useLines());
    const { result: status } = renderHook(() => useSubwayDataStatus());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(status.current.error).toBe(true);
    expect(status.current.attempt).toBeGreaterThan(0);

    // Manual retry resets the attempt counter to 0 before firing
    // the request, so a successful tap restarts the auto-retry
    // schedule from a clean baseline.
    await act(async () => {
      retryLoadLines();
      await Promise.resolve();
      await Promise.resolve();
    });
    // After retry → another failure, attempt should be 1 again (reset
    // then incremented).
    expect(status.current.attempt).toBe(1);
  });
});
