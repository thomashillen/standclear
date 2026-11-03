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

struct StationBrowser: View {
    let store: TransitStore
    let location: LocationStore
    let search: Bool
    let placeSearchMemory: PlaceSearchMemory
    let recentStations: RecentStations
    let favoriteStations: FavoriteStations
    let openPlace: (PlaceResult) -> Void
    @Binding var query: String
    var searchFocus: FocusState<Bool>.Binding
    @Binding var directionsSelection: DirectionsSelection
    let onDirectionsHere: (Station) -> Void
    let onSelectTrip: (NativeTripPlan?) -> Void
    let onShowTripMap: (NativeTripPlan) -> Void
    let select: (Station) -> Void
    @State private var selectedStationID: String?

    var body: some View {
        Group {
            if search {
                PlaceSearchView(store: store, recentStations: recentStations, placeSearchMemory: placeSearchMemory, openPlace: openPlace,
                                query: $query, clearFocus: { searchFocus.wrappedValue = false }, stationRow: searchStationRow)
                    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Address, place or station")
                    .searchFocused(searchFocus)

            } else {
                nearby
            }
        }
        .navigationDestination(item: $selectedStationID) { id in
            if let station = store.stations.first(where: { $0.id == id }) {
                stationDetails(station)
            } else {
                ContentUnavailableView("Station unavailable", systemImage: "tram",
                                       description: Text("This station is no longer in the subway data."))
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
                        ForEach(results) { station in
                            Section {
                                nearbyStationRow(station, savedOnly: false)
                                arrivalRows(for: station, now: context.date)
                            }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
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
                ForEach(Array(arrivals.prefix(3))) { arrival in
                    ArrivalRow(arrival: arrival, store: store, now: now)
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
        StationArrivals(station: station, store: store, favoriteStations: favoriteStations, directionsSelection: $directionsSelection,
                        onDirectionsHere: onDirectionsHere, onSelectTrip: onSelectTrip, onShowTripMap: onShowTripMap)
            .onAppear { select(station) }
    }

    private func searchStationRow(_ station: Station, recent: Bool) -> some View {
        Button {
            recentStations.record(station.id)
            searchFocus.wrappedValue = false
            selectedStationID = station.id
        } label: {
            stationLabel(station)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Show station arrivals and focus the map")
        .accessibilityIdentifier(recent ? "recentStation-\(station.id)" : "station-\(station.id)")
    }

    private func nearbyStationRow(_ station: Station, savedOnly: Bool) -> some View {
        Button { selectedStationID = station.id } label: {
            stationLabel(station, starred: favoriteStations.contains(station.id))
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

    private func stationLabel(_ station: Station, starred: Bool = false) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                stationName(station, starred: starred)
                Spacer(minLength: 8)
                routeBadges(station)
            }
            VStack(alignment: .leading, spacing: 4) {
                stationName(station, starred: starred)
                ViewThatFits(in: .horizontal) {
                    routeBadges(station)
                    Text(station.routes.map(RouteBadge.displayID).joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
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
                Button {
                    // Prefill only on this explicit action, never when navigation
                    // reappears after a rider edits an endpoint or goes back.
                    onDirectionsHere(station)
                    showingDirections = true
                } label: {
                    Label("Directions here", systemImage: "arrow.triangle.turn.up.right.diamond")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityHint("Plan a subway trip to this station. Choose or edit your starting station.")
                .accessibilityIdentifier("directionsHere")
                .listRowBackground(Color.clear)
                StationAlertSection(station: station, load: alerts, now: context.date) { alertsRetry += 1 }
                Section {
                    ArrivalFeedState(store: store, now: context.date)
                    if fresh, groups.isEmpty {
                        Label("No upcoming predictions", systemImage: "tram")
                        Text("The feed currently has no upcoming arrivals for this station.")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    if groups.isEmpty {
                        Text(caveat)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
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
                let saved = favoriteStations.contains(station.id)
                Button(saved ? "Remove from favorites" : "Add to favorites", systemImage: saved ? "star.fill" : "star") {
                    favoriteStations.toggle(station.id)
                }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("favoriteStationToggle")
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
                    ArrivalRow(arrival: arrival, store: store, now: now)
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

    var body: some View {
        DisclosureGroup {
            Text("Predicted arrival: \(Date(timeIntervalSince1970: arrival.eta).formatted(date: .omitted, time: .shortened))")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("arrivalClockTime")
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
                if let destination = arrival.destinationName(in: store.lines) {
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
            Text(service.isExpress ? "\(arrival.directionLabel) · Express" : arrival.directionLabel)
                .accessibilityLabel(arrival.directionLabel)
        }
    }

    private var countdown: some View {
        Text(arrival.countdown(at: now) ?? "Prediction elapsed")
            .font(.headline)
            .monospacedDigit()
            .accessibilityLabel(arrival.countdown(at: now).map { "Predicted in \($0)" } ?? "Prediction elapsed")
    }
}
