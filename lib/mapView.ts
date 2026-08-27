// The canonical first-paint camera frame: Lower + Midtown Manhattan at a
// train-forward neighborhood zoom. Two consumers in components/MapView.tsx
// must agree on it:
//
//   1. The `new mapboxgl.Map({...})` constructor: the frame the live
//      map paints on cold boot. The live map is the cold-boot hero, so
//      this is the first thing a new rider sees.
//   2. The reset-to-Manhattan `flyTo` driven by `flyToDefaultSignal`,
//      fired when an out-of-NYC rider taps "Preview the map" from the
//      Near-me panel. It must land on exactly the cold-boot frame.
//
// The launch frame deliberately sits above the train marker's low-zoom
// "abstract dot" range. At z≈12.2 the car silhouette is clearly visible
// while a phone still shows enough of Lower + Midtown Manhattan to read
// the subway as a living network rather than a handful of isolated trains.
// Keep this mobile-first: the first public impression should be moving
// trains around the iconic Manhattan core, not a zoomed-out system map.
//
// Single-sourced here, with lib/mapView.test.ts pinning the invariant and
// guarding against a re-introduced hard-coded literal in MapView.tsx.
export const INITIAL_MAP_VIEW: {
  center: [number, number];
  zoom: number;
} = {
  center: [-73.989, 40.7355],
  zoom: 12.2,
};
