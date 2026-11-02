import SwiftUI

/// A single native glass surface for the web's station/service glance grouping.
struct NearbyGlancePanel: View {
    let store: TransitStore
    let location: LocationStore
    let now: Date
    let maximumHeight: CGFloat
    let mapUnavailable: Bool
    let retryMap: () -> Void
    let openNearby: () -> Void
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
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Button(action: openNearby) {
                    Text("Nearby")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityHint("Open the full nearby arrival list")
                .accessibilityIdentifier("glanceNearbyButton")
                Spacer()
                Menu {
                    Text(store.feedLabel(at: now))
                    Text("Predictions are estimates. A dash means no prediction within 45 minutes, not no service.")
                    if let snapshot = store.snapshot, snapshot.isFresh(at: now) {
                        Text("Updated \(Date(timeIntervalSince1970: snapshot.generatedAt / 1000), style: .relative) ago")
                    }
                    Button("Refresh arrivals") { Task { await store.refresh() } }
                    if store.error != nil {
                        Button("Retry subway data") { Task { await store.loadLines() } }
                    }
                    if mapUnavailable {
                        Button("Retry map", action: retryMap)
                    }
                } label: {
                    Image(systemName: "info.circle")
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .accessibilityLabel("Arrival status")
                }
            }
            .buttonStyle(.borderless)
            .frame(minHeight: 44)
            if mapUnavailable {
                Label("Map unavailable", systemImage: "map")
                    .font(.caption)
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
                ForEach(rows) { row in
                    Divider()
                    Button(action: openNearby) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Image(systemName: "circle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(Color(uiColor: transitColor(row.color)))
                                    .accessibilityHidden(true)
                                Text(row.routes.map(RouteBadge.displayID).joined(separator: " · "))
                                    .font(.caption.weight(.bold))
                                Text(row.station.stop.name)
                                    .font(.caption.weight(.medium))
                            }
                            ViewThatFits(in: .horizontal) {
                                HStack {
                                    prediction(row.north, direction: "Northbound", symbol: "arrow.up")
                                    Spacer(minLength: 8)
                                    prediction(row.south, direction: "Southbound", symbol: "arrow.down")
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    prediction(row.north, direction: "Northbound", symbol: "arrow.up")
                                    prediction(row.south, direction: "Southbound", symbol: "arrow.down")
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
                    .accessibilityHint("Open the full nearby arrival list")
                    .accessibilityIdentifier("glance-\(row.id)")
                }
            }
        }
        .padding(12)
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

    private func prediction(_ arrival: Arrival?, direction: String, symbol: String) -> some View {
        let summary = arrival.map { "\(RouteBadge.displayID($0.routeId)) · \($0.countdown(at: now) ?? "—")" } ?? "—"
        return Label(summary, systemImage: symbol)
            .foregroundStyle(.primary)
            .accessibilityLabel(arrival.map {
                "\(direction), route \(RouteBadge.displayID($0.routeId)), predicted in \($0.countdown(at: now) ?? "unavailable")"
            } ?? "\(direction), prediction unavailable")
    }
}

private struct GlanceSurface: ViewModifier {
    let opaque: Bool
    func body(content: Content) -> some View {
        if opaque {
            content.background(Color(uiColor: .secondarySystemBackground), in: ConcentricRectangle())
        } else {
            content.glassEffect(.regular, in: ConcentricRectangle())
        }
    }
}
