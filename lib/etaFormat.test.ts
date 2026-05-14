// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatEtaCountdown } from "./etaFormat";

describe("formatEtaCountdown", () => {
  // The five-second floor for "Now" comes from the crossover where
  // the train is functionally at the platform — anything tighter
  // creates noisy flicker between "Now" and "1 sec" on the polling
  // boundary.
  describe('"Now" window (secs <= 5)', () => {
    it("renders Now when the train has just arrived (secs == 0)", () => {
      expect(formatEtaCountdown(0, 0)).toBe("Now");
    });

    it("renders Now exactly at the 5-second boundary", () => {
      expect(formatEtaCountdown(5, 0)).toBe("Now");
    });

    it("renders Now for trains already in the past (negative remaining)", () => {
      // The arrival memo in StationPanel can still surface arrivals
      // a few seconds past their feed-supplied eta; the formatter
      // collapses them to Now rather than showing "-3 sec".
      expect(formatEtaCountdown(-3, 0)).toBe("Now");
    });

    it("rounds 5.4 s to Now (sub-second precision via Math.round)", () => {
      expect(formatEtaCountdown(5.4, 0)).toBe("Now");
    });
  });

  describe("seconds window (5 < secs < 60)", () => {
    it("renders 6 sec one tick past the Now threshold", () => {
      expect(formatEtaCountdown(6, 0)).toBe("6 sec");
    });

    it("renders 30 sec at the midpoint", () => {
      expect(formatEtaCountdown(30, 0)).toBe("30 sec");
    });

    it("renders 59 sec at the upper boundary", () => {
      expect(formatEtaCountdown(59, 0)).toBe("59 sec");
    });

    it("rounds 5.6 s up to 6 sec", () => {
      // Math.round(5.6) === 6, falling out of the Now window.
      expect(formatEtaCountdown(5.6, 0)).toBe("6 sec");
    });
  });

  describe("minutes window (secs >= 60)", () => {
    it("renders 1 min at the 60-second boundary", () => {
      expect(formatEtaCountdown(60, 0)).toBe("1 min");
    });

    it("rounds 89 s down to 1 min (just under the half-minute mark)", () => {
      // 89 / 60 = 1.483 → round → 1
      expect(formatEtaCountdown(89, 0)).toBe("1 min");
    });

    it("rounds 90 s up to 2 min (banker's rounding via Math.round)", () => {
      // 90 / 60 = 1.5 → round → 2. Pinning this so a future swap
      // to Math.floor doesn't silently regress riders who are
      // budgeting 90 s as "still 2 min away."
      expect(formatEtaCountdown(90, 0)).toBe("2 min");
    });

    it("renders 2 min at 119 s and 2 min at 120 s", () => {
      expect(formatEtaCountdown(119, 0)).toBe("2 min");
      expect(formatEtaCountdown(120, 0)).toBe("2 min");
    });

    it("renders 10 min for a long horizon arrival", () => {
      expect(formatEtaCountdown(600, 0)).toBe("10 min");
    });
  });

  describe("unit conventions", () => {
    // The historic divergence between StationPanel's `(eta, now)`
    // (millis) and FollowCapsule's `(etaSec, nowSec)` is the bug
    // this helper exists to retire. Pinning the canonical
    // (etaSec, nowMs) shape so a future caller that swaps either
    // unit trips the suite.
    it("treats `now` as wall-clock milliseconds", () => {
      // nowMs = 60_000 → 60 s of wall clock has passed; an eta
      // 90 s past epoch leaves 30 s remaining.
      expect(formatEtaCountdown(90, 60_000)).toBe("30 sec");
    });

    it("treats `eta` as seconds (matches GTFS-RT Arrival.eta)", () => {
      // nowMs = 1_000 → 1 s past epoch. eta = 65 s → 64 s remain →
      // "1 min" (64 / 60 = 1.07, rounds to 1).
      expect(formatEtaCountdown(65, 1_000)).toBe("1 min");
    });

    it("handles realistic Date.now() magnitudes without overflow", () => {
      const nowMs = 1_700_000_000_000; // 2023-ish epoch
      const etaSec = nowMs / 1000 + 45; // 45 s in the future
      expect(formatEtaCountdown(etaSec, nowMs)).toBe("45 sec");
    });
  });
});
