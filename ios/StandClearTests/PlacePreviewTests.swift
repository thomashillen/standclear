import CoreLocation
@testable import StandClear
import XCTest

final class PlacePreviewTests: XCTestCase {
    func testNearestReachableDestinationUsesActualBoardingAndAlightingStops() {
        let board = stop("board-platform", latitude: 40.77, index: 0)
        let exit = stop("exit-platform", latitude: 40.75, index: 1)
        let origin = station(stop("origin", latitude: 40.771), also: board.id)
        let near = station(stop("unconnected", latitude: 40.749))
        let served = station(stop("connected", latitude: 40.7502), also: exit.id)
        let line = SubwayLine(id: "4", routeId: "4", color: "009952", stops: [board, exit], shape: [[-74, 40.77], [-74, 40.75]])
        let result = PlaceRouting.route(to: near.stop.coordinate, from: origin, stations: [origin, near, served], lines: [line])
        guard case let .route(route) = result else { return XCTFail("Expected the reachable station near the place") }
        XCTAssertEqual(route.destination.id, served.id)
        XCTAssertEqual(route.trip?.totalStops, 1)
        XCTAssertEqual(route.boarding.id, board.id)
        XCTAssertEqual(route.alighting.id, exit.id)
    }

    func testStationSearchBoundsAndInvalidCoordinates() {
        let origin = station(stop("origin", latitude: 40.78))
        let distant = station(stop("distant", latitude: 40.76))
        let place = CLLocationCoordinate2D(latitude: 40.75, longitude: -74)
        guard case .noNearbyStation = PlaceRouting.route(to: place, from: origin, stations: [origin, distant], lines: []) else {
            return XCTFail("A station more than 900 metres away must not be suggested")
        }
        XCTAssertNil(PlaceRouting.distance(from: .init(latitude: .nan, longitude: -74), to: origin.stop))
        let nearby = (0 ..< 4).map { station(stop("s\($0)", latitude: 40.75 + Double($0) / 10000)) }
        let board = origin.stop
        let exit = nearby[3].stop
        let line = SubwayLine(id: "4", routeId: "4", color: "009952", stops: [board, exit], shape: [])
        guard case .noConnection = PlaceRouting.route(to: place, from: origin, stations: [origin] + nearby, lines: [line]) else {
            return XCTFail("Only the three closest destination candidates are considered")
        }
    }

    func testPlaceAtStartingStationUsesWalkingOnly() {
        let origin = station(stop("nearby", latitude: 40.75))
        let result = PlaceRouting.route(to: origin.stop.coordinate, from: origin, stations: [origin], lines: [])
        guard case let .route(route) = result else { return XCTFail("Expected a walk from the station") }
        XCTAssertNil(route.trip)
        XCTAssertEqual(route.alighting.id, origin.stop.id)
    }

    func testExactCoincidenceOverridesCachedWalkButNearbyStillRequiresRouting() {
        let point = CLLocationCoordinate2D(latitude: 40.75, longitude: -74)
        let other = CLLocationCoordinate2D(latitude: 40.75001, longitude: -74)
        let prior = WalkingConnection(coordinates: [other, point], seconds: 10, meters: 5)
        let zero = PlacePreview.Walk(from: point, to: point, cached: prior)
        guard case .notRequired = zero else { return XCTFail("Coincident endpoints need no walking request") }
        XCTAssertNil(zero.connection)
        let estimate = PlaceTimeEstimate(stopsPerLeg: [2], accessSeconds: 0, egressSeconds: zero.secondsForEstimate)
        XCTAssertEqual(estimate?.totalSeconds, 420)
        let nearby = PlacePreview.Walk(from: other, to: point, cached: nil)
        guard case .loading = nearby else { return XCTFail("Even a short, nonzero walk needs a routed duration") }
        XCTAssertNil(nearby.secondsForEstimate)
    }

    func testWalkMemorySeparatesLocationFromStationAndExpiresEntries() {
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        let start = CLLocationCoordinate2D(latitude: 40.75, longitude: -74)
        let drift = CLLocationCoordinate2D(latitude: 40.7501, longitude: -74) // About 11 m.
        let farther = CLLocationCoordinate2D(latitude: 40.7503, longitude: -74) // About 33 m.
        let end = CLLocationCoordinate2D(latitude: 40.751, longitude: -74)
        let route = WalkingConnection(coordinates: [start, end], seconds: 100, meters: 120)
        var memory = PlaceWalkMemory()
        memory.remember(route, leg: .toStation, start: start, end: end, fromLocation: true, at: date)
        memory.remember(route, leg: .toPlace, start: start, end: end, fromLocation: false, at: date)
        XCTAssertNotNil(memory.connection(for: .toStation, start: drift, end: end, fromLocation: true, at: date))
        XCTAssertNil(memory.connection(for: .toStation, start: farther, end: end, fromLocation: true, at: date))
        XCTAssertNil(memory.connection(for: .toPlace, start: drift, end: end, fromLocation: false, at: date))
        XCTAssertNil(memory.connection(for: .toStation, start: start, end: drift, fromLocation: true, at: date))
        XCTAssertNil(memory.connection(for: .toStation, start: start, end: end, fromLocation: false, at: date))
        memory.discardLocationWalks()
        XCTAssertNil(memory.connection(for: .toStation, start: start, end: end, fromLocation: true, at: date))
        XCTAssertNotNil(memory.connection(for: .toPlace, start: start, end: end, fromLocation: false, at: date))
        XCTAssertNil(memory.connection(for: .toPlace, start: start, end: end, fromLocation: false, at: date.addingTimeInterval(300)))
    }

    func testTypicalTimeIncludesEachRideWaitAndTransfer() {
        let direct = PlaceTimeEstimate(stopsPerLeg: [5], accessSeconds: 0, egressSeconds: 435)
        XCTAssertEqual(direct?.walkingSeconds, 435)
        XCTAssertEqual(direct?.totalSeconds, 1125)
        let transfer = PlaceTimeEstimate(stopsPerLeg: [3, 2], accessSeconds: 120, egressSeconds: 300)
        XCTAssertEqual(transfer?.walkingSeconds, 420)
        XCTAssertEqual(transfer?.totalSeconds, 1530)
        let walk = PlaceTimeEstimate(stopsPerLeg: [], accessSeconds: 0, egressSeconds: 435)
        XCTAssertEqual(walk?.totalSeconds, 435)
    }

    func testTypicalTimeRequiresEveryRequestedWalkingDuration() {
        XCTAssertNil(PlaceTimeEstimate(stopsPerLeg: [5], accessSeconds: nil, egressSeconds: 435))
        XCTAssertNil(PlaceTimeEstimate(stopsPerLeg: [5], accessSeconds: 0, egressSeconds: nil))
        XCTAssertNil(PlaceTimeEstimate(stopsPerLeg: [5], accessSeconds: .nan, egressSeconds: 435))
        XCTAssertNil(PlaceTimeEstimate(stopsPerLeg: [5], accessSeconds: 0, egressSeconds: -1))
    }

    private func stop(_ id: String, latitude: Double, index: Int = 0) -> Stop {
        Stop(id: id, name: id, lat: latitude, lng: -74, shapeIdx: index)
    }

    private func station(_ stop: Stop, also platformID: String? = nil) -> Station {
        Station(id: stop.id, stop: stop, stopIDs: Set([stop.id, platformID].compactMap(\.self)), routes: ["4"])
    }
}
