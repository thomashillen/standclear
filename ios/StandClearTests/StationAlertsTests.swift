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

    func testFailedPollKeepsReportUnconfirmedThroughRetryUntilSuccessfulReplacement() {
        let severe = StationAlert(id: "service-change", header: "Suspended", description: "", effect: "", severity: "severe",
                                  routeIds: ["4"], stopIds: [], selectors: nil)
        let source = now.addingTimeInterval(-10)
        let severeReport = StationAlertSnapshot(generatedAt: now.timeIntervalSince1970 * 1000, available: true,
                                                feedTimestamp: source.timeIntervalSince1970, alerts: [severe])
        var load = StationAlertsLoad(scope: "419")
        load.beginRequest()
        XCTAssertTrue(load.isRequestInFlight)
        load.receive(severeReport)
        XCTAssertFalse(load.isRequestInFlight)
        XCTAssertEqual(load.evidence(at: now), .current)
        load.fail()
        XCTAssertFalse(load.isRequestInFlight)
        load = load.scoped(to: "419")
        load.beginRequest()
        XCTAssertTrue(load.isRequestInFlight)
        XCTAssertEqual(load.evidence(at: now), .unavailable)
        XCTAssertEqual(load.snapshot?.alerts.map(\.id), ["service-change"])
        XCTAssertEqual(load.lastReportAfterFailure(at: now), source)

        for available in [true, false] {
            load.receive(severeReport)
            load.fail()
            load.beginRequest()
            load.receive(StationAlertSnapshot(generatedAt: now.timeIntervalSince1970 * 1000, available: available,
                                              feedTimestamp: now.timeIntervalSince1970, alerts: []))
            XCTAssertFalse(load.isRequestInFlight)
            XCTAssertEqual(load.evidence(at: now), available ? .current : .unavailable)
            XCTAssertEqual(load.snapshot?.alerts.count, 0)
            XCTAssertNil(load.lastReportAfterFailure(at: now))
        }
    }

    func testFirstFailureAndChangedScopeHaveNoPriorReport() {
        var load = StationAlertsLoad(scope: "4")
        load.fail()
        XCTAssertEqual(load.evidence(at: now), .unavailable)
        XCTAssertNil(load.snapshot)
        XCTAssertNil(load.lastReportAfterFailure(at: now))
        load.receive(StationAlertSnapshot(generatedAt: now.timeIntervalSince1970 * 1000, available: true,
                                          feedTimestamp: now.timeIntervalSince1970, alerts: []))
        load.fail()
        load.beginRequest()
        load = load.scoped(to: "5")
        XCTAssertFalse(load.isRequestInFlight)
        XCTAssertNil(load.evidence(at: now))
        XCTAssertNil(load.snapshot)
        XCTAssertNil(load.lastReportAfterFailure(at: now))
    }

    func testFailedPollDoesNotAssignAnUnverifiedReportDate() {
        for timestamp: Double? in [nil, .nan, now.timeIntervalSince1970 + 60] {
            var load = StationAlertsLoad(scope: "419")
            load.receive(StationAlertSnapshot(generatedAt: now.timeIntervalSince1970 * 1000, available: true,
                                              feedTimestamp: timestamp, alerts: []))
            XCTAssertEqual(load.evidence(at: now), .unknown)
            load.fail()
            XCTAssertEqual(load.evidence(at: now), .unavailable)
            XCTAssertNil(load.lastReportAfterFailure(at: now))
        }
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

    func testReportedWindowDecodesLegacySecondsAndMalformedOptionalDates() throws {
        func decode(_ extra: String) throws -> StationAlert {
            let json = """
            {"id":"a","header":"Service change","description":"Keep this advisory","effect":"NO_SERVICE","severity":"severe","routeIds":["4"],"stopIds":[]\(extra)}
            """
            return try JSONDecoder().decode(StationAlert.self, from: Data(json.utf8))
        }
        XCTAssertNil(try decode("").reportedWindow(at: now, evidence: .current))
        let seconds = now.addingTimeInterval(120)
        let timed = try decode(",\"startTime\":0,\"endTime\":\(seconds.timeIntervalSince1970)")
        XCTAssertEqual(timed.reportedWindow(at: now, evidence: .current), .endsSoon(seconds, minutes: 2))
        for value in ["null", "\"bad date\"", "true", "{}", "[]"] {
            let malformed = try decode(",\"startTime\":\(value),\"endTime\":\(value)")
            XCTAssertEqual(malformed.header, "Service change")
            XCTAssertEqual(malformed.description, "Keep this advisory")
            XCTAssertNil(malformed.reportedWindow(at: now, evidence: .current))
        }
        let partial = try decode(",\"startTime\":\"invalid\",\"endTime\":\(seconds.timeIntervalSince1970)")
        XCTAssertEqual(partial.reportedWindow(at: now, evidence: .current), .endsSoon(seconds, minutes: 2))
    }

    func testReportedWindowCeilsMinutesAndChangesAtOneHour() {
        for (seconds, minutes) in [(0.1, 1), (60.0, 1), (60.1, 2), (3599.9, 60), (3600.0, 60)] {
            let end = now.addingTimeInterval(seconds)
            guard case let .endsSoon(reportedEnd, reportedMinutes) = timedAlert(end: end.timeIntervalSince1970).reportedWindow(at: now, evidence: .current) else {
                XCTFail("Expected endsSoon for \(seconds) seconds remaining")
                continue
            }
            XCTAssertEqual(reportedMinutes, minutes)
            XCTAssertEqual(reportedEnd.timeIntervalSince1970, end.timeIntervalSince1970, accuracy: 0.000001)
        }
        let later = now.addingTimeInterval(3600.1)
        guard case let .until(reportedEnd) = timedAlert(end: later.timeIntervalSince1970).reportedWindow(at: now, evidence: .current) else {
            return XCTFail("Expected until for more than one hour remaining")
        }
        XCTAssertEqual(reportedEnd.timeIntervalSince1970, later.timeIntervalSince1970, accuracy: 0.000001)
    }

    func testReportedWindowIncludesStartAndExcludesEndAsClockAdvances() {
        let start = now.addingTimeInterval(60)
        let end = now.addingTimeInterval(120)
        let alert = timedAlert(start: start.timeIntervalSince1970, end: end.timeIntervalSince1970)
        XCTAssertEqual(alert.reportedWindow(at: now, evidence: .current), .starts(start))
        XCTAssertEqual(alert.reportedWindow(at: start, evidence: .current), .endsSoon(end, minutes: 1))
        XCTAssertNil(alert.reportedWindow(at: end, evidence: .current))
        XCTAssertNil(alert.reportedWindow(at: end.addingTimeInterval(1), evidence: .current))
    }

    func testReportedWindowBoundsHorizonAndOmitsUnboundedOrSentinelDates() {
        let horizon = now.addingTimeInterval(14 * 86400)
        XCTAssertEqual(timedAlert(start: horizon.timeIntervalSince1970).reportedWindow(at: now, evidence: .current), .starts(horizon))
        XCTAssertEqual(timedAlert(end: horizon.timeIntervalSince1970).reportedWindow(at: now, evidence: .current), .until(horizon))
        XCTAssertNil(timedAlert(start: horizon.timeIntervalSince1970 + 1).reportedWindow(at: now, evidence: .current))
        XCTAssertNil(timedAlert(end: horizon.timeIntervalSince1970 + 1).reportedWindow(at: now, evidence: .current))
        XCTAssertNil(timedAlert(start: 0).reportedWindow(at: now, evidence: .current))
        XCTAssertNil(timedAlert().reportedWindow(at: now, evidence: .current))
        XCTAssertNil(timedAlert(end: now.timeIntervalSince1970 * 1000).reportedWindow(at: now, evidence: .current))
    }

    func testReportedWindowRejectsContradictoryAndInvalidBounds() {
        let end = now.addingTimeInterval(120)
        XCTAssertNil(timedAlert(end: end.timeIntervalSince1970).reportedWindow(at: Date(timeIntervalSince1970: .nan), evidence: .current))
        for start in [end.timeIntervalSince1970, end.timeIntervalSince1970 + 1] {
            XCTAssertNil(timedAlert(start: start, end: end.timeIntervalSince1970).reportedWindow(at: now, evidence: .current))
        }
        for invalid in [-1.0, .nan, .infinity, -.infinity] {
            XCTAssertNil(timedAlert(end: invalid).reportedWindow(at: now, evidence: .current))
            XCTAssertEqual(timedAlert(start: invalid, end: end.timeIntervalSince1970).reportedWindow(at: now, evidence: .current),
                           .endsSoon(end, minutes: 2))
        }
    }

    func testReportedWindowRequiresCurrentEvidenceAndRecoversAfterFailedRetry() {
        let alert = timedAlert(end: now.timeIntervalSince1970 + 120)
        let unconfirmed: [StationAlertSnapshot.Evidence?] = [nil, .unknown, .unavailable, .lastReported(now)]
        for evidence in unconfirmed {
            XCTAssertNil(alert.reportedWindow(at: now, evidence: evidence))
        }
        let snapshot = StationAlertSnapshot(generatedAt: now.timeIntervalSince1970 * 1000, available: true,
                                            feedTimestamp: now.timeIntervalSince1970, alerts: [alert])
        var load = StationAlertsLoad(scope: "4")
        load.receive(snapshot)
        XCTAssertNotNil(alert.reportedWindow(at: now, evidence: load.evidence(at: now)))
        load.fail()
        load.beginRequest()
        XCTAssertNil(alert.reportedWindow(at: now, evidence: load.evidence(at: now)))
        XCTAssertEqual(load.snapshot?.alerts.first?.header, alert.header)
        load.receive(snapshot)
        XCTAssertNotNil(alert.reportedWindow(at: now, evidence: load.evidence(at: now)))
        XCTAssertNil(alert.reportedWindow(at: now.addingTimeInterval(301), evidence: load.evidence(at: now.addingTimeInterval(301))))
    }

    func testReportedWindowFormattingUsesNewYorkAcrossDSTAndRespectsLocale() throws {
        let parser = ISO8601DateFormatter()
        let before = try XCTUnwrap(parser.date(from: "2026-11-01T05:30:00Z"))
        let after = try XCTUnwrap(parser.date(from: "2026-11-01T06:30:00Z"))
        let locale = Locale(identifier: "en_US")
        let first = ReportedAlertWindow.until(before)
        let second = ReportedAlertWindow.until(after)
        let firstText = first.text(relativeTo: before.addingTimeInterval(-7200), locale: locale)
        let secondText = second.text(relativeTo: before.addingTimeInterval(-7200), locale: locale)
        XCTAssertTrue(firstText.contains("1:30"))
        XCTAssertTrue(secondText.contains("1:30"))
        XCTAssertNotEqual(firstText, secondText, "The repeated local hour must retain its daylight/standard-time distinction")
        XCTAssertTrue(firstText.contains("New York"))
        XCTAssertTrue(secondText.contains("New York"))
        XCTAssertTrue(second.accessibilityText(locale: locale).contains("New York"))
        let french = second.text(relativeTo: before.addingTimeInterval(-7200), locale: Locale(identifier: "fr_FR"))
        XCTAssertNotEqual(french, secondText)
        XCTAssertTrue(french.contains("New York"))
        for days in [2.0, 10.0] {
            let later = after.addingTimeInterval(days * 86400)
            let text = ReportedAlertWindow.starts(later).text(relativeTo: after, locale: locale)
            XCTAssertTrue(text.contains("New York"))
            XCTAssertTrue(text.contains("1:30"))
        }
    }

    private func timedAlert(start: Double? = nil, end: Double? = nil) -> StationAlert {
        StationAlert(id: "timed", header: "Service change", description: "Reported advisory", effect: "NO_SERVICE",
                     severity: "severe", routeIds: ["4"], stopIds: [], selectors: nil, startTime: start, endTime: end)
    }

    private func evidence(available: Bool? = true, generatedAge: Double = 0, sourceAge: Double? = 0) -> StationAlertSnapshot.Evidence {
        StationAlertSnapshot(generatedAt: (now.timeIntervalSince1970 - generatedAge) * 1000, available: available,
                             feedTimestamp: sourceAge.map { now.timeIntervalSince1970 - $0 }, alerts: []).evidence(at: now)
    }
}
