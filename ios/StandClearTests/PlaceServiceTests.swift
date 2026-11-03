import CoreLocation
import MapKit
@testable import StandClear
import XCTest

@MainActor
final class PlaceServiceTests: XCTestCase {
    private let start = CLLocationCoordinate2D(latitude: 40.75, longitude: -73.98)
    private let end = CLLocationCoordinate2D(latitude: 40.7501, longitude: -73.9802)

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
        do {
            _ = try await service.walk(from: start, to: .init(latitude: 41, longitude: -74))
            XCTFail("Outside-area endpoints must not start a walking request")
        } catch PlaceServiceError.noWalkingRoute {}

        for invalid in [
            WalkingConnection(coordinates: [start, start], seconds: 1, meters: 2),
            WalkingConnection(coordinates: [start, .init(latitude: .nan, longitude: -74), end], seconds: 1, meters: 2),
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
