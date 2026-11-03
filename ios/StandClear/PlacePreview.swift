import MapKit
import SwiftUI

/// Station proximity is a straight-line search bound. Only the walking service
/// supplies pedestrian geometry, distance, and time.
enum PlaceRouting {
    struct Route {
        let destination: Station
        let trip: NativeTripPlan?
        let boarding: Stop
        let alighting: Stop
    }

    enum Outcome {
        case noNearbyStation, noConnection, route(Route)
    }

    static func distance(from coordinate: CLLocationCoordinate2D, to stop: Stop) -> Double? {
        guard CLLocationCoordinate2DIsValid(coordinate), CLLocationCoordinate2DIsValid(stop.coordinate) else { return nil }
        return CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
            .distance(from: CLLocation(latitude: stop.lat, longitude: stop.lng))
    }

    static func route(to place: CLLocationCoordinate2D, from origin: Station, stations: [Station], lines: [SubwayLine]) -> Outcome {
        let nearby = stations.compactMap { station -> (Station, Double)? in
            guard let meters = distance(from: place, to: station.stop), meters <= 900 else { return nil }
            return (station, meters)
        }.sorted { $0.1 == $1.1 ? $0.0.id < $1.0.id : $0.1 < $1.1 }.prefix(3)
        guard !nearby.isEmpty else { return .noNearbyStation }
        for (destination, _) in nearby {
            if destination.id == origin.id {
                return .route(Route(destination: destination, trip: nil, boarding: origin.stop, alighting: origin.stop))
            }
            guard let trip = TripPlanner.plans(lines: lines, stations: stations, from: origin, to: destination).first,
                  let first = trip.legs.first, let last = trip.legs.last,
                  let boarding = lines.first(where: { $0.routeId == first.routeId })?.stops.first(where: { $0.id == first.boardStopId }),
                  let alighting = lines.first(where: { $0.routeId == last.routeId })?.stops.first(where: { $0.id == last.alightStopId })
            else { continue }
            return .route(Route(destination: destination, trip: trip, boarding: boarding, alighting: alighting))
        }
        return .noConnection
    }
}

/// Regular-service assumptions from lib/commuteRouting.ts, with the routed
/// pedestrian durations for this specific preview. An omitted origin walk is
/// zero only when the trip starts at the chosen station or is a direct walk.
struct PlaceTimeEstimate {
    let walkingSeconds: Double
    let totalSeconds: Double

    init?(stopsPerLeg: [Int], accessSeconds: Double?, egressSeconds: Double?) {
        guard let accessSeconds, let egressSeconds,
              accessSeconds.isFinite, accessSeconds >= 0, egressSeconds.isFinite, egressSeconds >= 0,
              stopsPerLeg.allSatisfy({ $0 > 0 }) else { return nil }
        let walking = accessSeconds + egressSeconds
        let riding = stopsPerLeg.reduce(0.0) { $0 + Double($1) * 90 }
        let waits = Double(stopsPerLeg.count) * 240
        let transfers = Double(max(0, stopsPerLeg.count - 1)) * 180
        let total = walking + riding + waits + transfers
        guard total.isFinite else { return nil }
        walkingSeconds = walking
        totalSeconds = total
    }
}

/// Holds at most one successful result for each walking leg in the open preview.
struct PlaceWalkMemory {
    enum Leg { case toStation, toPlace }

    private struct Entry {
        let start, end: CLLocationCoordinate2D
        let fromLocation: Bool
        let connection: WalkingConnection
        let date: Date
    }

    private var entries: [Leg: Entry] = [:]

    mutating func remember(_ connection: WalkingConnection, leg: Leg, start: CLLocationCoordinate2D,
                           end: CLLocationCoordinate2D, fromLocation: Bool, at date: Date = .now)
    {
        entries[leg] = Entry(start: start, end: end, fromLocation: fromLocation, connection: connection, date: date)
    }

    func connection(for leg: Leg, start: CLLocationCoordinate2D, end: CLLocationCoordinate2D,
                    fromLocation: Bool, at date: Date = .now) -> WalkingConnection?
    {
        guard let entry = entries[leg], entry.fromLocation == fromLocation,
              (0 ..< 300).contains(date.timeIntervalSince(entry.date)),
              entry.end.latitude == end.latitude, entry.end.longitude == end.longitude else { return nil }
        if entry.start.latitude == start.latitude, entry.start.longitude == start.longitude {
            return entry.connection
        }
        // Station endpoints are exact. Only the explicitly approximate rider
        // position can reuse a recent street path after a small GPS fluctuation.
        guard fromLocation else { return nil }
        let previous = CLLocation(latitude: entry.start.latitude, longitude: entry.start.longitude)
        let current = CLLocation(latitude: start.latitude, longitude: start.longitude)
        return previous.distance(from: current) < 25 ? entry.connection : nil
    }

    mutating func discardLocationWalks() {
        entries = entries.filter { !$0.value.fromLocation }
    }
}

struct PlacePreview: View {
    let place: PlaceResult
    let store: TransitStore
    let location: LocationStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var manualID: String?
    @State private var suggestedID: String?
    @State private var revision = 0
    @State private var preview: Preview?
    @State private var walks = PlaceWalkMemory()
    @State private var camera: MapCameraPosition = .automatic

    private struct Point: Equatable {
        let latitude, longitude: Double
        init(_ coordinate: CLLocationCoordinate2D) {
            latitude = coordinate.latitude
            longitude = coordinate.longitude
        }

        var coordinate: CLLocationCoordinate2D {
            .init(latitude: latitude, longitude: longitude)
        }
    }

    private struct Request: Equatable {
        let place: PlaceResult
        let manualID: String?
        let fix: Point?
        let stationCount: Int
        let active: Bool
        let revision: Int
    }

    private var request: Request {
        Request(place: place, manualID: manualID, fix: manualID == nil ? location.availableCoordinate.map(Point.init) : nil,
                stationCount: store.stations.count, active: scenePhase == .active, revision: revision)
    }

    private enum Walk {
        case omitted, loading, unavailable, ready(WalkingConnection)
        var secondsForEstimate: Double? {
            if case .omitted = self {
                return 0
            }
            return connection?.seconds
        }

        var connection: WalkingConnection? {
            if case let .ready(value) = self {
                return value
            }
            return nil
        }
    }

    private struct Preview {
        let request: Request
        let origin: Station?
        let outcome: PlaceRouting.Outcome?
        var access: Walk = .omitted
        var egress: Walk = .omitted
    }

    var body: some View {
        let key = request
        // Hide old geometry immediately when the input changes, including an
        // expired fix. A cancelled request can never publish a prior route.
        let current = preview?.request == key && key.active ? preview : nil
        GeometryReader { geometry in
            if geometry.size.width >= 640, !typeSize.isAccessibilitySize {
                HStack(spacing: 0) {
                    routeMap(current)
                    details(current, mapHeight: nil)
                        .frame(width: min(420, geometry.size.width * 0.48))
                }
            } else {
                details(current, mapHeight: min(300, max(145, geometry.size.height * 0.32)))
            }
        }
        .navigationTitle("Route preview")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: key.active && key.fix != nil) { _, usable in
            if !usable {
                walks.discardLocationWalks()
            }
        }
        .onDisappear { walks.discardLocationWalks() }
        .task(id: key) { await load(key) }
    }

    private func load(_ key: Request) async {
        guard key.active, !Task.isCancelled else { return }
        let origin: Station?
        if let manualID = key.manualID {
            origin = store.stations.first { $0.id == manualID }
        } else if let fix = key.fix?.coordinate {
            if let previous = store.stations.first(where: { $0.id == suggestedID }),
               let meters = PlaceRouting.distance(from: fix, to: previous.stop), meters <= 900
            {
                origin = previous
            } else {
                var selection = DirectionsSelection()
                selection.suggestOrigin(stations: store.stations, coordinate: fix)
                suggestedID = selection.originID
                origin = selection.origin(in: store.stations)
            }
        } else {
            origin = nil
        }
        let outcome = origin.map { PlaceRouting.route(to: key.place.coordinate, from: $0, stations: store.stations, lines: store.lines) }
        var result = Preview(request: key, origin: origin, outcome: outcome)
        guard case let .route(route)? = outcome else {
            preview = result
            frameMap(result)
            return
        }
        let accessStart = route.trip == nil ? nil : key.fix?.coordinate
        if let accessStart {
            result.access = walks.connection(for: .toStation, start: accessStart, end: route.boarding.coordinate, fromLocation: true).map(Walk.ready) ?? .loading
        }
        let directFromLocation = route.trip == nil && key.fix != nil
        let egressStart = route.trip == nil ? (key.fix?.coordinate ?? route.alighting.coordinate) : route.alighting.coordinate
        result.egress = walks.connection(for: .toPlace, start: egressStart, end: key.place.coordinate, fromLocation: directFromLocation).map(Walk.ready) ?? .loading
        preview = result
        frameMap(result)
        let service = PlaceService()
        if let accessStart, case .loading = result.access {
            result.access = await walking(service, leg: .toStation, from: accessStart, to: route.boarding.coordinate, fromLocation: true, key: key)
            guard !Task.isCancelled, request == key else { return }
            preview = result
        }
        if case .loading = result.egress {
            result.egress = await walking(service, leg: .toPlace, from: egressStart, to: key.place.coordinate,
                                          fromLocation: directFromLocation, key: key)
            guard !Task.isCancelled, request == key else { return }
            preview = result
        }
        if !camera.positionedByUser {
            frameMap(result)
        }
    }

    private func walking(_ service: PlaceService, leg: PlaceWalkMemory.Leg, from: CLLocationCoordinate2D, to: CLLocationCoordinate2D,
                         fromLocation: Bool, key: Request) async -> Walk
    {
        guard !Task.isCancelled, request == key else { return .unavailable }
        do {
            let connection = try await service.walk(from: from, to: to)
            guard !Task.isCancelled, request == key else { return .unavailable }
            walks.remember(connection, leg: leg, start: from, end: to, fromLocation: fromLocation)
            return .ready(connection)
        } catch {
            return .unavailable
        }
    }

    private func details(_ current: Preview?, mapHeight: CGFloat?) -> some View {
        List {
            if let mapHeight {
                routeMap(current).frame(height: mapHeight)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                LabeledContent("To", value: place.name)
                if !place.subtitle.isEmpty {
                    Text(place.subtitle).foregroundStyle(.secondary)
                }
                NavigationLink {
                    DirectionStationPicker(stations: store.stations, title: "From station") { station in manualID = station.id }
                } label: {
                    LabeledContent("From station", value: current?.origin?.stop.name ?? "Choose station")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .disabled(store.stations.isEmpty)
                .accessibilityIdentifier("placeOriginPicker")
                if current?.origin != nil, manualID == nil {
                    Text("Suggested from your approximate location.").font(.subheadline).foregroundStyle(.secondary)
                } else if manualID != nil {
                    Text("Your trip begins at the selected station.").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            if store.loading {
                ProgressView("Loading subway stations…")
            } else if store.error != nil {
                ContentUnavailableView("Stations unavailable", systemImage: "tram", description: Text("Subway stations could not be loaded."))
                Button("Retry stations") { Task { await store.loadLines() } }
            } else if let current {
                switch current.outcome {
                case nil:
                    ContentUnavailableView("Choose a starting station", systemImage: "tram",
                                           description: Text("Select From station to preview a trip to this place."))
                case .noNearbyStation:
                    ContentUnavailableView("No nearby subway station", systemImage: "mappin.slash",
                                           description: Text("No station in the data is within 900 metres of this place."))
                case .noConnection:
                    ContentUnavailableView("No subway route found", systemImage: "tram",
                                           description: Text("No direct or one-transfer trip was found to the nearby stations checked. Try another starting station."))
                case let .route(route):
                    itinerary(route, current: current)
                }
            } else {
                ProgressView("Preparing preview…")
            }
        }
        .accessibilityIdentifier("placePreviewList")
    }

    private func itinerary(_ route: PlaceRouting.Route, current: Preview) -> some View {
        Section {
            if let trip = route.trip {
                if current.request.fix != nil {
                    walkingRow("Walk to \(route.boarding.name)", walk: current.access)
                }
                ForEach(trip.legs) { leg in
                    let stops = store.lines.first { $0.routeId == leg.routeId }?.stops ?? []
                    let boarding = stops.first { $0.id == leg.boardStopId }?.name ?? leg.boardStopId
                    let alighting = stops.first { $0.id == leg.alightStopId }?.name ?? leg.alightStopId
                    VStack(alignment: .leading, spacing: 4) {
                        Label("\(leg.routeIDs.map(RouteBadge.displayID).joined(separator: "/")) · \(leg.direction == "N" ? "Northbound" : "Southbound")", systemImage: "tram")
                            .font(.headline)
                        Text("\(boarding) → \(alighting)")
                        Text("\(leg.stopCount) stops").font(.subheadline).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("placeTripLeg-\(leg.id)")
                }
            } else {
                Text(current.request.fix == nil ? "Walk from the selected station to your destination." : "Walk directly from your approximate location to your destination.")
            }
            walkingRow("Walk to \(place.name)", walk: current.egress)
                .accessibilityIdentifier("placeDestinationWalk")
            if let estimate = PlaceTimeEstimate(stopsPerLeg: route.trip?.legs.map(\.stopCount) ?? [],
                                                accessSeconds: current.access.secondsForEstimate,
                                                egressSeconds: current.egress.connection?.seconds)
            {
                walkingTotal(seconds: estimate.walkingSeconds)
                if route.trip != nil {
                    LabeledContent("Typical total trip time", value: "About \(minutes(estimate.totalSeconds))")
                        .accessibilityIdentifier("placeTripTimeEstimate")
                }
            }
            if case .unavailable = current.egress {
                Button("Retry walking directions") { revision += 1 }
            } else if case .unavailable = current.access {
                Button("Retry walking directions") { revision += 1 }
            }
        } header: {
            Text("Itinerary")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if route.trip != nil {
                    Text("Typical total time combines the walking routes with regular-service estimates of 4 minutes per train wait, 90 seconds per stop, and 3 minutes per transfer. Actual service can vary.")
                }
                Text("Walking routes use station coordinates. Entrances and step-free access are unverified.")
            }
        }
    }

    private func walkingTotal(seconds: Double) -> some View {
        LabeledContent("Estimated walking time", value: minutes(seconds))
            .accessibilityIdentifier("placeWalkingTotal")
    }

    private func minutes(_ seconds: Double) -> String {
        seconds < 60 ? "<1 min" : "\(ceil(seconds / 60).formatted(.number.precision(.fractionLength(0)))) min"
    }

    private func walkingRow(_ title: String, walk: Walk) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: "figure.walk").font(.headline)
            switch walk {
            case let .ready(connection):
                let distance = Measurement(value: connection.meters, unit: UnitLength.meters)
                Text("\(minutes(connection.seconds)) · \(distance.formatted(.measurement(width: .abbreviated, usage: .road)))")
            case .loading: ProgressView("Finding walking route…")
            case .unavailable: Text("Walking route unavailable").foregroundStyle(.secondary)
            case .omitted: EmptyView()
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func frameMap(_ result: Preview) {
        var points = [result.request.place.coordinate]
        if case let .route(route)? = result.outcome {
            points += [route.boarding.coordinate, route.alighting.coordinate]
            points += TripMapOverlay.make(plan: route.trip, lines: store.lines).flatMap(\.coordinates)
            points += result.access.connection?.coordinates ?? []
            points += result.egress.connection?.coordinates ?? []
        }
        let bounds = points.reduce(MKMapRect.null) { rect, coordinate in
            rect.union(MKMapRect(origin: MKMapPoint(coordinate), size: MKMapSize(width: 1, height: 1)))
        }
        let margin = 300 * MKMapPointsPerMeterAtLatitude(place.latitude)
        camera = .rect(bounds.insetBy(dx: -max(bounds.width * 0.15, margin), dy: -max(bounds.height * 0.15, margin)))
    }

    private func routeMap(_ current: Preview?) -> some View {
        Map(position: $camera, interactionModes: [.pan, .zoom]) {
            Marker(place.name, systemImage: "mappin", coordinate: place.coordinate)
            if case let .route(route)? = current?.outcome {
                ForEach(TripMapOverlay.make(plan: route.trip, lines: store.lines)) { overlay in
                    MapPolyline(coordinates: overlay.coordinates).stroke(Color(uiColor: transitColor(overlay.color)), lineWidth: 5)
                }
                if route.trip != nil {
                    Marker(route.boarding.name, systemImage: "tram", coordinate: route.boarding.coordinate)
                    Marker(route.alighting.name, systemImage: "tram", coordinate: route.alighting.coordinate)
                }
                if let walking = current?.access.connection {
                    MapPolyline(coordinates: walking.coordinates).stroke(.blue, style: StrokeStyle(lineWidth: 4, dash: [6, 4]))
                }
                if let walking = current?.egress.connection {
                    MapPolyline(coordinates: walking.coordinates).stroke(.blue, style: StrokeStyle(lineWidth: 4, dash: [6, 4]))
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .accessibilityLabel("Map of the trip to \(place.name)")
        .accessibilityHint("The itinerary lists each segment.")
        .accessibilityIdentifier("placePreviewMap")
    }
}
