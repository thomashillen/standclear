import CoreLocation
import SwiftUI

struct StationBrowser: View {
    let store: TransitStore
    let location: LocationStore
    let search: Bool
    @Binding var query: String
    var searchFocus: FocusState<Bool>.Binding
    @Binding var directionsSelection: DirectionsSelection
    let onDirectionsHere: (Station) -> Void
    let onSelectTrip: (NativeTripPlan?) -> Void
    let onShowTripMap: (NativeTripPlan) -> Void
    let select: (Station) -> Void

    private var results: [Station] {
        if search {
            return store.stations.filter { query.isEmpty || $0.stop.name.localizedStandardContains(query) }
        }
        guard let coordinate = location.availableCoordinate else { return [] }
        return Transit.nearby(store.stations, coordinate: coordinate)
    }

    var body: some View {
        Group {
            if search {
                content.searchable(text: $query, prompt: "Search subway stations")
                    .searchFocused(searchFocus)
                    .onDisappear { searchFocus.wrappedValue = false }
            } else {
                content
            }
        }
        .navigationTitle(search ? "Search stations" : "Nearby arrivals")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
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
                    if !search, location.availableCoordinate == nil {
                        locationState
                    } else if results.isEmpty, !store.loading, store.error == nil {
                        if search {
                            ContentUnavailableView.search(text: query)
                        } else {
                            Section {
                                Label("You’re outside NYC", systemImage: "location.slash")
                                Text("No NYC subway stations are within 80 km. Use Search to explore stations.")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    if search {
                        ForEach(results) { station in
                            stationLink(station)
                        }
                    } else if !results.isEmpty {
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

    private func stationLink(_ station: Station) -> some View {
        NavigationLink {
            StationArrivals(station: station, store: store, directionsSelection: $directionsSelection,
                            onDirectionsHere: onDirectionsHere, onSelectTrip: onSelectTrip, onShowTripMap: onShowTripMap)
                .onAppear { select(station) }
        } label: {
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
            .frame(minHeight: 44)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .accessibilityHint("Show station arrivals and focus the map")
        .accessibilityIdentifier("station-\(station.id)")
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

    private var direction: String {
        arrival.directionLabel
    }

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
        HStack(spacing: 8) {
            RouteBadge(routeID: arrival.routeId,
                       color: store.lines.first { $0.routeId == arrival.routeId }?.color ?? "808080")
            Text(direction)
        }
    }

    private var countdown: some View {
        Text(arrival.countdown(at: now) ?? "Prediction elapsed")
            .font(.headline)
            .monospacedDigit()
            .accessibilityLabel(arrival.countdown(at: now).map { "Predicted in \($0)" } ?? "Prediction elapsed")
    }
}
