import CoreLocation
import SwiftUI

struct StationBrowser: View {
    let store: TransitStore
    let location: LocationStore
    let search: Bool
    @Binding var query: String
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
            } else {
                content
            }
        }
        .navigationTitle(search ? "Search stations" : "Nearby arrivals")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        List {
            if store.loading {
                ProgressView("Loading stations…")
            }
            if let error = store.error {
                Text(error)
                Button("Retry") { Task { await store.loadLines() } }
            }
            if !search, location.availableCoordinate == nil {
                Section {
                    switch location.status {
                    case .denied, .restricted:
                        ContentUnavailableView("Location access is off", systemImage: "location.slash",
                                               description: Text("Search stations or allow location in Settings."))
                        Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
                    default:
                        if let message = location.message {
                            Text(message)
                            Button("Retry location") { location.start() }
                        } else {
                            ProgressView("Waiting for your location…")
                        }
                    }
                }
            } else if results.isEmpty, !store.loading, store.error == nil {
                if search {
                    ContentUnavailableView.search(text: query)
                } else {
                    ContentUnavailableView("You’re outside NYC", systemImage: "location.slash",
                                           description: Text("No NYC subway stations are within 80 km. Use Search to explore stations."))
                }
            }
            ForEach(results) { station in
                NavigationLink {
                    StationArrivals(station: station, store: store)
                        .onAppear { select(station) }
                } label: {
                    VStack(alignment: .leading) {
                        Text(station.stop.name)
                        ViewThatFits(in: .horizontal) {
                            HStack {
                                ForEach(station.routes, id: \.self) { route in
                                    RouteBadge(routeID: route, color: store.lines.first { $0.routeId == route }?.color ?? "808080")
                                }
                            }
                            Text(station.routes.map(RouteBadge.displayID).joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if !search {
                            TimelineView(.periodic(from: .now, by: 5)) { context in
                                let arrivals = Transit.arrivals(for: station, snapshot: store.snapshot, now: context.date)
                                if !store.feedError, let first = arrivals.first {
                                    Text("Next \(first.routeId) · \(first.direction == "N" ? "northbound" : "southbound")")
                                    Text(Date(timeIntervalSince1970: first.eta), style: .time)
                                } else {
                                    Text(store.feedError || store.snapshot?.isFresh(at: context.date) != true
                                        ? store.feedLabel(at: context.date) : "No upcoming predictions")
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

struct StationArrivals: View {
    let station: Station
    let store: TransitStore
    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            let arrivals = Transit.arrivals(for: station, snapshot: store.snapshot, now: context.date)
            List {
                Section {
                    Label(store.feedLabel(at: context.date), systemImage: store.feedError ? "wifi.exclamationmark" : "clock")
                    if store.feedError || store.snapshot?.isFresh(at: context.date) != true {
                        Button("Retry arrivals") { Task { await store.refresh() } }
                    } else if arrivals.isEmpty {
                        ContentUnavailableView("No upcoming predictions", systemImage: "tram",
                                               description: Text("The feed currently has no upcoming arrivals for this station."))
                    } else {
                        ForEach(Array(arrivals.prefix(20))) { arrival in
                            VStack(alignment: .leading) {
                                HStack {
                                    RouteBadge(routeID: arrival.routeId,
                                               color: store.lines.first { $0.routeId == arrival.routeId }?.color ?? "808080")
                                    Text(arrival.direction == "N" ? "Uptown / northbound" : "Downtown / southbound")
                                }
                                if let id = arrival.destStopId,
                                   let destination = store.stations.first(where: { $0.stopIDs.contains(id) })
                                {
                                    Text("To \(destination.stop.name)").font(.subheadline)
                                }
                                Text(Date(timeIntervalSince1970: arrival.eta), style: .time)
                                    .foregroundStyle(.secondary)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                } footer: {
                    Text("MTA predictions may change. Missing predictions do not mean no service. Partial upstream outages may omit routes.")
                }
            }
        }
        .navigationTitle(station.stop.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
