// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The limiter holds module-scope state (`windows` Map). Load fresh per
// describe block via `vi.resetModules()` so cases inside the same block
// can use unique keys without cross-test bleed, and so the eviction
// block doesn't inherit a half-full Map from other tests.
async function loadFresh() {
  vi.resetModules();
  return await import("./rateLimit");
}

describe("isRateLimited — sliding window", () => {
  let isRateLimited: (k: string, max: number, w: number) => boolean;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00Z"));
    ({ isRateLimited } = await loadFresh());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts requests strictly under the limit", () => {
    expect(isRateLimited("a", 3, 60_000)).toBe(false);
    expect(isRateLimited("a", 3, 60_000)).toBe(false);
    expect(isRateLimited("a", 3, 60_000)).toBe(false);
  });

  it("rejects the request that would cross the limit", () => {
    isRateLimited("a", 3, 60_000);
    isRateLimited("a", 3, 60_000);
    isRateLimited("a", 3, 60_000);
    expect(isRateLimited("a", 3, 60_000)).toBe(true);
  });

  it("slides — once the oldest timestamp ages out, the next request is accepted", () => {
    // t=0 — first hit, accepted
    expect(isRateLimited("a", 2, 60_000)).toBe(false);
    // t=30s — second hit, accepted (window now full)
    vi.advanceTimersByTime(30_000);
    expect(isRateLimited("a", 2, 60_000)).toBe(false);
    // t=30s — third hit, rejected
    expect(isRateLimited("a", 2, 60_000)).toBe(true);
    // Advance past the t=0 sample's expiry (cutoff = now - windowMs, so
    // a sample at t=0 is still in-window at exactly t=60_000; it ages
    // out at t > 60_000).
    vi.advanceTimersByTime(30_001);
    expect(isRateLimited("a", 2, 60_000)).toBe(false);
  });

  it("blocked requests do not extend the window (limiter pegs at the limit)", () => {
    // Fill window: t=0 + t=10s, max=2.
    isRateLimited("a", 2, 60_000);
    vi.advanceTimersByTime(10_000);
    isRateLimited("a", 2, 60_000);
    // 20 rejected requests at t=20s. None of these should push the
    // oldest sample's expiry deadline forward.
    vi.advanceTimersByTime(10_000);
    for (let i = 0; i < 20; i++) {
      expect(isRateLimited("a", 2, 60_000)).toBe(true);
    }
    // From t=20s, advance past the t=0 sample's age-out at >60_000.
    // If a blocked request had been recorded the most recent rejection
    // (at t=20s) would still be in-window and the next request would
    // also be rejected.
    vi.advanceTimersByTime(40_001);
    expect(isRateLimited("a", 2, 60_000)).toBe(false);
  });

  it("keys are isolated — one caller's hits don't count against another", () => {
    expect(isRateLimited("a", 1, 60_000)).toBe(false);
    expect(isRateLimited("a", 1, 60_000)).toBe(true);
    // b is independent of a's saturated window.
    expect(isRateLimited("b", 1, 60_000)).toBe(false);
  });

  it("re-accepts after the entire window expires", () => {
    isRateLimited("a", 1, 60_000); // t=0
    expect(isRateLimited("a", 1, 60_000)).toBe(true); // still t=0
    vi.advanceTimersByTime(60_001); // past expiry
    expect(isRateLimited("a", 1, 60_000)).toBe(false);
  });
});

describe("isRateLimited — entry-cap eviction", () => {
  it("evicts the oldest ~10% when the entry cap is reached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00Z"));
    try {
      const { isRateLimited } = await loadFresh();

      // Saturate the Map: 5_000 distinct callers (MAX_ENTRIES). Each
      // records exactly one accepted timestamp.
      for (let i = 0; i < 5000; i++) {
        isRateLimited(`k-${i}`, 10, 60_000);
      }

      // Adding the 5001st distinct caller trips the eviction branch:
      // `!windows.has(key) && windows.size >= MAX_ENTRIES`. The first
      // 500 keys inserted (Math.ceil(5000 * 0.1)) should be dropped
      // from the Map in insertion order.
      isRateLimited("k-new", 10, 60_000);

      // An evicted key, probed under max=1, should be accepted —
      // proving the limiter has no memory of its earlier timestamp.
      // (A retained key with one prior hit returns true under max=1.)
      expect(isRateLimited("k-0", 1, 60_000)).toBe(false);
      expect(isRateLimited("k-499", 1, 60_000)).toBe(false);

      // k-500 was just outside the eviction range; its original hit is
      // still in the window so a max=1 probe blocks.
      expect(isRateLimited("k-500", 1, 60_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("callerKey", () => {
  let callerKey: (h: Headers) => string;

  beforeEach(async () => {
    ({ callerKey } = await loadFresh());
  });

  it("extracts the leftmost address from a comma-separated chain", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" });
    expect(callerKey(h)).toBe("1.2.3.4");
  });

  it("trims whitespace around the leftmost entry", () => {
    const h = new Headers({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" });
    expect(callerKey(h)).toBe("1.2.3.4");
  });

  it("returns the single value when the chain has only one entry", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(callerKey(h)).toBe("1.2.3.4");
  });

  it("falls back to 'anon' when the header is absent", () => {
    expect(callerKey(new Headers())).toBe("anon");
  });
});
