import SwiftUI

/// A single native glass surface for the web's station/service glance grouping.
struct NearbyGlancePanel: View {
    let store: TransitStore
    let location: LocationStore
    let maximumHeight: CGFloat
    let openStation: (String) -> Void
    let openNearby: () -> Void
    let openLocationHelp: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var contentHeight: CGFloat = 1
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { _ in
            // Read the clock where feed-driven changes invalidate the content,
            // rather than inheriting the parent's previous scheduled tick.
            let now = Date.now
            ScrollView {
                content(at: now).onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: min(contentHeight, maximumHeight), alignment: .top)
            .modifier(GlanceSurface(opaque: reduceTransparency))
        }
    }

    private func content(at now: Date) -> some View {
        let rows = NearbyGlanceProjection.rows(stations: store.stations, lines: store.lines,
                                               snapshot: store.snapshot, coordinate: location.availableCoordinate,
                                               now: now, feedUnavailable: store.feedError)
        return VStack(alignment: .leading, spacing: 0) {
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
                                    prediction(row.north, routes: row.routes, color: row.color, direction: "Northbound", symbol: "arrow.up", now: now)
                                    Spacer(minLength: 8)
                                    prediction(row.south, routes: row.routes, color: row.color, direction: "Southbound", symbol: "arrow.down", now: now)
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    prediction(row.north, routes: row.routes, color: row.color, direction: "Northbound", symbol: "arrow.up", now: now)
                                    prediction(row.south, routes: row.routes, color: row.color, direction: "Southbound", symbol: "arrow.down", now: now)
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
            if typeSize.isAccessibilitySize {
                locationHelp("Location access is off", hint: "Show location help and Open Settings in Nearby arrivals")
            } else {
                Label("Location access is off", systemImage: "location.slash")
                    .font(.subheadline)
                Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
            }
        } else if let message = location.message {
            if typeSize.isAccessibilitySize {
                locationHelp("Location unavailable", hint: "Show location details and Retry location in Nearby arrivals")
            } else {
                Text(message).font(.caption)
                Button("Retry location") { location.start() }
            }
        } else if typeSize.isAccessibilitySize {
            VStack(spacing: 8) {
                // Size only the native indicator; the complete status keeps Dynamic Type.
                ProgressView()
                    .controlSize(.small)
                Text("Finding nearby stations…")
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Finding nearby stations…")
        } else {
            ProgressView("Finding nearby stations…")
        }
    }

    private func locationHelp(_ title: String, hint: String) -> some View {
        Button(action: openLocationHelp) {
            HStack(spacing: 8) {
                Text(title)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .accessibilityHidden(true)
            }
            .font(.subheadline)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(title)
        .accessibilityHint(hint)
        .accessibilityIdentifier("glanceLocationOptions")
    }

    private func prediction(_ arrival: Arrival?, routes: [String], color: String, direction: String, symbol: String, now: Date) -> some View {
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
