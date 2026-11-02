# StandClear for iOS — native proof of concept

This Xcode project is an incremental native client alongside the existing Next.js web application. The web app and backend remain the production application. The native client uses SwiftUI and the native Mapbox Maps SDK, pinned to **11.26.0** through Swift Package Manager. It targets iOS 26 or later and is developed with Xcode 27.2 / the iOS 27.2 SDK.

## Open and configure

Open `ios/StandClear.xcodeproj` and select the shared **StandClear** scheme and an installed iPhone Simulator. Simulator builds do not require a development team, a paid Apple Developer Program membership, or device signing.

Create `ios/Config/Local.xcconfig`, which is ignored by Git:

```xcconfig
MAPBOX_PUBLIC_TOKEN = <your public Mapbox rendering token>
```

Use an appropriate public rendering token for a native application; a token restricted to web URLs may not work. Do not use a secret Mapbox token here. `App.xcconfig` optionally includes this file, and the public token is supplied to Mapbox through the application’s processed Info.plist. A public rendering token is necessarily present in a built client application: keeping it out of Git does not make the installed application a secret store.

Do not commit tokens, signing files, credentials, or machine-specific configuration. Keep build products and DerivedData outside the repository, or in the ignored `ios/build/` or `ios/DerivedData/` directories. Never commit an application archive containing local configuration.

When physical-device testing becomes necessary, use a free Apple Personal Team. Keep the selected `DEVELOPMENT_TEAM` in local configuration and adjust the bundle identifier locally if Xcode requires it. No team identifier is stored in the project. Free provisioning is sufficient for development; App Store distribution is outside this milestone.

The checked-in project is generated from `ios/project.yml` with XcodeGen. Regenerate it after changing target settings, dependencies, or source membership:

```sh
xcodegen generate --spec ios/project.yml
```

Ordinary Xcode builds do not require XcodeGen. Commit the generated project and shared scheme with relevant specification changes. Commit the Swift package resolution file; do not silently update the SDK as part of unrelated work.

## Architecture and native presentation

- `StandClearApp` configures Mapbox and opens `MapShell`.
- `MapShell` owns the observable stores and a Mapbox SwiftUI `Map`. Subway lines use polyline annotations and train positions use circle annotations. The SDK’s UIKit map view is not wrapped in a custom representable.
- `TransitStore` loads the existing static dataset and polls the existing train endpoint. Active-scene polling uses an eight-second interval after successful requests and a longer delay on failure. Requests have a timeout; realtime work is stopped when the scene becomes inactive.
- `LocationStore` uses Core Location with when-in-use permission, hundred-meter accuracy, foreground one-shot fixes, 30-second fix expiration, and inactive-scene cleanup.
- `TransitModels` decodes the shared contracts and implements the small native station/arrival projection. Station complexes use the web client’s explicit allowlist rather than merging unrelated stations by name or proximity. Train deduplication is trip-only, preserving legitimate trains queued at a terminus.
- `StationBrowser` provides station search and a nearby station list, with navigation to native arrival rows.

Navigation stacks, toolbars, buttons, menus, searchable lists, navigation links, sheets, presentation detents, progress views, unavailable states, typography, and semantic materials come from SwiftUI. The operating system supplies their appearance, including supported Liquid Glass behavior. Custom visuals are limited to transit geometry, route colors, and train markers. There are no custom glass gradients, blur recipes, shadows, or animation replicas.

The map extends behind the native window’s system chrome; interactive controls remain within native safe-area layouts. With at least 640 points of available width, a bounded right-side control region appears, opening to Nearby by default. Narrow windows and accessibility Dynamic Type sizes use conventional toolbar entry points and native sheets. Native Search and Nearby buttons in a ControlGroup switch the expanded region between station search and nearby arrivals; More remains a native menu. The map’s status presentation is constrained to the remaining map area. Layout follows window geometry rather than a device model or fixed screen resolution. This is not a claim of verified physical Duo behavior.

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

See [the validation record](docs/validation.md) for executed local checks, screenshots, and remaining device/accessibility checks. The Native iOS workflow builds, analyzes, and runs simulator tests without credentials alongside the existing web CI.

## Limits and next increments

This is a map/search/nearby-arrivals shell, not web feature parity. It has no trip planner, address geocoding, service-alert presentation, saved commutes, favorites, persistence/offline cache, background arrivals, push notifications, settings screen, or complete station-details feature. Nearby selection uses straight-line distance, not walking directions. It does not synthesize “Now” rows from stopped trains. Search is local station-name matching, without address suggestions or the web client’s full suggestion behavior. Native CI and physical Duo acceptance must be assessed separately from the existing web CI.

Continue in small reviewed increments: location lifecycle and automatic nearby presentation; arrival freshness and outage behavior; train-marker parity; search suggestions; station details; navigation/trip planning; settings and secondary menus. Preserve cancellation, location efficiency, accessibility, and reduced-motion behavior at each step.

Mapbox remains the map engine for this proof of concept. A future, separate MapKit evaluation could compare operating cost, offline requirements, overlay support, and accessibility parity against the established Mapbox styling and transit behavior. It is not a prerequisite for this migration and does not imply a map-engine switch.
