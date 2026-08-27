// @vitest-environment node
//
// INITIAL_MAP_VIEW is the canonical first-paint camera frame, shared by
// the `new mapboxgl.Map({...})` constructor (cold-boot hero frame) and
// the `flyToDefaultSignal` reset-to-Manhattan fly ("Preview the map").
// The whole point of the constant is that those two can't drift.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_SCALE_STOPS, iconScaleAtZoom } from "@/lib/iconScale";
import { INITIAL_MAP_VIEW } from "@/lib/mapView";

const MAP_VIEW_SRC = readFileSync(
  resolve(__dirname, "..", "components", "MapView.tsx"),
  "utf8",
);

describe("INITIAL_MAP_VIEW", () => {
  it("is a [lng, lat] tuple + finite zoom", () => {
    expect(Array.isArray(INITIAL_MAP_VIEW.center)).toBe(true);
    expect(INITIAL_MAP_VIEW.center).toHaveLength(2);
    for (const n of INITIAL_MAP_VIEW.center) expect(Number.isFinite(n)).toBe(true);
    expect(Number.isFinite(INITIAL_MAP_VIEW.zoom)).toBe(true);
  });

  it("pins the Lower + Midtown Manhattan launch frame exactly", () => {
    // Updating this expectation is a deliberate product decision: this is
    // the frame every first-time rider sees and the README hero will show.
    expect(INITIAL_MAP_VIEW.center).toEqual([-73.989, 40.7355]);
    expect(INITIAL_MAP_VIEW.zoom).toBe(12.2);
  });

  it("starts above the train marker's low-zoom abstract range", () => {
    const abstractDotZoom = ICON_SCALE_STOPS[0][0];
    expect(INITIAL_MAP_VIEW.zoom).toBeGreaterThan(abstractDotZoom + 1.5);
    // At this scale the capsule body is visibly recognizable while the
    // viewport still carries broad Manhattan context on a phone.
    expect(iconScaleAtZoom(INITIAL_MAP_VIEW.zoom)).toBeGreaterThan(0.55);
  });

  it("center sits inside the NYC bounding box", () => {
    const [lng, lat] = INITIAL_MAP_VIEW.center;
    expect(lng).toBeGreaterThan(-74.3);
    expect(lng).toBeLessThan(-73.6);
    expect(lat).toBeGreaterThan(40.4);
    expect(lat).toBeLessThan(41.0);
  });

  it("hero zoom stays within the map's minZoom/maxZoom constraints", () => {
    const minM = MAP_VIEW_SRC.match(/minZoom:\s*(\d+(?:\.\d+)?)/);
    const maxM = MAP_VIEW_SRC.match(/maxZoom:\s*(\d+(?:\.\d+)?)/);
    expect(minM, "minZoom not found in MapView.tsx").not.toBeNull();
    expect(maxM, "maxZoom not found in MapView.tsx").not.toBeNull();
    const minZoom = Number(minM![1]);
    const maxZoom = Number(maxM![1]);
    expect(INITIAL_MAP_VIEW.zoom).toBeGreaterThanOrEqual(minZoom);
    expect(INITIAL_MAP_VIEW.zoom).toBeLessThanOrEqual(maxZoom);
  });
});

describe("MapView.tsx single-sources the frame", () => {
  it("imports INITIAL_MAP_VIEW from @/lib/mapView", () => {
    expect(MAP_VIEW_SRC).toMatch(
      /import\s*\{\s*INITIAL_MAP_VIEW\s*\}\s*from\s*["']@\/lib\/mapView["']/,
    );
  });

  it("references the constant at both the constructor and the reset", () => {
    const centerRefs = MAP_VIEW_SRC.match(/INITIAL_MAP_VIEW\.center/g) ?? [];
    const zoomRefs = MAP_VIEW_SRC.match(/INITIAL_MAP_VIEW\.zoom/g) ?? [];
    expect(centerRefs.length).toBeGreaterThanOrEqual(2);
    expect(zoomRefs.length).toBeGreaterThanOrEqual(2);
  });

  it("carries no re-introduced hard-coded hero coordinates", () => {
    expect(MAP_VIEW_SRC).not.toContain("-73.989");
    expect(MAP_VIEW_SRC).not.toContain("40.7355");
  });
});
