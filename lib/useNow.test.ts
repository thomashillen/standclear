import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time on first render", () => {
    const { result } = renderHook(() => useNow(true, 1000));
    expect(result.current).toBe(Date.parse("2026-05-02T12:00:00Z"));
  });

  it("updates on every interval tick while enabled", () => {
    const { result } = renderHook(() => useNow(true, 1000));
    const t0 = result.current;
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    // Two interval ticks fired (at +1000 and +2000) before the +2500
    // mark, so the latest setNow snapshot is t0+2000.
    expect(result.current - t0).toBe(2_000);
  });

  it("freezes when disabled and resumes when re-enabled", () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNow(enabled, 1000),
      { initialProps: { enabled: true } },
    );
    const t0 = result.current;

    rerender({ enabled: false });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // Disabled — no updates, even though wall time advanced.
    expect(result.current).toBe(t0);

    rerender({ enabled: true });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // Resumed — should have moved forward by at least one tick.
    expect(result.current).toBeGreaterThan(t0);
  });
});
