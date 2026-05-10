// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ringPulsePhase } from "./ringPulse";

describe("ringPulsePhase", () => {
  it("returns a value in [0, 1] for any non-reduced-motion input", () => {
    for (let t = 0; t < 10_000; t += 37) {
      const v = ringPulsePhase(t, false);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("oscillates over time (peaks and troughs both observed within one period)", () => {
    let min = 1;
    let max = 0;
    // Period is ~1400 ms (0.9 Hz); sample finely across two full cycles.
    for (let t = 0; t < 2800; t += 25) {
      const v = ringPulsePhase(t, false);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeLessThan(0.05);
    expect(max).toBeGreaterThan(0.95);
  });

  it("holds at 0.5 when reduced motion is set, regardless of time", () => {
    expect(ringPulsePhase(0, true)).toBe(0.5);
    expect(ringPulsePhase(123, true)).toBe(0.5);
    expect(ringPulsePhase(987_654_321, true)).toBe(0.5);
  });

  it("the reduced-motion value equals the long-run average of the wave", () => {
    // Mean of (sin(x) + 1) / 2 over a full period is 0.5 — verify the
    // static value matches what an averaging observer would compute.
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 1400; t += 1) {
      sum += ringPulsePhase(t, false);
      n += 1;
    }
    const mean = sum / n;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
    expect(ringPulsePhase(42, true)).toBeCloseTo(mean, 1);
  });
});
