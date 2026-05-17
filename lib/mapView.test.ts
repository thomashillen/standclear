// @vitest-environment node
//
// INITIAL_MAP_VIEW is the canonical first-paint camera frame, shared by
// two consumers in components/MapView.tsx that sit ~1000 lines apart:
// the `new mapboxgl.Map({...})` constructor (cold-boot hero frame) and
// the `flyToDefaultSignal` reset-to-Manhattan fly ("Preview the map").
// The whole point of the constant is that those two can't drift; this
// suite pins the values AND reads MapView.tsx source to prove the
// duplicated literal hasn't crept back in.
//
// Source-string assertion (rather than importing MapView) follows the
// app/marketingTitles.test.ts precedent: importing the component drags
// mapbox-gl + "use client" + React into a node runner, which the Vitest
// env can't resolve, and the regression we care about — a re-introduced
// hard-coded `[-73.9857, 40.7484]` — is exactly what the source shows.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INITIAL_MAP_VIEW } from "@/lib/mapView";

const MAP_VIEW_SRC = readFileSync(
  resolve(__dirname, "..", "components", "MapView.tsx"),
  "utf8",
);

describe("INITIAL_MAP_VIEW", () => {
  it("is a [lng, lat] tuple + finite zoom", () => {
    expect(Array.isArray(INITIAL_MAP_VIEW.center)).toBe(true);
    expect(INITIAL_MAP_VIEW.center).toHaveLength(2);
    for (const n of INITIAL_MAP_VIEW.center) {
      expect(Number.isFinite(n)).toBe(true);
    }
    expect(Number.isFinite(INITIAL_MAP_VIEW.zoom)).toBe(true);
  });

  it("pins the lower-Manhattan hero frame exactly", () => {
    // A change here is a deliberate product decision (the frame every
    // first-time rider sees on cold boot, and the one "Preview the map"
    // returns to). Updating this expectation should be conscious, not
    // incidental — that's the point of the pin.
    expect(INITIAL_MAP_VIEW.center).toEqual([-73.9857, 40.7484]);
    expect(INITIAL_MAP_VIEW.zoom).toBe(11);
  });

  it("center sits inside the NYC bounding box", () => {
    const [lng, lat] = INITIAL_MAP_VIEW.center;
    // Generous box around the five boroughs — a transposed lat/lng or a
    // sign flip (the classic [lat, lng] mistake) lands far outside it.
    expect(lng).toBeGreaterThan(-74.3);
    expect(lng).toBeLessThan(-73.6);
    expect(lat).toBeGreaterThan(40.4);
    expect(lat).toBeLessThan(41.0);
  });

  it("hero zoom stays within the map's minZoom/maxZoom constraints", () => {
    // Read the constructor's clamp from MapView source. If a future
    // retune narrows the zoom range past the hero zoom, the cold-boot
    // frame would be silently clamped on init — flag that here.
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
    // One pair for the `new mapboxgl.Map({...})` constructor, one for
    // the `flyToDefaultSignal` reset fly.
    expect(centerRefs.length).toBeGreaterThanOrEqual(2);
    expect(zoomRefs.length).toBeGreaterThanOrEqual(2);
  });

  it("carries no re-introduced hard-coded hero coordinates", () => {
    // The drift guard. These coordinates now live only in
    // lib/mapView.ts; their reappearance in MapView.tsx means a
    // consumer was reverted to a literal and the invariant is broken.
    expect(MAP_VIEW_SRC).not.toContain("-73.9857");
    expect(MAP_VIEW_SRC).not.toContain("40.7484");
  });
});
