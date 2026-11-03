import CoreLocation
import SwiftUI

struct StationBrowser: View {
    let store: TransitStore
    let location: LocationStore
    let search: Bool
    let recentStations: RecentStations
    let openWindowPreview: ((PlaceResult) -> Void)?
    @Binding var query: String
    var searchFocus: FocusState<Bool>.Binding
    @Binding var directionsSelection: DirectionsSelection
    let onDirectionsHere: (Station) -> Void
    let onSelectTrip: (NativeTripPlan?) -> Void
    let onShowTripMap: (NativeTripPlan) -> Void
    let select: (Station) -> Void
    @State private var searchStationID: String?

    var body: some View {
        Group {
            if search {
                PlaceSearchView(store: store, location: location, recentStations: recentStations, openWindowPreview: openWindowPreview,
                                query: $query, clearFocus: { searchFocus.wrappedValue = false }, stationRow: searchStationRow)
                    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Address, place or station")
                    .searchFocused(searchFocus)
                    .navigationDestination(item: $searchStationID) { id in
                        if let station = store.stations.first(where: { $0.id == id }) {
                            stationDetails(station)
                        } else {
                            ContentUnavailableView("Station unavailable", systemImage: "tram",
                                                   description: Text("This station is no longer in the subway data."))
                        }
                    }
            } else {
                nearby
            }
        }
        .navigationTitle(search ? "Search" : "Nearby arrivals")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var nearby: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let results = location.availableCoordinate.map { Transit.nearby(store.stations, coordinate: $0) } ?? []
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
                    if !results.isEmpty {
                        if store.feedError || store.snapshot?.isFresh(at: context.date) != true {
                            Section {
                                ArrivalFeedState(store: store, now: context.date)
                            }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        }
                        ForEach(results) { station in
                            Section {
                                stationLink(station)
                                if !store.feedError, store.snapshot?.isFresh(at: context.date) == true {
                                    let arrivals = Transit.arrivals(for: station, snapshot: store.snapshot, now: context.date)
                                    if arrivals.isEmpty {
                                        Text("No upcoming predictions. This does not mean there is no service.")
                                            .foregroundStyle(.secondary)
                                    } else {
                                        ForEach(Array(arrivals.prefix(3))) { arrival in
                                            ArrivalRow(arrival: arrival, store: store, now: context.date)
                                        }
                                    }
                                }
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
        StationArrivals(station: station, store: store, directionsSelection: $directionsSelection,
                        onDirectionsHere: onDirectionsHere, onSelectTrip: onSelectTrip, onShowTripMap: onShowTripMap)
            .onAppear { select(station) }
    }

    private func searchStationRow(_ station: Station, recent: Bool) -> some View {
        Button {
            recentStations.record(station.id)
            searchFocus.wrappedValue = false
            searchStationID = station.id
        } label: {
            stationLabel(station)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Show station arrivals and focus the map")
        .accessibilityIdentifier(recent ? "recentStation-\(station.id)" : "station-\(station.id)")
    }

    private func stationLink(_ station: Station) -> some View {
        NavigationLink {
            stationDetails(station)
        } label: {
            stationLabel(station)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .accessibilityHint("Show station arrivals and focus the map")
        .accessibilityIdentifier("station-\(station.id)")
    }

    private func stationLabel(_ station: Station) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                Text(station.stop.name)
                Spacer(minLength: 8)
                routeBadges(station)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(station.stop.name)
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
            let arrivals = Transit.arrivals(for: station, snapshot: store.snapshot, now: context.date)
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
                    if !store.feedError, store.snapshot?.isFresh(at: context.date) == true {
                        if arrivals.isEmpty {
                            Label("No upcoming predictions", systemImage: "tram")
                            Text("The feed currently has no upcoming arrivals for this station.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(Array(arrivals.prefix(20))) { arrival in
                                ArrivalRow(arrival: arrival, store: store, now: context.date)
                            }
                        }
                    }
                } footer: {
                    Text("MTA predictions may change. Missing predictions do not mean no service. Partial upstream outages may omit routes.")
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }
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
        .navigationTitle(station.stop.name)
        .navigationBarTitleDisplayMode(.inline)
        .containerBackground(.clear, for: .navigation)
        .navigationDestination(isPresented: $showingDirections) {
            DirectionsView(store: store, selection: $directionsSelection,
                           onSelect: onSelectTrip, onShowMap: onShowTripMap)
        }
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
