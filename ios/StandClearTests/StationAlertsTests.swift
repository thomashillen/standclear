@testable import StandClear
import XCTest

final class StationAlertsTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testRequiresPositiveAvailabilityAndFreshSourceAndResponse() {
        XCTAssertEqual(evidence(), .current)
        XCTAssertEqual(evidence(sourceAge: 300), .current)
        XCTAssertEqual(evidence(sourceAge: 301), .lastReported(now.addingTimeInterval(-301)))
        XCTAssertEqual(evidence(generatedAge: 310, sourceAge: 320), .lastReported(now.addingTimeInterval(-320)))
        XCTAssertEqual(evidence(available: false), .unavailable)
        XCTAssertEqual(evidence(available: nil), .unknown)
        XCTAssertEqual(evidence(sourceAge: nil), .unknown)
        XCTAssertEqual(evidence(sourceAge: -31), .unknown)
        XCTAssertEqual(evidence(generatedAge: -31), .unknown)
        XCTAssertEqual(evidence(generatedAge: 300, sourceAge: 0), .unknown)
    }

    func testLegacyEmptyPayloadDecodesWithoutClaimingCurrentCoverage() throws {
        let payload = Data(#"{"generatedAt":1800000000000,"alerts":[]}"#.utf8)
        let snapshot = try JSONDecoder().decode(StationAlertSnapshot.self, from: payload)
        XCTAssertEqual(snapshot.evidence(at: now), .unknown)
    }

    func testEachSelectorMatchesAsAUnitAndLegacyArraysRemainSupported() {
        let station = Station(id: "419", stop: Stop(id: "419", name: "Wall St", lat: 40.7, lng: -74, shapeIdx: 0),
                              stopIDs: ["419", "other-platform"], routes: ["4", "5"])
        func matches(_ selectors: [StationAlert.Selector]?) -> Bool {
            StationAlert(id: "alert", header: "", description: "", effect: "", severity: "warning",
                         routeIds: ["4"], stopIds: ["unrelated"], selectors: selectors).applies(to: station)
        }
        XCTAssertFalse(matches([.init(routeId: "4", stopId: "unrelated"), .init(routeId: "N", stopId: "419")]))
        XCTAssertTrue(matches([.init(routeId: "4", stopId: "unrelated"), .init(routeId: "5", stopId: nil)]))
        XCTAssertTrue(matches([.init(routeId: nil, stopId: "other-platform")]))
        XCTAssertTrue(matches([.init(routeId: "4", stopId: "419")]))
        XCTAssertFalse(matches([.init(routeId: nil, stopId: nil)]))
        XCTAssertTrue(matches(nil))
        XCTAssertTrue(matches([]))
    }

    private func evidence(available: Bool? = true, generatedAge: Double = 0, sourceAge: Double? = 0) -> StationAlertSnapshot.Evidence {
        StationAlertSnapshot(generatedAt: (now.timeIntervalSince1970 - generatedAge) * 1000, available: available,
                             feedTimestamp: sourceAge.map { now.timeIntervalSince1970 - $0 }, alerts: []).evidence(at: now)
    }
}
