// @vitest-environment node

import { describe, expect, it } from "vitest";
import { fmtEta, fmtDistance } from "./panelUI";

// Compact short-form formatters used in the dense list rows
// (TripPlanRow Next-pill, ArrivalChip, NextLeg pill, etc.). The
// contract intentionally diverges from `lib/etaFormat::formatEtaCountdown`
// — short "12s"/"3m" glyphs fit a chip layout where a verbose "12 sec"
// would line-wrap. The header comment in lib/etaFormat.ts documents
// this divergence as load-bearing; pinning it here keeps a future
// "consolidate all the things" refactor honest.

describe("fmtEta", () => {
  describe('"Now" window (secs <= 5)', () => {
    it("renders Now at exactly 0 seconds remaining", () => {
      expect(fmtEta(0, 0)).toBe("Now");
    });

    it("renders Now exactly at the 5-second boundary", () => {
      expect(fmtEta(5, 0)).toBe("Now");
    });

    it("renders Now for arrivals slightly in the past", () => {
      // The arrival memo in NearbyPanel + SearchSheet can still
      // surface arrivals a few seconds past their feed-supplied eta
      // (the next-poll race); the formatter collapses them to Now
      // rather than showing "-3s".
      expect(fmtEta(-3, 0)).toBe("Now");
    });

    it("rounds 5.4 s to Now (sub-second precision via Math.round)", () => {
      expect(fmtEta(5.4, 0)).toBe("Now");
    });

    it("rounds 5.6 s up to 6s, escaping the Now band", () => {
      // Boundary symmetry — 5.4 floors to Now but 5.6 lifts into
      // the seconds band so the chip text moves immediately.
      expect(fmtEta(5.6, 0)).toBe("6s");
    });
  });

  describe('seconds window (5 < secs < 60)', () => {
    it("renders 6s just past the Now boundary", () => {
      expect(fmtEta(6, 0)).toBe("6s");
    });

    it("renders 30s mid-window", () => {
      expect(fmtEta(30, 0)).toBe("30s");
    });

    it("renders 59s at the upper boundary", () => {
      expect(fmtEta(59, 0)).toBe("59s");
    });

    it("rounds 59.6s up to 60s and crosses into the minutes band", () => {
      // Math.round cascade — 59.6 → 60 secs → "1m". A regression
      // here that used Math.floor would render "59s" forever past
      // the polling boundary.
      expect(fmtEta(59.6, 0)).toBe("1m");
    });
  });

  describe('minutes window (secs >= 60)', () => {
    it("renders 1m at the 60-second boundary", () => {
      expect(fmtEta(60, 0)).toBe("1m");
    });

    it("rounds 89s down to 1m", () => {
      expect(fmtEta(89, 0)).toBe("1m");
    });

    it("rounds 90s up to 2m", () => {
      // A rider budgeting 90 s as "still 2 min away" is correct —
      // the rounded label matches conservative trip planning.
      expect(fmtEta(90, 0)).toBe("2m");
    });

    it("renders 5m at 300s", () => {
      expect(fmtEta(300, 0)).toBe("5m");
    });
  });

  describe("unit contract", () => {
    it("treats eta as seconds and now as milliseconds", () => {
      // The canonical `(etaSec, nowMs)` shape that matches
      // `Date.now()` + `useNow()` across the codebase. A future swap
      // of either parameter unit would silently scale every chip by
      // 1000 — pin both shapes so the regression trips here.
      const nowMs = 1_000_000_000;
      const etaSec = nowMs / 1000 + 30;
      expect(fmtEta(etaSec, nowMs)).toBe("30s");
    });

    it("subtracts now/1000 from eta, not the other way around", () => {
      // The Math.round of `eta - now/1000` runs in seconds; a
      // sign-flip regression would render every fresh ETA as a
      // huge negative number collapsed to Now.
      const nowMs = 1_000_000_000;
      const etaSec = nowMs / 1000 + 120;
      expect(fmtEta(etaSec, nowMs)).toBe("2m");
    });
  });
});

describe("fmtDistance", () => {
  describe("meters window (m < 1000)", () => {
    it("renders 0 m for the degenerate zero-distance case", () => {
      // The Nearby spatial lookup's haversine can return ~0 when a
      // rider's geolocation point lands inside a station footprint;
      // pin the floor so a future "hide if 0" branch takes an
      // explicit decision.
      expect(fmtDistance(0)).toBe("0 m");
    });

    it("renders rounded meters for sub-km distances", () => {
      expect(fmtDistance(120)).toBe("120 m");
      expect(fmtDistance(450)).toBe("450 m");
      expect(fmtDistance(999)).toBe("999 m");
    });

    it("rounds fractional meters via Math.round", () => {
      expect(fmtDistance(120.4)).toBe("120 m");
      expect(fmtDistance(120.6)).toBe("121 m");
    });
  });

  describe("kilometers window (m >= 1000)", () => {
    it("renders 1.0 km exactly at the 1000-m boundary", () => {
      // The `< 1000` predicate is strict, so 1000 m crosses into
      // the km band — guard against an off-by-one swap to `<=`.
      expect(fmtDistance(1000)).toBe("1.0 km");
    });

    it("renders one decimal of precision in the km band", () => {
      expect(fmtDistance(1500)).toBe("1.5 km");
      expect(fmtDistance(2700)).toBe("2.7 km");
    });

    it("uses toFixed(1) — does not round to integer km", () => {
      // A future tweak that swaps `.toFixed(1)` for
      // `Math.round(m/1000)` would silently collapse 2.7 km to
      // "3 km", hiding the granularity a rider needs to budget a
      // walk. Pin the decimal explicitly.
      expect(fmtDistance(2750)).toBe("2.8 km");
    });

    it("renders large distances with a single decimal", () => {
      expect(fmtDistance(12_345)).toBe("12.3 km");
    });
  });
});
