import CoreLocation
@testable import StandClear
import XCTest

final class TrainMapProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testCompassBearingsFollowForwardAndReverseTravel() throws {
        let north = route(shape: [[-74, 40], [-74, 41]])
        XCTAssertEqual(try marker(train(), line: north).bearingDegrees ?? -1, 0, accuracy: 0.0001)
        let east = route(shape: [[-74, 40], [-73, 40]])
        XCTAssertEqual(try marker(train(), line: east).bearingDegrees ?? -1, 90, accuracy: 0.0001)
        let westbound = train(previous: "end", next: "start")
        XCTAssertEqual(try marker(westbound, line: east).bearingDegrees ?? -1, 270, accuracy: 0.0001)
    }

    func testTangentSkipsRepeatedVerticesAndWorksAtShapeEndpoint() throws {
        let line = route(shape: [[-74, 40], [-74, 40], [-73, 40]])
        XCTAssertEqual(try marker(train(progress: 0), line: line).bearingDegrees ?? -1, 90, accuracy: 0.0001)
        XCTAssertEqual(try marker(train(progress: 1), line: line).bearingDegrees ?? -1, 90, accuracy: 0.0001)
    }

    func testReverseAtCornerUsesTheSegmentItWillEnter() throws {
        let corner = route(shape: [[-74, 40], [-73, 40], [-73, 41]])
        let reverse = train(progress: 0.5, previous: "end", next: "start")
        XCTAssertEqual(try marker(reverse, line: corner).bearingDegrees ?? -1, 270, accuracy: 0.0001)
        XCTAssertEqual(try marker(train(progress: 0.5), line: corner).bearingDegrees ?? -1, 0, accuracy: 0.0001)
    }

    func testStoppedTrainUsesItsFutureTripStopRatherThanCompassDirectionCode() throws {
        let line = route(shape: [[-74, 40], [-73, 40]])
        let parked = train(previous: "end", next: "end", status: "STOPPED_AT")
        let future = Arrival(routeId: "A", stopId: "start", direction: "N", eta: now.timeIntervalSince1970 + 60,
                             tripId: parked.id, destStopId: nil)
        let result = try marker(parked, line: line, arrivals: [future])
        XCTAssertEqual(result.bearingDegrees ?? -1, 270, accuracy: 0.0001)
        XCTAssertEqual(result.coordinate.longitude, -73, accuracy: 0.0001)
    }

    func testStoppedTrainWithoutDirectionEvidenceUsesNeutralHeading() throws {
        let parked = train(previous: "end", next: "end", status: "STOPPED_AT")
        XCTAssertNil(try marker(parked).bearingDegrees)
        let duplicateShape = route(shape: [[-74, 40], [-74, 40]])
        XCTAssertNil(try marker(train(), line: duplicateShape).bearingDegrees)
    }

    func testMarkerAgeFadesContinuouslyAndHidesOnlyPastSixMinutes() throws {
        XCTAssertEqual(try marker(train(age: 90)).opacity, 1, accuracy: 0.0001)
        XCTAssertEqual(try marker(train(age: 225)).opacity, 0.7, accuracy: 0.0001)
        XCTAssertEqual(try marker(train(age: 360)).opacity, 0.4, accuracy: 0.0001)
        XCTAssertTrue(project([train(age: 360.001)]).isEmpty)
        XCTAssertTrue(try marker(train(age: 91)).stale)
        XCTAssertFalse(try marker(train(age: 90)).stale)
    }

    func testSnapshotOutageAndInvalidReportsDoNotPresentLiveMarkers() {
        let fresh = snapshot([train()])
        XCTAssertTrue(TrainMapProjection.markers(snapshot: fresh, lines: [route()], now: now, feedUnavailable: true).isEmpty)
        XCTAssertTrue(TrainMapProjection.markers(snapshot: nil, lines: [route()], now: now).isEmpty)
        let stale = Snapshot(generatedAt: (now.timeIntervalSince1970 - 60) * 1000, trains: [train()], arrivals: [])
        XCTAssertTrue(TrainMapProjection.markers(snapshot: stale, lines: [route()], now: now).isEmpty)
        for timestamp in [Double.nan, .infinity, 0, now.timeIntervalSince1970 + 6] {
            let invalid = Train(id: "bad", routeId: "A", direction: "N", progress: 0,
                                prevStopId: "start", nextStopId: "end", status: "IN_TRANSIT_TO", lastReportedAt: timestamp)
            XCTAssertTrue(project([invalid]).isEmpty)
        }
    }

    func testProjectionPreservesTripOnlyLastWinsQueueAndTimestampFallback() throws {
        let first = train(id: "one", progress: 0.1)
        let replacement = train(id: "one", progress: 0.8)
        let second = train(id: "two", progress: 0.8)
        let markers = project([first, second, replacement])
        XCTAssertEqual(markers.map(\.id), ["one", "two"])
        XCTAssertEqual(try XCTUnwrap(markers.first).coordinate.longitude, -73.2, accuracy: 0.0001)
        let noReport = Train(id: "fallback", routeId: "A", direction: "N", progress: 0,
                             prevStopId: "start", nextStopId: "end", status: "IN_TRANSIT_TO", lastReportedAt: nil)
        XCTAssertEqual(try marker(noReport).opacity, 1)
    }

    func testInvalidGeometryIsOmittedAndTransitLabelContrastIsPreserved() throws {
        XCTAssertTrue(project([train()], line: route(shape: [[-74, 40], [-73, .nan]])).isEmpty)
        XCTAssertTrue(project([train()], line: route(shape: [[-74, 40], [-73, 100]])).isEmpty)
        XCTAssertEqual(try marker(train(), line: route(color: "#0039A6")).textColor, "white")
        XCTAssertEqual(try marker(train(), line: route(color: "#FCCC0A")).textColor, "black")
        XCTAssertEqual(try marker(train()).displayLetter, "A")
    }

    private func project(_ trains: [Train], line: SubwayLine? = nil, arrivals: [Arrival] = []) -> [TrainMapMarker] {
        TrainMapProjection.markers(snapshot: snapshot(trains, arrivals: arrivals), lines: [line ?? route()], now: now)
    }

    private func marker(_ train: Train, line: SubwayLine? = nil, arrivals: [Arrival] = []) throws -> TrainMapMarker {
        try XCTUnwrap(project([train], line: line, arrivals: arrivals).first)
    }

    private func snapshot(_ trains: [Train], arrivals: [Arrival] = []) -> Snapshot {
        Snapshot(generatedAt: now.timeIntervalSince1970 * 1000, trains: trains, arrivals: arrivals)
    }

    private func train(id: String = "trip", progress: Double = 0.5, previous: String = "start",
                       next: String = "end", status: String = "IN_TRANSIT_TO", age: Double = 0) -> Train
    {
        Train(id: id, routeId: "A", direction: "N", progress: progress, prevStopId: previous,
              nextStopId: next, status: status, lastReportedAt: now.timeIntervalSince1970 - age)
    }

    private func route(shape: [[Double]] = [[-74, 40], [-73, 40]], color: String = "#0039A6") -> SubwayLine {
        let first = shape.first ?? [-74, 40], last = shape.last ?? [-73, 40]
        return SubwayLine(id: "A", routeId: "A", color: color,
                          stops: [Stop(id: "start", name: "Start", lat: first[1], lng: first[0], shapeIdx: 0),
                                  Stop(id: "end", name: "End", lat: last[1], lng: last[0], shapeIdx: max(0, shape.count - 1))], shape: shape)
    }
}
