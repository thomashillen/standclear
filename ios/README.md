# StandClear for iOS — native MapKit client

This Xcode project is an incremental native client alongside the existing Next.js web application. The native app uses SwiftUI MapKit exclusively, with no map-provider setting, rendering token or third-party map SDK. Existing installations ignore the former provider preference. The web app and its Mapbox integration remain unchanged.

The project targets iOS 26 or later and is developed with Xcode 27.2 / the iOS 27.2 SDK. See [the native MapKit migration record](docs/mapkit-migration.md) for scope and remaining device checks; the [earlier comparison record](docs/map-comparison.md) is historical.

## Open and configure

Open the actual `ios/StandClear.xcodeproj` project, rather than opening `project.yml` or the repository as a folder workspace. From the repository root:

```sh
open ios/StandClear.xcodeproj
```

Select the shared **StandClear** scheme and an installed iPhone simulator, then press **⌘R** to build and run. In Xcode 27, simulators appear in **Device Hub**, available from **Xcode → Open Developer Tool → Device Hub**. Simulator builds do not require a development team, a paid Apple Developer Program membership, or device signing.

Xcode reads the same local source files being edited in this checkout. Press **⌘R** after code changes to rebuild and relaunch. Realtime data refreshes independently while the application is running.

MapKit does not require a rendering token. `ios/Config/App.xcconfig` optionally includes the ignored `Local.xcconfig` for machine-specific signing configuration. An existing unused Mapbox token in that local file can remain private; it is no longer read or included in the app’s Info.plist.

Do not commit tokens, signing files, credentials, or machine-specific configuration. Keep build products and DerivedData outside the repository, or in the ignored `ios/build/` or `ios/DerivedData/` directories. Never commit an application archive containing local configuration.

For physical-device testing, use a free Apple Personal Team. Keep the selected `DEVELOPMENT_TEAM` in local configuration and adjust the bundle identifier locally if Xcode requires it. No team identifier is stored in the project. Free provisioning is sufficient for development; App Store distribution is outside this milestone.

After pairing the phone with this Mac and completing the device’s Developer Mode and developer-profile trust steps, it can receive development builds wirelessly. Keep the Mac and phone on the same Wi-Fi network with IPv6 enabled, select the physical phone as Xcode’s run destination, and press **⌘R**. A cable is not required for every update. Device Hub also offers **Add Device → Pair Nearby Device** for supported devices. See [Apple’s Device Hub pairing instructions](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub).

The checked-in project is generated from `ios/project.yml` with XcodeGen. Regenerate it after changing target settings, dependencies, or source membership:

```sh
xcodegen generate --spec ios/project.yml
```

Ordinary Xcode builds do not require XcodeGen. Commit the generated project and shared scheme with relevant specification changes. Commit the Swift package resolution file; do not silently update the SDK as part of unrelated work.

## Architecture and native presentation

- `StandClearApp` opens `MapShell`.
- `MapShell` owns the observable stores, map focus and itinerary intent, native menus, and adaptive controls. `AppleTransitMap` is the only map renderer.
- `AppleTransitMap` uses SwiftUI MapKit polylines and custom annotations on a flat Apple basemap. Pitch is deliberately disabled; train bodies rotate along the track while route text stays upright.
- `TrainMapProjection` supplies estimated positions, route identity, and freshness. Travel heading follows the shape segment. A parked train uses its next known trip arrival as direction evidence; when the feed cannot establish a direction, the map uses a neutral round marker rather than a directed car. Reports fade after 90 seconds and markers are hidden after 360 seconds; stale or failed snapshots do not provide current markers.
- `TransitArtwork` draws the shared subway-car silhouette and route badges with SwiftUI. The car body rotates while its route label stays upright. Map annotations render the artwork directly in SwiftUI; no image cache or UIKit map bridge is needed.
- `TrainMarkerSizing` carries the native car-size curve shared with the web’s transit artwork. MapKit estimates the artwork zoom from the visible longitude span and available width; this remains approximate, especially during rotation. Route text fades at wider map views to avoid labels overflowing tiny cars.
- `TransitStore` loads the existing static dataset and polls the existing train endpoint. Active-scene polling uses an eight-second interval after successful requests and a longer delay on failure. If the initial static station load fails, the active polling loop retries it up to three times at that same cadence while retaining a visible retry state. Empty station data is treated as a failure. Manual Retry remains available after the automatic attempts are exhausted; backgrounding ends the run and its retry budget. Requests have a timeout; realtime work is stopped when the scene becomes inactive.
- `LocationStore` uses Core Location with when-in-use permission, hundred-meter accuracy, foreground one-shot fixes, 30-second fix expiration, and inactive-scene cleanup.
- `TransitModels` decodes the shared contracts and implements the small native station/arrival projection. Station complexes use the web client’s explicit allowlist rather than merging unrelated stations by name or proximity. Train deduplication is trip-only, preserving legitimate trains queued at a terminus.
- `StationBrowser` provides combined place and station search and a nearby station list, with route-color badges and navigation to native arrival rows.
- The application icon reuses the existing `public` 512-pixel StandClear artwork, upscaled to the 1024-pixel asset required by the native app icon catalog. This preserves the existing identity; it does not add new illustration detail.

Navigation stacks, toolbars, buttons, menus, searchable lists, navigation links, sheets, presentation detents, progress views, unavailable states, typography, and semantic materials come from SwiftUI. The operating system supplies their appearance, including supported Liquid Glass behavior. Custom visuals are limited to transit geometry, route colors, and train markers. There are no custom glass gradients, blur recipes, shadows, or animation replicas.

The map retains the native top safe area so itinerary framing keeps destination and transfer pins below the navigation bar. Native bottom and trailing insets reserve space for route sheets and expanded controls; interactive controls remain within native safe-area layouts. With at least 640 points of available width, a bounded right-side control region appears, opening to Nearby by default. Narrow windows and accessibility Dynamic Type sizes use conventional toolbar entry points and native sheets. Native Search and Nearby buttons in a ControlGroup switch the expanded region between station search and nearby arrivals; More remains a native menu. The map’s status presentation is constrained to the remaining map area. An open compact sheet transfers to the matching expanded region when the window widens, preserving station-search text. Search and Nearby retain independent station navigation across widening and narrowing, with Back returning to the preserved list or query. Explicitly dismissing a compact browser ends that visit; reopening starts at its list. The default expanded Nearby list alone does not open a sheet when the window narrows. Layout follows window geometry rather than a device model or fixed screen resolution. This is not a claim of verified physical Duo behavior.

## Nearby arrivals increment

Nearby presents native station sections with up to three real predictions per station. Matching reported route, direction and destination share a row with multiple countdowns; expanding it reveals each prediction’s clock time. Different services, short turns and unknown destinations stay separate. Station distance fits beside its name when space permits, with approximate straight-line meaning included in its accessibility label and a shared list footer. Each prediction includes the route badge, exact reported destination when known, direction, rounded-up minutes remaining, and scheduled prediction clock time. Station details show additional predictions. Missing destinations and unknown directions are not inferred from static termini.

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

UI interaction tests explicitly launch with `--ui-test-fixture`. This data source exists only in Debug simulator builds; ordinary launches, physical devices, and Release builds use the real endpoints. It supplies a small fixed station network and stable trip identities with fresh synthetic timestamps, through the same JSON decoding, polling, freshness, and cancellation paths. Core Location permission and native controls remain real. Nearby disclosure is required, rather than conditionally skipped when the live feed happens to lack a suitable arrival.

`LiveBackendContractTests` separately fetches and decodes the production `gtfsData.json` and `api/trains` endpoints. It checks the actual station contract without requiring an ephemeral train to survive a multi-step interaction. Unit tests retain stale/expired-feed and lifecycle coverage. Fixture screenshots establish interaction/layout behavior, not live-data completeness or dense-map performance.

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

The [original proof-of-concept validation record](docs/validation.md) describes the first milestone’s checks and screenshots. The [earlier map comparison record](docs/map-comparison.md) is historical; neither record validates subsequent changes. The Native iOS workflow builds, analyzes, and runs simulator tests without credentials alongside the existing web CI.

## Limits and next increments

Open **Search** and type an NYC address, place or subway station. Address and place matches appear first, followed by matching subway stations. Choose a place to preview a trip or a station to see arrivals and **Directions here**. With the search field empty, **Recent stations** lets you reopen one of the last ten stations you chose in Search. The list is stored on this device and can be cleared in Search. MapKit looks up the place and supplies walking paths and estimated walking times. Native search and walking share one coarse NYC envelope that includes the existing southern Staten Island Railway stations. This is a geographic limit, not a municipal-boundary check or a guarantee of service; walking legs retain their 2.5 km limit. StandClear uses its subway graph to find direct and one-transfer trips. Place directions begin at **Current Location** when a usable fix is available. The boarding station is a separate step in the itinerary. Tap **From** to change the starting point.

For place directions, select an option in the route card to highlight its subway legs and available walking paths on the main transit map. Compact windows use a resizable sheet; expanded windows place the card beside the map. The card distinguishes routed pedestrian time from typical subway time, using four minutes per train wait, 90 seconds per stop and three minutes per transfer. Boarding predictions are separate observations at the listed platform. When the next train is predicted before the initial routed walk plus 20 seconds for station entry, the card also shows the next matching prediction after that estimate, if reported. Its countdown is measured from now. Station coordinates approximate entrances. A confirmed accessible entrance or guaranteed transfer requires more information than this planner provides.

Open a station from Search or Nearby to see service advisories alongside arrivals. StandClear checks the existing `/api/alerts` endpoint while the station is open and the app is active. An advisory can apply to a whole route, a stop, or a route at a particular stop. Station alerts include reported express variants of their base routes, while retaining explicit stop scope and keeping separate shuttle services distinct. The section distinguishes current reports, older reports with a timestamp, and unavailable or unconfirmed status. A fresh request alone cannot confirm that the MTA source is current. If a refresh fails, the current station or line visit retains its last report alongside an unavailable status, its verified last-report time when known, and Retry. Starting a retry keeps that failure state until a successful response replaces the report, including a fresh empty response. Reports remain local to that station or line detail; no persistence or shared cache is added. Advisories provide context for riders and are not used to recalculate itineraries.

More → Service alerts opens a native list of reported advisories across services without first selecting a station or line. Each disclosure shows severity, reported routes when available, headline, and details. The list follows the sheet/right-side pane layout and polls the existing `/api/alerts` endpoint once a minute only while visible and active. Refresh and Retry use the same five-minute source/response evidence and failed-refresh retention rules as station advisories. Only a verified current empty report says no alerts were reported. Reports survive adaptive presentation changes within this visit; reopening after leaving starts a fresh visit. Advisory data does not recalculate routes.

The shared endpoint filters alerts by their current GTFS display window. Its optional `startTime`/`endTime` fields are epoch seconds for the continuous active window containing server time; overlapping/touching periods merge, but separate intervals retain their gaps. Missing bounds stay null. Current advisories show a reported window caption in the systemwide list and expanded station/line details. Known ends within an hour use rounded-up minutes; later dates use Foundation's localized date/time formatting in New York time, including daylight/standard time distinctions. Missing, invalid, elapsed, or distant indefinite ends have no invented countdown. Legacy or malformed optional date fields cannot discard the advisory body. Stale, unavailable and unconfirmed reports retain their existing status/text but hide timing captions until current evidence returns. The existing timeline refreshes captions; no polling or background work is added. Labels and VoiceOver describe reported alert-display windows, not guaranteed service-restoration times.

MapKit is the only native renderer. See [the migration record](docs/mapkit-migration.md) for the retired dependencies and remaining device checks.

## Location and compact map glance

The map shows a blue approximate-location dot from the existing expiring coarse fix. No independent map location manager or continuous high-accuracy tracking is added. Permission revocation, fix expiration, and background cleanup remove the dot and location-dependent predictions.

The glance mirrors the web grouping: station complexes remain distinct, services sharing a route color are grouped at that station, and only stations within 900 metres are considered. Up to three groups use stable distance/identity ordering. Both directions show the next valid prediction within 45 minutes; dashes do not imply no service. Native freshness and failed-request gates remain in force, with no synthesized “Now” rows. More opens a point-in-time arrival-status alert and provides recovery actions.

SwiftUI supplies the glass effect on a soft rounded rectangle. The panel uses three tight rows with no separate header; feed status remains in the native More menu. Reduce Transparency uses a semantic opaque background; typography scales with Dynamic Type, and taller content can scroll within a geometry-bounded panel. No custom animation is introduced.

In Search, touch and hold a station result or recent station to add or remove a favorite using the native context menu. VoiceOver exposes the same named action. Favorite rows show the existing star and announce their saved state; choosing the action keeps the current search open. A regular tap still opens station arrivals. Favorites use the same local store as Nearby, independently of Home and Work assignments. In station details, open **Save station (•••)** to add or remove a favorite on this device. Keeping saved-station actions in this native menu reserves room for the station title, Directions here, and Done. Open **Nearby** to find saved stations even when location is unavailable. A saved station already in the nearby results is marked with a star and appears just once.

Nearby station rows show approximate straight-line distance in local units when a location fix is usable.

Tap a station on the nearby map glance to open its arrivals and service alerts directly. Use the Nearby toolbar button to browse the full list.

Near Me now opens the appropriate native presentation and recenters/zooms around the usable coarse location fix. If a fix is pending, it applies once; search, station selection, dismissal, and backgrounding cancel the pending intent. A medium nearby sheet reserves visible map space, and the compact glance hides while a narrow sheet is open.

Queued basics: station-to-station directions should reuse the web's direct/one-transfer planning logic. A selected-journey Live Activity is deferred until those basics are validated. It must preserve truthful freshness and background-update limits; no push infrastructure or paid service is authorized by this milestone.

## Basic station directions

Choose **More → Directions**, then select From and To stations. Native lists, search fields, navigation links, and buttons provide station selection, swap/clear, up to four route alternatives, and boarding/transfer/alighting instructions. Selecting an itinerary highlights its route geometry and frames it in the native map. Station itineraries label the boarding and final arrival platforms with native map markers; Clear route removes those markers with the highlighted route. At accessibility text sizes, the native endpoint symbols remain visible while MapKit hides their titles to avoid clipping; full station names remain in the marker accessibility labels and Trip details. In Trip details, the native toolbar’s **Show route on map** button remains available while scrolling, including at accessibility text sizes. Selections are stored by station identity and survive adaptive presentation changes; delayed data never chooses a different station for the rider.

`TripPlanner` ports the existing `lib/commuteRouting.ts` direct/one-transfer graph and curated complex membership. Platform IDs remain distinct from complex IDs. Equivalent routes share an option; express/local options with different stop counts remain separate. Plans are ranked by transfers and stops, not total journey time. Geometry uses existing static shapes and rejects malformed data.

Each leg shows the next reported departure at its boarding platform, using the existing strict freshness, route and direction checks. For a transfer, the map marks the outgoing platform and trip details name the connecting service. A transfer-platform prediction describes trains there now, even if they will depart before the rider arrives. It is separate from the static itinerary and is not a promise that the rider can catch that train or make a connection. Missing predictions do not establish no service. This increment does not include service-alert routing, total-duration estimates, walking/accessibility routing, address search, live location endpoints, or Live Activities. It adds no endpoint, account, or paid service.

## Compact native arrivals

Nearby prioritizes station and arrival information: healthy-feed status remains in More rather than occupying a list section. Loading, stale/error recovery, and location-permission states remain visible. Station badges fit beside names when space permits. Station details show the first four predictions in each direction. Use Show all to expand one direction independently. Predictions with an unrecognized direction appear separately. Arrival rows keep route, direction, countdown, and reported destination visible; expand a native disclosure to read the prediction's clock time. Text adapts instead of shrinking to fit.

The three-group map glance uses route bullets for each direction in a narrower native glass surface. Expanded controls use system material over the map, with transparent navigation/list backgrounds and an opaque semantic fallback for Reduce Transparency. Expanded route previews, station directions, itinerary details and endpoint pickers also reveal that shared material through their list rows; compact sheets keep their native row backgrounds. The material samples the map behind the control region, rather than an opaque row surface. MapKit can now advance eligible train estimates between feed updates. It follows the representative track toward a matching next-stop arrival, holds at the station, and uses discrete reported positions under Reduce Motion. See [train motion](docs/train-motion.md).

From Search or Nearby, open a station and choose **Directions here** to push Directions in the same native navigation stack. The selected station fills To only when you tap that action. Your existing From station remains editable. If From is empty and a valid location fix is available, the explicit action suggests the nearest subway station within 900 metres. From shows the actual station name and identifies it as a location-based suggestion; walking to that station is not included. Without a usable nearby fix, choose From manually. The suggestion is a one-time station selection: later location fixes, expiry, and delayed data never silently replace it. Choosing From manually, swapping, or clearing removes the suggestion label. Back returns to station arrivals and then the preserved search query. **More → Directions** remains available. This remains station-to-station subway planning; a nearby station is not a verified entrance or walking connection.

While a route is highlighted, **Clear route** is directly available in the narrow map toolbar or expanded control region. One tap removes the highlight while preserving From and To. **Clear directions** in Directions still clears both endpoints. A station itinerary is highlighted by explicitly activating its route row or Show route on map. Recreating its details during layout changes does not replay that selection after Clear route.

Search opens in a native large sheet so keyboard activation does not have to promote a medium sheet. Station search and endpoint pickers use SwiftUI’s always-visible navigation-bar search placement, avoiding the bottom-toolbar activation path that lost keyboard focus in hosted iOS 26 testing; the system still supplies the control and its appearance. Accessibility Dynamic Type sizes also use the large sheet for station results and endpoint controls. Other presentations retain medium and large detents at ordinary text sizes; map framing tracks the actual presentation.

In Search, use the menu beside an address or place to set Home or Work. Saving dismisses the keyboard and reveals the saved-place shortcuts. They also appear whenever the search field is empty. Each opens the existing route preview with its current-location default and editable origin. Choosing identical valid starting and destination map coordinates shows a native same-endpoint state instead of a route or walking estimate; the From control remains available to choose another starting point. The shortcut menu removes the saved address. Home and Work stay on this device. In station details, use Save station to assign Home or Work. Assigning a station also favorites it. The saved shortcut opens arrivals and Directions here; removing an anchor preserves the station favorite. Station names resolve from current subway data. A temporarily unavailable station stays saved with a removable unavailable row.

In a place route preview, tap **To** to search for a replacement address or place within the current trip. Your chosen **From** is preserved. Going back without selecting a result keeps the existing destination and route; accepting a different result clears the old route while preparing the replacement. Selecting the same destination keeps the current route choice. The destination picker uses the existing native MapKit search and shares the origin picker’s lifecycle and adaptive presentation. Station destinations continue using the separate station Directions flow. **Back to Search** returns to the original search query.

Search also remembers up to ten recently opened places on this device. The first three appear when the query is empty; More recent places reveals the rest. Open one to start a new trip with an editable current-location origin. Its menu removes one entry, and Clear recent places removes the history. Saving a place as Home or Work is separate from this history.

More → Lines opens a native list of routes and their ordered stations from the existing static dataset. Select a stop to open its station arrivals, advisories, favorites and Directions here. The list labels the static route pattern explicitly. Line details also show a compact native service-alert disclosure from the existing `/api/alerts` endpoint, with severity labels, refresh/retry states and the same five-minute upstream/response freshness checks as station advisories. An explicit route selector qualifies even when its stop lies beyond the representative static pattern; stop-only advisories qualify at listed stops, and a different route at a shared stop stays excluded. Express-service advisories appear under their base line. Polling runs once a minute only while the line detail is visible and the app is active, and stops when opening station details or leaving the screen. It does not infer actual stopping patterns from the static list. The map focuses the selected station.

Place search uses MapKit autocomplete for partial addresses and business names in Search and both place-route endpoint pickers. Selecting or saving a suggestion resolves that exact MapKit completion before navigation; coordinates still must pass the shared NYC coverage check. Completion regions are a search bias, so an out-of-coverage suggestion can be rejected when selected. Failed resolution stays in the picker with retry; changing the query or leaving cancels pending resolution.

Place and station itineraries have a small native sheet detent. Drag the sheet down, or use Hide directions / Show route on map, to expose the map without canceling the selected route. Drag up or tap Directions (Steps when space is limited) to restore the existing steps. The separate X clears the highlighted route; Done explicitly closes it. Station endpoint choices remain available for another trip. Collapsing retains the place view's routing and freshness work; an expired location still removes location-derived geometry. Layout reparenting restores only the navigation depth the rider left open, rather than replaying steps after Back. No custom drag recognizer or sheet animation is used.
