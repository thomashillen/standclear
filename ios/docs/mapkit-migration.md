# Native MapKit migration

Use Apple Maps as the primary native renderer and keep Mapbox selectable while riders compare the two. On the physical Duo, Thomas reported that Apple Maps filled the expanded window and that trains appeared and updated. Smooth motion, dense-map performance, and the latest layouts still need separate verification.

## Coverage and remaining dependencies

| Area | Current dependency and removal work |
| --- | --- |
| Map and overlays | `AppleTransitMap` draws route polylines, train artwork, the approximate location dot, and itinerary highlights with SwiftUI MapKit. Verify camera framing, compass and attribution clearance, and selected routes under the cover sheet and expanded pane before removing the second renderer. |
| Native fallback | `MapShell` owns the provider preference, Mapbox viewport, ornaments, annotations, loading recovery, and missing-token state. `StandClearApp` configures the SDK. `TrainSpriteCache` renders images for Mapbox. Keep the route colors, car artwork, marker sizing and transit projections that MapKit also uses. |
| Build and configuration | `project.yml` pins Mapbox Maps 11.26.0 and defines `MBXAccessToken`. Retiring the fallback entails regenerating the Xcode project, updating package resolution, removing the app token declaration and revising provider-switching and missing-token tests. Preserve ignored signing configuration. |
| Search and walking | The existing `/api/geocode` and `/api/walk` web contracts use Mapbox upstream. Native place previews use MKLocalSearch for destinations and MKDirections for walking. The web app still needs its own provider credentials even after the native fallback is retired. |
| Transit data | Both renderers use StandClear’s `/gtfsData.json` and `/api/trains`. The native `TripPlanner` supplies subway legs and boarding predictions. Keep these shared contracts when changing the map or place-search provider. |

## Train motion

`TrainMapProjection` currently maps each reported segment and progress value to one coordinate and heading. MapKit’s `Annotation` displays that estimate. Polls advance the position in steps. The web’s `trainTrajectory.ts` and `useTrainMarkers.ts` provide a reference for travel along cumulative track distance, orientation around corners, and smoothing corrections when a new report arrives.

A native motion increment can cache cumulative distances per line and calculate a short trajectory per trip on each fresh snapshot. Advance toward a matching next-stop ETA, stop at the predicted platform, and keep reported stopped trains parked. Hold the estimate when the trip or shape cannot support a direction. Reset on trip changes, large discontinuities and foreground reentry. Keep vehicle-age fading and expiration, suppress failed or stale snapshots, pause work outside the active scene, and present discrete updates under Reduce Motion.

Before retiring the fallback, exercise a dense corridor during pan and zoom, inspect reverse travel and turnouts, and measure update cost with the artwork and itinerary overlays visible. Verify map accessibility and camera behavior when folding on the physical Duo. Record simulator observations separately from device results. The [comparison record](map-comparison.md) contains the earlier renderer checks.
