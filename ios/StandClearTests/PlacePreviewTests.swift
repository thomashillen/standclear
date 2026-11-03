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
        let result = PlaceRouting.options(to: near.stop.coordinate, from: origin, location: nil, stations: [origin, near, served], lines: [line])
        guard case let .routes(routes) = result, let route = routes.first else { return XCTFail("Expected the reachable station near the place") }
        XCTAssertEqual(route.ride?.destination.id, served.id)
        XCTAssertEqual(route.trip?.totalStops, 1)
        XCTAssertEqual(route.ride?.boarding.id, board.id)
        XCTAssertEqual(route.ride?.alighting.id, exit.id)
    }

    func testMissingOriginAndBoundedDestinationRecoveryStates() {
        let origin = station(stop("origin", latitude: 40.78))
        let distant = station(stop("distant", latitude: 40.77))
        let place = CLLocationCoordinate2D(latitude: 40.75, longitude: -74)
        guard case .noOrigin = PlaceRouting.options(to: place, from: nil, location: nil, stations: [origin], lines: []) else {
            return XCTFail("Missing permission or fix needs an origin selection")
        }
        guard case .noNearbyStation = PlaceRouting.options(to: place, from: origin, location: nil, stations: [origin, distant], lines: []) else {
            return XCTFail("Do not propose unbounded destination walks")
        }
        XCTAssertNil(PlaceRouting.distance(from: .init(latitude: .nan, longitude: -74), to: origin.stop))
        let nearPlace = station(stop("target", latitude: 40.7501))
        guard case .noConnection = PlaceRouting.options(to: place, from: origin, location: nil, stations: [origin, nearPlace], lines: []) else {
            return XCTFail("Stations in range without a rail connection have a distinct recovery state")
        }
    }

    func testPlaceAtStartingStationUsesWalkingOnly() {
        let origin = station(stop("nearby", latitude: 40.75))
        let result = PlaceRouting.options(to: origin.stop.coordinate, from: origin, location: nil, stations: [origin], lines: [])
        guard case let .routes(routes) = result, let route = routes.first else { return XCTFail("Expected a walk from the station") }
        XCTAssertNil(route.trip)
        XCTAssertEqual(route.id, "walk")
        XCTAssertEqual(route.start.latitude, origin.stop.lat)
        XCTAssertEqual(route.start.longitude, origin.stop.lng)
    }

    func testDirectWalkFromSelectedCoordinatesWhenStationAreasAreDisjoint() {
        // The station groups are 2.3 km apart and share no rail connection.
        // The two actual street endpoints are 1.9 km apart, within the walking limit.
        let start = CLLocationCoordinate2D(latitude: 40.751, longitude: -74)
        let place = CLLocationCoordinate2D(latitude: 40.768, longitude: -74)
        let access = station(stop("access", latitude: 40.749))
        let exit = station(stop("exit", latitude: 40.770))
        let stations = [access, exit]
        guard case let .routes(options) = PlaceRouting.options(to: place, from: nil, location: start, stations: stations, lines: []),
              let route = options.first, case let .walk(actualStart) = route
        else {
            return XCTFail("Nearby street endpoints should have a direct walking option without a rail connection")
        }
        XCTAssertEqual(options.count, 1)
        XCTAssertEqual(route.id, "walk")
        XCTAssertEqual(actualStart.latitude, start.latitude)
        XCTAssertEqual(actualStart.longitude, start.longitude)
        XCTAssertNil(route.ride)
        // Street routing may still reject this walk, for example across water.
        guard case .noConnection = PlaceRouting.options(to: place, from: nil, location: start, stations: stations, lines: [],
                                                        excludingOptionIDs: [route.id])
        else {
            return XCTFail("A direct walk rejected by the pedestrian service must stay excluded")
        }
        // A manual station supplies the actual start even if a location fix is available.
        guard case let .routes(manualOptions) = PlaceRouting.options(to: place, from: access, location: start, stations: stations, lines: []),
              let manual = manualOptions.first else { return XCTFail("The selected station should allow the same walk") }
        XCTAssertEqual(manual.start.latitude, access.stop.lat)
        XCTAssertEqual(manual.id, route.id)
    }

    func testRectorAreaToNoguchiCanBoardAtWallStreetAndStillOffersDirectService() throws {
        let lines = lexingtonQueensLines()
        let stations = Transit.stations(lines)
        let place = CLLocationCoordinate2D(latitude: 40.76676, longitude: -73.9384)
        let fix = CLLocationCoordinate2D(latitude: 40.7071, longitude: -74.0135)
        guard case let .routes(routes) = PlaceRouting.options(to: place, from: nil, location: fix, stations: stations, lines: lines) else {
            return XCTFail("A longer destination walk must allow the real museum trip")
        }
        XCTAssertLessThanOrEqual(routes.count, 3)
        XCTAssertEqual(Set(routes.map(\.id)).count, routes.count)
        let first = try XCTUnwrap(routes.first)
        XCTAssertEqual(first.ride?.origin.id, "419")
        XCTAssertEqual(first.trip?.transferComplexId, "629")
        XCTAssertEqual(first.trip?.legs.first?.alightStopId, "629")
        XCTAssertEqual(first.trip?.legs.last?.boardStopId, "R11")
        XCTAssertEqual(first.ride?.destination.id, "R05")
        XCTAssertTrue(routes.contains { $0.ride?.origin.id == "R26" && $0.trip?.legs.count == 1 })

        let manual = try XCTUnwrap(stations.first { $0.id == "R26" })
        guard case let .routes(manualRoutes) = PlaceRouting.options(to: place, from: manual, location: fix, stations: stations, lines: lines) else {
            return XCTFail("Manual station selection still has a direct ride")
        }
        XCTAssertTrue(manualRoutes.allSatisfy { $0.ride?.origin.id == manual.id })
    }

    func testLexington59TransferAndSelectedTrackInBothTravelDirections() throws {
        let lines = lexingtonQueensLines()
        let stations = Transit.stations(lines)
        let wall = try XCTUnwrap(stations.first { $0.id == "419" })
        let broadway = try XCTUnwrap(stations.first { $0.id == "R05" })
        let yellow = try XCTUnwrap(lines.first { $0.routeId == "W" })
        let timesSquare = try XCTUnwrap(yellow.stops.first { $0.id == "R16" })
        for (origin, destination) in [(wall, broadway), (broadway, wall)] {
            let outward = origin.id == wall.id
            let plan = try XCTUnwrap(TripPlanner.plans(lines: lines, stations: stations, from: origin, to: destination).first)
            let transfer = try XCTUnwrap(plan.transfer(in: lines))
            XCTAssertTrue(transfer.isLexington59)
            XCTAssertEqual(transfer.incoming.id, outward ? "629" : "R11")
            XCTAssertEqual(transfer.outgoing.id, outward ? "R11" : "629")
            XCTAssertEqual(transfer.routeIDs, outward ? ["4", "W"] : ["W", "4"])
            let overlays = TripMapOverlay.make(plan: plan, lines: lines)
            XCTAssertEqual(overlays.count, 2)
            let segment = try XCTUnwrap(overlays.first { $0.color == yellow.color })
            XCTAssertFalse(segment.walking)
            let expectedIDs = outward ? ["R11", "R09", "R08", "R06", "R05"] : ["R05", "R06", "R08", "R09", "R11"]
            let expected = try expectedIDs.map { id in try XCTUnwrap(yellow.stops.first { $0.id == id }) }
            XCTAssertEqual(segment.coordinates.map(\.latitude), expected.map(\.lat))
            XCTAssertEqual(segment.coordinates.map(\.longitude), expected.map(\.lng))
            XCTAssertFalse(segment.coordinates.contains { $0.latitude == timesSquare.lat && $0.longitude == timesSquare.lng })
            XCTAssertNil(plan.transfer(in: [yellow]), "Missing the incoming or outgoing line must suppress the transfer")
            let mismatched = NativeTripPlan(legs: plan.legs, totalStops: plan.totalStops, transferComplexId: "127")
            XCTAssertNil(mismatched.transfer(in: lines), "A different complex must not manufacture a transfer")
        }
    }

    private func lexingtonQueensLines() -> [SubwayLine] {
        // Representative segments of public/gtfsData.json. The museum is over
        // 1.2 km from Broadway; 59 St is a transfer between platform IDs.
        let express = fixtureLine("4", [
            ("629", 40.762526, -73.967967), ("631", 40.751776, -73.976848),
            ("635", 40.734673, -73.989951), ("640", 40.713065, -74.004131),
            ("418", 40.710368, -74.009509), ("419", 40.707557, -74.011862),
        ])
        let broadway = fixtureLine("W", [
            ("R26", 40.70722, -74.013342), ("R25", 40.710668, -74.011029),
            ("R24", 40.713282, -74.006978), ("R23", 40.719527, -74.001775),
            ("R22", 40.724329, -73.997702), ("R21", 40.730328, -73.992629),
            ("R20", 40.735736, -73.990568), ("R19", 40.741303, -73.989344),
            ("R18", 40.745494, -73.988691), ("R17", 40.749567, -73.98795),
            ("R16", 40.754672, -73.986754), ("R15", 40.759901, -73.984139),
            ("R14", 40.764664, -73.980658), ("R13", 40.764811, -73.973347),
            ("R11", 40.76266, -73.967258), ("R09", 40.750582, -73.940202),
            ("R08", 40.752882, -73.932755), ("R06", 40.756804, -73.929575),
            ("R05", 40.76182, -73.925508),
        ], color: "F6BC26")
        return [express, broadway]
    }

    func testRejectedWalkingEndpointCanBeReplacedWithoutLosingOtherRoute() throws {
        let line = fixtureLine("F", [
            ("D16", 40.754222, -73.984569), ("B06", 40.759145, -73.953260),
            ("B04", 40.754203, -73.942836),
        ])
        let stations = Transit.stations([line])
        let manual = try XCTUnwrap(stations.first { $0.id == "D16" })
        let place = CLLocationCoordinate2D(latitude: 40.76676, longitude: -73.9384)
        guard case let .routes(routes) = PlaceRouting.options(to: place, from: manual, location: nil, stations: stations,
                                                              lines: [line], excludingAlightingStops: ["B06"])
        else {
            return XCTFail("Rejecting an impractical Roosevelt Island exit should retain a Queens exit")
        }
        XCTAssertEqual(routes.compactMap { $0.ride?.alighting.id }, ["B04"])
        guard case .noConnection = PlaceRouting.options(to: place, from: manual, location: nil, stations: stations, lines: [line],
                                                        excludingBoardingStops: ["D16"], excludingAlightingStops: ["B06"])
        else {
            return XCTFail("A rejected access walk must not reappear on a replacement itinerary")
        }
    }

    func testExcludingDirectWalkKeepsRailOptionsFromSameStation() throws {
        let line = fixtureLine("Q", [("source", 40.751, -74), ("exit", 40.75, -74)])
        let stations = Transit.stations([line])
        let manual = try XCTUnwrap(stations.first { $0.id == "source" })
        let place = CLLocationCoordinate2D(latitude: 40.75, longitude: -74)
        guard case let .routes(initial) = PlaceRouting.options(to: place, from: manual, location: nil, stations: stations, lines: [line]) else {
            return XCTFail("Expected direct walking and subway choices")
        }
        let walk = try XCTUnwrap(initial.first { $0.trip == nil })
        guard case let .routes(remaining) = PlaceRouting.options(to: place, from: manual, location: nil, stations: stations,
                                                                 lines: [line], excludingOptionIDs: [walk.id])
        else {
            return XCTFail("A rejected direct walk must not invalidate a different walking endpoint")
        }
        XCTAssertEqual(remaining.compactMap { $0.ride?.alighting.id }, ["exit"])
        XCTAssertNotNil(remaining.first?.trip)
    }

    private func fixtureLine(_ route: String, _ points: [(String, Double, Double)], color: String = "009952") -> SubwayLine {
        let stops = points.enumerated().map { index, point in
            Stop(id: point.0, name: point.0, lat: point.1, lng: point.2, shapeIdx: index)
        }
        return SubwayLine(id: route, routeId: route, color: color, stops: stops, shape: stops.map { [$0.lng, $0.lat] })
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
