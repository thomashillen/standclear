import CoreLocation
@testable import StandClear
import XCTest

final class TrainMotionTests: XCTestCase {
    private let epoch = 1_800_000_000.0
    private func date(_ offset: Double) -> Date {
        Date(timeIntervalSince1970: epoch + offset)
    }

    private func line() -> SubwayLine {
        let start = Stop(id: "a", name: "A", lat: 40.75, lng: -74, shapeIdx: 0)
        let end = Stop(id: "b", name: "B", lat: 40.751, lng: -73.999, shapeIdx: 3)
        return SubwayLine(id: "R", routeId: "R", color: "FCCC0A", stops: [start, end],
                          shape: [[-74, 40.75], [-73.999, 40.75], [-73.999, 40.75], [-73.999, 40.751]])
    }

    private func train(_ progress: Double = 0, reverse: Bool = false, status: String = "IN_TRANSIT_TO", reported: Double? = 0) -> Train {
        Train(id: "t", routeId: "R", direction: reverse ? "S" : "N", progress: progress,
              prevStopId: reverse ? "b" : "a", nextStopId: reverse ? "a" : "b", status: status,
              lastReportedAt: reported.map { epoch + $0 })
    }

    private func arrival(_ eta: Double, route: String = "R", direction: String = "N", stop: String = "b", trip: String = "t") -> Arrival {
        Arrival(routeId: route, stopId: stop, direction: direction, eta: epoch + eta, tripId: trip, destStopId: nil)
    }

    private func feed(_ train: Train, _ arrivals: [Arrival], at offset: Double = 0) -> Snapshot {
        Snapshot(generatedAt: (epoch + offset) * 1000, trains: [train], arrivals: arrivals)
    }

    func testMovementFollowsTrackAndHoldsNextPlatformAfterETA() throws {
        var engine = TrainMotion(lines: [line()])
        engine.update(snapshot: feed(train(), [arrival(40)]), now: date(0))
        XCTAssertTrue(engine.hasActiveMotion(at: date(10)))
        XCTAssertFalse(engine.hasActiveMotion(at: date(40)))
        let beforeTurn = try XCTUnwrap(engine.markers(at: date(10)).first)
        XCTAssertEqual(beforeTurn.coordinate.latitude, 40.75, accuracy: 0.000001)
        XCTAssertGreaterThan(beforeTurn.coordinate.longitude, -74)
        XCTAssertEqual(try XCTUnwrap(beforeTurn.bearingDegrees), 90, accuracy: 0.001)
        let afterTurn = try XCTUnwrap(engine.markers(at: date(30)).first)
        XCTAssertEqual(afterTurn.coordinate.longitude, -73.999, accuracy: 0.000001)
        XCTAssertGreaterThan(afterTurn.coordinate.latitude, beforeTurn.coordinate.latitude)
        XCTAssertEqual(try XCTUnwrap(afterTurn.bearingDegrees), 0, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(engine.markers(at: date(50)).first).coordinate.latitude, 40.751, accuracy: 0.000001)
        XCTAssertEqual(try XCTUnwrap(engine.markers(at: date(30), reduceMotion: true).first).coordinate.longitude, -74, accuracy: 0.000001)
    }

    func testReverseTravelFollowsPlatformOrderAndTurnsWest() throws {
        var engine = TrainMotion(lines: [line()])
        engine.update(snapshot: feed(train(reverse: true), [arrival(40, direction: "S", stop: "a")]), now: date(0))
        let beforeTurn = try XCTUnwrap(engine.markers(at: date(10)).first)
        XCTAssertEqual(try XCTUnwrap(beforeTurn.bearingDegrees), 180, accuracy: 0.001)
        XCTAssertEqual(beforeTurn.coordinate.longitude, -73.999, accuracy: 0.000001)
        let afterTurn = try XCTUnwrap(engine.markers(at: date(35)).first)
        XCTAssertEqual(try XCTUnwrap(afterTurn.bearingDegrees), 270, accuracy: 0.001)
        XCTAssertEqual(afterTurn.coordinate.latitude, 40.75, accuracy: 0.000001)
    }

    func testUnmatchedETAsUnknownVehicleTimeAndStationDwellStayDiscrete() throws {
        let unrelated = [arrival(30, route: "W"), arrival(30, direction: "S"), arrival(30, stop: "a"), arrival(30, trip: "other"), arrival(-1)]
        for (vehicle, etas) in [(train(), unrelated), (train(reported: nil), [arrival(40)]), (train(status: "STOPPED_AT"), [arrival(40)])] {
            var engine = TrainMotion(lines: [line()])
            engine.update(snapshot: feed(vehicle, etas), now: date(0))
            let start = try XCTUnwrap(engine.markers(at: date(0)).first)
            let later = try XCTUnwrap(engine.markers(at: date(30)).first)
            XCTAssertEqual(start.coordinate.latitude, later.coordinate.latitude)
            XCTAssertEqual(start.coordinate.longitude, later.coordinate.longitude)
        }
    }

    func testPartialRepresentativeShapeAndImpossibleETADoNotAnimate() throws {
        let good = line()
        let displaced = Stop(id: "b", name: "Branch", lat: 40.78, lng: -73.999, shapeIdx: 3)
        let branch = SubwayLine(id: good.id, routeId: good.routeId, color: good.color, stops: [good.stops[0], displaced], shape: good.shape)
        for (route, seconds) in [(branch, 40.0), (good, 1.0)] {
            var engine = TrainMotion(lines: [route])
            engine.update(snapshot: feed(train(), [arrival(seconds)]), now: date(0))
            XCTAssertFalse(engine.hasActiveMotion(at: date(0)))
            let start = try XCTUnwrap(engine.markers(at: date(0)).first)
            let end = try XCTUnwrap(engine.markers(at: date(15)).first)
            XCTAssertEqual(start.coordinate.latitude, end.coordinate.latitude)
            XCTAssertEqual(start.coordinate.longitude, end.coordinate.longitude)
        }
    }

    func testReanchorHoldsForwardProgressAndRecoversAfterOutage() throws {
        var engine = TrainMotion(lines: [line()])
        let original = feed(train(), [arrival(40)])
        engine.update(snapshot: original, now: date(0))
        let before = try XCTUnwrap(engine.markers(at: date(10)).first)
        let newer = feed(train(0, reported: 10), [arrival(50)], at: 10)
        engine.update(snapshot: newer, now: date(10))
        let after = try XCTUnwrap(engine.markers(at: date(10)).first)
        XCTAssertEqual(before.coordinate.longitude, after.coordinate.longitude, accuracy: 0.000001)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(engine.markers(at: date(16)).first).coordinate.longitude, before.coordinate.longitude)
        engine.update(snapshot: original, now: date(20))
        XCTAssertFalse(engine.markers(at: date(64)).isEmpty, "An out-of-order feed must not replace a newer snapshot")
        engine.update(snapshot: newer, now: date(20), feedUnavailable: true)
        XCTAssertTrue(engine.markers(at: date(20)).isEmpty)
        engine.update(snapshot: newer, now: date(20))
        XCTAssertFalse(engine.markers(at: date(20)).isEmpty)
        engine.reset()
        XCTAssertTrue(engine.markers(at: date(20)).isEmpty)
    }

    func testSameGenerationReplacesPredictionsStopsAndRoster() throws {
        var engine = TrainMotion(lines: [line()])
        let original = feed(train(), [arrival(40)])
        engine.update(snapshot: original, now: date(0))
        let before = try XCTUnwrap(engine.markers(at: date(10)).first)
        let corrected = feed(train(), [arrival(20)])
        engine.update(snapshot: corrected, now: date(10))
        XCTAssertGreaterThan(try XCTUnwrap(engine.markers(at: date(10)).first).coordinate.latitude, before.coordinate.latitude)
        let completed = try XCTUnwrap(engine.markers(at: date(22)).first)
        engine.update(snapshot: corrected, now: date(22))
        XCTAssertEqual(try XCTUnwrap(engine.markers(at: date(22)).first).coordinate.latitude, completed.coordinate.latitude)
        XCTAssertEqual(completed.coordinate.latitude, 40.751, accuracy: 0.000001)
        engine.update(snapshot: feed(train(status: "STOPPED_AT"), [arrival(45)]), now: date(22))
        XCTAssertFalse(engine.hasActiveMotion(at: date(22)))
        XCTAssertNil(try XCTUnwrap(engine.markers(at: date(22)).first).bearingDegrees)
        engine.update(snapshot: Snapshot(generatedAt: original.generatedAt, trains: [], arrivals: []), now: date(23))
        XCTAssertTrue(engine.markers(at: date(23)).isEmpty)
    }

    func testSnapshotExpiryAndVehicleExpiryApplyBetweenUpdates() throws {
        var engine = TrainMotion(lines: [line()])
        engine.update(snapshot: feed(train(reported: -80), [arrival(45)]), now: date(0))
        let lastFresh = try XCTUnwrap(engine.markers(at: date(10)).first)
        let faded = try XCTUnwrap(engine.markers(at: date(30)).first)
        XCTAssertLessThan(faded.opacity, 1)
        XCTAssertEqual(faded.coordinate.longitude, lastFresh.coordinate.longitude)
        XCTAssertTrue(engine.markers(at: date(60)).isEmpty)
        engine.reset()
        engine.update(snapshot: feed(train(reported: -355), [arrival(40)]), now: date(0))
        XCTAssertTrue(engine.markers(at: date(6)).isEmpty)
    }
}
