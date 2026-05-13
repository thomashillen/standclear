// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  snapshotStaleLabel,
  staleOpacityMul,
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

describe("staleOpacityMul", () => {
  it("returns full opacity for fresh ages (calm default for trustworthy trains)", () => {
    expect(staleOpacityMul(0)).toBe(1);
    expect(staleOpacityMul(30)).toBe(1);
    expect(staleOpacityMul(89.999)).toBe(1);
  });

  it("treats exactly 90s as fresh (boundary matches trainStaleness `ageSec <= 90`)", () => {
    // The textual label flips at the same boundary — co-located so a
    // future tweak can't drift the two apart.
    expect(staleOpacityMul(90)).toBe(1);
  });

  it("decays linearly from 1.0 to 0.4 across the 90–360s window", () => {
    // Sub-second past the boundary should be just shy of 1.0.
    expect(staleOpacityMul(91)).toBeGreaterThan(0.99);
    expect(staleOpacityMul(91)).toBeLessThan(1);
    // Halfway through the fade window (225s = midpoint of 90..360).
    expect(staleOpacityMul(225)).toBeCloseTo(0.7, 5);
    // One full minute into the fade window.
    expect(staleOpacityMul(150)).toBeCloseTo(1 - 0.6 * (60 / 270), 5);
  });

  it("hits the 0.4 floor at exactly 360s and holds it past the hard-stale boundary", () => {
    expect(staleOpacityMul(360)).toBeCloseTo(0.4, 5);
    expect(staleOpacityMul(361)).toBeCloseTo(0.4, 5);
    expect(staleOpacityMul(600)).toBeCloseTo(0.4, 5);
    expect(staleOpacityMul(3600)).toBeCloseTo(0.4, 5);
  });

  it("never drops below the 0.4 floor (vanished marker reads as 'no longer exists', which is wrong)", () => {
    // A range of hard-stale ages should all sit at the floor, never
    // below — the floor is load-bearing for the "ghost — last known
    // position" semantic.
    for (const age of [360, 600, 1800, 3600, 86_400]) {
      expect(staleOpacityMul(age)).toBeGreaterThanOrEqual(0.4);
      expect(staleOpacityMul(age)).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it("returns full opacity for non-finite inputs (defensive against NaN / Infinity)", () => {
    // Upstream clamps clock skew to 0 already, but a malformed input
    // shouldn't crash the marker layer or hide a train under opacity 0.
    expect(staleOpacityMul(Number.NaN)).toBe(1);
    expect(staleOpacityMul(Number.POSITIVE_INFINITY)).toBe(1);
    expect(staleOpacityMul(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it("treats negative ages as fresh (defensive against clock skew not pre-clamped upstream)", () => {
    expect(staleOpacityMul(-5)).toBe(1);
    expect(staleOpacityMul(-3600)).toBe(1);
  });

  it("agrees with trainStaleness on the fresh/stale boundary at 90s", () => {
    // Cross-helper invariant: a single rider-perceived boundary
    // governs both the marker fade and the label flip. If a future
    // refactor moves the threshold, this test trips first.
    const NOW = NOW_MS;
    const SEC = NOW_SEC;
    // At ageSec = 90: textual = fresh (no label), visual = 1.0.
    expect(trainStaleness(SEC - 90, NOW, SEC).label).toBeNull();
    expect(staleOpacityMul(90)).toBe(1);
    // At ageSec = 91: textual flips to a label, visual drops below 1.
    expect(trainStaleness(SEC - 91, NOW, SEC).label).not.toBeNull();
    expect(staleOpacityMul(91)).toBeLessThan(1);
  });

  it("agrees with trainStaleness on the hard-stale boundary at 360s", () => {
    // At ageSec = 360: textual = soft-stale ("Updated 6m ago"),
    // visual = 0.4 (the floor — they coincide at the boundary so
    // the marker doesn't continue fading past it).
    const r360 = trainStaleness(NOW_SEC - 360, NOW_MS, NOW_SEC);
    expect(r360.stale).toBe(true);
    expect(r360.veryStale).toBe(false);
    expect(staleOpacityMul(360)).toBeCloseTo(0.4, 5);
    // At ageSec = 361: textual flips to hard-stale ("Stale · …"),
    // visual stays at the floor.
    const r361 = trainStaleness(NOW_SEC - 361, NOW_MS, NOW_SEC);
    expect(r361.veryStale).toBe(true);
    expect(staleOpacityMul(361)).toBeCloseTo(0.4, 5);
  });
});
