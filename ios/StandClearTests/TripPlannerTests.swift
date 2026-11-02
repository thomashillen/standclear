import CoreLocation
@testable import StandClear
import XCTest

final class TripPlannerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testSameComplexAndMissingEndpointsHaveNoPlan() throws {
        let lines = sampleLines()
        let stations = Transit.stations(lines)
        let union = try station("635", in: stations)
        XCTAssertTrue(TripPlanner.plans(lines: lines, stations: stations, from: union, to: union).isEmpty)
        let missing = Station(id: "missing", stop: stop("missing", 40.7), stopIDs: ["missing"], routes: [])
        XCTAssertTrue(TripPlanner.plans(lines: lines, stations: stations, from: missing, to: union).isEmpty)
    }

    func testDirectTripAndReverseDirectionKeepPlatformIDs() throws {
        let lines = sampleLines(), stations = Transit.stations(lines)
        let from = try station("L01", in: stations), to = try station("L08", in: stations)
        let forward = try XCTUnwrap(TripPlanner.plans(lines: lines, stations: stations, from: from, to: to).first)
        XCTAssertEqual(forward.legs.count, 1)
        XCTAssertEqual(forward.totalStops, 2)
        XCTAssertEqual(forward.legs[0].routeId, "L")
        XCTAssertEqual(forward.legs[0].direction, "S")
        XCTAssertEqual(forward.legs[0].boardStopId, "L01")
        let reverse = try XCTUnwrap(TripPlanner.plans(lines: lines, stations: stations, from: to, to: from).first)
        XCTAssertEqual(reverse.legs[0].direction, "N")
        XCTAssertEqual(reverse.legs[0].alightStopId, "L01")
    }

    func testOneTransferUsesCuratedComplexAcrossDifferentPlatforms() throws {
        let lines = sampleLines(), stations = Transit.stations(lines)
        let plans = try TripPlanner.plans(lines: lines, stations: stations,
                                          from: station("L01", in: stations), to: station("419", in: stations))
        let plan = try XCTUnwrap(plans.first)
        XCTAssertEqual(plan.transferComplexId, "635")
        XCTAssertEqual(plan.legs.count, 2)
        XCTAssertEqual(plan.legs[0].alightStopId, "L03")
        XCTAssertEqual(plan.legs[1].boardStopId, "635")
        XCTAssertEqual(plan.legs[0].alightComplexId, plan.legs[1].boardComplexId)
        XCTAssertEqual(plan.legs[1].routeIDs, ["4", "5"])
        XCTAssertEqual(plan.totalStops, 2)
    }

    func testSiblingRoutesMergeButExpressAndLocalStayDistinct() throws {
        let lines = sampleLines(), stations = Transit.stations(lines)
        let plans = try TripPlanner.plans(lines: lines, stations: stations,
                                          from: station("601", in: stations), to: station("635", in: stations))
        XCTAssertEqual(plans.count, 2)
        XCTAssertEqual(plans.map(\.totalStops), [2, 3])
        XCTAssertEqual(plans[0].legs[0].routeIDs, ["4", "5"])
        XCTAssertEqual(plans[1].legs[0].routeIDs, ["6"])
        XCTAssertTrue(plans.allSatisfy { $0.legs.count == 1 }, "Redundant transfers between direct trunk routes should disappear")
        XCTAssertEqual(plans.map(\.id), try TripPlanner.plans(lines: Array(lines.reversed()), stations: stations,
                                                              from: station("601", in: stations), to: station("635", in: stations)).map(\.id))
    }

    func testResultsAreCappedAndOrderedByStopCount() throws {
        let lines = (1 ... 6).map { count in
            line("R\(count)", [stop("origin", 40.9)] + (1 ..< count).map { stop("r\(count)-\($0)", 40.9 - Double($0) * 0.01) } + [stop("destination", 40.7)])
        }
        let stations = Transit.stations(lines)
        let plans = try TripPlanner.plans(lines: lines, stations: stations,
                                          from: station("origin", in: stations), to: station("destination", in: stations))
        XCTAssertEqual(plans.count, 4)
        XCTAssertEqual(plans.map(\.totalStops), [1, 2, 3, 4])
    }

    func testGeometryFollowsTravelOrderAndRejectsInvalidShape() throws {
        let route = line("X", [stop("a", 40.9, shape: 0), stop("b", 40.8, shape: 2)],
                         shape: [[-74, 40.9], [-74, 40.85], [-74, 40.8]])
        let stations = Transit.stations([route])
        let plan = try XCTUnwrap(try TripPlanner.plans(lines: [route], stations: stations,
                                                       from: station("b", in: stations), to: station("a", in: stations)).first)
        XCTAssertEqual(TripPlanner.geometry(for: plan.legs[0], lines: [route]).map(\.latitude), [40.8, 40.85, 40.9])
        XCTAssertTrue(TripPlanner.geometry(for: plan.legs[0], lines: []).isEmpty)
        let invalid = line("X", route.stops, shape: [[-74, 40.9], [-74, .nan], [-74, 40.8]])
        XCTAssertTrue(TripPlanner.geometry(for: plan.legs[0], lines: [invalid]).isEmpty)
        let short = line("X", route.stops, shape: [[-74, 40.9]])
        XCTAssertTrue(TripPlanner.geometry(for: plan.legs[0], lines: [short]).isEmpty)
        let collapsed = line("X", [stop("a", 40.9), stop("b", 40.8)], shape: [[-74, 40.9]])
        XCTAssertTrue(TripPlanner.geometry(for: plan.legs[0], lines: [collapsed]).isEmpty)
    }

    func testDepartureMatchesSiblingRouteSpecificPlatformAndDirection() throws {
        let lines = [line("4", [stop("631", 40.75), stop("635", 40.73)]),
                     line("N", [stop("901", 40.75), stop("R20", 40.73)])]
        let stations = Transit.stations(lines)
        let leg = try XCTUnwrap(try TripPlanner.plans(lines: lines, stations: stations,
                                                      from: station("631", in: stations), to: station("635", in: stations)).first?.legs.first)
        XCTAssertEqual(leg.routeIDs, ["4", "N"])
        let wrongPlatform = arrival("wrong-platform", route: "4", stop: "901", direction: "S", seconds: 5)
        let wrongDirection = arrival("wrong-direction", route: "N", stop: "901", direction: "N", seconds: 10)
        let valid = arrival("valid", route: "N", stop: "901", direction: "S", seconds: 30)
        let later = arrival("later", route: "4", stop: "631", direction: "S", seconds: 60)
        let snapshot = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: [], arrivals: [later, wrongDirection, wrongPlatform, valid])
        XCTAssertEqual(TripPlanner.nextDeparture(for: leg, stations: stations, snapshot: snapshot, now: now, feedUnavailable: false)?.tripId, "valid")
    }

    func testDepartureRejectsStaleFailedAndOldVehicleData() throws {
        let lines = sampleLines(), stations = Transit.stations(lines)
        let leg = try XCTUnwrap(try TripPlanner.plans(lines: lines, stations: stations,
                                                      from: station("631", in: stations), to: station("419", in: stations)).first?.legs.first)
        let prediction = arrival("trip", route: "4", stop: "631", direction: "S", seconds: 120)
        let fresh = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: [], arrivals: [prediction])
        XCTAssertNotNil(TripPlanner.nextDeparture(for: leg, stations: stations, snapshot: fresh, now: now, feedUnavailable: false))
        XCTAssertNil(TripPlanner.nextDeparture(for: leg, stations: stations, snapshot: fresh, now: now, feedUnavailable: true))
        XCTAssertNil(TripPlanner.nextDeparture(for: leg, stations: stations, snapshot: fresh, now: now.addingTimeInterval(60), feedUnavailable: false))
        let oldVehicle = Train(id: "trip", routeId: "4", direction: "S", progress: 0, prevStopId: "631", nextStopId: "635",
                               status: "IN_TRANSIT_TO", lastReportedAt: now.timeIntervalSince1970 - 91)
        let old = Snapshot(generatedAt: fresh.generatedAt, trains: [oldVehicle], arrivals: [prediction])
        XCTAssertNil(TripPlanner.nextDeparture(for: leg, stations: stations, snapshot: old, now: now, feedUnavailable: false))
    }

    private func sampleLines() -> [SubwayLine] {
        let express = [stop("601", 40.80), stop("631", 40.75), stop("635", 40.73), stop("419", 40.70)]
        return [line("4", express), line("5", express),
                line("6", [express[0], stop("603", 40.78), express[1], express[2], stop("640", 40.71)]),
                line("L", [stop("L01", 40.74), stop("L03", 40.73), stop("L08", 40.71)])]
    }

    private func station(_ stopID: String, in stations: [Station]) throws -> Station {
        try XCTUnwrap(stations.first { $0.stopIDs.contains(stopID) })
    }

    private func stop(_ id: String, _ lat: Double, shape: Int = 0) -> Stop {
        Stop(id: id, name: id, lat: lat, lng: -74, shapeIdx: shape)
    }

    private func line(_ route: String, _ stops: [Stop], shape: [[Double]] = []) -> SubwayLine {
        SubwayLine(id: route, routeId: route, color: "#000000", stops: stops, shape: shape)
    }

    private func arrival(_ trip: String, route: String, stop: String, direction: String, seconds: Double) -> Arrival {
        Arrival(routeId: route, stopId: stop, direction: direction, eta: now.timeIntervalSince1970 + seconds, tripId: trip, destStopId: nil)
    }
}
