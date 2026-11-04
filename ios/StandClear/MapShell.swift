import CoreLocation
import SwiftUI

struct MapShell: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var store = TransitStore()
    @State private var location = LocationStore()
    @State private var linePath: [LineDestination] = []
    @State private var searchPath: [StationBrowserDestination] = []
    @State private var nearbyPath: [StationBrowserDestination] = []
    @State private var expandedNearbyRequested = false
    @State private var panel: Panel?
    @State private var sheetDetent: PresentationDetent = .medium
    @State private var windowSize: CGSize = .zero
    @State private var expandedPanel: Panel = .nearby
    @State private var stationVisit = 0
    @State private var directionsSelection = DirectionsSelection()
    @State private var placeSession = PlacePreviewSession()
    @State private var placeRoute: PlaceMapRoute?
    @State private var publishedOrigin: PlacePreviewSession.Origin?
    @State private var framedPlaceChoice: PlaceChoice?

    private struct PlaceChoice: Equatable {
        let optionID: String
        let origin: PlacePreviewSession.Origin
    }

    @State private var placeGeometryRevision = 0
    @State private var detentBeforeOriginPicker: PresentationDetent?
    @State private var editingPlaceID: String?
    @State private var selectedTrip: NativeTripPlan?
    @State private var tripFocusRevision = 0
    @State private var searchQuery = ""
    @State private var savedPlaces = SavedPlaces()
    @State private var recentPlaces = RecentPlaces()
    @State private var recentStations = RecentStations()
    @State private var placeSearchMemory = PlaceSearchMemory()
    @State private var favoriteStations = FavoriteStations()
    @FocusState private var stationSearchFocused: Bool
    @State private var arrivalStatusMessage = ""
    @State private var showingArrivalStatus = false
    @State private var focus = MapFocusState()
    enum Panel: Hashable, Identifiable {
        case search, nearby, directions, lines
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
                            panelNavigation(expandedPanel, expanded: true)
                                .id(expandedPanel)
                                .id(stationVisit)
                            if selectedTrip != nil {
                                clearRouteButton
                                    .buttonStyle(.bordered)
                                    .padding(.horizontal)
                            }
                            ControlGroup {
                                Button("Search", systemImage: "magnifyingglass") { showSearch(expanded: true) }
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
                                    Button("Search", systemImage: "magnifyingglass") { showSearch(expanded: false) }
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
                    expandedNearbyRequested = activePanel == .nearby
                    expandedPanel = activePanel
                    panel = nil
                } else if !isExpanded, expandedPanel == .search {
                    sheetDetent = .large
                    panel = .search
                    expandedPanel = .nearby
                } else if !isExpanded, expandedPanel == .nearby,
                          expandedNearbyRequested || !nearbyPath.isEmpty
                {
                    sheetDetent = typeSize.isAccessibilitySize || !nearbyPath.isEmpty ? .large : .medium
                    panel = .nearby
                    expandedNearbyRequested = false
                } else if !isExpanded, expandedPanel.destination != nil {
                    sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
                    panel = expandedPanel
                    expandedPanel = .nearby
                } else if !isExpanded, expandedPanel == .lines {
                    sheetDetent = .large
                    panel = .lines
                    expandedPanel = .nearby
                } else if !isExpanded, case .station = expandedPanel {
                    sheetDetent = .large
                    panel = expandedPanel
                    expandedPanel = .nearby
                }
            }
            .onChange(of: panel) { previous, selection in
                // Done and interactive dismissal end a browser visit. Moving
                // its sheet into the expanded pane preserves the same path.
                if selection == nil, !expanded {
                    if previous == .search {
                        searchPath = []
                    }
                    if previous == .nearby {
                        nearbyPath = []
                    }
                }
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
                panelNavigation(panel, expanded: false)
                    // Search starts with room for its keyboard instead of promoting a medium sheet during focus.
                    .presentationDetents(panel == .search || typeSize.isAccessibilitySize ? [.large] : [.medium, .large], selection: $sheetDetent)
                    .presentationDragIndicator(.visible)
                    // A place card and the exposed map form one interactive view, including between detents.
                    .presentationBackgroundInteraction(panel.destination != nil ? .enabled : .automatic)
            }
        }
        .alert("Arrival status", isPresented: $showingArrivalStatus) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(arrivalStatusMessage)
        }
        .onChange(of: expandedPanel) { _, selection in
            if selection != .nearby {
                expandedNearbyRequested = false
            }
            if selection != .search {
                stationSearchFocused = false
            }
        }
        .onChange(of: activeDestination?.id) { _, id in
            editingPlaceID = nil
            if id == nil {
                placeRoute = nil
            }
        }
        .onChange(of: typeSize, initial: true) { _, _ in
            if typeSize.isAccessibilitySize {
                sheetDetent = .large
            }
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
            if available {
                focus.receiveLocation(location.availableCoordinate)
            }
        }
        .task(id: placeRenewalFix) { [timestamp = placeRenewalFix] in
            guard let timestamp else { return }
            await location.renewForPlace(timestamp) { placeRenewalFix == timestamp }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { location.stop(); store.stop(); return }
            location.start()
            await store.run()
        }
    }

    private func map(statusWidth: CGFloat, coveredWidth: CGFloat, coveredBottom: CGFloat, maximumGlanceHeight: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            AppleTransitMap(store: store, mapExposed: panel == nil || sheetDetent != .large, focusedCoordinate: focus.coordinate, focusRevision: focus.revision,
                            coveredWidth: coveredWidth, coveredBottom: coveredBottom, currentLocation: location.availableCoordinate,
                            tripOverlays: tripOverlays, tripFocusRevision: tripFocusRevision,
                            destination: activeDestination, placeRoute: visiblePlaceRoute, placeGeometryRevision: placeGeometryRevision, transferMarker: transferMarker)
            if !showsJourney, panel == nil || coveredWidth > 0 {
                TimelineView(.periodic(from: .now, by: 5)) { timeline in
                    NearbyGlancePanel(store: store, location: location, now: timeline.date,
                                      maximumHeight: maximumGlanceHeight,
                                      openStation: { showGlanceStation($0, expanded: coveredWidth > 0) },
                                      openNearby: { showNearby(expanded: coveredWidth > 0) })
                        .frame(maxWidth: min(typeSize.isAccessibilitySize ? 260 : 220, max(0, statusWidth - 32)))
                        .padding()
                        .frame(maxWidth: statusWidth, alignment: .leading)
                }
            }
        }
    }

    private var moreMenu: some View {
        Menu("More", systemImage: "ellipsis") {
            Button("Lines", systemImage: "tram") {
                focus.cancelPending()
                if windowSize.width >= 640, !typeSize.isAccessibilitySize {
                    expandedPanel = .lines
                } else {
                    sheetDetent = .large
                    panel = .lines
                }
            }
            .accessibilityIdentifier("linesButton")
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

    private func showSearch(expanded: Bool) {
        focus.cancelPending()
        if expanded {
            expandedPanel = .search
        } else {
            searchPath = []
            panel = .search
        }
    }

    private func showNearby(expanded: Bool) {
        selectedTrip = nil
        sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
        if expanded {
            expandedNearbyRequested = true
            expandedPanel = .nearby
        } else {
            nearbyPath = []
            panel = .nearby
        }
        focus.requestNearby(location.availableCoordinate)
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

    private var isWide: Bool {
        windowSize.width >= 640 && !typeSize.isAccessibilitySize
    }

    private var activeDestination: PlaceResult? {
        (isWide ? expandedPanel : panel)?.destination
    }

    private var placeRenewalFix: Date? {
        guard scenePhase == .active, activeDestination != nil, placeSession.usesCurrentLocation, editingPlaceID != activeDestination?.id else { return nil }
        return location.usableFixTimestamp
    }

    private var visiblePlaceRoute: PlaceMapRoute? {
        guard scenePhase == .active, let placeRoute, placeRoute.place.id == activeDestination?.id,
              publishedOrigin == placeSession.origin else { return nil }
        if placeSession.usesCurrentLocation {
            guard let fix = location.availableCoordinate, let start = placeRoute.start,
                  fix.latitude == start.latitude, fix.longitude == start.longitude else { return nil }
        }
        return placeRoute
    }

    private var showsJourney: Bool {
        activeDestination != nil || selectedTrip != nil
    }

    private var transferMarker: (text: String, coordinate: CLLocationCoordinate2D)? {
        guard let plan = visiblePlaceRoute?.plan ?? selectedTrip, let transfer = plan.transfer(in: store.lines),
              let departing = plan.legs.last else { return nil }
        return (transfer.instruction(to: departing), transfer.outgoing.coordinate)
    }

    private var tripOverlays: [TripMapOverlay] {
        let route = visiblePlaceRoute
        return TripMapOverlay.make(plan: route?.plan ?? selectedTrip, lines: store.lines) + (route?.walkingOverlays ?? [])
    }

    private func openPlace(_ place: PlaceResult, expanded: Bool) {
        recentPlaces.record(place)
        focus.cancelPending()
        stationSearchFocused = false
        selectedTrip = nil
        placeRoute = nil
        detentBeforeOriginPicker = nil
        framedPlaceChoice = nil
        placeSession = PlacePreviewSession()
        if expanded {
            expandedPanel = .place(place)
        } else {
            panel = .place(place)
            sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
        }
        tripFocusRevision += 1
    }

    private func updatePlaceMap(_ route: PlaceMapRoute?, destination: PlaceResult) {
        guard activeDestination?.id == destination.id else { return }
        placeRoute = route
        publishedOrigin = route == nil ? nil : placeSession.origin
        placeGeometryRevision += 1
        // A renewed location or walking reply invalidates geometry, but is not
        // a request to undo a pan when the same itinerary remains selected.
        guard let route else { return }
        let choice = PlaceChoice(optionID: route.optionID, origin: placeSession.origin)
        guard choice != framedPlaceChoice else { return }
        framedPlaceChoice = choice
        tripFocusRevision += 1
    }

    @ViewBuilder private func panelNavigation(_ mode: Panel, expanded: Bool) -> some View {
        if mode == .lines {
            NavigationStack(path: $linePath) { panelRoot(mode, expanded: expanded) }
        } else if mode == .search {
            NavigationStack(path: $searchPath) { panelRoot(mode, expanded: expanded) }
        } else if mode == .nearby {
            NavigationStack(path: $nearbyPath) { panelRoot(mode, expanded: expanded) }
        } else {
            NavigationStack { panelRoot(mode, expanded: expanded) }
        }
    }

    @ViewBuilder private func panelRoot(_ mode: Panel, expanded: Bool) -> some View {
        if expanded {
            panelContent(mode, expanded: true).containerBackground(.clear, for: .navigation)
        } else {
            panelContent(mode).toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { panel = nil } }
            }
        }
    }

    @ViewBuilder private func panelContent(_ mode: Panel, expanded: Bool = false) -> some View {
        switch mode {
        case let .place(place):
            PlacePreview(place: place, store: store, location: location, session: placeSession,
                         onMapChange: { updatePlaceMap($0, destination: place) },
                         onEditingOriginChanged: { editing in
                             guard activeDestination?.id == place.id else { return }
                             editingPlaceID = editing ? place.id : nil
                             guard !expanded else { return }
                             if editing {
                                 detentBeforeOriginPicker = sheetDetent
                                 sheetDetent = .large
                             } else if let previous = detentBeforeOriginPicker {
                                 sheetDetent = typeSize.isAccessibilitySize ? .large : previous
                                 detentBeforeOriginPicker = nil
                             }
                         })
                         .toolbar {
                             if expanded {
                                 ToolbarItem(placement: .confirmationAction) { clearRouteButton }
                             }
                             ToolbarItem(placement: .navigation) {
                                 Button("Back to Search", systemImage: "chevron.backward") {
                                     showSearch(expanded: expanded)
                                 }
                                 .accessibilityIdentifier("placeBackToSearch")
                             }
                         }
        case let .station(id):
            if let station = store.stations.first(where: { $0.id == id }) {
                StationArrivals(station: station, store: store, favoriteStations: favoriteStations, savedPlaces: savedPlaces, directionsSelection: $directionsSelection,
                                onDirectionsHere: beginDirections, onSelectTrip: selectTrip, onShowTripMap: showTripOnMap)
            } else {
                ContentUnavailableView("Station unavailable", systemImage: "tram",
                                       description: Text("This station is no longer in the subway data."))
            }
        case .lines:
            LineBrowser(store: store, stationDetail: { station in
                StationArrivals(station: station, store: store, favoriteStations: favoriteStations, savedPlaces: savedPlaces,
                                directionsSelection: $directionsSelection, onDirectionsHere: beginDirections,
                                onSelectTrip: selectTrip, onShowTripMap: showTripOnMap)
            }, select: focusStation)
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
    }

    private func stationBrowser(search: Bool, expanded: Bool) -> some View {
        StationBrowser(store: store, location: location, search: search, placeSearchMemory: placeSearchMemory, savedPlaces: savedPlaces, recentStations: recentStations, recentPlaces: recentPlaces, favoriteStations: favoriteStations, openPlace: { openPlace($0, expanded: expanded) }, query: $searchQuery, searchFocus: $stationSearchFocused,
                       directionsSelection: $directionsSelection, onDirectionsHere: beginDirections,
                       onSelectTrip: selectTrip, onShowTripMap: showTripOnMap, select: focusStation,
                       path: search ? $searchPath : $nearbyPath,
                       dismissPanel: expanded ? nil : { panel = nil })
    }

    private func focusStation(_ station: Station) {
        stationSearchFocused = false
        selectedTrip = nil
        focus.focus(on: station.stop.coordinate)
    }
}

func transitColor(_ hex: String) -> UIColor {
    let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x808080
    return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}
