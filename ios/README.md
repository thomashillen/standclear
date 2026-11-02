# StandClear for iOS — native transit map comparison

This Xcode project is an incremental native client alongside the existing Next.js web application. The web app and backend remain the production application. The SwiftUI client now offers a bounded comparison between the native Mapbox Maps SDK, pinned to **11.26.0** through Swift Package Manager, and Apple MapKit. Both engines run natively; neither uses a WebView. Mapbox remains the default. Choose a map provider in **More** to switch engines; the choice persists between launches. This comparison does not establish complete feature or performance parity.

The project targets iOS 26 or later and is developed with Xcode 27.2 / the iOS 27.2 SDK. See [the map comparison record](docs/map-comparison.md) for the comparison’s scope, observations, and validation results.

## Open and configure

Open the actual `ios/StandClear.xcodeproj` project, rather than opening `project.yml` or the repository as a folder workspace. From the repository root:

```sh
open ios/StandClear.xcodeproj
```

Select the shared **StandClear** scheme and an installed iPhone simulator, then press **⌘R** to build and run. In Xcode 27, simulators appear in **Device Hub**, available from **Xcode → Open Developer Tool → Device Hub**. Simulator builds do not require a development team, a paid Apple Developer Program membership, or device signing.

Xcode reads the same local source files being edited in this checkout. Press **⌘R** after code changes to rebuild and relaunch. Realtime data refreshes independently while the application is running.

Create `ios/Config/Local.xcconfig`, which is ignored by Git:

```xcconfig
MAPBOX_PUBLIC_TOKEN = <your public Mapbox rendering token>
```

Use an appropriate public rendering token for a native application; a token restricted to web URLs may not work. Do not use a secret Mapbox token here. `App.xcconfig` optionally includes this file, and the public token is supplied to Mapbox through the application’s processed Info.plist. A public rendering token is necessarily present in a built client application: keeping it out of Git does not make the installed application a secret store.

Do not commit tokens, signing files, credentials, or machine-specific configuration. Keep build products and DerivedData outside the repository, or in the ignored `ios/build/` or `ios/DerivedData/` directories. Never commit an application archive containing local configuration.

For physical-device testing, use a free Apple Personal Team. Keep the selected `DEVELOPMENT_TEAM` in local configuration and adjust the bundle identifier locally if Xcode requires it. No team identifier is stored in the project. Free provisioning is sufficient for development; App Store distribution is outside this milestone.

After pairing the phone with this Mac and completing the device’s Developer Mode and developer-profile trust steps, it can receive development builds wirelessly. Keep the Mac and phone on the same Wi-Fi network with IPv6 enabled, select the physical phone as Xcode’s run destination, and press **⌘R**. A cable is not required for every update. Device Hub also offers **Add Device → Pair Nearby Device** for supported devices. See [Apple’s Device Hub pairing instructions](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub).

The checked-in project is generated from `ios/project.yml` with XcodeGen. Regenerate it after changing target settings, dependencies, or source membership:

```sh
xcodegen generate --spec ios/project.yml
```

Ordinary Xcode builds do not require XcodeGen. Commit the generated project and shared scheme with relevant specification changes. Commit the Swift package resolution file; do not silently update the SDK as part of unrelated work.

## Architecture and native presentation

- `StandClearApp` configures Mapbox and opens `MapShell`.
- `MapShell` owns the observable stores, the native provider menu, and adaptive controls. Mapbox uses its supported SwiftUI `Map` and annotation APIs; its UIKit map view is not wrapped in a custom representable.
- `AppleTransitMap` uses SwiftUI MapKit polylines and custom annotations on a flat Apple basemap. Pitch is deliberately disabled for this comparison; rotated train bodies and upright route text are evaluated in the flat-map presentation.
- `TrainMapProjection` supplies both engines with the same estimated positions, route identity, and freshness. Travel heading follows the shape segment. A parked train uses its next known trip arrival as direction evidence; when the feed cannot establish a direction, the map uses a neutral round marker rather than a directed car. Reports fade after 90 seconds and markers are hidden after 360 seconds; stale or failed snapshots do not provide current markers.
- `TransitArtwork` draws the shared subway-car silhouette and route badges with SwiftUI. The car body rotates while its route label stays upright. Mapbox’s image annotation API requires a `UIImage`, so `TrainSpriteCache` uses SwiftUI `ImageRenderer` once per route/color and caches the result; no custom UIKit map bridge or UIKit drawing implementation is introduced.
- `TrainMarkerSizing` carries the native car-size curve shared with the web’s transit artwork. MapKit estimates a comparable zoom from the visible longitude span and available width; this remains approximate, especially during rotation. Route text fades at wider map views to avoid labels overflowing tiny cars.
- `TransitStore` loads the existing static dataset and polls the existing train endpoint. Active-scene polling uses an eight-second interval after successful requests and a longer delay on failure. Requests have a timeout; realtime work is stopped when the scene becomes inactive.
- `LocationStore` uses Core Location with when-in-use permission, hundred-meter accuracy, foreground one-shot fixes, 30-second fix expiration, and inactive-scene cleanup.
- `TransitModels` decodes the shared contracts and implements the small native station/arrival projection. Station complexes use the web client’s explicit allowlist rather than merging unrelated stations by name or proximity. Train deduplication is trip-only, preserving legitimate trains queued at a terminus.
- `StationBrowser` provides station search and a nearby station list, with route-color badges and navigation to native arrival rows.
- The application icon reuses the existing `public` 512-pixel StandClear artwork, upscaled to the 1024-pixel asset required by the native app icon catalog. This preserves the existing identity; it does not add new illustration detail.

Navigation stacks, toolbars, buttons, menus, searchable lists, navigation links, sheets, presentation detents, progress views, unavailable states, typography, and semantic materials come from SwiftUI. The operating system supplies their appearance, including supported Liquid Glass behavior. Custom visuals are limited to transit geometry, route colors, and train markers. There are no custom glass gradients, blur recipes, shadows, or animation replicas.

The map extends behind the native window’s system chrome; interactive controls remain within native safe-area layouts. With at least 640 points of available width, a bounded right-side control region appears, opening to Nearby by default. Narrow windows and accessibility Dynamic Type sizes use conventional toolbar entry points and native sheets. Native Search and Nearby buttons in a ControlGroup switch the expanded region between station search and nearby arrivals; More remains a native menu. The map’s status presentation is constrained to the remaining map area. An open compact sheet transfers to the matching expanded region when the window widens, preserving station-search text. Layout follows window geometry rather than a device model or fixed screen resolution. This is not a claim of verified physical Duo behavior.

## Nearby arrivals increment

Nearby now presents native station sections with up to three real predictions per station. Each prediction includes the route badge, exact reported destination when known, direction, rounded-up minutes remaining, and scheduled prediction clock time. Station details show additional predictions. Missing destinations and unknown directions are not inferred from static termini.

On map open, one compact native glass panel shows up to three nearby station/service groups, with the next northbound and southbound predictions. It replaces the automatic sheet so the map stays visible. Nearby and the panel open the full list on demand. Expanded layouts continue using the native right-side region. Location denial, outside-service-area location, waiting for a fix, feed failure, stale data, and fresh-but-empty predictions have distinct native states. The permission state uses compact native rows so it remains readable in a short landscape panel.

More → Arrival status opens a native alert with feed status and update time captured when requested. Healthy status does not occupy Nearby list space. Arrival rows remain estimates and do not synthesize “Now” arrivals. Invalid or future-dated vehicle reports cannot qualify stale predictions as current. No endpoint or backend changes are required.

## Existing APIs and truthfulness

The proof of concept calls the existing public deployment without adding backend endpoints or authentication:

| Endpoint | Contract used |
| --- | --- |
| `https://standclear.vercel.app/gtfsData.json` | A `lines` dictionary containing route IDs, colors, stops, and representative `[longitude, latitude]` shape coordinates. Loaded at runtime, not bundled into either application. |
| `https://standclear.vercel.app/api/trains` | `generatedAt`, `trains`, and `arrivals`; the existing server continues aggregating the MTA feeds and maintaining its cross-request trip-stop cache. |

`generatedAt` is epoch **milliseconds**. Arrival `eta` and train `lastReportedAt` are epoch **seconds**. A snapshot becomes stale at 60 seconds. Expired arrivals are omitted; failed or stale snapshots do not supply current arrival rows. Train position age is assessed separately from snapshot age. Arrival rows are deduplicated by trip, stop, and direction, since the server can return overlapping arrival records from multiple feeds. A missing prediction never establishes that no train service exists. The existing API does not expose per-route partial-outage health; the client cannot distinguish every missing route from an upstream gap.

Train positions follow representative static geometry and the server’s progress estimate. These are transit estimates, not GPS locations. This milestone does not port the web client’s complete trajectory interpolation, smoothing, route variants, or “Now” arrival synthesis. Real-time destination IDs are used when supplied, rather than inventing a destination from a static terminus.

## Build, analyze, and test

Run commands from the repository root. Substitute an installed simulator ID from `xcrun simctl list devices available` for `<SIMULATOR_ID>`:

```sh
swiftformat ios/StandClear ios/StandClearTests ios/StandClearUITests --swiftversion 6.0 --lint

xcodebuild -project ios/StandClear.xcodeproj -scheme StandClear \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/standclear-ios-derived CODE_SIGNING_ALLOWED=NO build analyze

xcodebuild -project ios/StandClear.xcodeproj -scheme StandClear \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -derivedDataPath /tmp/standclear-ios-derived CODE_SIGNING_ALLOWED=NO test
```

To install and launch a simulator build:

```sh
xcrun simctl boot <SIMULATOR_ID>
xcrun simctl bootstatus <SIMULATOR_ID> -b
xcrun simctl install <SIMULATOR_ID> /tmp/standclear-ios-derived/Build/Products/Debug-iphonesimulator/StandClear.app
xcrun simctl launch <SIMULATOR_ID> app.standclear.native
```

Do not treat a successful compile as visual validation. Inspect the rendered map, annotations, sheet and search behavior, compact/expanded layout, permission states, larger text, and native accessibility. Test on a real Duo before claiming camera clearance, folding behavior, touch ergonomics, or system-overlay compatibility on that device. Simulator inspection and native VoiceOver use are separate checks.

The web application retains its validation commands:

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

The [original proof-of-concept validation record](docs/validation.md) describes the first milestone’s checks and screenshots. See [the map comparison record](docs/map-comparison.md) for results specific to the current artwork/provider comparison; earlier results alone do not validate these changes. The Native iOS workflow builds, analyzes, and runs simulator tests without credentials alongside the existing web CI.

## Limits and next increments

This is a map/search/nearby-arrivals client with basic station directions, not web feature parity. It has no address geocoding, service-alert presentation, saved commutes, favorites, persistence/offline cache, background arrivals, push notifications, settings screen, or complete station-details feature. Nearby selection uses straight-line distance, not walking directions. It does not synthesize “Now” rows from stopped trains. Search is local station-name matching, without address suggestions or the web client’s full suggestion behavior. Native CI and physical Duo acceptance must be assessed separately from the existing web CI.

Continue in small reviewed increments: location lifecycle and automatic nearby presentation; arrival freshness and outage behavior; train-marker parity; search suggestions; station details; navigation/trip planning; settings and secondary menus. Preserve cancellation, location efficiency, accessibility, and reduced-motion behavior at each step.

Mapbox remains the default while the optional MapKit comparison tests the core overlays and shared train artwork. The comparison does not establish Mapbox basemap-style parity, pitched-map behavior, dense-marker performance, selection behavior, or smooth realtime interpolation. No benchmark or full migration is claimed. Apple’s basemap has different styling controls; use the comparison record to separate those differences from missing transit behavior.

MapKit is not a replacement for the existing MTA data contracts or subway-routing logic. This milestone does not add MapKit directions or transit-ETA requests. Apple’s transit ETA capability is not a drop-in subway itinerary planner, so retain StandClear’s backend and transit graph when evaluating future routing. Evaluate costs, offline requirements, accessibility, attribution, and platform terms separately before choosing a production engine.

## Location and compact map glance

Both renderers show a blue approximate-location dot from the existing expiring coarse fix. No independent map location manager or continuous high-accuracy tracking is added. Permission revocation, fix expiration, and background cleanup remove the dot and location-dependent predictions.

The glance mirrors the web grouping: station complexes remain distinct, services sharing a route color are grouped at that station, and only stations within 900 metres are considered. Up to three groups use stable distance/identity ordering. Both directions show the next valid prediction within 45 minutes; dashes do not imply no service. Native freshness and failed-request gates remain in force, with no synthesized “Now” rows. More opens a point-in-time arrival-status alert and provides recovery actions.

SwiftUI supplies the glass effect on a soft rounded rectangle. The panel uses three tight rows with no separate header; feed status remains in the native More menu. Reduce Transparency uses a semantic opaque background; typography scales with Dynamic Type, and taller content can scroll within a geometry-bounded panel. No custom animation is introduced.

Near Me now opens the appropriate native presentation and recenters/zooms around the usable coarse location fix. If a fix is pending, it applies once; search, station selection, dismissal, and backgrounding cancel the pending intent. A medium nearby sheet reserves visible map space, and the compact glance hides while a narrow sheet is open.

Queued basics: station-to-station directions should reuse the web's direct/one-transfer planning logic. A selected-journey Live Activity is deferred until those basics are validated. It must preserve truthful freshness and background-update limits; no push infrastructure or paid service is authorized by this milestone.

## Basic station directions

Choose **More → Directions**, then select From and To stations. Native lists, search fields, navigation links, and buttons provide station selection, swap/clear, up to four route alternatives, and boarding/transfer/alighting instructions. Selecting an itinerary highlights its route geometry and frames it in either map engine. Selections are stored by station identity and survive adaptive presentation changes; delayed data never chooses a different station for the rider.

`TripPlanner` ports the existing `lib/commuteRouting.ts` direct/one-transfer graph and curated complex membership. Platform IDs remain distinct from complex IDs. Equivalent routes share an option; express/local options with different stop counts remain separate. Plans are ranked by transfers and stops, not total journey time. Geometry uses existing static shapes and rejects malformed data.

The first boarding prediction uses the existing strict freshness filters, matching each route's actual boarding platform and direction. It is separate from the static itinerary and is not a promise that the rider can catch that train or make a connection. Missing predictions do not establish no service. This increment does not include service-alert routing, total-duration estimates, walking/accessibility routing, address search, live location endpoints, or Live Activities. It adds no endpoint, account, or paid service.

## Compact native arrivals

Nearby prioritizes station and arrival information: healthy-feed status remains in More rather than occupying a list section. Loading, stale/error recovery, and location-permission states remain visible. Station badges fit beside names when space permits. Arrival rows keep route, direction, countdown, and reported destination visible; expand a native disclosure to read the prediction's clock time. Text adapts instead of shrinking to fit.

The three-group map glance uses route bullets for each direction in a narrower native glass surface. Expanded controls use system material over the map, with transparent navigation/list backgrounds and an opaque semantic fallback for Reduce Transparency. No custom blur implementation or movement animation is introduced. Track-following interpolation remains a later increment, with freshness, lifecycle, and Reduce Motion safeguards required.

From Search or Nearby, open a station and choose **Directions here** to push Directions in the same native navigation stack. The selected station fills To only when you tap that action. Your existing From station remains editable. If From is empty and a valid location fix is available, the explicit action suggests the nearest subway station within 900 metres. From shows the actual station name and identifies it as a location-based suggestion; walking to that station is not included. Without a usable nearby fix, choose From manually. The suggestion is a one-time station selection: later location fixes, expiry, and delayed data never silently replace it. Choosing From manually, swapping, or clearing removes the suggestion label. Back returns to station arrivals and then the preserved search query. **More → Directions** remains available. This remains station-to-station subway planning; a nearby station is not a verified entrance or walking connection.

While a route is highlighted, **Clear route** is directly available in the narrow map toolbar or expanded control region. One tap removes the highlight while preserving From and To. **Clear directions** in Directions still clears both endpoints.

Search opens in a native large sheet so keyboard activation does not have to promote a medium sheet. Accessibility Dynamic Type sizes also use the large sheet for station results and endpoint controls. Other presentations retain medium and large detents at ordinary text sizes; map framing tracks the actual presentation.
