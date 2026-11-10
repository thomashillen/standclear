import CoreLocation
import MapKit
@testable import StandClear
import XCTest

@MainActor
final class PlaceServiceTests: XCTestCase {
    private let start = CLLocationCoordinate2D(latitude: 40.75, longitude: -73.98)
    private let end = CLLocationCoordinate2D(latitude: 40.7501, longitude: -73.9802)

    func testSuggestionKeepsIdentityAndResolvesOnlyWhenChosen() async throws {
        var requests = 0
        let destination = place("resolved-map-item")
        let suggestion = PlaceSuggestion(id: "completion", name: "Suggested place", subtitle: "NYC") {
            requests += 1
            return destination
        }
        XCTAssertEqual(suggestion.id, "completion")
        XCTAssertEqual(requests, 0, "Showing suggestions must not issue a search per result")
        let resolved = try await suggestion.resolve()
        XCTAssertEqual(resolved, destination, "Use the selected completion's resolved coordinates and identity")
        XCTAssertEqual(requests, 1)
        let fixture = PlaceSuggestion(place: destination)
        XCTAssertEqual(fixture.id, destination.id)
        let fixtureResult = try await fixture.resolve()
        XCTAssertEqual(fixtureResult, destination)
    }

    func testSuggestionResolutionRejectsOutOfCoverageAndInvalidCoordinates() async throws {
        for invalid in [place("outside", latitude: 42), place("invalid", latitude: .nan),
                        PlaceResult(id: "empty", name: " ", subtitle: "", latitude: 40.75, longitude: -73.98)]
        {
            let suggestion = PlaceSuggestion(place: invalid)
            do {
                _ = try await suggestion.resolve()
                XCTFail("A region-biased completion must not bypass coverage validation")
            } catch PlaceServiceError.outsideCoverage {}
        }
    }

    func testCancelledSuggestionResolutionCannotDeliverLatePlace() async throws {
        let started = AsyncStream<Void>.makeStream()
        var pending: CheckedContinuation<PlaceResult, Never>?
        let suggestion = PlaceSuggestion(id: "delayed", name: "Delayed", subtitle: "") {
            await withCheckedContinuation {
                pending = $0
                started.continuation.yield(())
            }
        }
        let task = Task { try await suggestion.resolve() }
        var iterator = started.stream.makeAsyncIterator()
        _ = await iterator.next()
        task.cancel()
        try XCTUnwrap(pending).resume(returning: place("late"))
        do {
            _ = try await task.value
            XCTFail("Cancelled completion resolution must not navigate or save a place")
        } catch is CancellationError {}
    }

    func testSuggestionResolutionFailureCanBeRetriedWithoutChangingSuggestion() async throws {
        var attempts = 0
        let destination = place("recovered")
        let suggestion = PlaceSuggestion(id: "retry", name: "Retry", subtitle: "") {
            attempts += 1
            if attempts == 1 {
                throw URLError(.notConnectedToInternet)
            }
            return destination
        }
        do {
            _ = try await suggestion.resolve()
            XCTFail("Failed resolution must not be presented as a selected place")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        }
        let recovered = try await suggestion.resolve()
        XCTAssertEqual(recovered, destination)
        XCTAssertEqual(attempts, 2)
    }

    func testSearchPreservesRankingAndSelectedCoordinatesWithinNYCBounds() async throws {
        let a = place("a")
        let other = place("other", latitude: 40.76)
        let service = PlaceService(find: { query in
            XCTAssertEqual(query, "550 Madison")
            return [a, self.place("outside", latitude: 34), a, other]
        }, route: unexpectedWalk)
        let results = try await service.search(" 550 Madison ")
        XCTAssertEqual(results, [a, other])
        XCTAssertEqual(results[0].coordinate.longitude, -73.98)
        XCTAssertEqual(results[1].coordinate.latitude, 40.76)
    }

    func testServiceAreaAndSearchRegionCoverPreviouslyExcludedStatenIslandStations() {
        // Extracted from public/gtfsData.json: each failed the old south/west bounds.
        let stops: [(String, Double, Double)] = [
            ("Eltingville", 40.544601, -74.16457), ("Annadale", 40.54046, -74.178217),
            ("Huguenot", 40.533674, -74.191794), ("Prince's Bay", 40.525507, -74.200064),
            ("Pleasant Plains", 40.52241, -74.217847), ("Richmond Valley", 40.519631, -74.229141),
            ("Arthur Kill", 40.516578, -74.242096), ("Tottenville", 40.512764, -74.251961),
        ]
        let region = PlaceServiceArea.searchRegion
        for (name, latitude, longitude) in stops {
            XCTAssertTrue(PlaceServiceArea.contains(.init(latitude: latitude, longitude: longitude)), name)
            XCTAssertLessThan(abs(latitude - region.center.latitude), region.span.latitudeDelta / 2, name)
            XCTAssertLessThan(abs(longitude - region.center.longitude), region.span.longitudeDelta / 2, name)
        }
    }

    func testTottenvilleSearchResultAndShortWalkArePreserved() async throws {
        let station = CLLocationCoordinate2D(latitude: 40.512764, longitude: -74.251961)
        let destination = PlaceResult(id: "tottenville", name: "Tottenville destination", subtitle: "Staten Island",
                                      latitude: 40.514, longitude: -74.251)
        let middle = CLLocationCoordinate2D(latitude: 40.5134, longitude: -74.2516)
        let service = PlaceService(find: { _ in [destination, self.place("outside", latitude: 40.46)] }, route: { from, to in
            XCTAssertEqual(from.latitude, station.latitude)
            XCTAssertEqual(to.longitude, destination.longitude)
            return WalkingConnection(coordinates: [from, middle, to], seconds: 180, meters: 240)
        })
        let matches = try await service.search("Tottenville")
        XCTAssertEqual(matches, [destination])
        let walk = try await service.walk(from: station, to: destination.coordinate)
        XCTAssertEqual(walk.seconds, 180)
        XCTAssertEqual(walk.meters, 240)
        XCTAssertEqual(walk.coordinates.map(\.latitude), [station.latitude, middle.latitude, destination.latitude])
        XCTAssertEqual(walk.coordinates.map(\.longitude), [station.longitude, middle.longitude, destination.longitude])
    }

    func testShortQuerySkipsSearchAndNoMatchDiffersFromServiceFailure() async throws {
        let service = PlaceService(find: { query in
            switch query {
            case "no match": throw NSError(domain: MKErrorDomain, code: Int(MKError.Code.placemarkNotFound.rawValue))
            case "offline": throw URLError(.notConnectedToInternet)
            default: XCTFail("Short input should not start a search"); return []
            }
        }, route: unexpectedWalk)
        let short = try await service.search(" a ")
        let noMatch = try await service.search("no match")
        XCTAssertTrue(short.isEmpty && noMatch.isEmpty)
        do {
            _ = try await service.search("offline")
            XCTFail("A service failure must be distinguishable from an empty result")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        }
    }

    func testSearchCancellationDiscardsLateResult() async throws {
        let started = AsyncStream<Void>.makeStream()
        var pending: CheckedContinuation<[PlaceResult], Never>?
        let service = PlaceService(find: { _ in
            await withCheckedContinuation {
                pending = $0
                started.continuation.yield(())
            }
        }, route: unexpectedWalk)
        let task = Task { try await service.search("Madison") }
        var iterator = started.stream.makeAsyncIterator()
        _ = await iterator.next()
        task.cancel()
        try XCTUnwrap(pending).resume(returning: [place("late")])
        do {
            _ = try await task.value
            XCTFail("A cancelled search must discard a late response")
        } catch is CancellationError {}
    }

    func testShortWalkPreservesReturnedStreetGeometryAndTime() async throws {
        let intermediate = CLLocationCoordinate2D(latitude: 40.7503, longitude: -73.9801)
        let service = PlaceService(find: { _ in [] }, route: { from, to in
            WalkingConnection(coordinates: [from, intermediate, to], seconds: 72, meters: 95)
        })
        let result = try await service.walk(from: start, to: end)
        XCTAssertEqual(result.seconds, 72)
        XCTAssertEqual(result.meters, 95)
        XCTAssertEqual(result.coordinates.map(\.latitude), [start.latitude, intermediate.latitude, end.latitude])
        XCTAssertEqual(result.coordinates.map(\.longitude), [start.longitude, intermediate.longitude, end.longitude])
    }

    func testWalkRejectsOutOfAreaInputAndInvalidGeometryOrMetrics() async throws {
        let service = PlaceService(find: { _ in [] }, route: unexpectedWalk)
        for invalid in [CLLocationCoordinate2D(latitude: 41, longitude: -74),
                        .init(latitude: 40.46, longitude: -74.25), .init(latitude: 40.51, longitude: -74.28),
                        .init(latitude: .nan, longitude: -74), .init(latitude: 40.51, longitude: .infinity)]
        {
            do {
                _ = try await service.walk(from: start, to: invalid)
                XCTFail("Outside-area or invalid endpoints must not start a walking request")
            } catch PlaceServiceError.noWalkingRoute {}
            do {
                _ = try await service.walk(from: invalid, to: end)
                XCTFail("The starting endpoint must pass the same boundary checks")
            } catch PlaceServiceError.noWalkingRoute {}
        }

        for invalid in [
            WalkingConnection(coordinates: [start, start], seconds: 1, meters: 2),
            WalkingConnection(coordinates: [start, .init(latitude: .nan, longitude: -74), end], seconds: 1, meters: 2),
            WalkingConnection(coordinates: [start, .init(latitude: 40.46, longitude: -74.25), end], seconds: 1, meters: 2),
            WalkingConnection(coordinates: [start, end], seconds: .infinity, meters: 2),
            WalkingConnection(coordinates: [start, end], seconds: 1, meters: -4),
        ] {
            let service = PlaceService(find: { _ in [] }, route: { _, _ in invalid })
            do {
                _ = try await service.walk(from: start, to: end)
                XCTFail("An invalid path must not produce a walking connection")
            } catch PlaceServiceError.unavailable {}
        }
    }

    func testNoWalkingDirectionsRemainsUnavailable() async throws {
        let service = PlaceService(find: { _ in [] }, route: { _, _ in
            throw NSError(domain: MKErrorDomain, code: Int(MKError.Code.directionsNotFound.rawValue))
        })
        do {
            _ = try await service.walk(from: start, to: end)
            XCTFail("A missing route must not create a straight-line walking leg")
        } catch PlaceServiceError.noWalkingRoute {}
    }

    private func place(_ id: String, latitude: Double = 40.75) -> PlaceResult {
        PlaceResult(id: id, name: id, subtitle: "NYC", latitude: latitude, longitude: -73.98)
    }

    private var unexpectedWalk: PlaceService.Route {
        { _, _ in XCTFail("Unexpected walking request"); throw PlaceServiceError.unavailable }
    }
}
