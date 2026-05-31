// @vitest-environment node
import { describe, it, expect } from "vitest";
import { formatRingEta } from "./ringEta";

// The on-map incoming-ring caption. Pinned against the same band
// boundaries as panelUI.tsx::fmtEta (the in-panel chip) because a
// rider sees the ring caption and the chip for the same train at the
// same time — they must cross "Now" / seconds / minutes together.
// The suffix strings differ on purpose ("X min" spelled out for the
// free-floating map caption vs the chip's tight "Xm"); these tests
// assert the *band*, not the chip's literal glyph.

describe("formatRingEta", () => {
  describe('"Now" window (secs <= 5 after rounding)', () => {
    it("renders STOPPED_AT-here trains (0) as Now", () => {
      expect(formatRingEta(0)).toBe("Now");
    });

    it("renders a slightly-past-due train (negative within horizon) as Now", () => {
      // The caller's horizon floor is -30 s; a train the feed still
      // lists as arriving 10 s ago is functionally at the platform.
      expect(formatRingEta(-10)).toBe("Now");
      expect(formatRingEta(-30)).toBe("Now");
    });

    it("treats exactly 5 s as Now", () => {
      expect(formatRingEta(5)).toBe("Now");
    });

    it("rounds 5.4 down to 5 → Now (crosses the boundary with the panel chip, which also rounds-first)", () => {
      // The pre-extraction inline formatter branched on the raw float
      // and showed "5s" here while the chip already said "Now".
      expect(formatRingEta(5.4)).toBe("Now");
    });

    it("rounds 5.6 up to 6 → out of the Now window", () => {
      expect(formatRingEta(5.6)).toBe("6s");
    });
  });

  describe("seconds window (5 < secs < 60)", () => {
    it("renders whole-second captions", () => {
      expect(formatRingEta(6)).toBe("6s");
      expect(formatRingEta(30)).toBe("30s");
      expect(formatRingEta(59)).toBe("59s");
    });

    it("rounds to the nearest whole second", () => {
      expect(formatRingEta(30.4)).toBe("30s");
      expect(formatRingEta(30.6)).toBe("31s");
      expect(formatRingEta(59.4)).toBe("59s");
    });
  });

  describe("the 60s regression — must roll into the minute band, never read 60s", () => {
    it('renders 59.5 as "1 min" (Math.round(59.5) === 60), not "60s"', () => {
      // This is the bug the extraction fixes: the old inline code did
      // `etaSec < 60` on the raw float, then `Math.round` inside the
      // branch, so [59.5, 60) painted a nonsensical "60s" caption.
      expect(formatRingEta(59.5)).toBe("1 min");
    });

    it('renders 59.6 as "1 min", not "60s"', () => {
      expect(formatRingEta(59.6)).toBe("1 min");
    });

    it('renders exactly 60 as "1 min"', () => {
      expect(formatRingEta(60)).toBe("1 min");
    });

    it("never emits a caption ending in 60s across the whole seconds band", () => {
      for (let s = 0; s <= 600; s += 0.1) {
        const out = formatRingEta(s);
        expect(out).not.toBe("60s");
      }
    });
  });

  describe("minutes window (secs >= 60)", () => {
    it("rounds minutes to nearest, 89 s reading as 1 min", () => {
      expect(formatRingEta(89)).toBe("1 min");
    });

    it('reads 90 s as "2 min" (conservative round-up the rider can trust)', () => {
      // Math.round(90/60) === Math.round(1.5) === 2. Matches the
      // panel chip's minute rounding so "should I run?" reads the
      // same on the map and in the sheet.
      expect(formatRingEta(90)).toBe("2 min");
    });

    it("formats larger ETAs across the horizon", () => {
      expect(formatRingEta(120)).toBe("2 min");
      expect(formatRingEta(150)).toBe("3 min");
      expect(formatRingEta(300)).toBe("5 min");
      expect(formatRingEta(599)).toBe("10 min");
      expect(formatRingEta(600)).toBe("10 min");
    });
  });

  describe("band parity with the panelUI fmtEta contract", () => {
    // panelUI.tsx::fmtEta rounds to whole seconds, then: <=5 Now,
    // <60 "{secs}s", else "{round(secs/60)}m". formatRingEta must
    // classify every integer-second ETA into the same band (only the
    // minutes suffix differs: " min" vs "m").
    const panelBand = (secs: number): "now" | "sec" | "min" => {
      if (secs <= 5) return "now";
      if (secs < 60) return "sec";
      return "min";
    };
    const ringBand = (out: string): "now" | "sec" | "min" =>
      out === "Now" ? "now" : out.endsWith(" min") ? "min" : "sec";

    it("agrees with the panel chip's band at every whole second 0–600", () => {
      for (let s = 0; s <= 600; s++) {
        expect(ringBand(formatRingEta(s))).toBe(panelBand(s));
      }
    });
  });
});
