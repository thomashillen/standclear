// The canonical first-paint camera frame: lower-Manhattan center at a
// neighborhood zoom. Two consumers in components/MapView.tsx — ~1000
// lines apart — must agree on it:
//
//   1. The `new mapboxgl.Map({...})` constructor: the frame the live
//      map paints on cold boot. Per CLAUDE.md's "UI shell" note the
//      live map is the cold-boot hero, so this is the very first thing
//      every first-time rider sees.
//   2. The reset-to-Manhattan `flyTo` driven by `flyToDefaultSignal`,
//      fired when an out-of-NYC rider taps "Preview the map" from the
//      Near-me panel. It must land on *exactly* the cold-boot frame so
//      "Preview" returns the rider to the same canonical hero rather
//      than a drifted approximation.
//
// These were duplicated literals before. A retune of the hero frame
// that touched only the constructor would silently leave "Preview the
// map" flying to a stale center, with no compile-time signal (both
// sites are valid standalone calls). Single-sourced here, with
// lib/mapView.test.ts pinning the invariant and guarding against a
// re-introduced hard-coded literal in MapView.tsx.
//
// Scope is exactly center + zoom: the `minZoom`/`maxZoom` constructor
// options are persistent map constraints, not part of the resettable
// frame, so the reset deliberately does not re-assert them.
export const INITIAL_MAP_VIEW: {
  center: [number, number];
  zoom: number;
} = {
  center: [-73.9857, 40.7484],
  zoom: 11,
};
