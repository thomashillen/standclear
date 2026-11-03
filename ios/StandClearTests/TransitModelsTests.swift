import CoreLocation
@testable import StandClear
import XCTest

final class TransitModelsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testStationNameSearchRanksPrefixesAndMatchesReorderedAbbreviations() {
        let names = ["14 St-Union Sq", "Times Sq-42 St", "Union Square", "Squire Road", "Cortelyou Rd"]
        let stations = names.map { name in
            Station(id: name, stop: Stop(id: name, name: name, lat: 0, lng: 0, shapeIdx: 0), stopIDs: [name], routes: [])
        }
        func results(_ query: String) -> [String] {
            Transit.searchStations(stations, query: query).map(\.id)
        }
        XCTAssertEqual(results("  UNION   sq "), ["Union Square", "14 St-Union Sq"])
        XCTAssertEqual(results("42 Square times"), ["Times Sq-42 St"])
        XCTAssertEqual(results("square"), ["Times Sq-42 St", "Union Square", "14 St-Union Sq"])
        XCTAssertEqual(results("times union"), [])
        XCTAssertEqual(results("  "), names)
    }

    func testSnapshotUsesMillisecondsAndExpiresAtSixtySeconds() {
        XCTAssertTrue(snapshot(age: 59.999).isFresh(at: now))
        XCTAssertFalse(snapshot(age: 60).isFresh(at: now))
        XCTAssertFalse(snapshot(age: 120).isFresh(at: now))
        let secondsInsteadOfMilliseconds = Snapshot(generatedAt: now.timeIntervalSince1970, trains: [], arrivals: [])
        XCTAssertFalse(secondsInsteadOfMilliseconds.isFresh(at: now))
    }

    func testInvalidAndFutureSnapshotTimestampsAreNotFresh() {
        for timestamp in [Double.nan, .infinity, -.infinity, 0, -1] {
            XCTAssertFalse(Snapshot(generatedAt: timestamp, trains: [], arrivals: []).isFresh(at: now))
        }
        XCTAssertTrue(snapshot(age: -5).isFresh(at: now))
        XCTAssertFalse(snapshot(age: -5.001).isFresh(at: now))
    }

    func testTripOnlyLastWinsDedupPreservesTerminusQueue() {
        let earlier = train(id: "trip-a", progress: 0.1)
        let later = train(id: "trip-a", progress: 0.8)
        let otherTripAtSamePlatform = train(id: "trip-b", progress: 0.8)
        let data = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000,
                            trains: [earlier, otherTripAtSamePlatform, later], arrivals: [])
        XCTAssertEqual(data.uniqueTrains.map(\.id), ["trip-a", "trip-b"])
        XCTAssertEqual(data.uniqueTrains.first?.progress, 0.8)
        XCTAssertEqual(data.uniqueTrains.last?.nextStopId, data.uniqueTrains.first?.nextStopId)
    }

    func testExplicitComplexMergesPlatformsAndUnionsRoutes() throws {
        let unionSquare = Transit.stations([
            line(route: "6", stops: [stop("635", name: "14 St-Union Sq")]),
            line(route: "4", stops: [stop("635", name: "14 St-Union Sq")]),
            line(route: "L", stops: [stop("L03", name: "14 St-Union Sq")]),
            line(route: "N", stops: [stop("R20", name: "14 St-Union Sq")]),
        ])
        XCTAssertEqual(unionSquare.count, 1)
        let station = try XCTUnwrap(unionSquare.first)
        XCTAssertEqual(station.stopIDs, ["635", "L03", "R20"])
        XCTAssertEqual(station.routes, ["4", "6", "L", "N"])
        XCTAssertEqual(station.id, "635")
    }

    func testComplexCanonicalIDFollowsAllowlistOrderAndPositionUsesPlatformCentroid() throws {
        // Court Square's first allowlisted ID is 719, while F09 sorts first alphabetically.
        // Different platform positions ensure this catches using a single platform as center.
        let lines = [
            line(route: "E", stops: [stop("F09", name: "Court Sq-23 St", latitude: 40.74, longitude: -73.94)]),
            line(route: "7", stops: [stop("719", name: "Court Sq", latitude: 40.75, longitude: -73.95)]),
            line(route: "G", stops: [stop("G22", name: "Court Sq", latitude: 40.76, longitude: -73.96)]),
        ]
        let stations = Transit.stations(lines)
        XCTAssertEqual(stations.count, 1)
        let station = try XCTUnwrap(stations.first)
        XCTAssertEqual(station.id, "719")
        XCTAssertEqual(station.stop.name, "Court Sq")
        XCTAssertEqual(station.stop.lat, 40.75, accuracy: 0.000_001)
        XCTAssertEqual(station.stop.lng, -73.95, accuracy: 0.000_001)
        XCTAssertEqual(station.stopIDs, ["719", "G22", "F09"])
    }

    func testSameNameNearbyRectorStationsRemainSeparate() {
        let stations = Transit.stations([
            line(route: "1", stops: [stop("139", name: "Rector St")]),
            line(route: "R", stops: [stop("R26", name: "Rector St")]),
        ])
        XCTAssertEqual(stations.count, 2)
        XCTAssertEqual(Set(stations.map(\.id)), ["139", "R26"])
        XCTAssertTrue(stations.allSatisfy { $0.stopIDs.count == 1 })
    }

    func testIncompleteComplexOnlyIncludesPresentPlatforms() throws {
        let stations = Transit.stations([line(route: "L", stops: [stop("L03")])])
        let station = try XCTUnwrap(stations.first)
        XCTAssertEqual(station.stopIDs, ["L03"])
        XCTAssertEqual(station.routes, ["L"])
    }

    func testNearbyRanksStationsByDistanceAndLimitsToFive() {
        let origin = CLLocationCoordinate2D(latitude: 40.75, longitude: -73.99)
        let stations = (1 ... 7).reversed().map { offset in
            Station(id: "station-\(offset)",
                    stop: stop("station-\(offset)", latitude: 40.75 + Double(offset) * 0.001, longitude: -73.99),
                    stopIDs: ["station-\(offset)"], routes: ["1"])
        }
        XCTAssertEqual(Transit.nearby(stations, coordinate: origin).map(\.id),
                       ["station-1", "station-2", "station-3", "station-4", "station-5"])
    }

    func testNearbyDoesNotPresentNYCStationsAsNearbyFarFromTheServiceArea() {
        let stations = [Station(id: "635", stop: stop("635"), stopIDs: ["635"], routes: ["6"])]
        let boston = CLLocationCoordinate2D(latitude: 42.36, longitude: -71.06)
        XCTAssertTrue(Transit.nearby(stations, coordinate: boston).isEmpty)
        XCTAssertTrue(Transit.nearby([], coordinate: boston).isEmpty)
    }

    func testArrivalFilteringUsesEpochSecondsAndAllComplexPlatforms() {
        let station = Station(id: "635", stop: stop("635"), stopIDs: ["635", "L03"], routes: ["6", "L"])
        let data = snapshot(arrivals: [
            arrival("later", stopID: "635", secondsFromNow: 90),
            arrival("expired", stopID: "635", secondsFromNow: -0.001),
            arrival("other-station", stopID: "R26", secondsFromNow: 10),
            arrival("now", stopID: "L03", secondsFromNow: 0),
            arrival("invalid", stopID: "635", secondsFromNow: .nan),
        ])
        let result = Transit.arrivals(for: station, snapshot: data, now: now)
        XCTAssertEqual(result.map(\.tripId), ["now", "later"])
        XCTAssertEqual(result.first?.eta, now.timeIntervalSince1970)
    }

    func testDuplicateArrivalIDsUseLastPredictionWithoutCollapsingOtherTripsOrPlatforms() {
        let station = Station(id: "635", stop: stop("635"), stopIDs: ["635", "L03"], routes: ["6", "L"])
        let data = snapshot(arrivals: [
            arrival("trip-a", stopID: "635", secondsFromNow: 30),
            arrival("trip-b", stopID: "635", secondsFromNow: 45),
            arrival("trip-a", stopID: "L03", secondsFromNow: 50),
            arrival("trip-a", stopID: "635", secondsFromNow: 60),
        ])
        let results = Transit.arrivals(for: station, snapshot: data, now: now)
        XCTAssertEqual(results.count, 3)
        XCTAssertEqual(Set(results.map(\.id)), ["trip-a:635:N", "trip-a:L03:N", "trip-b:635:N"])
        XCTAssertEqual(results.first(where: { $0.id == "trip-a:635:N" })?.eta,
                       now.timeIntervalSince1970 + 60)
    }

    func testStaleOrMissingSnapshotDoesNotOfferArrivals() {
        let station = Station(id: "635", stop: stop("635"), stopIDs: ["635"], routes: ["6"])
        let upcoming = arrival("upcoming", stopID: "635", secondsFromNow: 60)
        XCTAssertTrue(Transit.arrivals(for: station, snapshot: nil, now: now).isEmpty)
        XCTAssertTrue(Transit.arrivals(for: station, snapshot: snapshot(age: 60, arrivals: [upcoming]), now: now).isEmpty)
    }

    func testArrivalsExcludeStaleMatchingVehicleReportsButKeepTripOnlyPredictions() {
        let station = Station(id: "635", stop: stop("635"), stopIDs: ["635"], routes: ["6"])
        let predictions = ["fresh", "stale", "no-vehicle", "missing-timestamp"].map {
            arrival($0, stopID: "635", secondsFromNow: 60)
        }
        let vehicles = [
            train(id: "fresh", reportedAt: now.timeIntervalSince1970 - 90),
            train(id: "stale", reportedAt: now.timeIntervalSince1970 - 90.001),
            train(id: "missing-timestamp"),
        ]
        let data = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000,
                            trains: vehicles, arrivals: predictions)
        XCTAssertEqual(Set(Transit.arrivals(for: station, snapshot: data, now: now).map(\.tripId)),
                       ["fresh", "no-vehicle", "missing-timestamp"])
    }

    func testArrivalsRejectInvalidAndFutureVehicleReportsWithFiveSecondClockTolerance() {
        let station = Station(id: "635", stop: stop("635"), stopIDs: ["635"], routes: ["6"])
        let prediction = arrival("trip", stopID: "635", secondsFromNow: 60)
        for timestamp in [Double.nan, .infinity, -.infinity, 0, -1, now.timeIntervalSince1970 + 5.001] {
            let data = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000,
                                trains: [train(reportedAt: timestamp)], arrivals: [prediction])
            XCTAssertTrue(Transit.arrivals(for: station, snapshot: data, now: now).isEmpty)
        }
        let tolerated = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000,
                                 trains: [train(reportedAt: now.timeIntervalSince1970 + 5)], arrivals: [prediction])
        XCTAssertEqual(Transit.arrivals(for: station, snapshot: tolerated, now: now).map(\.tripId), ["trip"])
    }

    func testLatestVehicleReportControlsArrivalFreshnessWithoutMergingDirections() {
        let station = Station(id: "635", stop: stop("635"), stopIDs: ["635"], routes: ["6"])
        let north = arrival("trip", stopID: "635", secondsFromNow: 60)
        let south = arrival("trip", stopID: "635", secondsFromNow: 90, direction: "S")
        let staleLast = Snapshot(generatedAt: now.timeIntervalSince1970 * 1000,
                                 trains: [train(reportedAt: now.timeIntervalSince1970),
                                          train(reportedAt: now.timeIntervalSince1970 - 91)], arrivals: [north, south])
        XCTAssertTrue(Transit.arrivals(for: station, snapshot: staleLast, now: now).isEmpty)
        let freshLast = Snapshot(generatedAt: staleLast.generatedAt, trains: Array(staleLast.trains.reversed()), arrivals: [north, south])
        XCTAssertEqual(Transit.arrivals(for: station, snapshot: freshLast, now: now).map(\.id),
                       ["trip:635:N", "trip:635:S"])
    }

    func testCountdownRoundsUpMinutesAndNeverCallsAnEstimateNow() {
        for (seconds, expected) in [(0.0, "<1 min"), (59.999, "<1 min"), (60, "1 min"), (60.001, "2 min"), (120, "2 min")] {
            XCTAssertEqual(arrival("trip", stopID: "635", secondsFromNow: seconds).countdown(at: now), expected)
        }
        for seconds in [-0.001, Double.nan, .infinity, -.infinity, .greatestFiniteMagnitude] {
            XCTAssertNil(arrival("trip", stopID: "635", secondsFromNow: seconds).countdown(at: now))
        }
    }

    func testArrivalDestinationUsesExactReportedStopInsteadOfComplexNameOrStaticTerminus() {
        let lines = [
            line(route: "7", stops: [stop("719", name: "Court Sq")]),
            line(route: "E", stops: [stop("F09", name: "Court Sq-23 St"), stop("end", name: "Full route terminus")]),
        ]
        let shortTurn = arrival("trip", stopID: "635", secondsFromNow: 60, destination: "F09")
        XCTAssertEqual(shortTurn.destinationName(in: lines), "Court Sq-23 St")
        XCTAssertNil(arrival("trip", stopID: "635", secondsFromNow: 60).destinationName(in: lines))
        XCTAssertNil(arrival("trip", stopID: "635", secondsFromNow: 60, destination: "unknown").destinationName(in: lines))
    }

    func testUnknownDirectionIsNotInventedAsSouthbound() {
        XCTAssertEqual(arrival("trip", stopID: "635", secondsFromNow: 60).directionLabel, "Northbound")
        XCTAssertEqual(arrival("trip", stopID: "635", secondsFromNow: 60, direction: "S").directionLabel, "Southbound")
        XCTAssertEqual(arrival("trip", stopID: "635", secondsFromNow: 60, direction: "?").directionLabel, "Direction unavailable")
    }

    func testCoordinateFollowsForwardAndReverseShape() throws {
        let route = geometryLine()
        let forward = try XCTUnwrap(Transit.coordinate(train(progress: 0.25), line: route))
        XCTAssertEqual(forward.latitude, 15, accuracy: 0.000_001)
        XCTAssertEqual(forward.longitude, 105, accuracy: 0.000_001)
        let reverse = train(progress: 0.25, previous: "end", next: "start")
        let coordinate = try XCTUnwrap(Transit.coordinate(reverse, line: route))
        XCTAssertEqual(coordinate.latitude, 25, accuracy: 0.000_001)
        XCTAssertEqual(coordinate.longitude, 115, accuracy: 0.000_001)
    }

    func testProgressAndShapeIndicesAreClamped() throws {
        let route = geometryLine()
        for (progress, expectedLatitude) in [(-3.0, 10.0), (4.0, 30.0), (Double.nan, 10.0)] {
            let coordinate = try XCTUnwrap(Transit.coordinate(train(progress: progress), line: route))
            XCTAssertEqual(coordinate.latitude, expectedLatitude, accuracy: 0.000_001)
        }
        let invalidIndices = line(stops: [stop("start", index: -20), stop("end", index: 100)], shape: route.shape)
        let coordinate = try XCTUnwrap(Transit.coordinate(train(progress: 0.5), line: invalidIndices))
        XCTAssertEqual(coordinate.latitude, 20, accuracy: 0.000_001)
    }

    func testStoppedOrUnknownPreviousTrainUsesKnownNextStop() throws {
        let route = geometryLine()
        for train in [train(progress: 0.1, status: "STOPPED_AT"), train(progress: 0.1, previous: "missing")] {
            let coordinate = try XCTUnwrap(Transit.coordinate(train, line: route))
            XCTAssertEqual(coordinate.latitude, 30)
            XCTAssertEqual(coordinate.longitude, 120)
        }
        XCTAssertNil(Transit.coordinate(train(next: "unknown"), line: route))
    }

    private func snapshot(age: Double = 0, arrivals: [Arrival] = []) -> Snapshot {
        Snapshot(generatedAt: (now.timeIntervalSince1970 - age) * 1000, trains: [], arrivals: arrivals)
    }

    private func arrival(_ trip: String, stopID: String, secondsFromNow: Double,
                         direction: String = "N", destination: String? = nil) -> Arrival
    {
        Arrival(routeId: "6", stopId: stopID, direction: direction, eta: now.timeIntervalSince1970 + secondsFromNow,
                tripId: trip, destStopId: destination)
    }

    private func train(id: String = "trip", progress: Double = 0, previous: String = "start",
                       next: String = "end", status: String = "IN_TRANSIT_TO", reportedAt: Double? = nil) -> Train
    {
        Train(id: id, routeId: "1", direction: "N", progress: progress, prevStopId: previous,
              nextStopId: next, status: status, lastReportedAt: reportedAt)
    }

    private func stop(_ id: String, name: String = "Station", index: Int = 0,
                      latitude: Double = 40.7, longitude: Double = -74) -> Stop
    {
        Stop(id: id, name: name, lat: latitude, lng: longitude, shapeIdx: index)
    }

    private func line(route: String = "1", stops: [Stop], shape: [[Double]] = []) -> SubwayLine {
        SubwayLine(id: route, routeId: route, color: "EE352E", stops: stops, shape: shape)
    }

    private func geometryLine() -> SubwayLine {
        line(stops: [stop("start", index: 0, latitude: 10, longitude: 100),
                     stop("end", index: 2, latitude: 30, longitude: 120)],
             shape: [[100, 10], [110, 20], [120, 30]])
    }
}

@MainActor
final class RecentStationsTests: XCTestCase {
    func testBoundedUniqueHistoryResolvesCurrentStationsAndClearsPersistence() throws {
        let domain = "StandClear.RecentStationsTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let history = RecentStations(defaults: defaults)
        for index in 1 ... 12 {
            history.record(String(index))
        }
        history.record("5")
        history.record("5")
        let expected = ["5", "12", "11", "10", "9", "8", "7", "6", "4", "3"]
        XCTAssertEqual(history.ids, expected)
        let restored = RecentStations(defaults: defaults)
        XCTAssertEqual(restored.ids, expected)
        XCTAssertTrue(restored.resolved(in: []).isEmpty)
        let current: [Station] = ["12", "5", "other"].map { id in
            let stop = Stop(id: id, name: "Updated \(id)", lat: 40.75, lng: -74, shapeIdx: 0)
            return Station(id: id, stop: stop, stopIDs: [id], routes: ["4"])
        }
        XCTAssertEqual(restored.resolved(in: current).map(\.stop.name), ["Updated 5", "Updated 12"])
        XCTAssertEqual(restored.ids, expected, "Delayed or unavailable stations must not erase stored selections")
        restored.clear()
        XCTAssertTrue(RecentStations(defaults: defaults).ids.isEmpty)
    }
}
