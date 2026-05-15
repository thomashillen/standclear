// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  ICON_SCALE_STOPS,
  iconScaleAtZoom,
  iconSizeByZoomExpression,
} from "./iconScale";

// Independent reference implementation of Mapbox `interpolate
// ["linear"] ["zoom"]` over a flat stop list: clamps to the endpoint
// value outside the stop range, linear between adjacent stops. If
// `iconScaleAtZoom` and this reference ever disagree, the JS scalar
// has drifted from what Mapbox actually renders.
function refInterpolate(stops: readonly (readonly [number, number])[], z: number): number {
  if (z <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (z >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [z0, s0] = stops[i - 1];
    const [z1, s1] = stops[i];
    if (z <= z1) return s0 + ((z - z0) / (z1 - z0)) * (s1 - s0);
  }
  return last[1];
}

describe("ICON_SCALE_STOPS", () => {
  it("is the documented four-stop curve, strictly increasing in both axes", () => {
    expect(ICON_SCALE_STOPS).toEqual([
      [10, 0.29],
      [11.5, 0.5],
      [13, 0.74],
      [14, 1.03],
    ]);
    for (let i = 1; i < ICON_SCALE_STOPS.length; i++) {
      // Monotonic zoom is required for the single-pass interpolation
      // in iconScaleAtZoom; monotonic scale matches "bigger as you
      // zoom in" so the stack-offset never inverts.
      expect(ICON_SCALE_STOPS[i][0]).toBeGreaterThan(ICON_SCALE_STOPS[i - 1][0]);
      expect(ICON_SCALE_STOPS[i][1]).toBeGreaterThan(ICON_SCALE_STOPS[i - 1][1]);
    }
  });
});

describe("iconSizeByZoomExpression", () => {
  it("emits the Mapbox interpolate literal derived from ICON_SCALE_STOPS", () => {
    // This is the contract that keeps the GPU-rendered icon size and
    // the JS stack-offset scale in lockstep: the expression Mapbox
    // evaluates is generated from the same table iconScaleAtZoom
    // reads, so a stop tune moves both.
    expect(iconSizeByZoomExpression()).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      0.29,
      11.5,
      0.5,
      13,
      0.74,
      14,
      1.03,
    ]);
  });

  it("returns a fresh array each call so the shared stop table can't be mutated through it", () => {
    const a = iconSizeByZoomExpression() as unknown[];
    const b = iconSizeByZoomExpression() as unknown[];
    expect(a).not.toBe(b);
    a[3] = 99;
    expect((iconSizeByZoomExpression() as unknown[])[3]).toBe(10);
  });

  it("flattens every stop into the expression tail in (zoom, scale) order", () => {
    const expr = iconSizeByZoomExpression() as unknown[];
    const tail = expr.slice(3);
    expect(tail).toHaveLength(ICON_SCALE_STOPS.length * 2);
    ICON_SCALE_STOPS.forEach(([z, s], i) => {
      expect(tail[i * 2]).toBe(z);
      expect(tail[i * 2 + 1]).toBe(s);
    });
  });
});

describe("iconScaleAtZoom", () => {
  it("returns each stop's exact value at the stop zoom", () => {
    for (const [z, s] of ICON_SCALE_STOPS) {
      expect(iconScaleAtZoom(z)).toBe(s);
    }
  });

  it("clamps flat below the first stop and above the last (Mapbox endpoint extrapolation)", () => {
    expect(iconScaleAtZoom(0)).toBe(0.29);
    expect(iconScaleAtZoom(9)).toBe(0.29);
    expect(iconScaleAtZoom(10)).toBe(0.29);
    expect(iconScaleAtZoom(14)).toBe(1.03);
    expect(iconScaleAtZoom(15)).toBe(1.03);
    expect(iconScaleAtZoom(22)).toBe(1.03);
  });

  it("linearly interpolates the segment midpoints", () => {
    // 10 → 11.5 spans 0.29 → 0.50; midpoint z=10.75 → 0.395
    expect(iconScaleAtZoom(10.75)).toBeCloseTo(0.395, 12);
    // 11.5 → 13 spans 0.50 → 0.74; midpoint z=12.25 → 0.62
    expect(iconScaleAtZoom(12.25)).toBeCloseTo(0.62, 12);
    // 13 → 14 spans 0.74 → 1.03; midpoint z=13.5 → 0.885
    expect(iconScaleAtZoom(13.5)).toBeCloseTo(0.885, 12);
  });

  it("agrees with an independent linear-interpolation reference across the whole zoom range", () => {
    // Pins the JS scalar to exactly what a Mapbox `interpolate
    // ["linear"]` would compute over the same stops — the property
    // that lets the stack-offset trust the rendered icon size.
    for (let z = 8; z <= 16; z += 0.05) {
      expect(iconScaleAtZoom(z)).toBeCloseTo(refInterpolate(ICON_SCALE_STOPS, z), 12);
    }
  });

  it("reproduces the pre-extraction useTrainMarkers if-ladder exactly at its branch boundaries", () => {
    // Behavior-preservation guard for the PR #136-style lift: the old
    // inline ladder was `z<=10 → .29`, `z<=11.5 → .29+((z-10)/1.5)*.21`,
    // `z<=13 → .50+((z-11.5)/1.5)*.24`, `z<=14 → .74+(z-13)*.29`,
    // else .29-floor/1.03-clamp. Same value at every boundary.
    const legacy = (z: number): number => {
      if (z <= 10) return 0.29;
      if (z <= 11.5) return 0.29 + ((z - 10) / 1.5) * 0.21;
      if (z <= 13) return 0.5 + ((z - 11.5) / 1.5) * 0.24;
      if (z <= 14) return 0.74 + (z - 13) * 0.29;
      return 1.03;
    };
    for (const z of [9, 10, 10.5, 11.5, 12, 12.25, 13, 13.5, 14, 15]) {
      expect(iconScaleAtZoom(z)).toBeCloseTo(legacy(z), 12);
    }
  });

  it("falls back to the first-stop value on any non-finite input instead of propagating NaN", () => {
    // The non-finite guard fires before the range checks, so ±Infinity
    // also resolve to the conservative small-icon value rather than
    // the last-stop clamp — a blanked/garbage zoom shrinks markers, it
    // never bursts them to max size.
    expect(iconScaleAtZoom(NaN)).toBe(0.29);
    expect(iconScaleAtZoom(Infinity)).toBe(0.29);
    expect(iconScaleAtZoom(-Infinity)).toBe(0.29);
  });
});
