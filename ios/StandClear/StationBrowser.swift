import CoreLocation
import SwiftUI

/// Favorites store station identities in save order. Current station data supplies
/// the names, route badges and arrivals each time Nearby displays them.
@MainActor @Observable
final class FavoriteStations {
    static let storageKey = "favoriteStationIDs"
    private let defaults: UserDefaults
    private(set) var ids: [String]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        var seen = Set<String>()
        ids = (defaults.stringArray(forKey: Self.storageKey) ?? []).filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && seen.insert($0).inserted
        }
    }

    func contains(_ stationID: String) -> Bool {
        ids.contains(stationID)
    }

    func toggle(_ stationID: String) {
        guard !stationID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if let index = ids.firstIndex(of: stationID) {
            ids.remove(at: index)
        } else {
            ids.append(stationID)
        }
        defaults.set(ids, forKey: Self.storageKey)
    }

    func resolved(in stations: [Station], excluding nearbyIDs: Set<String> = []) -> [Station] {
        guard !ids.isEmpty else { return [] }
        let current = Dictionary(stations.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return ids.compactMap { nearbyIDs.contains($0) ? nil : current[$0] }
    }
}

enum StationBrowserDestination: Hashable {
    case station(String)
}

struct StationBrowser: View {
    let store: TransitStore
    let location: LocationStore
    let search: Bool
    let placeSearchMemory: PlaceSearchMemory
    let savedPlaces: SavedPlaces
    let recentStations: RecentStations
    let recentPlaces: RecentPlaces
    let favoriteStations: FavoriteStations
    let openPlace: (PlaceResult) -> Void
    @Binding var query: String
    var searchFocus: FocusState<Bool>.Binding
    @Binding var directionsSelection: DirectionsSelection
    let onDirectionsHere: (Station) -> Void
    let onSelectTrip: (NativeTripPlan?) -> Void
    let onShowTripMap: (NativeTripPlan) -> Void
    let select: (Station) -> Void
    @Binding var path: [StationBrowserDestination]
    let dismissPanel: (() -> Void)?

    var body: some View {
        Group {
            if search {
                PlaceSearchView(store: store, recentStations: recentStations, recentPlaces: recentPlaces, savedPlaces: savedPlaces, placeSearchMemory: placeSearchMemory, openPlace: openPlace, openStation: openSearchStation,
                                query: $query, clearFocus: { searchFocus.wrappedValue = false }, stationRow: searchStationRow)
                    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Address, place or station")
                    .searchFocused(searchFocus)

            } else {
                nearby
            }
        }
        .navigationDestination(for: StationBrowserDestination.self) { destination in
            Group {
                switch destination {
                case let .station(id):
                    if let station = store.stations.first(where: { $0.id == id }) {
                        stationDetails(station)
                    } else {
                        ContentUnavailableView("Station unavailable", systemImage: "tram",
                                               description: Text("This station is no longer in the subway data."))
                    }
                }
            }
            .toolbar {
                if let dismissPanel {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: dismissPanel)
                    }
                }
            }
        }
        .navigationTitle(search ? "Search" : "Nearby arrivals")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var nearby: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let results = location.availableCoordinate.map { Transit.nearby(store.stations, coordinate: $0) } ?? []
            let favorites = favoriteStations.resolved(in: store.stations, excluding: Set(results.map(\.id)))
            List {
                Group {
                    if store.loading {
                        ProgressView("Loading stations…")
                    }
                    if let error = store.error {
                        Section {
                            Label("Subway data unavailable", systemImage: "wifi.exclamationmark")
                            Text(error).foregroundStyle(.secondary)
                            Button("Retry stations") { Task { await store.loadLines() } }
                        }
                    }
                    if location.availableCoordinate == nil {
                        locationState
                    } else if results.isEmpty, !store.loading, store.error == nil {
                        Section {
                            Label("You’re outside NYC", systemImage: "location.slash")
                            Text("No NYC subway stations are within 80 km. Use Search to explore stations.")
                                .foregroundStyle(.secondary)
                        }
                    }
                    if !results.isEmpty || !favorites.isEmpty {
                        if store.feedError || store.snapshot?.isFresh(at: context.date) != true {
                            Section {
                                ArrivalFeedState(store: store, now: context.date)
                            }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        }
                        if !favorites.isEmpty {
                            Section("Favorites") {
                                ForEach(favorites) { station in
                                    nearbyStationRow(station, savedOnly: true)
                                    arrivalRows(for: station, now: context.date)
                                }
                            }
                            .listRowBackground(Color.clear)
                        }
                        ForEach(results) { nearby in
                            Section {
                                nearbyStationRow(nearby.station, savedOnly: false, meters: nearby.meters)
                                arrivalRows(for: nearby.station, now: context.date)
                            }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        }
                        if !results.isEmpty {
                            Section {} footer: {
                                Text("Distances are approximate, in a straight line.")
                            }
                        }
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }
            .accessibilityIdentifier("stationList")
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .listSectionSpacing(.compact)
        }
    }

    @ViewBuilder private func arrivalRows(for station: Station, now: Date) -> some View {
        if !store.feedError, store.snapshot?.isFresh(at: now) == true {
            let arrivals = Transit.arrivals(for: station, snapshot: store.snapshot, now: now)
            if arrivals.isEmpty {
                Text("No upcoming predictions. This does not mean there is no service.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(NearbyArrivalGroup.groups(arrivals)) { group in
                    ArrivalRow(arrival: group.first, store: store, now: now, additionalArrivals: group.later)
                }
            }
        }
    }

    private var locationState: some View {
        Section {
            switch location.status {
            case .denied, .restricted:
                Label("Location access is off", systemImage: "location.slash")
                Text("Search stations or allow location in Settings.").foregroundStyle(.secondary)
                Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
            default:
                if let message = location.message {
                    Label("Location unavailable", systemImage: "location.slash")
                    Text(message).foregroundStyle(.secondary)
                    Button("Retry location") { location.start() }
                } else {
                    ProgressView("Waiting for your location…")
                }
            }
        }
    }

    private func stationDetails(_ station: Station) -> some View {
        StationArrivals(station: station, store: store, favoriteStations: favoriteStations, savedPlaces: savedPlaces, directionsSelection: $directionsSelection,
                        onDirectionsHere: onDirectionsHere, onSelectTrip: onSelectTrip, onShowTripMap: onShowTripMap)
            .onAppear { select(station) }
    }

    private func openSearchStation(_ station: Station) {
        recentStations.record(station.id)
        searchFocus.wrappedValue = false
        path.append(.station(station.id))
    }

    private func searchStationRow(_ station: Station, recent: Bool) -> some View {
        Button {
            openSearchStation(station)
        } label: {
            stationLabel(station)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Show station arrivals and focus the map")
        .accessibilityIdentifier(recent ? "recentStation-\(station.id)" : "station-\(station.id)")
    }

    private func nearbyStationRow(_ station: Station, savedOnly: Bool, meters: Double? = nil) -> some View {
        Button { path.append(.station(station.id)) } label: {
            stationLabel(station, starred: favoriteStations.contains(station.id), meters: meters)
                .accessibilityElement(children: .combine)
        }
        .buttonStyle(.plain)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .accessibilityHint("Show station arrivals and focus the map")
        .accessibilityIdentifier(savedOnly ? "favoriteStation-\(station.id)" : "station-\(station.id)")
    }

    @ViewBuilder private func stationName(_ station: Station, starred: Bool) -> some View {
        if starred {
            Label(station.stop.name, systemImage: "star.fill")
                .accessibilityLabel("\(station.stop.name), Favorite")
        } else {
            Text(station.stop.name)
        }
    }

    private func stationLabel(_ station: Station, starred: Bool = false, meters: Double? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ViewThatFits(in: .horizontal) {
                HStack {
                    stationName(station, starred: starred)
                    if let meters {
                        stationDistance(meters)
                    }
                    Spacer(minLength: 8)
                    routeBadges(station)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        stationName(station, starred: starred)
                        Spacer(minLength: 8)
                        routeBadges(station)
                    }
                    if let meters {
                        stationDistance(meters)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    stationName(station, starred: starred)
                    if let meters {
                        stationDistance(meters)
                    }
                    ViewThatFits(in: .horizontal) {
                        routeBadges(station)
                        Text(station.routes.map(RouteBadge.displayID).joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func stationDistance(_ meters: Double) -> some View {
        let distance = Measurement(value: max(100, meters), unit: UnitLength.meters)
            .formatted(.measurement(width: .abbreviated, usage: .road, numberFormatStyle: .number.precision(.significantDigits(1 ... 2))))
        return Text(meters < 100 ? "Within ≈\(distance)" : "≈\(distance)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(meters < 100 ? "Within about \(distance) in a straight line" : "About \(distance) away in a straight line")
    }

    private func routeBadges(_ station: Station) -> some View {
        HStack(spacing: 4) {
            ForEach(station.routes, id: \.self) { route in
                RouteBadge(routeID: route, color: store.lines.first { $0.routeId == route }?.color ?? "808080")
            }
        }
        .fixedSize()
    }
}

struct StationArrivals: View {
    let station: Station
    let store: TransitStore
    let favoriteStations: FavoriteStations
    let savedPlaces: SavedPlaces
    @Binding var directionsSelection: DirectionsSelection
    let onDirectionsHere: (Station) -> Void
    let onSelectTrip: (NativeTripPlan?) -> Void
    let onShowTripMap: (NativeTripPlan) -> Void
    @State private var showingDirections = false
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var alerts: StationAlertsLoad = .loading
    @State private var alertsRetry = 0

    private struct AlertsRequest: Equatable {
        let stationID: String
        let active: Bool
        let revision: Int
    }

    private var alertsRequest: AlertsRequest {
        AlertsRequest(stationID: station.id, active: visible && scenePhase == .active && !showingDirections, revision: alertsRetry)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let fresh = !store.feedError && store.snapshot?.isFresh(at: context.date) == true
            let groups = fresh ? StationArrivalGroup.groups(Transit.arrivals(for: station, snapshot: store.snapshot, now: context.date)) : []
            let caveat = "MTA predictions may change. Missing predictions do not mean no service. Partial upstream outages may omit routes."
            List {
                StationAlertSection(station: station, load: alerts, now: context.date) { alertsRetry += 1 }
                if !fresh || groups.isEmpty {
                    Section {
                        if !fresh {
                            ArrivalFeedState(store: store, now: context.date)
                        } else {
                            Label("No upcoming predictions", systemImage: "tram")
                            Text("The feed currently has no upcoming arrivals for this station.")
                                .foregroundStyle(.secondary)
                        }
                    } footer: {
                        Text(caveat)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
                ForEach(groups) { group in
                    StationDirectionSection(group: group, store: store, now: context.date,
                                            footer: group.id == groups.last?.id ? caveat : nil)
                }
                .id(station.id)
            }
            .accessibilityIdentifier("stationArrivalsList")
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .listSectionSpacing(.compact)
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: alertsRequest) { [alertsRequest] in
            guard alertsRequest.active else { return }
            alerts = .loading
            while !Task.isCancelled {
                do {
                    let snapshot = try await store.stationAlerts()
                    guard !Task.isCancelled, self.alertsRequest == alertsRequest else { return }
                    alerts = .received(snapshot)
                } catch {
                    guard !Task.isCancelled, self.alertsRequest == alertsRequest else { return }
                    alerts = .failed
                }
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    // Prefill only on this explicit action, never when navigation
                    // reappears after a rider edits an endpoint or goes back.
                    onDirectionsHere(station)
                    showingDirections = true
                } label: {
                    Label("Directions here", systemImage: "arrow.triangle.turn.up.right.diamond")
                }
                .labelStyle(.iconOnly)
                .accessibilityHint("Plan a subway trip to this station. Choose or edit your starting station.")
                .accessibilityIdentifier("directionsHere")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Save station", systemImage: "ellipsis") {
                    let saved = favoriteStations.contains(station.id)
                    Button(saved ? "Remove from favorites" : "Add to favorites", systemImage: saved ? "star.fill" : "star") {
                        favoriteStations.toggle(station.id)
                    }
                    .accessibilityIdentifier("favoriteStationToggle")
                    Divider()
                    ForEach(SavedPlaces.Anchor.allCases, id: \.self) { anchor in
                        if savedPlaces.destinations[anchor.rawValue] == .station(station.id) {
                            Button("Remove \(anchor.rawValue)", role: .destructive) { savedPlaces.set(nil, for: anchor) }
                        } else {
                            Button("Set as \(anchor.rawValue)", systemImage: anchor.symbol) {
                                savedPlaces.setStation(station.id, for: anchor)
                                if !favoriteStations.contains(station.id) {
                                    favoriteStations.toggle(station.id)
                                }
                            }
                        }
                    }
                }
                .accessibilityIdentifier("stationAnchorMenu")
            }
        }
        .navigationTitle(station.stop.name)
        .navigationBarTitleDisplayMode(.inline)
        .containerBackground(.clear, for: .navigation)
        .navigationDestination(isPresented: $showingDirections) {
            DirectionsView(store: store, selection: $directionsSelection,
                           onSelect: onSelectTrip, onShowMap: onShowTripMap)
        }
    }
}

private struct StationDirectionSection: View {
    let group: StationArrivalGroup
    let store: TransitStore
    let now: Date
    let footer: String?
    @State private var expanded = false

    var body: some View {
        Section {
            if group.arrivals.isEmpty {
                Text("No upcoming predictions reported.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(group.visible(expanded: expanded)) { arrival in
                    ArrivalRow(arrival: arrival, store: store, now: now, showsDirection: false)
                }
                if group.overflowCount > 0 {
                    let title = expanded ? "Show less" : "Show all (\(group.overflowCount) more)"
                    Button(title) { expanded.toggle() }
                        .accessibilityLabel("\(title), \(group.direction.title)")
                        .accessibilityIdentifier("stationArrivalToggle-\(group.direction.rawValue)")
                }
            }
        } header: {
            Text(group.direction.title)
                .accessibilityIdentifier("stationArrivalHeader-\(group.direction.rawValue)")
        } footer: {
            if let footer {
                Text(footer)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
    }
}

private struct ArrivalFeedState: View {
    let store: TransitStore
    let now: Date

    var body: some View {
        if store.snapshot == nil, !store.feedError {
            ProgressView("Connecting to live arrivals…")
        } else {
            Label(store.feedLabel(at: now), systemImage: store.feedError ? "wifi.exclamationmark" : "clock")
            if store.feedError || store.snapshot?.isFresh(at: now) != true {
                Text("Current predictions are unavailable. Try again shortly.")
                    .foregroundStyle(.secondary)
                Button("Retry arrivals") { Task { await store.refresh() } }
            }
        }
    }
}

private struct ArrivalRow: View {
    let arrival: Arrival
    let store: TransitStore
    let now: Date
    var additionalArrivals: [Arrival] = []
    var showsDirection = true

    private var arrivals: [Arrival] {
        [arrival] + additionalArrivals
    }

    var body: some View {
        DisclosureGroup {
            ForEach(arrivals) { prediction in
                Text("Predicted arrival: \(Date(timeIntervalSince1970: prediction.eta).formatted(date: .omitted, time: .shortened))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("arrivalClockTime")
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        routeAndDirection
                        Spacer(minLength: 8)
                        countdown
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        routeAndDirection
                        countdown
                    }
                }
                if showsDirection, let destination = arrival.destinationName(in: store.lines) {
                    Text("To \(destination)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .foregroundStyle(.primary)
            .frame(minHeight: 44, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
        .accessibilityIdentifier("arrivalRow-\(arrival.id)")
    }

    private var routeAndDirection: some View {
        let service = TransitRouteIdentity(arrival.routeId)
        return HStack(spacing: 8) {
            RouteBadge(routeID: arrival.routeId,
                       color: store.lines.first { $0.routeId == service.baseID }?.color ?? "808080")
            if showsDirection {
                Text(service.isExpress ? "\(arrival.directionLabel) · Express" : arrival.directionLabel)
                    .accessibilityLabel(arrival.directionLabel)
            } else {
                let destination = arrival.destinationName(in: store.lines).map { "To \($0)" } ?? "Destination unavailable"
                Text(service.isExpress ? "\(destination) · Express" : destination)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("\(arrival.directionLabel), \(destination)")
            }
        }
    }

    private var countdown: some View {
        let times = arrivals.map { $0.countdown(at: now) ?? "Prediction elapsed" }
        let label = times.allSatisfy { $0.hasSuffix(" min") }
            ? times.map { String($0.dropLast(4)) }.joined(separator: ", ") + " min"
            : times.joined(separator: ", ")
        return Text(label)
            .font(.headline)
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(arrivals.map { $0.countdown(at: now).map { "Predicted in \($0)" } ?? "Prediction elapsed" }.joined(separator: ", "))
    }
}

enum LineDestination: Hashable {
    case route(String)
    case station(String)
}

/// Browse the static route pattern and reported line advisories; arrivals remain in station details.
struct LineBrowser<StationDetail: View>: View {
    let store: TransitStore
    let stationDetail: (Station) -> StationDetail
    let select: (Station) -> Void

    var body: some View {
        List {
            if store.loading {
                ProgressView("Loading lines…")
            } else if store.error != nil {
                ContentUnavailableView("Lines unavailable", systemImage: "wifi.exclamationmark",
                                       description: Text("Subway data couldn’t load."))
                Button("Retry lines") { Task { await store.loadLines() } }
            } else if store.lines.isEmpty {
                ContentUnavailableView("No lines available", systemImage: "tram")
            }
            ForEach(store.lines) { line in
                NavigationLink(value: LineDestination.route(line.routeId)) {
                    HStack {
                        RouteBadge(routeID: line.routeId, color: line.color)
                        VStack(alignment: .leading) {
                            Text("\(RouteBadge.displayID(line.routeId)) line")
                            if let first = line.stops.first, let last = line.stops.last {
                                Text("\(first.name) – \(last.name)")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(TransitRouteIdentity(line.routeId).spokenName) line")
                    .accessibilityValue([line.stops.first?.name, line.stops.last?.name].compactMap(\.self).joined(separator: " to "))
                    .accessibilityHint("Browse stations on this route")
                }
                .accessibilityIdentifier("line-\(line.routeId)")
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .navigationTitle("Lines")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("lineList")
        .navigationDestination(for: LineDestination.self) { destination in
            switch destination {
            case let .route(id):
                stops(for: id)
            case let .station(id):
                if let station = store.stations.first(where: { $0.id == id }) {
                    stationDetail(station).onAppear { select(station) }
                } else {
                    ContentUnavailableView("Station unavailable", systemImage: "tram")
                }
            }
        }
    }

    @ViewBuilder private func stops(for routeID: String) -> some View {
        if let line = store.lines.first(where: { $0.routeId == routeID }) {
            LineStations(line: line, store: store)
        } else {
            ContentUnavailableView("Line unavailable", systemImage: "tram",
                                   description: Text("This line is no longer in the subway data."))
        }
    }
}

private struct LineStations: View {
    let line: SubwayLine
    let store: TransitStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var alerts: StationAlertsLoad = .loading
    @State private var alertsRetry = 0

    private struct Request: Equatable {
        let routeID: String
        let active: Bool
        let revision: Int
    }

    private var request: Request {
        Request(routeID: line.routeId, active: visible && scenePhase == .active, revision: alertsRetry)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            List {
                LineAlertSection(line: line, load: alerts, now: context.date) { alertsRetry += 1 }
                Section {
                    ForEach(line.stops) { stop in
                        if let station = store.stations.first(where: { $0.stopIDs.contains(stop.id) }) {
                            NavigationLink(value: LineDestination.station(station.id)) {
                                Text(stop.name)
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }
                            .accessibilityIdentifier("lineStation-\(stop.id)")
                        } else {
                            Text(stop.name).foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Regular station pattern")
                } footer: {
                    Text("Service may change. Open a station for reported arrivals.")
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .listSectionSpacing(.compact)
            .scrollContentBackground(.hidden)
            .navigationTitle("\(RouteBadge.displayID(line.routeId)) line")
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("lineStationList")
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: request) { [request] in
            guard request.active else { return }
            alerts = .loading
            while !Task.isCancelled {
                do {
                    let snapshot = try await store.stationAlerts()
                    guard !Task.isCancelled, self.request == request else { return }
                    alerts = .received(snapshot)
                } catch {
                    guard !Task.isCancelled, self.request == request else { return }
                    alerts = .failed
                }
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }
}
