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
        let endpoints = StationTripEndpoints(plan: reverse, lines: lines)
        XCTAssertEqual(endpoints.boarding?.id, "L08")
        XCTAssertEqual(endpoints.alighting?.id, "L01")
    }

    func testWest14StreetTransfersRespectTheTwoComplexes() throws {
        let lines = [
            line("1", [stop("131", 40.741), stop("132", 40.738)]),
            line("C", [stop("A30", 40.745), stop("A31", 40.740)]),
            line("F", [stop("D18", 40.743), stop("D19", 40.738)]),
            line("L", [stop("L01", 40.740), stop("L02", 40.737), stop("L03", 40.735)]),
        ]
        let stations = Transit.stations(lines)
        func plans(_ from: String, _ to: String) throws -> [NativeTripPlan] {
            try TripPlanner.plans(lines: lines, stations: stations, from: station(from, in: stations), to: station(to, in: stations))
        }

        // Crossing from Seventh Avenue to Eighth Avenue requires another leg.
        XCTAssertTrue(try plans("131", "A30").isEmpty)
        let direct = try plans("L02", "L01").first
        XCTAssertEqual(direct?.legs.map(\.routeId), ["L"])
        XCTAssertEqual(direct?.totalStops, 1)
        // Preserve the connected platforms at each end of that L ride.
        XCTAssertEqual(try plans("131", "D18").first?.legs.map(\.boardStopId), ["131", "D19"])
        XCTAssertEqual(try plans("A30", "L03").first?.legs.map(\.boardStopId), ["A30", "L01"])
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

    func testStationTripEndpointsResolveOuterPlatformsOnlyOnTheirSelectedLines() throws {
        let lines = sampleLines(), stations = Transit.stations(lines)
        let plan = try XCTUnwrap(try TripPlanner.plans(lines: lines, stations: stations,
                                                       from: station("L01", in: stations), to: station("419", in: stations)).first)
        let endpoints = StationTripEndpoints(plan: plan, lines: lines)
        XCTAssertEqual(endpoints.boarding?.id, "L01")
        XCTAssertEqual(endpoints.alighting?.id, "419")

        // The same alighting stop also appears on the sibling 5. If the 4
        // disappears or has invalid coordinates, its endpoint is unavailable.
        let missing = lines.filter { $0.routeId != "4" }
        let partial = StationTripEndpoints(plan: plan, lines: missing)
        XCTAssertEqual(partial.boarding?.id, "L01")
        XCTAssertNil(partial.alighting)
        let invalid = line("4", [stop("419", 91)])
        XCTAssertNil(StationTripEndpoints(plan: plan, lines: missing + [invalid]).alighting)
    }

    func testRouteChoiceTitleNamesTransferAndPreservesDirectAndUnavailableFallbacks() throws {
        let lines = sampleLines(), stations = Transit.stations(lines)
        let transfer = try XCTUnwrap(try TripPlanner.plans(lines: lines, stations: stations,
                                                           from: station("L01", in: stations), to: station("419", in: stations)).first)
        XCTAssertEqual(transfer.routeChoiceTitle(in: lines), "Change to 4/5 at 635")
        XCTAssertEqual(transfer.routeChoiceTitle(in: []), "1 transfer", "Missing platform data must not invent an interchange")
        let direct = try XCTUnwrap(try TripPlanner.plans(lines: lines, stations: stations,
                                                         from: station("L01", in: stations), to: station("L08", in: stations)).first)
        XCTAssertEqual(direct.routeChoiceTitle(in: lines), "Direct")
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

    func testFirstBoardingUsesWalkAndEntryButKeepsPlatformPrediction() throws {
        let stations = Transit.stations(sampleLines())
        let leg = try XCTUnwrap(try TripPlanner.plans(lines: sampleLines(), stations: stations,
                                                      from: station("631", in: stations), to: station("419", in: stations)).first?.legs.first)
        let arrivals = [arrival("early", route: "4", stop: "631", direction: "S", seconds: 180),
                        arrival("wrong-direction", route: "4", stop: "631", direction: "N", seconds: 231),
                        arrival("boundary", route: "4", stop: "631", direction: "S", seconds: 230)]
        let snapshot = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: [], arrivals: arrivals)
        let eligible = TripPlanner.departures(for: leg, stations: stations, snapshot: snapshot, now: now, feedUnavailable: false)
        XCTAssertEqual(eligible.map(\.tripId), ["early", "boundary"])
        let comparison = TripPlanner.EarlyDeparture(departures: eligible, walkSeconds: 210, now: now)
        XCTAssertEqual(comparison?.nextAfterWalk?.tripId, "boundary")
        XCTAssertNotNil(TripPlanner.EarlyDeparture(departures: eligible, walkSeconds: 300, now: now))
        XCTAssertNil(TripPlanner.EarlyDeparture(departures: eligible, walkSeconds: 300, now: now)?.nextAfterWalk)
        for duration: Double? in [nil, 0, -1, .nan, .infinity, 160] {
            XCTAssertNil(TripPlanner.EarlyDeparture(departures: eligible, walkSeconds: duration, now: now))
        }
        XCTAssertNil(TripPlanner.EarlyDeparture(departures: [], walkSeconds: 210, now: now))
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

    func testOperationalEJZDirectionsAndOppositeArrivalRejectionForCachedLines() throws {
        for route in ["E", "J", "Z"] {
            let southID = route == "E" ? "E01" : "M23"
            let stops = [stop("G05", 40.702147), stop("middle", 40.75), stop(southID, route == "E" ? 40.712582 : 40.706476)]
            for ordered in [stops, Array(stops.reversed())] {
                let lines = [line(route, ordered)], stations = Transit.stations(lines)
                for (destination, expected) in [("G05", "N"), (southID, "S")] {
                    let leg = try XCTUnwrap(try TripPlanner.plans(lines: lines, stations: stations,
                                                                  from: station("middle", in: stations), to: station(destination, in: stations)).first?.legs.first)
                    XCTAssertEqual(leg.direction, expected, route)
                    let opposite = arrival("opposite", route: route, stop: "middle", direction: expected == "N" ? "S" : "N", seconds: 30)
                    let valid = arrival("valid", route: route, stop: "middle", direction: expected, seconds: 60)
                    let snapshot = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: [], arrivals: [opposite, valid])
                    XCTAssertEqual(TripPlanner.nextDeparture(for: leg, stations: stations, snapshot: snapshot, now: now, feedUnavailable: false)?.tripId, "valid", route)
                }
            }
        }
    }

    func testDirectionMetadataDecodesAndOverridesLatitudeInBothOrders() throws {
        let json = ##"{"id":"X","routeId":"X","color":"#000000","stops":[{"id":"x","name":"X","lat":40.8,"lng":-74,"shapeIdx":0},{"id":"y","name":"Y","lat":40.7,"lng":-74,"shapeIdx":0}],"shape":[],"directionTowardEnd":"N"}"##
        let explicit = try JSONDecoder().decode(SubwayLine.self, from: Data(json.utf8))
        XCTAssertEqual(explicit.directionTowardEnd, "N")
        let stations = Transit.stations([explicit])
        for (from, to, expected) in [("x", "y", "N"), ("y", "x", "S")] {
            let leg = try XCTUnwrap(try TripPlanner.plans(lines: [explicit], stations: stations,
                                                          from: station(from, in: stations), to: station(to, in: stations)).first?.legs.first)
            XCTAssertEqual(leg.direction, expected)
        }
        let legacyJSON = json.replacingOccurrences(of: #","directionTowardEnd":"N""#, with: "")
        XCTAssertNil(try JSONDecoder().decode(SubwayLine.self, from: Data(legacyJSON.utf8)).directionTowardEnd)
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
