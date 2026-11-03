import CoreLocation
@testable import StandClear
import XCTest

final class NearbyGlanceProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let coordinate = CLLocationCoordinate2D(latitude: 40.75, longitude: -73.99)

    func testGroupsSameColorServicesWithinStationWithoutMergingUnrelatedSameNames() {
        let stations = [station("one", routes: ["1", "2", "R"]), station("two", routes: ["1"], offset: 0.001)]
        let rows = project(stations, lines: [line("1", "#ee352e"), line("2", "EE352E"), line("R", "FCCC0A")])
        XCTAssertEqual(rows.map(\.station.id), ["one", "one", "two"])
        XCTAssertEqual(rows[0].routes, ["1", "2"])
        XCTAssertEqual(rows[0].color, "EE352E")
        XCTAssertEqual(Set(rows.map(\.id)).count, 3)
    }

    func testChoosesNextValidPredictionInEachDirectionAndMatchesExpressRoute() throws {
        let arrivals = [arrival("later", seconds: 180), arrival("express", route: "6X", seconds: 60),
                        arrival("south", direction: "S", seconds: 120),
                        arrival("unknown", direction: "?", seconds: 1),
                        arrival("expired", seconds: -1), arrival("too-late", direction: "S", seconds: 2701)]
        let row = try XCTUnwrap(project([station("one")], arrivals: arrivals).first)
        XCTAssertEqual(row.north?.tripId, "express")
        let service = try TransitRouteIdentity(XCTUnwrap(row.north?.routeId))
        XCTAssertEqual(service.baseID, "6")
        XCTAssertEqual(service.bullet, "6")
        XCTAssertEqual(service.spokenName, "6 Express")
        XCTAssertTrue(service.isExpress)
        XCTAssertFalse(TransitRouteIdentity("6").isExpress)
        XCTAssertEqual(TransitRouteIdentity("X").baseID, "X")
        XCTAssertEqual(TransitRouteIdentity("GS").spokenName, "S")
        XCTAssertEqual(row.south?.tripId, "south")
        let boundary = try XCTUnwrap(project([station("one")], arrivals: [arrival("limit", seconds: 2700)]).first)
        XCTAssertEqual(boundary.north?.tripId, "limit")
    }

    func testStaleFailedAndMissingSnapshotsKeepStationIdentityButNeverPredictions() {
        let stations = [station("one")]
        let fresh = snapshot([arrival("next")])
        let stale = Snapshot(generatedAt: (now.timeIntervalSince1970 - 60) * 1000, trains: [], arrivals: fresh.arrivals)
        for data in [nil, stale, fresh] as [Snapshot?] {
            let rows = NearbyGlanceProjection.rows(stations: stations, lines: [line("6")], snapshot: data,
                                                   coordinate: coordinate, now: now, feedUnavailable: data?.generatedAt == fresh.generatedAt)
            XCTAssertEqual(rows.map(\.station.id), ["one"])
            XCTAssertNil(rows.first?.north)
            XCTAssertNil(rows.first?.south)
        }
    }

    func testStaleVehicleDoesNotWinAndStoppedVehicleDoesNotInventNow() throws {
        let trains = [Train(id: "old", routeId: "6", direction: "N", progress: 0, prevStopId: "one", nextStopId: "one",
                            status: "STOPPED_AT", lastReportedAt: now.timeIntervalSince1970 - 91),
                      Train(id: "parked", routeId: "6", direction: "S", progress: 0, prevStopId: "one", nextStopId: "one",
                            status: "STOPPED_AT", lastReportedAt: now.timeIntervalSince1970)]
        let data = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: trains,
                            arrivals: [arrival("old", seconds: 1), arrival("trip-only", seconds: 120)])
        let row = try XCTUnwrap(NearbyGlanceProjection.rows(stations: [station("one")], lines: [line("6")],
                                                            snapshot: data, coordinate: coordinate, now: now).first)
        XCTAssertEqual(row.north?.tripId, "trip-only")
        XCTAssertNil(row.south)
    }

    func testDistanceRadiusLimitAndInvalidLocation() {
        let stations = [station("far", offset: 0.02), station("third", offset: 0.003),
                        station("second", offset: 0.002), station("fourth", offset: 0.004), station("one")]
        XCTAssertEqual(project(stations).map(\.station.id), ["one", "second", "third"])
        for origin in [nil, CLLocationCoordinate2D(latitude: .nan, longitude: 0),
                       CLLocationCoordinate2D(latitude: 91, longitude: 0)] as [CLLocationCoordinate2D?]
        {
            XCTAssertTrue(NearbyGlanceProjection.rows(stations: stations, lines: [line("6")], snapshot: nil,
                                                      coordinate: origin, now: now).isEmpty)
        }
        XCTAssertTrue(project([station("far", offset: 0.02)]).isEmpty)
    }

    func testMissingPredictionsDoNotHideCloserGroupsOrReorderAfterRefresh() {
        let stations = [station("one", routes: ["R", "6", "1"])]
        let lines = [line("R", "FCCC0A"), line("6", "00933C"), line("1", "EE352E")]
        let empty = project(stations, lines: lines)
        let updated = project(stations, lines: lines, arrivals: [arrival("red-first", route: "1", seconds: 1)])
        XCTAssertEqual(empty.map(\.id), updated.map(\.id))
        XCTAssertEqual(empty.count, 3)
        XCTAssertNil(updated.first?.north)
        XCTAssertEqual(updated[1].north?.tripId, "red-first")
    }

    private func station(_ id: String, routes: [String] = ["6"], offset: Double = 0) -> Station {
        Station(id: id, stop: Stop(id: id, name: "Same name", lat: coordinate.latitude + offset,
                                   lng: coordinate.longitude, shapeIdx: 0), stopIDs: [id], routes: routes)
    }

    private func line(_ route: String, _ color: String = "00933C") -> SubwayLine {
        SubwayLine(id: route, routeId: route, color: color, stops: [], shape: [])
    }

    private func arrival(_ id: String, route: String = "6", direction: String = "N", seconds: Double = 60) -> Arrival {
        Arrival(routeId: route, stopId: "one", direction: direction, eta: now.timeIntervalSince1970 + seconds,
                tripId: id, destStopId: nil)
    }

    private func snapshot(_ arrivals: [Arrival]) -> Snapshot {
        Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: [], arrivals: arrivals)
    }

    private func project(_ stations: [Station], lines: [SubwayLine]? = nil, arrivals: [Arrival] = []) -> [NearbyGlanceRow] {
        NearbyGlanceProjection.rows(stations: stations, lines: lines ?? [line("6")], snapshot: snapshot(arrivals),
                                    coordinate: coordinate, now: now)
    }
}
