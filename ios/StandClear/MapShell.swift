import CoreLocation
import MapboxMaps
import SwiftUI

struct MapShell: View {
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var store = TransitStore()
    @State private var location = LocationStore()
    @State private var viewport = Viewport.camera(
        center: CLLocationCoordinate2D(latitude: 40.754, longitude: -73.984), zoom: 11
    )
    @State private var panel: Panel?
    @State private var sheetDetent: PresentationDetent = .medium
    @State private var windowSize: CGSize = .zero
    @State private var expandedPanel: Panel = .nearby
    @State private var stationVisit = 0
    @State private var directionsSelection = DirectionsSelection()
    @State private var placeSession = PlacePreviewSession()
    @State private var placeRoute: PlaceMapRoute?
    @State private var placeGeometryRevision = 0
    @State private var detentBeforeOriginPicker: PresentationDetent?
    @State private var selectedTrip: NativeTripPlan?
    @State private var tripFocusRevision = 0
    @State private var searchQuery = ""
    @State private var recentStations = RecentStations()
    @State private var favoriteStations = FavoriteStations()
    @FocusState private var stationSearchFocused: Bool
    @State private var arrivalStatusMessage = ""
    @State private var showingArrivalStatus = false
    @State private var mapError = false
    @State private var mapLoaded = false
    @State private var mapID = UUID()
    @AppStorage("mapProvider") private var mapProvider = MapProvider.apple
    @State private var mapZoom: Double = 11
    @State private var focus = MapFocusState()
    enum MapProvider: String, CaseIterable, Identifiable {
        case mapbox = "Mapbox", apple = "Apple Maps"
        var id: String {
            rawValue
        }
    }

    enum Panel: Hashable, Identifiable {
        case search, nearby, directions
        case station(String)
        case place(PlaceResult)

        var destination: PlaceResult? {
            if case let .place(value) = self {
                return value
            }; return nil
        }

        var id: Self {
            self
        }
    }

    private var hasToken: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String)?.hasPrefix("pk.") == true
    }

    var body: some View {
        GeometryReader { geometry in
            // Window geometry, not a device identifier, selects the control region.
            let expanded = geometry.size.width >= 640 && !typeSize.isAccessibilitySize
            let controlWidth = min(geometry.size.width * 0.4, 380)
            let statusWidth = expanded ? geometry.size.width - controlWidth : geometry.size.width
            Group {
                if expanded {
                    ZStack(alignment: .trailing) {
                        map(statusWidth: statusWidth, coveredWidth: geometry.size.width - statusWidth, coveredBottom: 0, maximumGlanceHeight: geometry.size.height * 0.55)
                        VStack(spacing: 0) {
                            NavigationStack {
                                panelContent(expandedPanel, expanded: true)
                                    .containerBackground(.clear, for: .navigation)
                            }
                            .id(expandedPanel)
                            .id(stationVisit)
                            if selectedTrip != nil || expandedPanel.destination != nil {
                                clearRouteButton
                                    .buttonStyle(.bordered)
                                    .padding(.horizontal)
                            }
                            ControlGroup {
                                Button("Search", systemImage: "magnifyingglass") { focus.cancelPending(); expandedPanel = .search }
                                    .accessibilityIdentifier("searchButton")
                                Button("Nearby", systemImage: "location") {
                                    showNearby(expanded: true)
                                }
                                .accessibilityIdentifier("nearbyButton")
                                moreMenu
                            }
                            .labelStyle(.iconOnly)
                            .controlSize(.large)
                            .padding()
                        }
                        .frame(width: controlWidth)
                        .background {
                            if reduceTransparency {
                                Color(uiColor: .systemBackground)
                            } else {
                                Rectangle().fill(.regularMaterial)
                            }
                        }
                    }
                } else {
                    NavigationStack {
                        map(statusWidth: statusWidth, coveredWidth: 0, coveredBottom: mediumSheetCoversMap ? geometry.size.height / 2 : 0, maximumGlanceHeight: geometry.size.height * 0.55)
                            .navigationTitle("StandClear")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    if selectedTrip != nil {
                                        clearRouteButton
                                    }
                                }
                                ToolbarItemGroup(placement: .bottomBar) {
                                    Button("Search", systemImage: "magnifyingglass") { focus.cancelPending(); panel = .search }
                                        .accessibilityIdentifier("searchButton")
                                    Spacer()
                                    Button("Nearby", systemImage: "location") { showNearby(expanded: false) }
                                        .accessibilityIdentifier("nearbyButton")
                                    moreMenu
                                }
                            }
                    }
                }
            }
            .onGeometryChange(for: CGSize.self) { $0.size } action: { windowSize = $0 }
            .onChange(of: expanded) { _, isExpanded in
                // The old searchable navigation region is about to disappear.
                // Release its focus so its keyboard cannot cover the new layout.
                stationSearchFocused = false
                if isExpanded, let activePanel = panel {
                    expandedPanel = activePanel
                    panel = nil
                } else if !isExpanded, expandedPanel.destination != nil {
                    sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
                    panel = expandedPanel
                    expandedPanel = .nearby
                } else if !isExpanded, case .station = expandedPanel {
                    sheetDetent = .large
                    panel = expandedPanel
                    expandedPanel = .nearby
                }
            }
            .onChange(of: panel) { _, selection in
                if selection != .search {
                    stationSearchFocused = false
                }
                if selection == .search || typeSize.isAccessibilitySize {
                    sheetDetent = .large
                }
                if selection == .search || selection == .directions || (selection == nil && !expanded) {
                    focus.cancelPending()
                }
            }
            .sheet(item: $panel) { panel in
                NavigationStack {
                    panelContent(panel)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { self.panel = nil } }
                        }
                }
                // Search starts with room for its keyboard instead of promoting a medium sheet during focus.
                .presentationDetents(panel == .search || typeSize.isAccessibilitySize ? [.large] : [.medium, .large], selection: $sheetDetent)
                .presentationDragIndicator(.visible)
                .presentationBackgroundInteraction(panel.destination != nil ? .enabled(upThrough: .medium) : .automatic)
            }
        }
        .alert("Arrival status", isPresented: $showingArrivalStatus) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(arrivalStatusMessage)
        }
        .onChange(of: panel) { _, _ in viewport = viewport.padding(focusPadding) }
        .onChange(of: expandedPanel) { _, selection in
            if selection != .search {
                stationSearchFocused = false
            }
        }
        .onChange(of: activeDestination?.id) { _, id in
            if id == nil {
                placeRoute = nil
            }
        }
        .onChange(of: sheetDetent) { _, _ in viewport = viewport.padding(focusPadding) }
        .onChange(of: windowSize) { _, _ in viewport = viewport.padding(focusPadding) }
        .onChange(of: typeSize, initial: true) { _, _ in
            if typeSize.isAccessibilitySize {
                sheetDetent = .large
            }
            viewport = viewport.padding(focusPadding)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                placeRoute = nil
                location.stop(); store.stop()
            }
            if phase == .background {
                focus.cancelPending()
            }
        }
        .onChange(of: location.availableCoordinate != nil) { _, available in
            if available, focus.receiveLocation(location.availableCoordinate) {
                applyFocus()
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { location.stop(); store.stop(); return }
            location.start()
            await store.run()
        }
    }

    @ViewBuilder private func map(statusWidth: CGFloat, coveredWidth: CGFloat, coveredBottom: CGFloat, maximumGlanceHeight: CGFloat) -> some View {
        if hasToken || mapProvider == .apple {
            ZStack(alignment: .topLeading) {
                if mapProvider == .apple {
                    AppleTransitMap(store: store, mapExposed: panel == nil || sheetDetent != .large, focusedCoordinate: focus.coordinate, focusRevision: focus.revision,
                                    coveredWidth: coveredWidth, coveredBottom: coveredBottom, currentLocation: location.availableCoordinate,
                                    tripOverlays: tripOverlays, tripFocusRevision: tripFocusRevision,
                                    destination: activeDestination, placeRoute: visiblePlaceRoute, placeGeometryRevision: placeGeometryRevision)
                } else {
                    TimelineView(.periodic(from: .now, by: 5)) { timeline in
                        Map(viewport: $viewport) {
                            ForEvery(store.lines, id: \.routeId) { line in
                                PolylineAnnotation(lineCoordinates: line.coordinates)
                                    .lineColor(StyleColor(transitColor(line.color)))
                                    .lineWidth(3)
                            }
                            ForEvery(tripOverlays) { overlay in
                                PolylineAnnotation(lineCoordinates: overlay.coordinates)
                                    .lineColor(.white)
                                    .lineWidth(10)
                                PolylineAnnotation(lineCoordinates: overlay.coordinates)
                                    .lineColor(StyleColor(transitColor(overlay.color)))
                                    .lineWidth(overlay.walking ? 4 : 6)
                            }
                            if let place = activeDestination {
                                PointAnnotation(coordinate: place.coordinate)
                                    .textField(place.name)
                                    .textHaloColor(.white)
                                    .textHaloWidth(2)
                            }
                            let projected = TrainMapProjection.markers(snapshot: store.snapshot, lines: store.lines,
                                                                       now: timeline.date, feedUnavailable: store.feedError)
                            CircleAnnotationGroup(projected.filter { $0.bearingDegrees == nil }) { marker in
                                CircleAnnotation(centerCoordinate: marker.coordinate)
                                    .circleColor(StyleColor(transitColor(marker.color)))
                                    .circleRadius(12 * markerScale)
                                    .circleStrokeWidth(1.5)
                                    .circleStrokeColor(.white)
                                    .circleOpacity(marker.opacity)
                            }
                            PointAnnotationGroup(projected.filter { $0.bearingDegrees != nil }) { marker in
                                PointAnnotation(coordinate: marker.coordinate)
                                    .image(.init(image: TrainSpriteCache.shared.image(routeID: marker.routeID, color: marker.color),
                                                 name: "car-\(marker.routeID)-\(marker.color)"))
                                    .iconRotate((marker.bearingDegrees ?? 90) - 90)
                                    .iconSize(markerScale)
                                    .iconOpacity(marker.opacity)
                            }
                            .iconRotationAlignment(.map)
                            .iconAllowOverlap(true)
                            PointAnnotationGroup(projected) { marker in
                                PointAnnotation(coordinate: marker.coordinate)
                                    .textField(RouteBadge.displayID(marker.displayLetter))
                                    .textColor(StyleColor(marker.textColor == "black" ? UIColor.black : UIColor.white))
                                    .textSize(max(9, 12 * markerScale))
                                    .textOpacity(marker.opacity * (differentiateWithoutColor ? 1 : TrainMarkerSizing.labelOpacity(zoom: mapZoom)))
                            }
                            .textRotationAlignment(.viewport)
                            .textAllowOverlap(true)
                            if let coordinate = location.availableCoordinate {
                                CircleAnnotation(centerCoordinate: coordinate)
                                    .circleRadius(6)
                                    .circleColor(StyleColor(UIColor.systemBlue))
                                    .circleStrokeWidth(3)
                                    .circleStrokeColor(.white)
                            }
                        }
                        .mapStyle(colorScheme == .dark ? .dark : .light)
                        .ornamentOptions(ornaments(coveredWidth: coveredWidth))
                        .onCameraChanged { event in
                            let quantized = (event.cameraState.zoom * 4).rounded() / 4
                            if mapZoom != quantized {
                                mapZoom = quantized
                            }
                        }
                        .onMapLoaded { _ in mapLoaded = true; mapError = false }
                        .onMapLoadingError { _ in mapError = true }
                        .accessibilityLabel("Subway map. Use Search or Nearby for accessible station arrivals.")
                        .accessibilityIdentifier("mapboxTransitMap")
                        .accessibilityValue(location.availableCoordinate == nil ? "Location unavailable" : "Your approximate location is shown")
                        .ignoresSafeArea(edges: .top)
                        .id(mapID)
                    }
                }
                if activeDestination == nil, panel == nil || coveredWidth > 0 {
                    TimelineView(.periodic(from: .now, by: 5)) { timeline in
                        NearbyGlancePanel(store: store, location: location, now: timeline.date,
                                          maximumHeight: maximumGlanceHeight,
                                          mapUnavailable: mapError && mapProvider == .mapbox,
                                          retryMap: { mapError = false; mapLoaded = false; mapID = UUID() },
                                          openStation: { showGlanceStation($0, expanded: coveredWidth > 0) },
                                          openNearby: {
                                              showNearby(expanded: coveredWidth > 0)
                                          })
                                          .frame(maxWidth: min(typeSize.isAccessibilitySize ? 260 : 220, max(0, statusWidth - 32)))
                                          .padding()
                                          .frame(maxWidth: statusWidth, alignment: .leading)
                    }
                }
            }
        } else {
            ContentUnavailableView {
                Label("Mapbox unavailable", systemImage: "map")
            } description: {
                Text("You can view subway lines, trains and stations with Apple Maps.")
            } actions: {
                Button("Use Apple Maps") { mapProvider = .apple }
            }
            .frame(width: statusWidth)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("mapboxConfigurationUnavailable")
        }
    }

    private var moreMenu: some View {
        Menu("More", systemImage: "ellipsis") {
            Button("Directions", systemImage: "arrow.triangle.turn.up.right.diamond") {
                focus.cancelPending()
                if windowSize.width >= 640, !typeSize.isAccessibilitySize {
                    expandedPanel = .directions
                } else {
                    sheetDetent = .large
                    panel = .directions
                }
            }
            .accessibilityIdentifier("directionsButton")
            Picker("Map provider", selection: $mapProvider) {
                ForEach(MapProvider.allCases) { provider in Text(provider.rawValue).tag(provider) }
            }
            .pickerStyle(.inline)
            .accessibilityIdentifier("mapProviderPicker")
            Button("Arrival status", systemImage: "info.circle", action: showArrivalStatus)
                .accessibilityIdentifier("arrivalStatusButton")
            Button("Refresh arrivals", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
            Link("Open web app", destination: URL(string: "https://standclear.vercel.app")!)
        }
        .accessibilityIdentifier("moreButton")
    }

    private func showArrivalStatus() {
        // Capture on explicit request: changing feed data must not rebuild an
        // open native menu or imply that this alert updates continuously.
        let now = Date()
        var lines = ["Status when opened: \(store.feedLabel(at: now))"]
        if let snapshot = store.snapshot, snapshot.isFresh(at: now) {
            lines.append("Feed updated \(Date(timeIntervalSince1970: snapshot.generatedAt / 1000).formatted(date: .omitted, time: .standard)).")
        }
        lines.append("Predictions are estimates. A dash means no prediction within 45 minutes, not no service.")
        arrivalStatusMessage = lines.joined(separator: "\n\n")
        showingArrivalStatus = true
    }

    private func ornaments(coveredWidth: CGFloat) -> OrnamentOptions {
        // Preserve the SDK's attribution/compass controls beside the trailing region.
        var options = OrnamentOptions()
        options.attributionButton.margins.x += coveredWidth
        options.compass.margins.x += coveredWidth
        return options
    }

    private var markerScale: Double {
        let scale = TrainMarkerSizing.scale(zoom: mapZoom)
        return differentiateWithoutColor ? max(0.85, scale) : scale
    }

    private func showNearby(expanded: Bool) {
        selectedTrip = nil
        sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
        if expanded {
            expandedPanel = .nearby
        } else {
            panel = .nearby
        }
        if focus.requestNearby(location.availableCoordinate) {
            applyFocus()
        }
        location.start()
    }

    private func showGlanceStation(_ id: String, expanded: Bool) {
        let destination = Panel.station(id)
        if expanded {
            // A repeated tap can also return from this station’s pushed Directions view.
            if expandedPanel == destination {
                stationVisit += 1
            }
            expandedPanel = destination
        } else {
            sheetDetent = .large
            panel = destination
        }
        focus.cancelPending()
        selectedTrip = nil
        if let station = store.stations.first(where: { $0.id == id }) {
            focusStation(station)
        }
    }

    private var mediumSheetCoversMap: Bool {
        panel != nil && panel != .search && sheetDetent == .medium
    }

    private var focusPadding: SwiftUI.EdgeInsets {
        let expanded = windowSize.width >= 640 && !typeSize.isAccessibilitySize
        let right = expanded ? min(windowSize.width * 0.4, 380) : 0
        let bottom = !expanded && mediumSheetCoversMap ? windowSize.height / 2 : 0
        return SwiftUI.EdgeInsets(top: 0, leading: 0, bottom: bottom, trailing: right)
    }

    private func applyFocus() {
        guard let coordinate = focus.coordinate else { return }
        viewport = .camera(center: coordinate, zoom: 14).padding(focusPadding)
    }

    private var isWide: Bool {
        windowSize.width >= 640 && !typeSize.isAccessibilitySize
    }

    private var activeDestination: PlaceResult? {
        (isWide ? expandedPanel : panel)?.destination
    }

    private var visiblePlaceRoute: PlaceMapRoute? {
        guard scenePhase == .active, let placeRoute, placeRoute.place.id == activeDestination?.id,
              !placeSession.usesCurrentLocation || location.availableCoordinate != nil else { return nil }
        return placeRoute
    }

    private var tripOverlays: [TripMapOverlay] {
        let route = visiblePlaceRoute
        return TripMapOverlay.make(plan: route?.plan ?? selectedTrip, lines: store.lines) + (route?.walkingOverlays ?? [])
    }

    private func openPlace(_ place: PlaceResult, expanded: Bool) {
        focus.cancelPending()
        stationSearchFocused = false
        selectedTrip = nil
        placeRoute = nil
        detentBeforeOriginPicker = nil
        placeSession = PlacePreviewSession()
        if expanded {
            expandedPanel = .place(place)
        } else {
            panel = .place(place)
            sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
        }
        tripFocusRevision += 1
        viewport = .camera(center: place.coordinate, zoom: 13).padding(focusPadding)
    }

    private func updatePlaceMap(_ route: PlaceMapRoute?, destination: PlaceResult) {
        guard activeDestination?.id == destination.id else { return }
        let selectionChanged = placeRoute?.optionID != route?.optionID
        placeRoute = route
        placeGeometryRevision += 1
        // Walking responses for other choices must not pull a rider back after a pan.
        guard selectionChanged else { return }
        tripFocusRevision += 1
        let points = tripOverlays.flatMap(\.coordinates) + (route?.endpoints ?? [destination.coordinate])
        if points.count > 1 {
            viewport = .overview(geometry: LineString(points), geometryPadding: .init(top: 24, leading: 24, bottom: 24, trailing: 24), maxZoom: 14)
                .padding(focusPadding)
        }
    }

    @ViewBuilder private func panelContent(_ mode: Panel, expanded: Bool = false) -> some View {
        switch mode {
        case let .place(place):
            PlacePreview(place: place, store: store, location: location, session: placeSession,
                         onMapChange: { updatePlaceMap($0, destination: place) },
                         onEditingOriginChanged: { editing in
                             guard !expanded, panel?.destination?.id == place.id else { return }
                             if editing {
                                 detentBeforeOriginPicker = sheetDetent
                                 sheetDetent = .large
                             } else if let previous = detentBeforeOriginPicker {
                                 sheetDetent = typeSize.isAccessibilitySize ? .large : previous
                                 detentBeforeOriginPicker = nil
                             }
                         })
                         .toolbar {
                             ToolbarItem(placement: .navigation) {
                                 Button("Back to Search", systemImage: "chevron.backward") {
                                     if expanded {
                                         expandedPanel = .search
                                     } else {
                                         panel = .search
                                     }
                                 }
                                 .accessibilityIdentifier("placeBackToSearch")
                             }
                         }
        case let .station(id):
            if let station = store.stations.first(where: { $0.id == id }) {
                StationArrivals(station: station, store: store, favoriteStations: favoriteStations, directionsSelection: $directionsSelection,
                                onDirectionsHere: beginDirections, onSelectTrip: selectTrip, onShowTripMap: showTripOnMap)
            } else {
                ContentUnavailableView("Station unavailable", systemImage: "tram",
                                       description: Text("This station is no longer in the subway data."))
            }
        case .directions:
            DirectionsView(store: store, selection: $directionsSelection, onSelect: selectTrip, onShowMap: showTripOnMap)
        case .nearby, .search:
            stationBrowser(search: mode == .search, expanded: expanded)
        }
    }

    private var clearRouteButton: some View {
        Button("Clear route", systemImage: "xmark") {
            if activeDestination != nil {
                placeRoute = nil
                if isWide {
                    expandedPanel = .nearby
                } else {
                    panel = nil
                }
            } else {
                selectTrip(nil)
            }
        }
        .accessibilityIdentifier("clearMapRoute")
        .accessibilityHint(activeDestination == nil ? "Remove the highlighted route. Your From and To stations are kept." : "Close directions to this place and clear its route.")
    }

    private func showTripOnMap(_ plan: NativeTripPlan) {
        panel = nil
        selectTrip(plan)
    }

    private func beginDirections(to station: Station) {
        directionsSelection.setDestination(station.id)
        directionsSelection.suggestOrigin(stations: store.stations, coordinate: location.availableCoordinate)
        selectTrip(nil)
        sheetDetent = .large
    }

    private func selectTrip(_ plan: NativeTripPlan?) {
        focus.cancelPending()
        selectedTrip = plan
        guard plan != nil else { return }
        tripFocusRevision += 1
        let coordinates = tripOverlays.flatMap(\.coordinates)
        if coordinates.count >= 2 {
            viewport = .overview(geometry: LineString(coordinates),
                                 geometryPadding: SwiftUI.EdgeInsets(top: 32, leading: 32, bottom: 32, trailing: 32),
                                 maxZoom: 14).padding(focusPadding)
        }
    }

    private func stationBrowser(search: Bool, expanded: Bool) -> some View {
        StationBrowser(store: store, location: location, search: search, recentStations: recentStations, favoriteStations: favoriteStations, openPlace: { openPlace($0, expanded: expanded) }, query: $searchQuery, searchFocus: $stationSearchFocused,
                       directionsSelection: $directionsSelection, onDirectionsHere: beginDirections,
                       onSelectTrip: selectTrip, onShowTripMap: showTripOnMap, select: focusStation)
    }

    private func focusStation(_ station: Station) {
        stationSearchFocused = false
        selectedTrip = nil
        if focus.focus(on: station.stop.coordinate) {
            applyFocus()
        }
    }
}

func transitColor(_ hex: String) -> UIColor {
    let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x808080
    return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}
