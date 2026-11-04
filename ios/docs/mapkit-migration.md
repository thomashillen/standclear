# Native MapKit migration

Thomas selected MapKit as the only native iOS map renderer after comparing it with Mapbox on the Duo. The app now always opens SwiftUI MapKit, including installations whose former `mapProvider` preference is `Mapbox`. There is no provider toggle or token gate. The existing web app continues using Mapbox.

## Scope

- `AppleTransitMap` supplies subway polylines, estimated train markers, approximate location, station/place/transfer markers, and itinerary overlays. Its focus and trip revisions and safe-area insets continue to control camera framing around compact sheets and the expanded control region.
- Native Mapbox SDK imports, renderer code, image cache, package dependencies and lockfile are removed. The shared transit artwork, route identity, marker sizing and freshness/motion rules remain.
- The app no longer reads or embeds `MBXAccessToken`. Ignored local configuration remains available for Personal Team signing and is not deleted. MapKit requires no rendering token.
- Native place previews continue using MKLocalSearch and MKDirections. The web `/api/geocode` and `/api/walk` contracts retain their existing upstream Mapbox integration and configuration.
- Shared `/gtfsData.json`, `/api/trains` and `/api/alerts` contracts are unchanged. Removing the native renderer does not change subway routing or boarding predictions.

## Validation and remaining checks

The native UI suite covers a fresh MapKit launch and a legacy Mapbox preference, native controls, Nearby/Search, station and place directions, route clearing, and compact/expanded presentations. Build, analysis, unit/UI results and rendered evidence for each change belong in its pull request; this document does not establish that pending checks have passed.

On the physical Duo, Thomas previously reported that Apple Maps filled the expanded window and that trains appeared and updated. Dense-map pan/zoom performance, update cost, latest fold transitions, safe-area clearance and spoken VoiceOver output still require device acceptance. Simulator checks are recorded separately from physical results. See [train motion](train-motion.md) for estimated movement and lifecycle rules, and the [historical comparison](map-comparison.md) for the earlier two-renderer experiment.
