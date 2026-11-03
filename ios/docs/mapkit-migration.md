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

MapKit advances an eligible train along its representative track toward a matching next-stop ETA. Reduce Motion uses discrete estimates. A stopped train stays at its platform, and missing evidence, stale reports and failed feeds use the existing visibility rules. See [train motion](train-motion.md) for sampling and lifecycle behavior.

Before retiring the fallback, exercise a dense corridor during pan and zoom, inspect reverse travel and turnouts, and measure update cost with the artwork and itinerary overlays visible. Verify map accessibility and camera behavior when folding on the physical Duo. Record simulator observations separately from device results. The [comparison record](map-comparison.md) contains the earlier renderer checks.
