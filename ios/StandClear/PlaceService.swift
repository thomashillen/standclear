import CoreLocation
import Foundation
import MapKit

struct PlaceResult: Identifiable, Hashable, Codable, Sendable {
    let id: String
    let name: String
    let subtitle: String
    let latitude: Double
    let longitude: Double
    var coordinate: CLLocationCoordinate2D {
        .init(latitude: latitude, longitude: longitude)
    }
}

struct WalkingConnection: Sendable {
    let coordinates: [CLLocationCoordinate2D]
    let seconds: Double
    let meters: Double
}

enum PlaceServiceError: Error { case unavailable, noWalkingRoute }

struct PlaceService: Sendable {
    typealias Find = @MainActor @Sendable (String) async throws -> [PlaceResult]
    typealias Route = @MainActor @Sendable (CLLocationCoordinate2D, CLLocationCoordinate2D) async throws -> WalkingConnection
    private let find: Find
    private let route: Route

    init() {
        #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--ui-test-fixture") {
                self.init(find: PlaceFixture.find, route: PlaceFixture.route)
                return
            }
        #endif
        self.init(find: Self.findMapItems, route: Self.walkingRoute)
    }

    init(find: @escaping Find, route: @escaping Route) {
        self.find = find
        self.route = route
    }

    func search(_ query: String) async throws -> [PlaceResult] {
        try Task.checkCancellation()
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return [] }
        let places: [PlaceResult]
        do {
            places = try await find(query)
        } catch {
            try Task.checkCancellation()
            if let error = error as? MKError, error.code == .placemarkNotFound {
                return []
            }
            throw error
        }
        try Task.checkCancellation()
        var ids = Set<String>()
        return Array(places.filter {
            Self.inNYC($0.coordinate) && !$0.name.isEmpty && ids.insert($0.id).inserted
        }.prefix(10))
    }

    func walk(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async throws -> WalkingConnection {
        try Task.checkCancellation()
        guard Self.inNYC(from), Self.inNYC(to) else { throw PlaceServiceError.noWalkingRoute }
        let connection: WalkingConnection
        do {
            connection = try await route(from, to)
        } catch {
            try Task.checkCancellation()
            if let error = error as? MKError, error.code == .directionsNotFound {
                throw PlaceServiceError.noWalkingRoute
            }
            throw error
        }
        try Task.checkCancellation()
        guard connection.seconds.isFinite, connection.seconds > 0, connection.meters.isFinite, connection.meters > 0,
              let first = connection.coordinates.first, connection.coordinates.allSatisfy(Self.inNYC),
              connection.coordinates.contains(where: { $0.latitude != first.latitude || $0.longitude != first.longitude })
        else { throw PlaceServiceError.unavailable }
        return connection
    }

    private static func inNYC(_ coordinate: CLLocationCoordinate2D) -> Bool {
        (40.55 ... 40.92).contains(coordinate.latitude) && (-74.20 ... -73.70).contains(coordinate.longitude)
    }

    @MainActor private static func findMapItems(_ query: String) async throws -> [PlaceResult] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.resultTypes = [.address, .pointOfInterest]
        request.region = MKCoordinateRegion(center: .init(latitude: 40.735, longitude: -73.95),
                                            span: .init(latitudeDelta: 0.37, longitudeDelta: 0.5))
        request.regionPriority = .required
        let search = MKLocalSearch(request: request)
        return try await MapRequest<[PlaceResult]>().run(cancel: { search.cancel() }) { finish in
            search.start { response, error in
                guard let response else { return finish(.failure(error ?? PlaceServiceError.unavailable)) }
                let places = response.mapItems.compactMap { item -> PlaceResult? in
                    let name = (item.name ?? item.address?.shortAddress ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return nil }
                    let coordinate = item.location.coordinate
                    let id = item.identifier?.rawValue ?? "\(name)|\(coordinate.latitude),\(coordinate.longitude)"
                    return PlaceResult(id: id, name: name, subtitle: item.address?.fullAddress ?? "",
                                       latitude: coordinate.latitude, longitude: coordinate.longitude)
                }
                finish(.success(places))
            }
        }
    }

    @MainActor private static func walkingRoute(_ from: CLLocationCoordinate2D, _ to: CLLocationCoordinate2D) async throws -> WalkingConnection {
        let request = MKDirections.Request()
        request.source = MKMapItem(location: CLLocation(latitude: from.latitude, longitude: from.longitude), address: nil)
        request.destination = MKMapItem(location: CLLocation(latitude: to.latitude, longitude: to.longitude), address: nil)
        request.transportType = .walking
        let directions = MKDirections(request: request)
        return try await MapRequest<WalkingConnection>().run(cancel: { directions.cancel() }) { finish in
            directions.calculate { response, error in
                guard let response else { return finish(.failure(error ?? PlaceServiceError.unavailable)) }
                guard let route = response.routes.first, route.polyline.pointCount >= 2 else {
                    return finish(.failure(PlaceServiceError.noWalkingRoute))
                }
                var coordinates = Array(repeating: CLLocationCoordinate2D(), count: route.polyline.pointCount)
                route.polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: coordinates.count))
                finish(.success(WalkingConnection(coordinates: coordinates, seconds: route.expectedTravelTime, meters: route.distance)))
            }
        }
    }
}

/// MapKit delivers these completions on the main queue. Finish once even when a
/// native completion arrives after cancellation, and release the suspended caller
/// if the underlying request stops without returning a result.
@MainActor
private final class MapRequest<Value: Sendable> {
    private var continuation: CheckedContinuation<Value, Error>?

    func run(cancel: @escaping @MainActor @Sendable () -> Void,
             start: (@escaping @Sendable (Result<Value, Error>) -> Void) -> Void) async throws -> Value
    {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                start { result in
                    Task { @MainActor in self.finish(result) }
                }
            }
        } onCancel: {
            Task { @MainActor in
                self.finish(.failure(CancellationError()))
                cancel()
            }
        }
    }

    private func finish(_ result: Result<Value, Error>) {
        let pending = continuation
        continuation = nil
        pending?.resume(with: result)
    }
}

#if DEBUG && targetEnvironment(simulator)
    private enum PlaceFixture {
        static let addresses = [
            PlaceResult(id: "fixture-550-madison", name: "550 Madison Avenue", subtitle: "Manhattan, New York",
                        latitude: 40.7616, longitude: -73.9733),
            PlaceResult(id: "fixture-bryant-park", name: "Bryant Park", subtitle: "Manhattan, New York",
                        latitude: 40.7536, longitude: -73.9832),
            PlaceResult(id: "fixture-55-wall-street", name: "55 Wall Street", subtitle: "Manhattan, New York",
                        latitude: 40.7061, longitude: -74.0095),
        ]

        static let museum = PlaceResult(id: "fixture-noguchi", name: "The Noguchi Museum", subtitle: "9-01 33rd Road, Queens, New York",
                                        latitude: 40.7667, longitude: -73.9381)

        static func find(_ query: String) -> [PlaceResult] {
            let candidates = ProcessInfo.processInfo.arguments.contains("--ui-test-noguchi") ? addresses + [museum] : addresses
            return candidates.filter { $0.name.localizedCaseInsensitiveContains(query) }
        }

        /// Representative pedestrian paths for a reproducible test, independent
        /// of production MKDirections. Include only explicit fixture endpoints.
        private static var museumWalks: [WalkingConnection] {
            let fix = CLLocationCoordinate2D(latitude: 40.7553, longitude: -73.987)
            func walk(_ vertices: [(Double, Double)], from: CLLocationCoordinate2D? = nil, to: CLLocationCoordinate2D? = nil,
                      meters: Double, seconds: Double) -> WalkingConnection
            {
                WalkingConnection(coordinates: [from].compactMap(\.self) + vertices.map { .init(latitude: $0.0, longitude: $0.1) } + [to].compactMap(\.self),
                                  seconds: seconds, meters: meters)
            }
            return [
                walk([(40.7061, -74.0095), (40.70684, -74.01074), (40.707557, -74.011862)], meters: 275, seconds: 210), // 55 Wall Street to Wall St 419
                walk([(40.75512, -73.98712), (40.75468, -73.98742), (40.754672, -73.986754)], from: fix, meters: 115, seconds: 95), // Times Sq R16
                walk([(40.75643, -73.98611), (40.75934, -73.98399), (40.759901, -73.984139)], from: fix, meters: 660, seconds: 510), // 49 St R15
                walk([(40.75502, -73.9869), (40.75001, -73.98809), (40.749567, -73.98795)], from: fix, meters: 765, seconds: 600), // Herald Sq R17
                walk([(40.76182, -73.925508), (40.76456, -73.93191), (40.76676, -73.93688), (40.76634, -73.93716)], to: museum.coordinate, meters: 1460, seconds: 1110), // Broadway
                walk([(40.756804, -73.929575), (40.75869, -73.93398), (40.76021, -73.93291), (40.76286, -73.93903), (40.7659, -73.93692)], to: museum.coordinate, meters: 1770, seconds: 1380), // 36 Av
                walk([(40.766779, -73.921479), (40.77031, -73.92976), (40.76763, -73.93164), (40.76941, -73.93568), (40.76697, -73.9374)], to: museum.coordinate, meters: 1925, seconds: 1490), // 30 Av
                walk([(40.752882, -73.932755), (40.75462, -73.93673), (40.75808, -73.9343), (40.76035, -73.93948), (40.76598, -73.93724)], to: museum.coordinate, meters: 2010, seconds: 1560), // 39 Av
                walk([(40.750582, -73.940202), (40.75287, -73.93919), (40.7592, -73.94032), (40.76598, -73.93724)], to: museum.coordinate, meters: 2270, seconds: 1770), // Queensboro Plaza
            ]
        }

        static func route(_ from: CLLocationCoordinate2D, _ to: CLLocationCoordinate2D) throws -> WalkingConnection {
            var routes = [
                WalkingConnection(coordinates: [.init(latitude: 40.762526, longitude: -73.967967),
                                                .init(latitude: 40.7638, longitude: -73.9712), addresses[0].coordinate],
                                  seconds: 435, meters: 555),
                WalkingConnection(coordinates: [.init(latitude: 40.75529, longitude: -73.987495),
                                                .init(latitude: 40.7569, longitude: -73.9836), addresses[1].coordinate],
                                  seconds: 410, meters: 530),
            ]
            if ProcessInfo.processInfo.arguments.contains("--ui-test-noguchi") {
                routes += museumWalks
            }
            func near(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Bool {
                abs(a.latitude - b.latitude) < 0.00001 && abs(a.longitude - b.longitude) < 0.00001
            }
            for route in routes {
                guard let start = route.coordinates.first, let end = route.coordinates.last else { continue }
                if near(from, start), near(to, end) {
                    return route
                }
                if near(from, end), near(to, start) {
                    return WalkingConnection(coordinates: Array(route.coordinates.reversed()), seconds: route.seconds, meters: route.meters)
                }
            }
            throw PlaceServiceError.noWalkingRoute
        }
    }
#endif
