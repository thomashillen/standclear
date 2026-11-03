import MapKit
import SwiftUI

/// Straight-line distances only bound and shortlist station candidates. The
/// walking service supplies the rider-facing geometry, distance, and time.
enum PlaceRouting {
    static let maximumWalkingMeters = 2500.0
    static let originSearchMeters = 1100.0
    static let destinationSearchMeters = 1800.0

    struct Route: Identifiable {
        let origin: Station
        let destination: Station
        let trip: NativeTripPlan?
        let boarding: Stop
        let alighting: Stop

        var id: String {
            "\(origin.id)>\(destination.id):\(trip?.id ?? "walk")"
        }

        fileprivate var servicePattern: String {
            trip?.legs.map { $0.routeIDs.sorted().joined(separator: "/") + "-" + $0.direction }.joined(separator: "|") ?? "walk"
        }
    }

    enum Options {
        case noOrigin, noNearbyStation, noConnection, routes([Route])
    }

    static func distance(from coordinate: CLLocationCoordinate2D, to stop: Stop) -> Double? {
        distance(from: coordinate, to: stop.coordinate)
    }

    private static func distance(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D) -> Double? {
        guard CLLocationCoordinate2DIsValid(start), CLLocationCoordinate2DIsValid(end) else { return nil }
        return CLLocation(latitude: start.latitude, longitude: start.longitude)
            .distance(from: CLLocation(latitude: end.latitude, longitude: end.longitude))
    }

    private static func nearby(_ coordinate: CLLocationCoordinate2D, stations: [Station], meters: Double, limit: Int) -> [Station] {
        let ranked = stations.compactMap { station -> (station: Station, meters: Double)? in
            guard let separation = distance(from: coordinate, to: station.stop), separation <= meters else { return nil }
            return (station, separation)
        }.sorted { $0.meters == $1.meters ? $0.station.id < $1.station.id : $0.meters < $1.meters }
        return ranked.prefix(limit).map(\.station)
    }

    static func options(to place: CLLocationCoordinate2D, from manual: Station?, location: CLLocationCoordinate2D?,
                        stations: [Station], lines: [SubwayLine],
                        excludingBoardingStops: Set<String> = [], excludingAlightingStops: Set<String> = [],
                        excludingOptionIDs: Set<String> = []) -> Options
    {
        let origins: [Station]
        if let manual {
            origins = [manual]
        } else if let location {
            origins = nearby(location, stations: stations, meters: originSearchMeters, limit: 4)
        } else {
            return .noOrigin
        }
        guard !origins.isEmpty else { return .noOrigin }
        let destinations = nearby(place, stations: stations, meters: destinationSearchMeters, limit: 6)
        guard !destinations.isEmpty else { return .noNearbyStation }

        let graph = TripPlanner.Network(lines: lines, stations: stations)
        let routeByID = Dictionary(lines.map { ($0.routeId, $0) }, uniquingKeysWith: { first, _ in first })
        var candidates: [(route: Route, score: Double)] = []
        var hasDirectWalk = false
        for origin in origins {
            for destination in destinations {
                if origin.id == destination.id {
                    if !hasDirectWalk, let start = manual?.stop.coordinate ?? location,
                       let meters = distance(from: start, to: place), meters <= maximumWalkingMeters
                    {
                        let walk = Route(origin: origin, destination: destination, trip: nil, boarding: origin.stop, alighting: origin.stop)
                        candidates.append((walk, meters * 1.3 / 1.4))
                        hasDirectWalk = true
                    }
                    continue
                }
                for trip in graph.plans(from: origin, to: destination) {
                    guard let first = trip.legs.first, let last = trip.legs.last,
                          let boarding = routeByID[first.routeId]?.stops.first(where: { $0.id == first.boardStopId }),
                          let alighting = routeByID[last.routeId]?.stops.first(where: { $0.id == last.alightStopId }),
                          !excludingBoardingStops.contains(boarding.id), !excludingAlightingStops.contains(alighting.id),
                          let exitMeters = distance(from: place, to: alighting), exitMeters <= destinationSearchMeters else { continue }
                    let accessMeters: Double
                    if manual != nil {
                        accessMeters = 0
                    } else {
                        guard let location, let meters = distance(from: location, to: boarding), meters <= originSearchMeters else { continue }
                        accessMeters = meters
                    }
                    // Web's walking proxy and regular-service assumptions are
                    // internal to shortlisting. Verified street walks replace
                    // the proxy before the preview displays any duration.
                    let walkSeconds = (accessMeters + exitMeters) * 1.3 / 1.4
                    guard let estimate = PlaceTimeEstimate(stopsPerLeg: trip.legs.map(\.stopCount),
                                                           accessSeconds: 0, egressSeconds: walkSeconds) else { continue }
                    let route = Route(origin: origin, destination: destination, trip: trip, boarding: boarding, alighting: alighting)
                    candidates.append((route, estimate.totalSeconds))
                }
            }
        }

        candidates.removeAll { excludingOptionIDs.contains($0.route.id) }
        candidates.sort { $0.score == $1.score ? $0.route.id < $1.route.id : $0.score < $1.score }
        guard let best = candidates.first else { return .noConnection }
        // First show distinct service choices. Neighboring exits on the same
        // train can fill open slots but must not hide a viable direct ride.
        let plausible = candidates.prefix { $0.score <= best.score + max(900, best.score * 0.25) }
        var seenPatterns = Set<String>()
        var options: [Route] = []
        for candidate in plausible where seenPatterns.insert(candidate.route.servicePattern).inserted {
            options.append(candidate.route)
            if options.count == 3 {
                break
            }
        }
        if options.count < 3 {
            for candidate in plausible where !options.contains(where: { $0.id == candidate.route.id }) {
                options.append(candidate.route)
                if options.count == 3 {
                    break
                }
            }
        }
        let chosen = Set(options.map(\.id))
        var emitted = Set<String>()
        return .routes(plausible.compactMap { chosen.contains($0.route.id) && emitted.insert($0.route.id).inserted ? $0.route : nil })
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

@MainActor @Observable
final class PlacePreviewSession {
    enum Origin: Equatable {
        case currentLocation, station(String), place(PlaceResult)
    }

    private(set) var origin: Origin = .currentLocation
    var selectedOptionID: String?
    var usesCurrentLocation: Bool {
        origin == .currentLocation
    }

    func choose(_ origin: Origin) {
        guard self.origin != origin else { return }
        self.origin = origin
        selectedOptionID = nil
    }
}

struct PlacePreview: View {
    let place: PlaceResult
    let store: TransitStore
    let location: LocationStore
    let session: PlacePreviewSession
    let onMapChange: (PlaceMapRoute?) -> Void
    var onEditingOriginChanged: (Bool) -> Void = { _ in }
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var preview: Preview?
    @State private var walks = PlaceWalkMemory()
    @State private var revision = 0

    private struct Point: Hashable {
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
        let origin: PlacePreviewSession.Origin
        let fix: Point?
        let stationCount: Int
        let linesRevision: UInt64
        let active: Bool
        let revision: Int

        var start: CLLocationCoordinate2D? {
            switch origin {
            case .currentLocation: fix?.coordinate
            case let .place(place): place.coordinate
            case .station: nil
            }
        }
    }

    private var request: Request {
        Request(place: place, origin: session.origin, fix: session.usesCurrentLocation ? location.availableCoordinate.map(Point.init) : nil,
                stationCount: store.stations.count, linesRevision: store.linesRevision, active: scenePhase == .active, revision: revision)
    }

    enum Walk {
        case omitted, notRequired, loading, unavailable, noRoute, tooLong, ready(WalkingConnection)

        init(from start: CLLocationCoordinate2D, to end: CLLocationCoordinate2D, cached: WalkingConnection?) {
            if start.latitude == end.latitude, start.longitude == end.longitude {
                self = .notRequired
            } else {
                self = cached.map(Self.ready) ?? .loading
            }
        }

        var secondsForEstimate: Double? {
            switch self {
            case .omitted, .notRequired: 0
            case let .ready(walk): walk.seconds
            case .loading, .unavailable, .noRoute, .tooLong: nil
            }
        }

        var rulesOutOption: Bool {
            switch self {
            case .noRoute, .tooLong: true
            default: false
            }
        }

        var connection: WalkingConnection? {
            if case let .ready(value) = self {
                return value
            }
            return nil
        }
    }

    private struct Option: Identifiable {
        let route: PlaceRouting.Route
        var access: Walk
        var egress: Walk
        var id: String {
            route.id
        }

        var estimate: PlaceTimeEstimate? {
            PlaceTimeEstimate(stopsPerLeg: route.trip?.legs.map(\.stopCount) ?? [],
                              accessSeconds: access.secondsForEstimate, egressSeconds: egress.secondsForEstimate)
        }
    }

    private enum Issue { case noOrigin, noNearbyStation, noConnection, noUsableWalk }

    private struct Preview {
        let request: Request
        var options: [Option] = []
        var issue: Issue?
    }

    private var originName: String {
        switch session.origin {
        case .currentLocation: "Current Location"
        case let .place(place): place.name
        case let .station(id): store.stations.first { $0.id == id }?.stop.name ?? "Station unavailable"
        }
    }

    var body: some View {
        let key = request
        let current = key.active && preview?.request == key ? preview : nil
        List {
            Section {
                NavigationLink {
                    PlaceOriginPicker(stations: store.stations) { origin in
                        if origin == .currentLocation, location.availableCoordinate == nil {
                            location.start()
                        }
                        session.choose(origin)
                    }
                    .onAppear { onEditingOriginChanged(true) }
                    .onDisappear { onEditingOriginChanged(false) }
                } label: {
                    LabeledContent("From", value: originName)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("placeOriginPicker")
                LabeledContent("To") {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(place.name).foregroundStyle(.primary)
                        if !place.subtitle.isEmpty {
                            Text(place.subtitle).font(.caption).foregroundStyle(.secondary)
                                .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
            if store.loading {
                ProgressView("Loading subway stations…")
            } else if store.error != nil {
                ContentUnavailableView("Stations unavailable", systemImage: "tram")
                Button("Retry stations") { Task { await store.loadLines() } }
            } else if let current {
                if let issue = current.issue {
                    issueView(issue)
                } else if let selected = selected(in: current) {
                    optionsSection(current.options, selectedID: selected.id)
                    itinerary(selected, current: current)
                }
            } else {
                ProgressView("Preparing routes…")
            }
        }
        .listStyle(.plain)
        .listSectionSpacing(.compact)
        .accessibilityIdentifier("placePreviewList")
        .navigationTitle("Route preview")
        .navigationBarTitleDisplayMode(.inline)
        .scrollContentBackground(.hidden)
        .onChange(of: key) { _, new in
            if !new.active || new.fix == nil {
                walks.discardLocationWalks()
            }
            if preview?.request != new || !new.active {
                preview = nil
                onMapChange(nil)
            }
        }
        .onChange(of: session.selectedOptionID) { _, _ in
            if let preview {
                publishMap(preview)
            }
        }
        .onDisappear {
            walks.discardLocationWalks()
            // The parent owns selection across pane changes. Discard private
            // geometry held by this card when a picker or another view covers it.
            if session.usesCurrentLocation {
                preview = nil
            }
        }
        .task(id: key) { await load(key) }
    }

    private func selected(in result: Preview) -> Option? {
        result.options.first { $0.id == session.selectedOptionID } ?? result.options.first
    }

    private func publishMap(_ result: Preview) {
        guard request == result.request, result.request.active else { return }
        guard let option = selected(in: result) else { onMapChange(nil); return }
        let r = option.route
        onMapChange(PlaceMapRoute(place: place, plan: r.trip, boarding: r.trip == nil ? nil : r.boarding,
                                  alighting: r.trip == nil ? nil : r.alighting, start: result.request.start ?? r.origin.stop.coordinate,
                                  access: option.access.connection, egress: option.egress.connection, optionID: option.id))
    }

    private func publish(_ result: Preview) {
        guard !Task.isCancelled, result.request == request, result.request.active else { return }
        preview = result
        publishMap(result)
    }

    private func load(_ key: Request) async {
        guard key.active, !Task.isCancelled, key == request else { return }
        var manual: Station?
        if case let .station(id) = key.origin {
            manual = store.stations.first { $0.id == id }
        }
        var result = Preview(request: key)
        let service = PlaceService()
        var excludedBoarding = Set<String>()
        var excludedAlighting = Set<String>()
        var excludedOptions = Set<String>()
        var checked: [String: Option] = [:]
        var memo: [WalkEndpoints: Walk] = [:]
        // Hard failures can reveal a usable station just outside the original
        // shortlist. Limit replanning to two replacements after the first pass.
        for _ in 0 ..< 3 {
            guard !Task.isCancelled, request == key else { return }
            let candidates = PlaceRouting.options(to: key.place.coordinate, from: manual, location: key.start,
                                                  stations: store.stations, lines: store.lines,
                                                  excludingBoardingStops: excludedBoarding, excludingAlightingStops: excludedAlighting,
                                                  excludingOptionIDs: excludedOptions)
            guard case let .routes(routes) = candidates, !routes.isEmpty else {
                if !excludedOptions.isEmpty {
                    if result.options.isEmpty {
                        result.issue = .noUsableWalk
                    }
                } else {
                    switch candidates {
                    case .noOrigin: result.issue = .noOrigin
                    case .noNearbyStation: result.issue = .noNearbyStation
                    case .noConnection, .routes: result.issue = .noConnection
                    }
                }
                break
            }
            result.issue = nil
            result.options = routes.map {
                checked[$0.id] ?? Option(route: $0, access: $0.trip == nil || key.start == nil ? .omitted : .loading, egress: .loading)
            }
            publish(result)
            let preferred = selected(in: result)?.id
            let order = result.options.filter { $0.id == preferred } + result.options.filter { $0.id != preferred }
            var rejected = false
            for var option in order where checked[option.id] == nil {
                guard !Task.isCancelled, request == key else { return }
                let route = option.route
                if let start = key.start, route.trip != nil {
                    option.access = await checkedWalk(service, leg: .toStation, from: start, to: route.boarding.coordinate,
                                                      fromLocation: key.origin == .currentLocation, key: key, memo: &memo)
                }
                guard !Task.isCancelled, request == key else { return }
                if option.access.rulesOutOption {
                    excludedBoarding.insert(route.boarding.id)
                } else {
                    let start = route.trip == nil ? (key.start ?? route.alighting.coordinate) : route.alighting.coordinate
                    option.egress = await checkedWalk(service, leg: .toPlace, from: start, to: key.place.coordinate,
                                                      fromLocation: route.trip == nil && key.origin == .currentLocation, key: key, memo: &memo)
                    guard !Task.isCancelled, request == key else { return }
                    if option.egress.rulesOutOption, route.trip != nil {
                        excludedAlighting.insert(route.alighting.id)
                    }
                }
                if option.access.rulesOutOption || option.egress.rulesOutOption {
                    excludedOptions.insert(option.id)
                    result.options.removeAll { $0.id == option.id }
                    rejected = true
                } else if let index = result.options.firstIndex(where: { $0.id == option.id }) {
                    checked[option.id] = option
                    result.options[index] = option
                }
                publish(result)
            }
            if !rejected {
                break
            }
        }
        if result.options.isEmpty, result.issue == nil {
            result.issue = .noUsableWalk
        }
        result.options.sort {
            ($0.estimate?.totalSeconds ?? .infinity) < ($1.estimate?.totalSeconds ?? .infinity)
        }
        publish(result)
    }

    private struct WalkEndpoints: Hashable { let start, end: Point }

    private func checkedWalk(_ service: PlaceService, leg: PlaceWalkMemory.Leg, from: CLLocationCoordinate2D, to: CLLocationCoordinate2D,
                             fromLocation: Bool, key: Request, memo: inout [WalkEndpoints: Walk]) async -> Walk
    {
        let endpoints = WalkEndpoints(start: Point(from), end: Point(to))
        if let cached = memo[endpoints] {
            return cached
        }
        let result = await walking(service, leg: leg, from: from, to: to, fromLocation: fromLocation, key: key)
        memo[endpoints] = result
        return result
    }

    private func walking(_ service: PlaceService, leg: PlaceWalkMemory.Leg, from: CLLocationCoordinate2D, to: CLLocationCoordinate2D,
                         fromLocation: Bool, key: Request) async -> Walk
    {
        guard !Task.isCancelled, request == key else { return .unavailable }
        let cached = walks.connection(for: leg, start: from, end: to, fromLocation: fromLocation)
        let initial = Walk(from: from, to: to, cached: cached)
        guard case .loading = initial else { return initial }
        do {
            let connection = try await service.walk(from: from, to: to)
            guard !Task.isCancelled, request == key else { return .unavailable }
            guard connection.meters <= PlaceRouting.maximumWalkingMeters else { return .tooLong }
            walks.remember(connection, leg: leg, start: from, end: to, fromLocation: fromLocation)
            return .ready(connection)
        } catch PlaceServiceError.noWalkingRoute {
            return .noRoute
        } catch {
            return .unavailable
        }
    }

    @ViewBuilder private func issueView(_ issue: Issue) -> some View {
        switch issue {
        case .noOrigin:
            if session.usesCurrentLocation, location.availableCoordinate == nil {
                if location.status == .denied || location.status == .restricted {
                    ContentUnavailableView("Location access is off", systemImage: "location.slash",
                                           description: Text("Choose a From station or address, or enable location in Settings."))
                    Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
                } else if let message = location.message {
                    ContentUnavailableView("Location unavailable", systemImage: "location.slash", description: Text(message))
                    Button("Retry location") { location.start() }
                } else {
                    ProgressView("Waiting for Current Location…")
                    Text("Choose a From station or address to plan now.").foregroundStyle(.secondary)
                }
            } else if case .station = session.origin {
                ContentUnavailableView("Starting station unavailable", systemImage: "tram", description: Text("Choose a different starting point."))
            } else {
                ContentUnavailableView("No starting station nearby", systemImage: "tram", description: Text("Choose a different starting point."))
            }
        case .noNearbyStation:
            ContentUnavailableView("No station nearby", systemImage: "mappin.slash", description: Text("Try a different starting point or destination."))
        case .noConnection:
            ContentUnavailableView("No subway route found", systemImage: "tram", description: Text("No direct or one-transfer trip connects the stations checked."))
        case .noUsableWalk:
            ContentUnavailableView("No usable walking connection", systemImage: "figure.walk", description: Text("The routes checked had no walking directions or exceeded the 2.5 km walking limit. Try another starting point."))
        }
    }

    private func routeSummary(_ route: PlaceRouting.Route) -> String {
        guard let trip = route.trip else { return "Walk directly" }
        return trip.legs.map { $0.routeIDs.map(RouteBadge.displayID).joined(separator: "/") }.joined(separator: " → ")
    }

    private func optionsSection(_ options: [Option], selectedID: String) -> some View {
        Section("Routes") {
            ForEach(options) { option in
                Button {
                    session.selectedOptionID = option.id
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(routeSummary(option.route)).font(.headline)
                            Spacer()
                            if let estimate = option.estimate {
                                Text("~\(minutes(estimate.totalSeconds))").monospacedDigit()
                            }
                            if option.estimate == nil {
                                if case .loading = option.egress {
                                    Text("Checking walks…").font(.caption).foregroundStyle(.secondary)
                                } else {
                                    Text("Walk unverified").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            if selectedID == option.id {
                                Image(systemName: "checkmark").accessibilityHidden(true)
                            }
                        }
                        if let trip = option.route.trip {
                            Text("\(trip.legs.count == 1 ? "Direct" : "1 transfer") · \(option.route.boarding.name) → \(option.route.alighting.name)")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(selectedID == option.id ? "Selected" : "")
                .accessibilityIdentifier("placeRouteOption-\(option.id)")
            }
        }
    }

    private func itinerary(_ option: Option, current: Preview) -> some View {
        let route = option.route
        return Section {
            if let trip = route.trip {
                if current.request.start != nil {
                    walkingRow("Walk to \(route.boarding.name)", walk: option.access)
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
                    TimelineView(.periodic(from: .now, by: 5)) { tick in
                        if let departure = TripPlanner.nextDeparture(for: leg, stations: store.stations, snapshot: store.snapshot,
                                                                     now: tick.date, feedUnavailable: store.feedError),
                            let countdown = departure.countdown(at: tick.date)
                        {
                            Text("Next \(RouteBadge.displayID(departure.routeId)) boarding prediction: \(countdown).")
                        } else {
                            Text("Boarding prediction unavailable.").foregroundStyle(.secondary)
                        }
                    }
                    .font(.subheadline)
                    .accessibilityIdentifier("placeDeparture-\(leg.id)")
                }
            }
            walkingRow("Walk to \(place.name)", walk: option.egress).accessibilityIdentifier("placeDestinationWalk")
            if let estimate = option.estimate {
                if estimate.walkingSeconds > 0 {
                    LabeledContent("Estimated walking time", value: minutes(estimate.walkingSeconds))
                        .accessibilityIdentifier("placeWalkingTotal")
                }
                if route.trip != nil {
                    LabeledContent("Typical total trip time", value: "About \(minutes(estimate.totalSeconds))")
                        .accessibilityIdentifier("placeTripTimeEstimate")
                }
            }
            if case .unavailable = option.egress {
                Button("Retry walking directions") { revision += 1 }
            } else if case .unavailable = option.access {
                Button("Retry walking directions") { revision += 1 }
            }
        } header: {
            Text("Itinerary")
        } footer: {
            Text("Walking routes use station coordinates. Entrances and step-free access are unverified. Typical times allow 4 minutes per train wait, 90 seconds per stop and 3 minutes per transfer. Transfer predictions show departures at that platform now. A connection is not guaranteed.")
        }
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
            case .notRequired: Text("No walk required")
            case .loading: ProgressView("Finding walking route…")
            case .unavailable: Text("Walking route unavailable").foregroundStyle(.secondary)
            case .noRoute, .tooLong, .omitted: EmptyView()
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct PlaceOriginPicker: View {
    let stations: [Station]
    let choose: (PlacePreviewSession.Origin) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var query = ""
    @State private var places: [PlaceResult] = []
    @State private var resolved = ""
    @State private var failed = false
    @State private var retry = 0
    private let service = PlaceService()

    private struct Request: Equatable {
        let query: String
        let active: Bool
        let retry: Int
    }

    private var request: Request {
        Request(query: query.trimmingCharacters(in: .whitespacesAndNewlines), active: scenePhase == .active, retry: retry)
    }

    private func pick(_ origin: PlacePreviewSession.Origin) {
        choose(origin); dismiss()
    }

    var body: some View {
        let key = request
        List {
            Button("Current Location", systemImage: "location") { pick(.currentLocation) }
                .accessibilityIdentifier("placeOriginCurrentLocation")
            if key.query.count >= 2 {
                Section("Addresses and places") {
                    if resolved != key.query {
                        ProgressView("Searching places…")
                    } else if failed {
                        Button("Retry place search") { retry += 1 }
                    } else if places.isEmpty {
                        Text("No matching addresses or places").foregroundStyle(.secondary)
                    }
                    if resolved == key.query, !failed {
                        ForEach(places) { item in
                            Button { pick(.place(item)) } label: {
                                VStack(alignment: .leading) {
                                    Text(item.name)
                                    Text(item.subtitle).font(.subheadline).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }
                            .accessibilityIdentifier("placeOriginResult-\(item.id)")
                        }
                    }
                }
            }
            Section("Stations") {
                ForEach(Transit.searchStations(stations, query: key.query)) { station in
                    Button { pick(.station(station.id)) } label: {
                        VStack(alignment: .leading) {
                            Text(station.stop.name)
                            Text(station.routes.map(RouteBadge.displayID).joined(separator: " · ")).font(.subheadline).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }.accessibilityIdentifier("stationChoice-\(station.id)")
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Address, place or station")
        .navigationTitle("From").navigationBarTitleDisplayMode(.inline)
        .task(id: key) { [key] in
            guard key.active, key.query.count >= 2 else { return }
            do {
                try await Task.sleep(for: .milliseconds(350))
                let results = try await service.search(key.query)
                try Task.checkCancellation()
                guard request == key else { return }
                places = results
                failed = false
            } catch {
                guard !Task.isCancelled, request == key else { return }
                places = []
                failed = true
            }
            resolved = key.query
        }
    }
}
