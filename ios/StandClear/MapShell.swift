import CoreLocation
import SwiftUI

struct MapShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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
    @State private var routePanelCollapsed = false
    @State private var stationRouteVisit: StationRouteVisit?
    @State private var stationDirectionsVisible = false
    @State private var stationStepsVisible = false
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
    @State private var systemAlerts = StationAlertsLoad()
    @State private var focus = MapFocusState()
    enum Panel: Hashable, Identifiable {
        case search, nearby, directions, lines, alerts
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

    private enum StationRouteVisit: Equatable {
        case search([StationBrowserDestination])
        case nearby([StationBrowserDestination])
        case lines([LineDestination])
        case panel(Panel)
    }

    private var currentStationVisit: StationRouteVisit? {
        guard let mode = isWide ? expandedPanel : panel else { return nil }
        switch mode {
        case .search: return .search(searchPath)
        case .nearby: return .nearby(nearbyPath)
        case .lines: return .lines(linePath)
        default: return .panel(mode)
        }
    }

    var body: some View {
        GeometryReader { geometry in
            // Window geometry, not a device identifier, selects the control region.
            let expanded = geometry.size.width >= 640 && !typeSize.isAccessibilitySize
            let controlWidth = min(geometry.size.width * 0.4, 380)
            NavigationStack {
                GeometryReader { mapGeometry in
                    map(statusWidth: mapGeometry.size.width, coveredWidth: 0,
                        coveredBottom: expanded ? 0 : routePanelIsCollapsed ? collapsedRouteHeight + geometry.safeAreaInsets.bottom : mediumSheetCoversMap ? geometry.size.height / 2 : 0,
                        maximumGlanceHeight: mapGeometry.size.height * 0.55)
                }
                .navigationTitle("StandClear")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(expanded ? .hidden : .automatic, for: .navigationBar)
                .toolbar {
                    if !expanded {
                        ToolbarItem(placement: .topBarTrailing) {
                            if selectedTrip != nil, !routePanelIsCollapsed {
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
            // Keep this presenter mounted while its column closes. Removing a
            // permanently-presented inspector also removes its dismissal owner.
            .environment(\.horizontalSizeClass, horizontalSizeClass)
            .inspector(isPresented: Binding(get: { expanded }, set: { _ in })) {
                panelNavigation(expandedPanel, expanded: true)
                    .interactiveDismissDisabled()
                    .environment(\.expandedTransitPanel, true)
                    .environment(\.expandedTransitToolbar, expandedToolbar)
                    .environment(\.horizontalSizeClass, horizontalSizeClass)
                    .id(expandedPanel)
                    .id(stationVisit)
                    .inspectorColumnWidth(controlWidth)
            }
            // Scope column presentation to its host; map and inspector content
            // retain the actual system trait. Compact sheets remain separate.
            .environment(\.horizontalSizeClass, .regular)
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
                    sheetDetent = routePanelCollapsed ? .custom(CollapsedRouteDetent.self) : typeSize.isAccessibilitySize ? .large : .medium
                    panel = expandedPanel
                    expandedPanel = .nearby
                } else if !isExpanded, expandedPanel == .directions {
                    sheetDetent = .large
                    panel = .directions
                    expandedPanel = .nearby
                } else if !isExpanded, expandedPanel == .lines || expandedPanel == .alerts {
                    sheetDetent = .large
                    panel = expandedPanel
                    expandedPanel = .nearby
                } else if !isExpanded, case .station = expandedPanel {
                    sheetDetent = .large
                    panel = expandedPanel
                    expandedPanel = .nearby
                }
                if !isExpanded, routePanelCollapsed, selectedTrip != nil, currentStationVisit == stationRouteVisit {
                    sheetDetent = .custom(CollapsedRouteDetent.self)
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
                if routePanelCollapsed, routeCanCollapse {
                    sheetDetent = .custom(CollapsedRouteDetent.self)
                } else if selection == .search || typeSize.isAccessibilitySize {
                    sheetDetent = .large
                }
                if selection == .search || selection == .directions || (selection == nil && !expanded) {
                    focus.cancelPending()
                }
            }
            .sheet(item: $panel) { panel in
                panelNavigation(panel, expanded: false)
                    .environment(\.horizontalSizeClass, horizontalSizeClass)
                    // Keep the navigation tree and its route tasks alive at the
                    // small detent. Removing PlacePreview would clear its route.
                    .opacity(routePanelIsCollapsed ? 0 : 1)
                    .accessibilityHidden(routePanelIsCollapsed)
                    .allowsHitTesting(!routePanelIsCollapsed)
                    .overlay(alignment: .top) {
                        if routePanelIsCollapsed {
                            collapsedRouteControls
                        }
                    }
                    // Search starts with room for its keyboard instead of promoting a medium sheet during focus.
                    .presentationDetents(routeCanCollapse ? [.custom(CollapsedRouteDetent.self), .medium, .large] : panel == .search || typeSize.isAccessibilitySize ? [.large] : [.medium, .large], selection: $sheetDetent)
                    .presentationDragIndicator(.visible)
                    .interactiveDismissDisabled(routeCanCollapse)
                    // A place card and the exposed map form one interactive view, including between detents.
                    .presentationBackgroundInteraction(routeCanCollapse ? .enabled : .automatic)
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
        .onChange(of: activeDestination) { _, destination in
            editingPlaceID = nil
            if destination == nil {
                placeRoute = nil
            }
        }
        .onChange(of: typeSize, initial: true) { _, _ in
            if routePanelCollapsed, routeCanCollapse {
                sheetDetent = .custom(CollapsedRouteDetent.self)
            } else if typeSize.isAccessibilitySize {
                sheetDetent = .large
            }
        }
        .onChange(of: sheetDetent) { _, detent in
            if routeCanCollapse {
                routePanelCollapsed = detent == .custom(CollapsedRouteDetent.self)
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
                            destination: activeDestination, placeRoute: visiblePlaceRoute,
                            stationEndpoints: activeDestination == nil ? selectedTrip.map { StationTripEndpoints(plan: $0, lines: store.lines) } : nil,
                            placeGeometryRevision: placeGeometryRevision, transferMarker: transferMarker)
            if !showsJourney, panel == nil || isWide {
                NearbyGlancePanel(store: store, location: location,
                                  maximumHeight: maximumGlanceHeight,
                                  openStation: { showGlanceStation($0, expanded: isWide) },
                                  openNearby: { showNearby(expanded: isWide) })
                    .frame(maxWidth: min(typeSize.isAccessibilitySize ? 260 : 220, max(0, statusWidth - 32)))
                    .padding()
                    .frame(maxWidth: statusWidth, alignment: .leading)
            }
        }
    }

    private var moreMenu: some View {
        Menu("More", systemImage: "ellipsis") {
            Button("Service alerts", systemImage: "exclamationmark.triangle") {
                // Reopening the selected pane preserves its active visit and
                // report; assigning the same panel does not restart its task.
                guard !isWide || expandedPanel != .alerts else { return }
                focus.cancelPending()
                systemAlerts = StationAlertsLoad()
                if windowSize.width >= 640, !typeSize.isAccessibilitySize {
                    expandedPanel = .alerts
                } else {
                    sheetDetent = .large
                    panel = .alerts
                }
            }
            .accessibilityIdentifier("serviceAlertsButton")
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

    private var collapsedRouteHeight: CGFloat {
        typeSize.isAccessibilitySize ? 180 : 96
    }

    private var routeCanCollapse: Bool {
        let mode = isWide ? expandedPanel : panel
        return mode?.destination != nil || (selectedTrip != nil && stationRouteVisit != nil && currentStationVisit == stationRouteVisit)
    }

    private var routePanelIsCollapsed: Bool {
        !isWide && routeCanCollapse && sheetDetent == .custom(CollapsedRouteDetent.self)
    }

    private var collapsedRouteControls: some View {
        HStack {
            Button {
                sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
            } label: {
                ViewThatFits(in: .horizontal) {
                    Text("Directions").fixedSize(horizontal: true, vertical: false)
                    Text("Steps").fixedSize(horizontal: true, vertical: false)
                }
                .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .accessibilityLabel(activeDestination.map { "Show directions to \($0.name)" } ?? "Show directions")
            .accessibilityHint("Restore the route steps. You can also drag the panel up.")
            .accessibilityIdentifier("restoreRoutePanel")
            clearRouteButton.labelStyle(.iconOnly).fixedSize(horizontal: true, vertical: false).frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .padding(.horizontal)
        .padding(.top, 20)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("collapsedRouteControls")
    }

    private func collapseRoutePanel() {
        stationSearchFocused = false
        sheetDetent = .custom(CollapsedRouteDetent.self)
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
        guard scenePhase == .active, let placeRoute, placeRoute.place == activeDestination,
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
        routePanelCollapsed = false
        if expanded {
            expandedPanel = .place(place)
        } else {
            panel = .place(place)
            sheetDetent = typeSize.isAccessibilitySize ? .large : .medium
        }
        tripFocusRevision += 1
    }

    private func replacePlace(_ destination: PlaceResult, replacing previous: PlaceResult, expanded: Bool) {
        guard activeDestination == previous, destination != previous else { return }
        recentPlaces.record(destination)
        focus.cancelPending()
        selectedTrip = nil
        placeRoute = nil
        publishedOrigin = nil
        framedPlaceChoice = nil
        placeSession.selectedOptionID = nil
        // Keep the existing session's rider-selected starting point. Opening a
        // place from Search remains a separate, new current-location trip.
        if expanded {
            expandedPanel = .place(destination)
        } else {
            panel = .place(destination)
        }
        placeGeometryRevision += 1
        tripFocusRevision += 1
    }

    private func updatePlaceMap(_ route: PlaceMapRoute?, destination: PlaceResult) {
        guard activeDestination == destination else { return }
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

    private var expandedToolbar: ExpandedTransitToolbar {
        ExpandedTransitToolbar(search: { showSearch(expanded: true) }, nearby: { showNearby(expanded: true) },
                               menu: AnyView(moreMenu), clearRoute: selectedTrip == nil ? nil : AnyView(clearRouteButton))
    }

    @ViewBuilder private func panelRoot(_ mode: Panel, expanded: Bool) -> some View {
        if expanded {
            panelContent(mode, expanded: true)
                .modifier(ExpandedTransitToolbarModifier())
        } else {
            panelContent(mode).toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        if routeCanCollapse {
                            clearRoute()
                        }
                        panel = nil
                    }
                }
                if routeCanCollapse {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Hide directions", systemImage: "arrow.down.right.and.arrow.up.left", action: collapseRoutePanel)
                            .labelStyle(.iconOnly)
                            .accessibilityHint("Show more of the map while keeping this route.")
                            .accessibilityIdentifier("collapseRoutePanel")
                    }
                }
            }
        }
    }

    @ViewBuilder private func panelContent(_ mode: Panel, expanded: Bool = false) -> some View {
        switch mode {
        case let .place(place):
            PlacePreview(place: place, store: store, location: location, session: placeSession,
                         onMapChange: { updatePlaceMap($0, destination: place) },
                         onEditingEndpointChanged: { editing in
                             guard activeDestination == place else { return }
                             editingPlaceID = editing ? place.id : nil
                             guard !expanded else { return }
                             if editing {
                                 detentBeforeOriginPicker = sheetDetent
                                 sheetDetent = .large
                             } else if let previous = detentBeforeOriginPicker {
                                 sheetDetent = typeSize.isAccessibilitySize ? .large : previous
                                 detentBeforeOriginPicker = nil
                             }
                         },
                         onDestinationChange: { replacePlace($0, replacing: place, expanded: expanded) })
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
                                onDirectionsHere: beginDirections, onSelectTrip: selectTrip, onShowTripMap: showTripOnMap, initialTrip: routeCanCollapse && stationStepsVisible ? selectedTrip : nil,
                                restoreDirections: routeCanCollapse && stationDirectionsVisible,
                                onDirectionsVisibilityChanged: { stationDirectionsVisible = $0 },
                                onItineraryVisibilityChanged: { stationStepsVisible = $0 })
            } else {
                ContentUnavailableView("Station unavailable", systemImage: "tram",
                                       description: Text("This station is no longer in the subway data."))
            }
        case .lines:
            LineBrowser<StationArrivals>(store: store, path: $linePath, stationDetail: { station in
                StationArrivals(station: station, store: store, favoriteStations: favoriteStations, savedPlaces: savedPlaces,
                                directionsSelection: $directionsSelection, onDirectionsHere: beginDirections,
                                onSelectTrip: selectTrip, onShowTripMap: showTripOnMap, initialTrip: routeCanCollapse && stationStepsVisible ? selectedTrip : nil,
                                restoreDirections: routeCanCollapse && stationDirectionsVisible,
                                onDirectionsVisibilityChanged: { stationDirectionsVisible = $0 },
                                onItineraryVisibilityChanged: { stationStepsVisible = $0 })
            }, select: focusStation, dismissPanel: expanded ? nil : { dismissCurrentPanel() })
        case .directions:
            DirectionsView(store: store, selection: $directionsSelection, onSelect: selectTrip, onShowMap: showTripOnMap, initialPlan: routeCanCollapse && stationStepsVisible ? selectedTrip : nil, onItineraryVisibilityChanged: { stationStepsVisible = $0 })
        case .alerts:
            SystemAlertsView(store: store, load: $systemAlerts)
        case .nearby, .search:
            stationBrowser(search: mode == .search, expanded: expanded)
        }
    }

    private var clearRouteButton: some View {
        Button(action: clearRoute) {
            Label("Clear route", systemImage: "xmark")
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityIdentifier("clearMapRoute")
        .accessibilityHint(activeDestination == nil ? "Remove the highlighted route. Your From and To stations are kept." : "Close directions to this place and clear its route.")
    }

    private func dismissCurrentPanel() {
        if routeCanCollapse {
            clearRoute()
        }
        panel = nil
    }

    private func clearRoute() {
        let dismissCollapsedRoute = routePanelIsCollapsed
        routePanelCollapsed = false
        if activeDestination != nil {
            placeRoute = nil
            if isWide {
                expandedPanel = .nearby
            } else {
                panel = nil
            }
        } else {
            selectTrip(nil)
            if dismissCollapsedRoute {
                panel = nil
            }
        }
    }

    private func showTripOnMap(_ plan: NativeTripPlan) {
        selectTrip(plan)
        if !isWide {
            collapseRoutePanel()
        }
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
        stationStepsVisible = plan != nil
        stationRouteVisit = plan == nil ? nil : currentStationVisit
        guard plan != nil else { return }
        tripFocusRevision += 1
    }

    private func stationBrowser(search: Bool, expanded: Bool) -> some View {
        StationBrowser(store: store, location: location, search: search, placeSearchMemory: placeSearchMemory, savedPlaces: savedPlaces, recentStations: recentStations, recentPlaces: recentPlaces, favoriteStations: favoriteStations, openPlace: { openPlace($0, expanded: expanded) }, query: $searchQuery, searchFocus: $stationSearchFocused,
                       directionsSelection: $directionsSelection, onDirectionsHere: beginDirections,
                       onSelectTrip: selectTrip, onShowTripMap: showTripOnMap, initialTrip: routeCanCollapse && stationStepsVisible ? selectedTrip : nil,
                       restoreDirections: routeCanCollapse && stationDirectionsVisible,
                       onDirectionsVisibilityChanged: { stationDirectionsVisible = $0 },
                       onItineraryVisibilityChanged: { stationStepsVisible = $0 }, select: focusStation,
                       path: search ? $searchPath : $nearbyPath,
                       dismissPanel: expanded ? nil : {
                           if routeCanCollapse {
                               clearRoute()
                           }
                           panel = nil
                       })
    }

    private func focusStation(_ station: Station) {
        stationSearchFocused = false
        selectedTrip = nil
        focus.focus(on: station.stop.coordinate)
    }
}

/// System sheet detents keep dragging, safe areas, and motion under UIKit's
/// control. Accessibility text gets enough space for the same two actions.
private struct CollapsedRouteDetent: CustomPresentationDetent {
    static func height(in context: Context) -> CGFloat? {
        min(context.maxDetentValue, context.dynamicTypeSize.isAccessibilitySize ? 180 : 96)
    }
}

func transitColor(_ hex: String) -> UIColor {
    let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x808080
    return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}

/// Pushed route screens inherit the same map-backed presentation as their root.
extension EnvironmentValues {
    @Entry var expandedTransitPanel = false
}

/// Each screen owns its native toolbar. Navigation pushes replace toolbar
/// content, so destinations opt in to the same controls through the environment.
struct ExpandedTransitToolbar: ToolbarContent {
    let search: () -> Void
    let nearby: () -> Void
    let menu: AnyView
    let clearRoute: AnyView?

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .bottomBar) {
            Button("Search", systemImage: "magnifyingglass", action: search)
                .accessibilityIdentifier("searchButton")
            Spacer()
            Button("Nearby", systemImage: "location", action: nearby)
                .accessibilityIdentifier("nearbyButton")
            menu
        }
        ToolbarItem(placement: .topBarTrailing) {
            if let clearRoute {
                clearRoute
            }
        }
    }
}

struct ExpandedTransitToolbarModifier: ViewModifier {
    @Environment(\.expandedTransitToolbar) private var expandedToolbar

    func body(content: Content) -> some View {
        content.toolbar {
            if let expandedToolbar {
                expandedToolbar
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var expandedTransitToolbar: ExpandedTransitToolbar? = nil
}
