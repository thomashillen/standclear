import SwiftUI

struct DirectionsView: View {
    let store: TransitStore
    @Binding var selection: DirectionsSelection
    let onSelect: (NativeTripPlan?) -> Void
    let onShowMap: (NativeTripPlan) -> Void
    private enum Endpoint: String, Identifiable, Hashable {
        case origin, destination
        var id: String {
            rawValue
        }

        var title: String {
            self == .origin ? "From station" : "To station"
        }
    }

    var body: some View {
        List {
            Section {
                NavigationLink(value: Endpoint.origin) {
                    LabeledContent("From", value: selection.origin(in: store.stations)?.stop.name ?? "Choose station")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("originPicker")
                .disabled(store.stations.isEmpty)
                if selection.originWasSuggested {
                    Text("Suggested nearby station from your location. Walking to the station is not included.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("originSuggestion")
                }
                NavigationLink(value: Endpoint.destination) {
                    LabeledContent("To", value: selection.destination(in: store.stations)?.stop.name ?? "Choose station")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("destinationPicker")
                .disabled(store.stations.isEmpty)
                Button("Swap stations", systemImage: "arrow.up.arrow.down") { selection.swap() }
                    .disabled(selection.originID == nil && selection.destinationID == nil)
                    .accessibilityIdentifier("swapStations")
            }
            if store.loading {
                ProgressView("Loading stations…")
            } else if let error = store.error {
                Section {
                    Label("Subway data unavailable", systemImage: "wifi.exclamationmark")
                    Text(error).foregroundStyle(.secondary)
                    Button("Retry stations") { Task { await store.loadLines() } }
                }
            } else if let origin = selection.origin(in: store.stations),
                      let destination = selection.destination(in: store.stations)
            {
                if origin.id == destination.id {
                    ContentUnavailableView("Same station", systemImage: "mappin.and.ellipse",
                                           description: Text("Choose a different destination to plan a subway trip."))
                } else {
                    let plans = TripPlanner.plans(lines: store.lines, stations: store.stations, from: origin, to: destination)
                    if plans.isEmpty {
                        ContentUnavailableView("No route found", systemImage: "tram",
                                               description: Text("No direct or one-transfer route connects these stations in the available data. This does not mean there is no service."))
                    } else {
                        Section {
                            ForEach(plans) { plan in
                                NavigationLink {
                                    TripItineraryView(plan: plan, store: store, onSelect: onSelect, onShowMap: onShowMap)
                                        .onAppear { onSelect(plan) }
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(plan.legs.count == 1 ? "Direct" : "1 transfer")
                                            .font(.headline)
                                        ForEach(plan.legs) { leg in
                                            TripRouteLabels(routes: leg.routeIDs, store: store)
                                        }
                                        Text("\(plan.totalStops) stops")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .accessibilityHint("Show boarding and transfer instructions and highlight the route on the map")
                                .accessibilityIdentifier("tripPlan-\(plan.id)")
                            }
                        } header: {
                            Text("Subway routes")
                        } footer: {
                            Text("Based on the regular route network. Service changes may affect these routes. Walking, station access, and total journey time are not included.")
                        }
                    }
                }
            } else {
                ContentUnavailableView("Choose two stations", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                       description: Text("Plan a direct subway trip or a route with one transfer."))
            }
        }
        .accessibilityIdentifier("directionsList")
        .navigationTitle("Directions")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .containerBackground(.clear, for: .navigation)
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button("Clear directions", systemImage: "xmark.circle") { selection.clear() }
                    .disabled(selection.originID == nil && selection.destinationID == nil)
                    .accessibilityIdentifier("clearDirections")
            }
        }
        .navigationDestination(for: Endpoint.self) { endpoint in
            DirectionStationPicker(stations: store.stations, title: endpoint.title) { station in
                if endpoint == .origin {
                    selection.originID = station.id
                } else {
                    selection.destinationID = station.id
                }
            }
        }
        .onChange(of: selection) { _, _ in onSelect(nil) }
    }
}

private struct DirectionStationPicker: View {
    let stations: [Station]
    let title: String
    let choose: (Station) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var matches: [Station] {
        stations.filter { query.isEmpty || $0.stop.name.localizedStandardContains(query) }
    }

    var body: some View {
        List {
            if matches.isEmpty {
                ContentUnavailableView.search(text: query)
            }
            ForEach(matches) { station in
                Button {
                    choose(station)
                    dismiss()
                } label: {
                    VStack(alignment: .leading) {
                        Text(station.stop.name)
                        Text(station.routes.map(RouteBadge.displayID).joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("stationChoice-\(station.id)")
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search subway stations")
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .containerBackground(.clear, for: .navigation)
    }
}

private struct TripItineraryView: View {
    let plan: NativeTripPlan
    let store: TransitStore
    let onSelect: (NativeTripPlan?) -> Void
    let onShowMap: (NativeTripPlan) -> Void

    var body: some View {
        List {
            Section {
                Button("Show route on map", systemImage: "map") { onShowMap(plan) }
                Text("\(plan.totalStops) stops · \(plan.legs.count == 1 ? "Direct" : "1 transfer")")
            } footer: {
                Text("Regular route network only. Check service changes before travel; walking and station access are not included.")
            }
            ForEach(Array(plan.legs.enumerated()), id: \.element.id) { index, leg in
                Section(index == 0 ? "Board" : "Transfer") {
                    Text(stopName(leg.boardStopId)).font(.headline)
                    TripRouteLabels(routes: leg.routeIDs, store: store)
                    Label(leg.direction == "N" ? "Northbound" : "Southbound", systemImage: leg.direction == "N" ? "arrow.up" : "arrow.down")
                    Text("Ride \(leg.stopCount) stops to \(stopName(leg.alightStopId)).")
                    if index == 0 {
                        DeparturePredictionView(leg: leg, store: store)
                    }
                }
            }
            if let last = plan.legs.last {
                Section("Arrive") {
                    Label(stopName(last.alightStopId), systemImage: "mappin.and.ellipse")
                }
            }
        }
        .navigationTitle("Trip details")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .containerBackground(.clear, for: .navigation)
    }

    private func stopName(_ id: String) -> String {
        store.lines.lazy.flatMap(\.stops).first { $0.id == id }?.name ?? "Station \(id)"
    }
}

private struct DeparturePredictionView: View {
    let leg: NativeTripLeg
    let store: TransitStore

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            VStack(alignment: .leading) {
                Text("Next boarding prediction").font(.subheadline)
                if let arrival = TripPlanner.nextDeparture(for: leg, stations: store.stations,
                                                           snapshot: store.snapshot, now: context.date,
                                                           feedUnavailable: store.feedError)
                {
                    Text("\(RouteBadge.displayID(arrival.routeId)) · \(arrival.countdown(at: context.date) ?? "Prediction elapsed")")
                        .font(.headline).monospacedDigit()
                    if let destination = arrival.destinationName(in: store.lines) {
                        Text("Train destination: \(destination)")
                            .font(.subheadline)
                    }
                    Text("This does not guarantee you can catch the train or make a connection.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else if store.snapshot == nil, !store.feedError {
                    ProgressView("Connecting to arrivals…")
                } else {
                    Text(store.feedError || store.snapshot?.isFresh(at: context.date) != true
                        ? "Current predictions unavailable."
                        : "No upcoming boarding prediction. This does not mean there is no service.")
                        .foregroundStyle(.secondary)
                    Button("Retry arrivals") { Task { await store.refresh() } }
                }
            }
            .accessibilityElement(children: .contain)
        }
    }
}

private struct TripRouteLabels: View {
    let routes: [String]
    let store: TransitStore

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                ForEach(routes, id: \.self) { route in
                    RouteBadge(routeID: route, color: store.lines.first { $0.routeId == route }?.color ?? "808080")
                }
            }
            Text(routes.map(RouteBadge.displayID).joined(separator: " · "))
                .font(.subheadline)
        }
    }
}
