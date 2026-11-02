import CoreLocation
import MapboxMaps
import SwiftUI

struct MapShell: View {
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var store = TransitStore()
    @State private var location = LocationStore()
    @State private var viewport = Viewport.camera(
        center: CLLocationCoordinate2D(latitude: 40.754, longitude: -73.984), zoom: 11
    )
    @State private var panel: Panel?
    @State private var expandedSearch = false
    @State private var searchQuery = ""
    @State private var mapError = false
    @State private var mapLoaded = false
    @State private var mapID = UUID()
    enum Panel: String, Identifiable {
        case search, nearby
        var id: String {
            rawValue
        }
    }

    private var hasToken: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String)?.hasPrefix("pk.") == true
    }

    var body: some View {
        GeometryReader { geometry in
            // Window geometry, not a device identifier, selects the control region.
            let expanded = geometry.size.width >= 640 && !typeSize.isAccessibilitySize
            let controlWidth = min(geometry.size.width * 0.4, 380)
            let statusWidth = expanded ? geometry.size.width - controlWidth : geometry.size.width
            Group {
                if expanded {
                    ZStack(alignment: .trailing) {
                        map(statusWidth: statusWidth, coveredWidth: geometry.size.width - statusWidth)
                        VStack(spacing: 0) {
                            NavigationStack { stationBrowser(search: expandedSearch) }
                                .id(expandedSearch)
                            ControlGroup {
                                Button("Search", systemImage: "magnifyingglass") { expandedSearch = true }
                                    .accessibilityIdentifier("searchButton")
                                Button("Nearby", systemImage: "location") {
                                    expandedSearch = false
                                    location.start()
                                }
                                .accessibilityIdentifier("nearbyButton")
                                moreMenu
                            }
                            .labelStyle(.iconOnly)
                            .controlSize(.large)
                            .padding()
                        }
                        .frame(width: controlWidth)
                        .background(.regularMaterial)
                    }
                } else {
                    NavigationStack {
                        map(statusWidth: statusWidth, coveredWidth: 0)
                            .navigationTitle("StandClear")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItemGroup(placement: .bottomBar) {
                                    Button("Search", systemImage: "magnifyingglass") { panel = .search }
                                        .accessibilityIdentifier("searchButton")
                                    Spacer()
                                    Button("Nearby", systemImage: "location") { panel = .nearby; location.start() }
                                        .accessibilityIdentifier("nearbyButton")
                                    moreMenu
                                }
                            }
                    }
                }
            }
            .onChange(of: expanded) { _, isExpanded in
                guard isExpanded, let activePanel = panel else { return }
                expandedSearch = activePanel == .search
                panel = nil
            }
            .sheet(item: $panel) { panel in
                NavigationStack {
                    stationBrowser(search: panel == .search)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { self.panel = nil } }
                        }
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                location.stop(); store.stop()
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { location.stop(); store.stop(); return }
            location.start()
            await store.run()
        }
    }

    @ViewBuilder private func map(statusWidth: CGFloat, coveredWidth: CGFloat) -> some View {
        if hasToken {
            TimelineView(.periodic(from: .now, by: 5)) { timeline in
                ZStack(alignment: .topLeading) {
                    Map(viewport: $viewport) {
                        ForEvery(store.lines, id: \.routeId) { line in
                            PolylineAnnotation(lineCoordinates: line.coordinates)
                                .lineColor(StyleColor(transitColor(line.color)))
                                .lineWidth(3)
                        }
                        if let snapshot = store.snapshot, snapshot.isFresh(at: timeline.date), !store.feedError {
                            CircleAnnotationGroup(markers(snapshot, at: timeline.date)) { marker in
                                CircleAnnotation(centerCoordinate: marker.coordinate)
                                    .circleColor(StyleColor(transitColor(marker.color)))
                                    .circleRadius(5)
                                    .circleStrokeWidth(2)
                                    .circleStrokeColor(.white)
                                    .circleOpacity(marker.stale ? 0.4 : 1)
                            }
                            if differentiateWithoutColor {
                                PointAnnotationGroup(markers(snapshot, at: timeline.date)) { marker in
                                    PointAnnotation(coordinate: marker.coordinate)
                                        .textField(marker.routeID)
                                        .textColor(.black)
                                        .textHaloColor(.white)
                                        .textHaloWidth(2)
                                }
                            }
                        }
                    }
                    .mapStyle(colorScheme == .dark ? .dark : .light)
                    .ornamentOptions(ornaments(coveredWidth: coveredWidth))
                    .onMapLoaded { _ in mapLoaded = true; mapError = false }
                    .onMapLoadingError { _ in mapError = true }
                    .accessibilityLabel("Subway map. Use Search or Nearby for accessible station arrivals.")
                    .ignoresSafeArea(edges: .top)
                    .id(mapID)
                    Menu {
                        Text(store.feedLabel(at: timeline.date))
                        if let snapshot = store.snapshot, snapshot.isFresh(at: timeline.date) {
                            let stale = snapshot.uniqueTrains.filter {
                                timeline.date.timeIntervalSince1970 - ($0.lastReportedAt ?? snapshot.generatedAt / 1000) > 90
                            }.count
                            if stale > 0 {
                                Text("\(stale) train positions are over 90 seconds old; dimmed or hidden on map.")
                            }
                        }
                        if store.feedError || store.snapshot?.isFresh(at: timeline.date) == false {
                            Button("Retry arrivals") { Task { await store.refresh() } }
                        }
                        if let error = store.error {
                            Text(error)
                            Button("Retry subway data") { Task { await store.loadLines() } }
                        }
                        if mapError {
                            Text("Map unavailable. Station search remains available.")
                            Button("Retry map") { mapError = false; mapLoaded = false; mapID = UUID() }
                        }
                    } label: {
                        let title = store.error != nil ? "Subway data unavailable" : mapError ? "Map unavailable" :
                            store.loading || !mapLoaded ? "Loading subway map…" : store.feedLabel(at: timeline.date)
                        if typeSize.isAccessibilitySize {
                            Image(systemName: "info.circle")
                                .accessibilityLabel(title)
                        } else {
                            Label(title, systemImage: "info.circle")
                        }
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .padding()
                    .frame(maxWidth: statusWidth, alignment: .leading)
                }
            }
        } else {
            ContentUnavailableView("Map configuration needed", systemImage: "map",
                                   description: Text("Add a public Mapbox token to the local Xcode configuration. Station search remains available."))
        }
    }

    private var moreMenu: some View {
        Menu("More", systemImage: "ellipsis") {
            Button("Refresh arrivals", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
            Link("Open web app", destination: URL(string: "https://standclear.vercel.app")!)
        }
    }

    private func ornaments(coveredWidth: CGFloat) -> OrnamentOptions {
        // Preserve the SDK's attribution/compass controls beside the trailing region.
        var options = OrnamentOptions()
        options.attributionButton.margins.x += coveredWidth
        options.compass.margins.x += coveredWidth
        return options
    }

    private struct TrainMarker: Identifiable {
        let id: String
        let coordinate: CLLocationCoordinate2D
        let color: String
        let routeID: String
        let stale: Bool
    }

    private func markers(_ snapshot: Snapshot, at date: Date) -> [TrainMarker] {
        snapshot.uniqueTrains.compactMap { train in
            guard let line = store.lines.first(where: { $0.routeId == train.routeId }),
                  let coordinate = Transit.coordinate(train, line: line) else { return nil }
            let age = date.timeIntervalSince1970 - (train.lastReportedAt ?? snapshot.generatedAt / 1000)
            guard age <= 360 else { return nil }
            return TrainMarker(id: train.id, coordinate: coordinate, color: line.color, routeID: line.id, stale: age > 90)
        }
    }

    private func stationBrowser(search: Bool) -> some View {
        StationBrowser(store: store, location: location, search: search, query: $searchQuery) { station in
            viewport = .camera(center: station.stop.coordinate, zoom: 14)
        }
    }
}

func transitColor(_ hex: String) -> UIColor {
    let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x808080
    return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                   green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
}
