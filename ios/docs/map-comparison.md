# Native map comparison

> Historical record: these observations describe the earlier proof of concept. The native app now uses MapKit exclusively; see [the migration record](mapkit-migration.md) for current scope.

This increment adds an optional Apple Maps renderer to the existing native proof of concept. Mapbox remains the default and the web application is unchanged. Select **More → Map provider** in the native app to compare them.

## Shared transit behavior

Both renderers consume the existing `/gtfsData.json` and `/api/trains` contracts through the same store and train projection. Both use the same route-colored subway-car artwork, heading evidence, freshness rules, and native search/nearby controls. Unknown travel direction uses a neutral circle. Stale snapshots and failed requests never supply current markers; individual position reports fade after 90 seconds and disappear after 360 seconds.

The native app icon reuses the existing StandClear artwork. Route badges appear within native station and arrival lists. The comparison adds no backend service, authentication, subscription, or paid account requirement.

## What this establishes

SwiftUI MapKit can render StandClear route polylines and custom train annotations, update their estimated coordinates, rotate cars while keeping route labels upright, and focus a selected station. Mapbox also runs natively; this is a comparison of native map engines, not a WebView migration.

MapKit uses a flat standard basemap with pan, zoom, and rotation. Its camera-derived marker scale is approximate. Mapbox Studio styles cannot be imported into MapKit. Dense-marker performance, pitched-map behavior, selection parity, interpolation, and physical folding ergonomics remain evaluation work. The comparison does not port the web application's full trajectory smoothing or trip planner.

MapKit does not replace MTA realtime data or StandClear routing logic. Apple's transit directions transport type supports ETA requests, rather than full transit route calculation. Retain the existing transit graph/backend for a future subway planner.

Primary references:

- [MapKit for SwiftUI](https://developer.apple.com/documentation/mapkit/mapkit-for-swiftui)
- [Map annotations](https://developer.apple.com/documentation/mapkit/annotation)
- [Map polylines](https://developer.apple.com/documentation/mapkit/mappolyline)
- [Transit directions limitations](https://developer.apple.com/documentation/mapkit/mkdirectionstransporttype/transit)
- [Mapbox SwiftUI support](https://docs.mapbox.com/ios/maps/guides/swift-ui/)

## Validation

The comparison builds and passes static analysis with Xcode 27.2 / iOS 27.2. All 29 native unit tests passed, including nine projection regressions covering heading, unknown direction, duplicate vertices, freshness, invalid reports, and train deduplication. Both simulator UI tests passed: provider switching retains the native entry points, and search/nearby preserve a single presentation and search text across narrow/expanded transitions. The full local run took about 14.5 minutes because XCTest repeatedly waited 60 seconds for animation quiescence after Mapbox rotations; assertions passed without disabling idle checks. This timing is a test reliability limitation to investigate, not a performance benchmark.

Rendered Mapbox output was inspected on iPhone 18 Pro and Duo simulators, including the Duo dark appearance and system-provided right-side toolbar. Provider and adaptive-layout captures are retained in the local xcresult bundle. Simulator observations do not establish physical device acceptance. Current-head CI and review status are recorded in [PR #267](https://github.com/thomashillen/standclear/pull/267).

The unchanged web application passed lint, TypeScript checking, all 992 tests in 94 files, and its production build (971 generated pages).

A signed comparison build was installed and launched successfully on the paired physical Duo with the USB cable disconnected. Device connectivity reported `localNetwork` before installation. This verifies wireless development delivery; it does not establish physical fold-layout, performance, or accessibility acceptance.

For future updates, keep the paired phone and Mac on the same Wi-Fi, select the phone as Xcode's run destination, and press Command-R. See [Apple's Device Hub documentation](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub). Signing configuration remains in ignored local configuration.
