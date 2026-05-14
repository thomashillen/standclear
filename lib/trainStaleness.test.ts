// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  markerOpacityMul,
  snapshotStaleLabel,
  summarizeFleetStaleness,
  trainStaleness,
} from "./trainStaleness";

const NOW_MS = new Date("2026-05-09T18:00:00Z").getTime();
const NOW_SEC = NOW_MS / 1000;

describe("trainStaleness", () => {
  it("treats short reports as fresh and returns no label", () => {
    const r = trainStaleness(NOW_SEC - 30, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(false);
    expect(r.veryStale).toBe(false);
    expect(r.label).toBeNull();
    expect(r.ageSec).toBe(30);
  });

  it("treats exactly 90s as fresh (boundary matches marker-fade `ageSec <= 90`)", () => {
    const r = trainStaleness(NOW_SEC - 90, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(false);
    expect(r.label).toBeNull();
  });

  it("flags stale just past 90s and renders an 'Updated Nm ago' label", () => {
    const r = trainStaleness(NOW_SEC - 120, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(false);
    expect(r.label).toBe("Updated 2m ago");
  });

  it("treats exactly 360s as soft-stale, not hard-stale (boundary is inclusive)", () => {
    const r = trainStaleness(NOW_SEC - 360, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(false);
    expect(r.label).toBe("Updated 6m ago");
  });

  it("flips to a hard-stale label past 360s", () => {
    const r = trainStaleness(NOW_SEC - 600, NOW_MS, NOW_SEC);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(true);
    expect(r.label).toBe("Stale · 10m");
  });

  it("falls back to the snapshot's generatedAt when the per-vehicle timestamp is missing", () => {
    // No per-vehicle ts; snapshot itself is well past the hard-stale
    // floor. Should surface as hard-stale so a silent-feed outage
    // doesn't hide behind missing per-vehicle data.
    const r = trainStaleness(undefined, NOW_MS, NOW_SEC - 600);
    expect(r.stale).toBe(true);
    expect(r.veryStale).toBe(true);
    expect(r.label).toMatch(/^Stale · /);
  });

  it("clamps negative ages to zero (clock skew defense)", () => {
    // A vehicle timestamp in the future shouldn't crash the formatter
    // or surface a negative-minute label. Treat it as fresh.
    const r = trainStaleness(NOW_SEC + 30, NOW_MS, NOW_SEC);
    expect(r.ageSec).toBe(0);
    expect(r.stale).toBe(false);
    expect(r.label).toBeNull();
  });
});

describe("summarizeFleetStaleness", () => {
  it("returns zero counts for an empty fleet", () => {
    expect(summarizeFleetStaleness([], NOW_MS, NOW_SEC)).toEqual({
      stale: 0,
      veryStale: 0,
    });
  });

  it("counts stale and veryStale across the fleet using trainStaleness thresholds", () => {
    const trains = [
      { lastReportedAt: NOW_SEC - 30 }, // fresh
      { lastReportedAt: NOW_SEC - 90 }, // boundary fresh
      { lastReportedAt: NOW_SEC - 120 }, // soft-stale
      { lastReportedAt: NOW_SEC - 240 }, // soft-stale
      { lastReportedAt: NOW_SEC - 600 }, // hard-stale
      { lastReportedAt: NOW_SEC - 1200 }, // hard-stale
    ];
    expect(summarizeFleetStaleness(trains, NOW_MS, NOW_SEC)).toEqual({
      stale: 4,
      veryStale: 2,
    });
  });

  it("falls back to generatedAt when a vehicle omits lastReportedAt", () => {
    // Snapshot is past the hard-stale floor; every vehicle without a
    // per-vehicle ts inherits that, so the fleet reads as fully stale.
    const trains = [{}, {}, {}];
    expect(
      summarizeFleetStaleness(trains, NOW_MS, NOW_SEC - 600),
    ).toEqual({ stale: 3, veryStale: 3 });
  });
});

describe("markerOpacityMul", () => {
  it("returns 1 for fresh ages (no fade)", () => {
    expect(markerOpacityMul(0)).toBe(1);
    expect(markerOpacityMul(30)).toBe(1);
    expect(markerOpacityMul(89)).toBe(1);
  });

  it("treats exactly 90s as fresh (boundary inclusive, matches trainStaleness)", () => {
    // Pin the boundary together with `trainStaleness` so the visual
    // fade and the textual label can't drift to different ages.
    expect(markerOpacityMul(90)).toBe(1);
    const txt = trainStaleness(NOW_SEC - 90, NOW_MS, NOW_SEC);
    expect(txt.label).toBeNull();
  });

  it("ramps linearly from 1.0 at 90s to 0.4 at 360s", () => {
    // Midpoint (225s) should land at the average of 1.0 and 0.4 = 0.7.
    expect(markerOpacityMul(225)).toBeCloseTo(0.7, 10);
    // Quarter-way through the ramp (~157.5s) = 1.0 - 0.6 * 0.25 = 0.85.
    expect(markerOpacityMul(157.5)).toBeCloseTo(0.85, 10);
    // Three-quarters through (~292.5s) = 1.0 - 0.6 * 0.75 = 0.55.
    expect(markerOpacityMul(292.5)).toBeCloseTo(0.55, 10);
  });

  it("just past 90s starts to fade (continuity with the fresh band)", () => {
    // The function is continuous at the boundary — 91s should be
    // ~negligibly below 1, not a sudden drop to 0.85+.
    const mul = markerOpacityMul(91);
    expect(mul).toBeLessThan(1);
    expect(mul).toBeGreaterThan(0.99);
  });

  it("floors at 0.4 from 360s onward (never invisible)", () => {
    // Floor is deliberately above zero so a hard-stale marker is
    // still tappable — the rider keeps the option to inspect the
    // trip even when its position is unreliable.
    expect(markerOpacityMul(360)).toBe(0.4);
    expect(markerOpacityMul(600)).toBe(0.4);
    expect(markerOpacityMul(36_000)).toBe(0.4);
  });

  it("returns 1 for non-finite ageSec (defensive against NaN from a missing timestamp)", () => {
    // A caller that fails to clamp clock skew or passes Number.NaN
    // from an arithmetic-on-undefined should not produce an
    // unrenderable marker — fall back to "trust as fresh."
    expect(markerOpacityMul(Number.NaN)).toBe(1);
    expect(markerOpacityMul(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("agrees with the `stale` flag from trainStaleness at every band", () => {
    // Cross-check: anywhere `trainStaleness().stale` is true, the
    // opacity should be < 1; anywhere it's false, opacity should be 1.
    for (const ageSec of [0, 30, 89, 90, 91, 200, 359, 360, 720]) {
      const txt = trainStaleness(NOW_SEC - ageSec, NOW_MS, NOW_SEC);
      const mul = markerOpacityMul(ageSec);
      if (txt.stale) {
        expect(mul).toBeLessThan(1);
      } else {
        expect(mul).toBe(1);
      }
    }
  });
});

describe("snapshotStaleLabel", () => {
  it("returns null for ages below the 60s threshold (calm-default principle)", () => {
    expect(snapshotStaleLabel(0)).toBeNull();
    expect(snapshotStaleLabel(8)).toBeNull();
    expect(snapshotStaleLabel(45)).toBeNull();
    expect(snapshotStaleLabel(59.9)).toBeNull();
  });

  it("rounds 60–119s to the nearest 10s so the label doesn't jitter each tick", () => {
    expect(snapshotStaleLabel(60)).toBe("Stale · 60s");
    expect(snapshotStaleLabel(65)).toBe("Stale · 60s");
    expect(snapshotStaleLabel(72)).toBe("Stale · 70s");
    expect(snapshotStaleLabel(119)).toBe("Stale · 110s");
  });

  it("switches to rounded minutes at 120s and above", () => {
    expect(snapshotStaleLabel(120)).toBe("Stale · 2m");
    expect(snapshotStaleLabel(150)).toBe("Stale · 3m");
    expect(snapshotStaleLabel(360)).toBe("Stale · 6m");
    expect(snapshotStaleLabel(1800)).toBe("Stale · 30m");
  });

  it("returns null for non-finite inputs (defensive against NaN from a missing generatedAt)", () => {
    expect(snapshotStaleLabel(Number.NaN)).toBeNull();
    expect(snapshotStaleLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
