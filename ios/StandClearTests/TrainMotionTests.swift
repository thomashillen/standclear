import CoreLocation
@testable import StandClear
import XCTest

final class TrainMotionTests: XCTestCase {
    private let epoch = 1_800_000_000.0
    private func date(_ offset: Double) -> Date {
        Date(timeIntervalSince1970: epoch + offset)
    }

    private func line(route: String = "R", longitudeOffset: Double = 0) -> SubwayLine {
        let start = Stop(id: "a", name: "A", lat: 40.75, lng: -74 + longitudeOffset, shapeIdx: 0)
        let end = Stop(id: "b", name: "B", lat: 40.751, lng: -73.999 + longitudeOffset, shapeIdx: 3)
        return SubwayLine(id: route, routeId: route, color: "FCCC0A", stops: [start, end],
                          shape: [[-74, 40.75], [-73.999, 40.75], [-73.999, 40.75], [-73.999, 40.751]].map { [$0[0] + longitudeOffset, $0[1]] })
    }

    private func train(_ progress: Double = 0, route: String = "R", reverse: Bool = false, status: String = "IN_TRANSIT_TO", reported: Double? = 0) -> Train {
        Train(id: "t", routeId: route, direction: reverse ? "S" : "N", progress: progress,
              prevStopId: reverse ? "b" : "a", nextStopId: reverse ? "a" : "b", status: status,
              lastReportedAt: reported.map { epoch + $0 })
    }

    private func arrival(_ eta: Double, route: String = "R", direction: String = "N", stop: String = "b", trip: String = "t") -> Arrival {
        Arrival(routeId: route, stopId: stop, direction: direction, eta: epoch + eta, tripId: trip, destStopId: nil)
    }

    private func feed(_ train: Train, _ arrivals: [Arrival], at offset: Double = 0) -> Snapshot {
        Snapshot(generatedAt: (epoch + offset) * 1000, trains: [train], arrivals: arrivals)
    }

    #if DEBUG && targetEnvironment(simulator)
        func testTemporalFixtureMaintainsJourneyAcrossRefreshesAndStops() throws {
            var fixture = TemporalMotionFixture()
            let first = try XCTUnwrap(fixture.sample(at: epoch))
            for offset in stride(from: 8.0, through: 120.0, by: 8) {
                let sample = try XCTUnwrap(fixture.sample(at: epoch + offset))
                XCTAssertEqual(sample.eta, first.eta)
                XCTAssertEqual(sample.generatedAt, (epoch + offset) * 1000)
                XCTAssertEqual(sample.reportedAt, epoch + offset)
                XCTAssertEqual(sample.progress, 0.2 + offset / 120 * 0.8, accuracy: 0.000001)
            }
            let stopped = try XCTUnwrap(fixture.sample(at: epoch + 140))
            XCTAssertEqual(stopped.progress, 1)
            XCTAssertEqual(stopped.status, "STOPPED_AT")
            fixture.reset()
            let restarted = try XCTUnwrap(fixture.sample(at: epoch + 200))
            XCTAssertEqual(restarted.progress, 0.2)
            XCTAssertEqual(restarted.eta, epoch + 320)
            XCTAssertEqual(restarted.status, "IN_TRANSIT_TO")
        }

        func testTemporalFixtureRejectsInvalidTimesWithoutStartingJourney() throws {
            var fixture = TemporalMotionFixture()
            for invalid in [Double.nan, .infinity, -.infinity, -1, .greatestFiniteMagnitude] {
                XCTAssertNil(fixture.sample(at: invalid))
            }
            XCTAssertEqual(try XCTUnwrap(fixture.sample(at: epoch)).eta, epoch + 120)
        }

        func testTemporalRefreshesAdvanceEngineWhileReducedMotionStaysDiscrete() throws {
            var fixture = TemporalMotionFixture()
            var engine = TrainMotion(lines: [line()])
            var previous: CLLocationCoordinate2D?
            for offset in stride(from: 0.0, through: 112.0, by: 8) {
                let sample = try XCTUnwrap(fixture.sample(at: epoch + offset))
                let snapshot = feed(train(sample.progress, status: sample.status, reported: offset),
                                    [arrival(sample.eta - epoch)], at: offset)
                engine.update(snapshot: snapshot, now: date(offset))
                let start = try XCTUnwrap(engine.markers(at: date(offset)).first).coordinate
                let next = try XCTUnwrap(engine.markers(at: date(offset + 4)).first).coordinate
                XCTAssertGreaterThan(next.latitude + next.longitude, start.latitude + start.longitude)
                if let previous {
                    XCTAssertGreaterThan(next.latitude + next.longitude, previous.latitude + previous.longitude)
                }
                previous = next
                let discrete = try XCTUnwrap(engine.markers(at: date(offset), reduceMotion: true).first).coordinate
                let discreteLater = try XCTUnwrap(engine.markers(at: date(offset + 4), reduceMotion: true).first).coordinate
                XCTAssertEqual(discrete.latitude, discreteLater.latitude)
                XCTAssertEqual(discrete.longitude, discreteLater.longitude)
            }
            let stopped = try XCTUnwrap(fixture.sample(at: epoch + 120))
            engine.update(snapshot: feed(train(stopped.progress, status: stopped.status, reported: 120), [], at: 120), now: date(120))
            XCTAssertFalse(engine.hasActiveMotion(at: date(124)))
            XCTAssertEqual(try XCTUnwrap(engine.markers(at: date(124)).first).coordinate.latitude, 40.751, accuracy: 0.000001)
        }

        func testTemporalStaleEvidenceExpiresDespiteFurtherRefreshes() throws {
            var fixture = TemporalMotionFixture()
            let initial = try XCTUnwrap(fixture.sample(at: epoch, stale: true))
            let later = try XCTUnwrap(fixture.sample(at: epoch + 64, stale: true))
            XCTAssertEqual(later.generatedAt, initial.generatedAt)
            XCTAssertEqual(later.reportedAt, initial.reportedAt)
            XCTAssertEqual(later.progress, initial.progress)
            XCTAssertEqual(later.eta, initial.eta)
            var engine = TrainMotion(lines: [line()])
            let snapshot = Snapshot(generatedAt: later.generatedAt,
                                    trains: [train(later.progress)], arrivals: [arrival(later.eta - epoch)])
            engine.update(snapshot: snapshot, now: date(0))
            XCTAssertFalse(engine.markers(at: date(59)).isEmpty)
            engine.update(snapshot: snapshot, now: date(64))
            XCTAssertTrue(engine.markers(at: date(64)).isEmpty)
            XCTAssertFalse(engine.hasActiveMotion(at: date(64)))
        }
    #endif

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

    func testExpressMotionUsesBaseTrackButRequiresExactReportedArrivalEvidence() throws {
        for (express, base) in [("6X", "6"), ("7X", "7"), ("FX", "F")] {
            var engine = TrainMotion(lines: [line(route: base)])
            let vehicle = train(route: express)
            let mismatched = [arrival(40, route: base), arrival(40, route: express, direction: "S"),
                              arrival(40, route: express, stop: "a"), arrival(40, route: express, trip: "other")]
            engine.update(snapshot: feed(vehicle, mismatched), now: date(0))
            XCTAssertFalse(engine.hasActiveMotion(at: date(10)))
            XCTAssertEqual(try XCTUnwrap(engine.markers(at: date(30)).first).coordinate.longitude, -74, accuracy: 0.000001)
            engine.update(snapshot: feed(vehicle, [arrival(40, route: express)]), now: date(0))
            XCTAssertTrue(engine.hasActiveMotion(at: date(10)))
            let moving = try XCTUnwrap(engine.markers(at: date(30)).first)
            XCTAssertGreaterThan(moving.coordinate.latitude, 40.75)
            XCTAssertEqual(moving.routeID, express)
            XCTAssertEqual(moving.displayLetter, express)
            XCTAssertEqual(try XCTUnwrap(engine.markers(at: date(30), reduceMotion: true).first).coordinate.longitude, -74, accuracy: 0.000001)
            XCTAssertTrue(engine.markers(at: date(60)).isEmpty)
            engine.update(snapshot: feed(vehicle, [arrival(40, route: express)]), now: date(0), feedUnavailable: true)
            XCTAssertTrue(engine.markers(at: date(0)).isEmpty)
        }
    }

    func testExpressMotionSamplesItsExactTrackWhenPresentAndNeverFallsBackFromInvalidExactTrack() throws {
        let base = line(route: "6")
        let exact = line(route: "6X", longitudeOffset: 0.01)
        let snapshot = feed(train(route: "6X"), [arrival(40, route: "6X")])
        var engine = TrainMotion(lines: [base, exact])
        engine.update(snapshot: snapshot, now: date(0))
        XCTAssertTrue(engine.hasActiveMotion(at: date(10)))
        let marker = try XCTUnwrap(engine.markers(at: date(30)).first)
        XCTAssertGreaterThan(marker.coordinate.latitude, 40.75)
        XCTAssertEqual(marker.coordinate.longitude, -73.989, accuracy: 0.000001)
        let invalid = SubwayLine(id: exact.id, routeId: exact.routeId, color: exact.color, stops: exact.stops,
                                 shape: [[-74, .nan], [-73, 40]])
        engine = TrainMotion(lines: [base, invalid])
        engine.update(snapshot: snapshot, now: date(0))
        XCTAssertFalse(engine.hasActiveMotion(at: date(10)))
        XCTAssertTrue(engine.markers(at: date(10)).isEmpty)
    }
}
