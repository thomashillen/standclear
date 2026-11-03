import SwiftUI

/// A single native glass surface for the web's station/service glance grouping.
struct NearbyGlancePanel: View {
    let store: TransitStore
    let location: LocationStore
    let now: Date
    let maximumHeight: CGFloat
    let mapUnavailable: Bool
    let retryMap: () -> Void
    let openStation: (String) -> Void
    let openNearby: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var contentHeight: CGFloat = 1
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private var rows: [NearbyGlanceRow] {
        NearbyGlanceProjection.rows(stations: store.stations, lines: store.lines,
                                    snapshot: store.snapshot, coordinate: location.availableCoordinate,
                                    now: now, feedUnavailable: store.feedError)
    }

    var body: some View {
        ScrollView {
            content.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(contentHeight, maximumHeight), alignment: .top)
        .modifier(GlanceSurface(opaque: reduceTransparency))
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            if mapUnavailable {
                Label("Map unavailable", systemImage: "map")
                    .font(.caption)
                Button("Retry map", action: retryMap)
            }
            if location.availableCoordinate == nil {
                locationState
            } else if store.loading {
                ProgressView("Loading nearby stations…")
            } else if let error = store.error {
                Text(error).font(.caption)
                Button("Retry stations") { Task { await store.loadLines() } }
            } else if rows.isEmpty {
                Text("No subway stations within 900 m.").font(.subheadline)
                Button("Browse stations", action: openNearby)
            } else {
                if store.feedError || store.snapshot?.isFresh(at: now) != true {
                    Text(store.feedLabel(at: now)).font(.caption)
                    Button("Retry arrivals") { Task { await store.refresh() } }
                }
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Divider()
                    }
                    Button { openStation(row.station.id) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.station.stop.name)
                                .font(.caption.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                            ViewThatFits(in: .horizontal) {
                                HStack {
                                    prediction(row.north, routes: row.routes, color: row.color, direction: "Northbound", symbol: "arrow.up")
                                    Spacer(minLength: 8)
                                    prediction(row.south, routes: row.routes, color: row.color, direction: "Southbound", symbol: "arrow.down")
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    prediction(row.north, routes: row.routes, color: row.color, direction: "Northbound", symbol: "arrow.up")
                                    prediction(row.south, routes: row.routes, color: row.color, direction: "Southbound", symbol: "arrow.down")
                                }
                            }
                            .font(.caption)
                            .monospacedDigit()
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityHint("Show arrivals and service alerts for this station")
                    .accessibilityIdentifier("glance-\(row.id)")
                }
            }
        }
        .padding(8)
    }

    @ViewBuilder private var locationState: some View {
        if location.status == .denied || location.status == .restricted {
            Label("Location access is off", systemImage: "location.slash")
                .font(.subheadline)
            Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
        } else if let message = location.message {
            Text(message).font(.caption)
            Button("Retry location") { location.start() }
        } else {
            ProgressView("Finding nearby stations…")
        }
    }

    private func prediction(_ arrival: Arrival?, routes: [String], color: String, direction: String, symbol: String) -> some View {
        HStack(spacing: 3) {
            if let arrival {
                RouteBadge(routeID: arrival.routeId, color: color)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 3) {
                        ForEach(routes, id: \.self) { route in
                            RouteBadge(routeID: route, color: color)
                        }
                    }
                    Text(routes.map(RouteBadge.displayID).joined(separator: " · "))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Image(systemName: symbol)
            Text(arrival?.countdown(at: now)?.replacingOccurrences(of: " min", with: "m") ?? "—")
        }
        .fixedSize(horizontal: false, vertical: true)
        .foregroundStyle(.primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(arrival.map {
            "\(direction), route \(TransitRouteIdentity($0.routeId).spokenName), predicted in \($0.countdown(at: now) ?? "unavailable")"
        } ?? "\(direction), routes \(routes.map(RouteBadge.displayID).joined(separator: ", ")), prediction unavailable")
    }
}

private struct GlanceSurface: ViewModifier {
    let opaque: Bool
    func body(content: Content) -> some View {
        if opaque {
            content.background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20))
        } else {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20))
        }
    }
}
