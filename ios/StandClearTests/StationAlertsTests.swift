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

    func testLineAlertsKeepExplicitRouteScopeBeyondRepresentativeStops() {
        let line = SubwayLine(id: "4", routeId: "4", color: "00933C",
                              stops: [Stop(id: "419", name: "Wall St", lat: 40.7, lng: -74, shapeIdx: 0)], shape: [])
        func matches(_ selectors: [StationAlert.Selector]?, routes: [String] = [], stops: [String] = []) -> Bool {
            StationAlert(id: "alert", header: "", description: "", effect: "", severity: "warning",
                         routeIds: routes, stopIds: stops, selectors: selectors).applies(to: line)
        }
        XCTAssertTrue(matches([.init(routeId: "4", stopId: nil)]))
        XCTAssertTrue(matches([.init(routeId: "4", stopId: "419")]))
        XCTAssertTrue(matches([.init(routeId: "4", stopId: "variant-stop")]), "A line advisory may describe a detour beyond the static pattern")
        XCTAssertFalse(matches([.init(routeId: "5", stopId: "419")]), "Another service at a shared station is not an advisory for this line")
        XCTAssertTrue(matches([.init(routeId: nil, stopId: "419")]))
        XCTAssertFalse(matches([.init(routeId: nil, stopId: "other")]))
        XCTAssertFalse(matches([.init(routeId: nil, stopId: nil)]))
        XCTAssertFalse(matches([.init(routeId: "5", stopId: "419")], routes: ["4"], stops: ["419"]), "Selectors take precedence over flattened arrays")
        XCTAssertTrue(matches([.init(routeId: "5", stopId: "419"), .init(routeId: "4", stopId: "other")]))
        XCTAssertTrue(matches(nil, routes: ["4"]))
        XCTAssertTrue(matches([], stops: ["419"]))
        XCTAssertFalse(matches(nil, routes: ["5"], stops: ["other"]))
    }

    func testBaseLineIncludesReportedExpressServiceWithoutCombiningUnrelatedShuttles() {
        func matches(lineID: String, alertRoute: String) -> Bool {
            let line = SubwayLine(id: lineID, routeId: lineID, color: "808080", stops: [], shape: [])
            return StationAlert(id: "alert", header: "", description: "", effect: "", severity: "warning",
                                routeIds: [], stopIds: [], selectors: [.init(routeId: alertRoute, stopId: nil)]).applies(to: line)
        }
        XCTAssertTrue(matches(lineID: "6", alertRoute: "6X"))
        XCTAssertTrue(matches(lineID: "7", alertRoute: "7X"))
        XCTAssertTrue(matches(lineID: "F", alertRoute: "FX"))
        XCTAssertFalse(matches(lineID: "6", alertRoute: "7X"))
        XCTAssertFalse(matches(lineID: "GS", alertRoute: "FS"))
        XCTAssertFalse(matches(lineID: "FS", alertRoute: "H"))
        XCTAssertFalse(matches(lineID: "4", alertRoute: "4X"))
        XCTAssertFalse(matches(lineID: "GS", alertRoute: "GSX"))
        XCTAssertTrue(matches(lineID: "unknownX", alertRoute: "unknownX"))
    }

    func testStationExpressAdvisoriesPreserveStopScopeAndSelectorPrecedence() {
        for (base, express) in [("6", "6X"), ("7", "7X"), ("F", "FX")] {
            let station = Station(id: "platform", stop: Stop(id: "platform", name: "Station", lat: 40.7, lng: -74, shapeIdx: 0),
                                  stopIDs: ["platform", "connected"], routes: [base])
            func matches(_ selectors: [StationAlert.Selector]?, routes: [String] = [], stops: [String] = []) -> Bool {
                StationAlert(id: "alert", header: "", description: "", effect: "", severity: "warning",
                             routeIds: routes, stopIds: stops, selectors: selectors).applies(to: station)
            }
            XCTAssertTrue(matches([.init(routeId: express, stopId: nil)]), express)
            XCTAssertTrue(matches([.init(routeId: express, stopId: "connected")]), express)
            XCTAssertFalse(matches([.init(routeId: express, stopId: "elsewhere")]), express)
            XCTAssertFalse(matches([.init(routeId: "4", stopId: "platform")]), express)
            XCTAssertFalse(matches([.init(routeId: express, stopId: "elsewhere"), .init(routeId: "4", stopId: "platform")]), express)
            XCTAssertTrue(matches([.init(routeId: "4", stopId: "platform"), .init(routeId: express, stopId: nil)]), express)
            XCTAssertFalse(matches([.init(routeId: express, stopId: "elsewhere")], routes: [base], stops: ["platform"]), "Structured scope takes precedence over flattened arrays")
            XCTAssertTrue(matches(nil, routes: [express]), express)
            XCTAssertTrue(matches([], routes: [express]), express)
            XCTAssertTrue(matches(nil, stops: ["platform"]), "Legacy stop-only scope remains supported")
            XCTAssertFalse(matches(nil, routes: ["4"], stops: ["elsewhere"]), express)
        }
    }

    func testStationRouteFamiliesDoNotCombineDistinctShuttles() {
        func matches(stationRoute: String, alertRoute: String) -> Bool {
            let station = Station(id: "platform", stop: Stop(id: "platform", name: "Station", lat: 40.7, lng: -74, shapeIdx: 0),
                                  stopIDs: ["platform"], routes: [stationRoute])
            return StationAlert(id: "alert", header: "", description: "", effect: "", severity: "warning",
                                routeIds: [], stopIds: [], selectors: [.init(routeId: alertRoute, stopId: "platform")]).applies(to: station)
        }
        XCTAssertTrue(matches(stationRoute: "7X", alertRoute: "7"), "Normalize both station and advisory routes")
        XCTAssertFalse(matches(stationRoute: "4", alertRoute: "4X"))
        XCTAssertFalse(matches(stationRoute: "GS", alertRoute: "GSX"))
        XCTAssertTrue(matches(stationRoute: "unknownX", alertRoute: "unknownX"))
        for shuttle in ["GS", "FS", "H"] {
            XCTAssertTrue(matches(stationRoute: shuttle, alertRoute: shuttle))
            for other in ["GS", "FS", "H"] where other != shuttle {
                XCTAssertFalse(matches(stationRoute: shuttle, alertRoute: other))
            }
        }
    }

    private func evidence(available: Bool? = true, generatedAge: Double = 0, sourceAge: Double? = 0) -> StationAlertSnapshot.Evidence {
        StationAlertSnapshot(generatedAt: (now.timeIntervalSince1970 - generatedAge) * 1000, available: available,
                             feedTimestamp: sourceAge.map { now.timeIntervalSince1970 - $0 }, alerts: []).evidence(at: now)
    }
}
