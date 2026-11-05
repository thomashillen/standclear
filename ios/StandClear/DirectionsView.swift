import SwiftUI

struct DirectionsView: View {
    let store: TransitStore
    @Binding var selection: DirectionsSelection
    let onSelect: (NativeTripPlan?) -> Void
    let onShowMap: (NativeTripPlan) -> Void
    @State private var presentedPlan: NativeTripPlan?

    private var showingItinerary: Binding<Bool> {
        Binding(get: { presentedPlan != nil }, set: { shown in
            if !shown {
                presentedPlan = nil
            }
        })
    }

    var body: some View {
        List {
            Section {
                NavigationLink {
                    DirectionStationPicker(stations: store.stations, title: "From station") { station in
                        selection.originID = station.id
                    }
                } label: {
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
                NavigationLink {
                    DirectionStationPicker(stations: store.stations, title: "To station") { station in
                        selection.destinationID = station.id
                    }
                } label: {
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
                                Button {
                                    onSelect(plan)
                                    presentedPlan = plan
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(plan.routeChoiceTitle(in: store.lines))
                                            .font(.headline)
                                        ForEach(plan.legs) { leg in
                                            TripRouteLabels(routes: leg.routeIDs, store: store)
                                        }
                                        Text("\(plan.totalStops) stops")
                                            .foregroundStyle(.secondary)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
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
        .navigationDestination(isPresented: showingItinerary) {
            if let presentedPlan {
                TripItineraryView(plan: presentedPlan, store: store, onShowMap: onShowMap)
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
        .onChange(of: selection) { _, _ in onSelect(nil) }
    }
}

struct DirectionStationPicker: View {
    let stations: [Station]
    let title: String
    let choose: (Station) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var matches: [Station] {
        Transit.searchStations(stations, query: query)
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
    let onShowMap: (NativeTripPlan) -> Void

    var body: some View {
        List {
            Section {
                Text("\(plan.totalStops) stops · \(plan.legs.count == 1 ? "Direct" : "1 transfer")")
            } footer: {
                Text("Regular route network only. Check service changes before travel; walking and station access are not included.")
            }
            ForEach(Array(plan.legs.enumerated()), id: \.element.id) { index, leg in
                Section(index == 0 ? "Board" : "Transfer") {
                    if index == 1, let transfer = plan.transfer(in: store.lines) {
                        TripTransferStep(transfer: transfer, arriving: plan.legs[0], departing: leg)
                            .accessibilityIdentifier("stationTripTransfer")
                    } else {
                        Text(stopName(leg.boardStopId)).font(.headline)
                    }
                    TripRouteLabels(routes: leg.routeIDs, store: store)
                    Label(leg.direction == "N" ? "Northbound" : "Southbound", systemImage: leg.direction == "N" ? "arrow.up" : "arrow.down")
                    Text("Ride \(leg.stopCount) stops to \(stopName(leg.alightStopId)).")
                    DeparturePredictionView(leg: leg, store: store, isTransfer: index > 0)
                        .accessibilityIdentifier("legPrediction-\(leg.id)")
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Show route on map", systemImage: "map") { onShowMap(plan) }
                    .accessibilityIdentifier("showStationRouteOnMap")
            }
        }
        .scrollContentBackground(.hidden)
        .containerBackground(.clear, for: .navigation)
    }

    private func stopName(_ id: String) -> String {
        store.lines.lazy.flatMap(\.stops).first { $0.id == id }?.name ?? "Station \(id)"
    }
}

struct TripTransferStep: View {
    let transfer: NativeTripTransfer
    let arriving: NativeTripLeg
    let departing: NativeTripLeg

    var body: some View {
        let incoming = arriving.routeIDs.map(RouteBadge.displayID).joined(separator: "/")
        let outgoing = departing.routeIDs.map(RouteBadge.displayID).joined(separator: "/")
        VStack(alignment: .leading, spacing: 4) {
            Label(transfer.instruction(to: departing), systemImage: "arrow.left.arrow.right").font(.headline)
            if transfer.isLexington59 {
                Text("Follow the in-station signs from the \(incoming) platform to the \(outgoing) platform.")
            } else {
                Text("Leave the \(incoming) at \(transfer.incoming.name).")
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct DeparturePredictionView: View {
    let leg: NativeTripLeg
    let store: TransitStore
    let isTransfer: Bool

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { _ in
            let now = Date.now
            VStack(alignment: .leading) {
                Text(isTransfer ? "Next departure at the transfer platform" : "Next boarding prediction").font(.subheadline)
                if let arrival = TripPlanner.nextDeparture(for: leg, stations: store.stations,
                                                           snapshot: store.snapshot, now: now,
                                                           feedUnavailable: store.feedError)
                {
                    Text("\(TransitRouteIdentity(arrival.routeId).spokenName) · \(arrival.countdown(at: now) ?? "Prediction elapsed")")
                        .font(.headline).monospacedDigit()
                    if let destination = arrival.destinationName(in: store.lines) {
                        Text("Train destination: \(destination)")
                            .font(.subheadline)
                    }
                    Text(isTransfer ? "This is the prediction at the platform now. You may arrive after this train departs." : "This does not guarantee you can catch the train or make a connection.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else if store.snapshot == nil, !store.feedError {
                    ProgressView("Connecting to arrivals…")
                } else {
                    Text(store.feedError || store.snapshot?.isFresh(at: now) != true
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
