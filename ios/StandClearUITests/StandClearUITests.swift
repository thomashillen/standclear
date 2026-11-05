import CoreLocation
import XCTest

final class StandClearUITests: XCTestCase {
    private let unifiedSearchPrompt = "Address, place or station"

    @MainActor
    func testNearbyGlanceKeepsMapVisibleForGrantedLocation() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
        defer { XCUIDevice.shared.location = nil }
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let allow = alert.buttons["Allow While Using App"]
            if allow.exists {
                allow.tap(); return true
            }
            return false
        }
        app.launch()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 15))
        activatePermissionPrompt(in: app)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "glance-")).firstMatch.waitForExistence(timeout: 30))
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists, "The glance panel should keep the map visible at startup")
        XCTAssertTrue(app.descendants(matching: .any)["userLocationDot"].exists)
        let mapCapture = XCTAttachment(screenshot: app.screenshot())
        mapCapture.name = "Location dot and compact nearby glance"
        mapCapture.lifetime = .keepAlways
        add(mapCapture)
        // Select a different station from the closest (Times Square) to prove
        // the compact sheet is driven by the specific glance row tapped.
        let penn = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "glance-128:")).firstMatch
        XCTAssertTrue(penn.waitForExistence(timeout: 10))
        penn.tap()
        XCTAssertTrue(app.navigationBars["34 St-Penn Station"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["directionsHere"].exists)
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists)
        let direct = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        direct.name = "Compact glance opens the selected Penn Station directly"
        direct.lifetime = .keepAlways
        add(direct)
        app.buttons["Done"].tap()
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        let station = app.buttons["station-127"]
        XCTAssertTrue(station.waitForExistence(timeout: 10), "Times Square should be nearby the simulated location")
        XCTAssertTrue(station.label.localizedCaseInsensitiveContains("straight line"), "A nearby station announces the approximate distance with its name")
        XCTAssertFalse(app.staticTexts["Arrival feed connected"].exists, "Healthy status must not displace nearby predictions")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Automatic nearby arrivals with granted location"
        capture.lifetime = .keepAlways
        add(capture)
        // Expand the native sheet before testing a disclosure. A medium sheet can
        // expose a lazy row in AX before it has a usable activation frame.
        app.buttons["Sheet Grabber"].doubleTap()
        // Scope live-row queries to the list; resolving labels across the map
        // also traverses hundreds of independently updating train annotations.
        let arrivalsList = app.collectionViews["stationList"]
        XCTAssertTrue(arrivalsList.waitForExistence(timeout: 5))
        let candidate = arrivalsList.buttons["arrivalRow-ui-fixture-1-n:127:N"]
        XCTAssertTrue(candidate.waitForExistence(timeout: 10), "Fixture arrivals must be available for disclosure coverage")
        let grouped = arrivalsList.buttons["arrivalRow-ui-fixture-1-n:127:N"]
        XCTAssertTrue(grouped.waitForExistence(timeout: 10))
        XCTAssertTrue(grouped.label.contains("Predicted in 3 min"))
        XCTAssertTrue(grouped.label.contains("Predicted in 11 min"))
        XCTAssertFalse(arrivalsList.buttons["arrivalRow-ui-fixture-1-n-later:127:N"].exists,
                       "The later train shares its service row instead of repeating direction and destination")
        let arrivalID = candidate.identifier
        let arrival = arrivalsList.buttons[arrivalID]
        let usable = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                guard arrival.exists else { return false }
                let frame = arrival.frame
                return frame.width > 0 && frame.height > 0 && app.frame.contains(frame) && arrival.isHittable
            }
        }
        expectation(for: usable, evaluatedWith: arrival)
        waitForExpectations(timeout: 20)
        XCTAssertGreaterThanOrEqual(arrival.frame.height, 44)
        arrival.tap()
        XCTAssertTrue(arrivalsList.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", arrivalID, "Predicted arrival:")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(arrivalsList.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", arrivalID, "Predicted arrival:")).count, 2)
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "Compact Nearby groups matching predictions with both clock times"
        compact.lifetime = .keepAlways
        add(compact)
        app.buttons["Done"].tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.buttons["arrivalRow-ui-fixture-1-n:127:N"].waitForExistence(timeout: 10))
        let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expanded.name = "Expanded Nearby compact service rows"
        expanded.lifetime = .keepAlways
        add(expanded)
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "Done")
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].exists, "Explicit Nearby browsing survives narrowing")
        app.buttons["Done"].tap()
        let neighborhood = XCTAttachment(screenshot: app.screenshot())
        neighborhood.name = "Near Me recentered neighborhood"
        neighborhood.lifetime = .keepAlways
        add(neighborhood)
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists, "Nearby must not interrupt manual search")
    }

    @MainActor
    func testNearbyGroupedPredictionsAtAccessibilityTextSize() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
        defer { XCUIDevice.shared.location = nil }
        app.launchArguments = ["--ui-test-fixture",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let allow = alert.buttons["Allow While Using App"]
            guard allow.exists else { return false }
            allow.tap()
            return true
        }
        app.launch()
        XCTAssertTrue(app.buttons["nearbyButton"].waitForExistence(timeout: 15))
        activatePermissionPrompt(in: app)
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 10))
        // Accessibility text sizes already use the large detent.
        let list = app.collectionViews["stationList"]
        let station = list.buttons["station-127"]
        XCTAssertTrue(station.waitForExistence(timeout: 10))
        XCTAssertTrue(station.label.localizedCaseInsensitiveContains("straight line"))
        let row = list.buttons["arrivalRow-ui-fixture-1-n:127:N"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("Northbound"))
        XCTAssertTrue(row.label.contains("50 St"))
        XCTAssertTrue(row.label.contains("Predicted in 3 min"))
        XCTAssertTrue(row.label.contains("Predicted in 11 min"))
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        row.tap()
        let clocks = list.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", row.identifier, "Predicted arrival:"))
        XCTAssertTrue(clocks.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(clocks.count, 2)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Nearby grouped predictions at largest accessibility text size"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testStationDensityPreservesStaleAlertsAndArrivalDetails() {
        checkCompactStationDetails(accessibilityText: false)
    }

    @MainActor
    func testStationWithoutAdvisoriesStaysQuietOnlyWhenCurrent() {
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        for stale in [false, true] {
            app.terminate()
            app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
            if stale {
                app.launchArguments.append("--ui-test-stale-alerts")
            }
            app.launch()
            activatePermissionPrompt(in: app)
            app.buttons["searchButton"].tap()
            let search = app.searchFields[unifiedSearchPrompt]
            XCTAssertTrue(search.waitForExistence(timeout: 5))
            search.tap()
            search.typeText("Times Sq\n")
            selectSearchResult("127", query: "Times Sq", in: app)
            let list = app.collectionViews["stationArrivalsList"]
            XCTAssertTrue(list.buttons["arrivalRow-ui-fixture-1-n:127:N"].waitForExistence(timeout: 10))
            XCTAssertFalse(list.staticTexts["Arrival feed connected"].exists)
            XCTAssertFalse(list.staticTexts["No service alerts reported for this station."].exists)
            if stale {
                XCTAssertTrue(list.buttons["stationAlertsRetry"].waitForExistence(timeout: 10))
                XCTAssertTrue(list.staticTexts["Alert status unconfirmed"].exists, "Empty stale evidence must remain visibly unconfirmed")
                XCTAssertTrue(list.staticTexts["stationAlertLastReport"].exists)
            } else {
                XCTAssertFalse(list.buttons["stationAlertsRetry"].exists)
            }
        }
    }

    @MainActor
    func testStationDensityAtLargestAccessibilityText() {
        checkCompactStationDetails(accessibilityText: true)
    }

    @MainActor
    func testStationDensityInExpandedControlRegion() {
        checkCompactStationDetails(accessibilityText: false, expanded: true)
    }

    @MainActor
    private func checkCompactStationDetails(accessibilityText: Bool, expanded: Bool = false) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-stale-alerts", "-mapProvider", "Apple Maps"]
        if accessibilityText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        if expanded {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true)
        }
        defer {
            if expanded {
                XCUIDevice.shared.orientation = .portrait
            }
        }
        app.buttons["searchButton"].tap()
        let search = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Wall\n")
        selectSearchResult("419", query: "Wall", in: app)
        let list = app.collectionViews["stationArrivalsList"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        let stationTitle = app.navigationBars["Wall St"].staticTexts["Wall St"]
        XCTAssertTrue(stationTitle.waitForExistence(timeout: 5), "Station identity must remain visible alongside native toolbar actions")
        XCTAssertGreaterThan(stationTitle.frame.width, 0)
        if expanded {
            let window = app.windows.firstMatch.frame
            XCTAssertGreaterThan(list.frame.midX, window.midX, "Station details should occupy the expanded right-side control region")
            XCTAssertLessThanOrEqual(list.frame.width, window.width / 2)
        }
        let retry = list.buttons["stationAlertsRetry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(list.staticTexts["Alert status unconfirmed"].exists)
        XCTAssertTrue(list.staticTexts["stationAlertLastReport"].exists)
        XCTAssertFalse(list.staticTexts["Arrival feed connected"].exists)
        XCTAssertFalse(list.staticTexts["Service alerts"].exists, "A separate heading must not displace arrivals")
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
        retry.tap()
        let summary = list.buttons["stationAlertsSummary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertTrue(summary.label.contains("1 severe"), "Stale evidence must retain the last reported advisory and its severity")
        let arrival = list.buttons["arrivalRow-ui-fixture-4-n:419:N"]
        if !accessibilityText {
            XCTAssertTrue(arrival.waitForExistence(timeout: 5))
            XCTAssertTrue(list.frame.contains(arrival.frame), "The first station prediction should be visible without scrolling at standard text size")
        }
        let first = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        first.name = expanded ? "Expanded station alerts and first arrival" : accessibilityText ? "Station status at largest accessibility text" : "Compact station alerts and first arrival"
        first.lifetime = .keepAlways
        add(first)

        func reveal(_ element: XCUIElement) {
            for _ in 0 ..< 8 {
                if element.exists, element.frame.height > 0, list.frame.contains(element.frame), element.isHittable {
                    return
                }
                list.swipeUp()
            }
            XCTFail("Could not reveal \(element.identifier)")
        }
        reveal(summary)
        summary.tap()
        let advisory = list.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Allow extra travel time at Wall St.")).firstMatch
        XCTAssertTrue(advisory.waitForExistence(timeout: 5))
        summary.tap()
        reveal(arrival)
        XCTAssertTrue(arrival.label.contains("Northbound"), "Direction remains available to VoiceOver even when its section supplies the visual label")
        XCTAssertTrue(arrival.label.contains("59 St"))
        XCTAssertTrue(arrival.label.contains("Predicted in"))
        XCTAssertGreaterThanOrEqual(arrival.frame.height, 44)
        arrival.tap()
        let clock = list.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", arrival.identifier, "Predicted arrival:")).firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 5))
        let detail = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        detail.name = expanded ? "Expanded station arrival clock disclosure" : accessibilityText ? "Station arrival at largest accessibility text" : "Station arrival clock disclosure"
        detail.lifetime = .keepAlways
        add(detail)
    }

    @MainActor
    func testBusyStationArrivalGroupsExpandIndependently() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-grouped-arrivals"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Grand Central\n")
        selectSearchResult("631", query: "Grand Central", in: app)
        XCTAssertTrue(app.navigationBars["Grand Central-42 St"].waitForExistence(timeout: 5))
        let title = app.navigationBars["Grand Central-42 St"].staticTexts["Grand Central-42 St"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "A long station title must retain visible space in the compact toolbar")
        XCTAssertGreaterThan(title.frame.width, 0)
        let titleCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        titleCapture.name = "Compact station title and native toolbar"
        titleCapture.lifetime = .keepAlways
        add(titleCapture)
        let list = app.collectionViews["stationArrivalsList"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        let north = list.buttons["stationArrivalToggle-N"]
        let south = list.buttons["stationArrivalToggle-S"]
        let fifthNorth = list.buttons["arrivalRow-busy-n-5:631:N"]
        let fifthSouth = list.buttons["arrivalRow-busy-s-5:631:S"]
        let unknown = list.buttons["arrivalRow-busy-unknown:631:?"]
        func reveal(_ row: XCUIElement, towardBottom: Bool) {
            for _ in 0 ..< 8 {
                let viewport = list.frame.intersection(app.windows.firstMatch.frame)
                let interior = viewport.insetBy(dx: 0, dy: 44)
                var scrollTowardBottom = towardBottom
                if row.exists {
                    // A collapsed List can expose a row's AX frame under the
                    // sheet edge before it has any valid activation point.
                    // Move it into the viewport interior before asking for
                    // hittability, which raises an XCTest error at that edge.
                    let frame = row.frame
                    if !frame.isNull, !frame.isInfinite, frame.width > 0, frame.height > 0 {
                        if interior.contains(frame), row.isHittable {
                            return
                        }
                        scrollTowardBottom = frame.midY > interior.midY
                    }
                }
                let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: scrollTowardBottom ? 0.8 : 0.35))
                let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: scrollTowardBottom ? 0.35 : 0.8))
                start.press(forDuration: 0.1, thenDragTo: end)
            }
            let failure = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            failure.name = "Busy station row outside usable viewport"
            failure.lifetime = .keepAlways
            add(failure)
            XCTFail("Could not reveal \(row.identifier); row \(row.exists ? row.frame.debugDescription : "missing"), list \(list.frame)")
        }
        reveal(north, towardBottom: true)
        XCTAssertTrue(north.label.contains("18 more"))
        XCTAssertFalse(fifthNorth.exists)
        north.tap()
        XCTAssertTrue(fifthNorth.waitForExistence(timeout: 5))
        reveal(south, towardBottom: true)
        XCTAssertTrue(south.label.contains("2 more"), "Expanding north must leave south collapsed")
        XCTAssertFalse(fifthSouth.exists)
        south.tap()
        XCTAssertTrue(fifthSouth.waitForExistence(timeout: 5))
        reveal(unknown, towardBottom: true)
        XCTAssertTrue(unknown.label.localizedCaseInsensitiveContains("direction unavailable"))
        reveal(north, towardBottom: false)
        XCTAssertTrue(north.label.contains("Show less"))
        north.tap()
        reveal(south, towardBottom: true)
        XCTAssertTrue(south.label.contains("Show less"), "Collapsing north must leave south expanded")
        south.tap()
        reveal(unknown, towardBottom: true)
        XCTAssertFalse(fifthSouth.exists)
        XCTAssertTrue(south.label.contains("2 more"), "Southbound should return to its four-row preview")
        XCTAssertTrue(unknown.label.localizedCaseInsensitiveContains("direction unavailable"))
        unknown.tap()
        let clock = list.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", unknown.identifier, "Predicted arrival:")).firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 5), "The unknown-direction prediction must remain usable after both groups collapse")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Unknown direction prediction remains usable after group collapse"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testExpressArrivalIdentifiesServiceAtParkchester() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.833226, longitude: -73.860816))
        defer { XCUIDevice.shared.location = nil }
        app.launchArguments = ["--ui-test-fixture", "--ui-test-express-arrivals"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let allow = alert.buttons["Allow While Using App"]
            guard allow.exists else { return false }
            allow.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        waitForLayout(in: app, expanded: true)
        let glance = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label CONTAINS[c] %@ AND label CONTAINS %@", "glance-608:", "express", "6")).firstMatch
        XCTAssertTrue(glance.waitForExistence(timeout: 15), "The Parkchester glance should identify the explicit 6X service")
        let map = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        map.name = "Parkchester glance with express and regular 6 predictions"
        map.lifetime = .keepAlways
        add(map)
        glance.tap()
        let title = app.navigationBars["Parkchester"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(title.frame.midX, app.windows.firstMatch.frame.midX)
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertFalse(app.buttons["Done"].exists, "The expanded map uses its trailing control region")
        XCTAssertTrue(app.buttons["directionsHere"].exists)
        let express = app.buttons["arrivalRow-ui-fixture-6x-n:608:N"]
        let regular = app.buttons["arrivalRow-ui-fixture-6-s:608:S"]
        // The short landscape control region scrolls independently of the map.
        let list = app.collectionViews.firstMatch
        for _ in 0 ..< 3 where !regular.exists || regular.frame.maxY > list.frame.maxY {
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                .press(forDuration: 0.1, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
        }
        XCTAssertTrue(express.waitForExistence(timeout: 10))
        XCTAssertTrue(express.label.contains("6"))
        XCTAssertTrue(express.label.localizedCaseInsensitiveContains("Express"))
        XCTAssertTrue(regular.waitForExistence(timeout: 5))
        XCTAssertFalse(regular.label.localizedCaseInsensitiveContains("Express"))
        let detail = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        detail.name = "Expanded glance opens Parkchester station details with express and regular 6 arrivals"
        detail.lifetime = .keepAlways
        add(detail)
    }

    @MainActor
    func testFavoriteStationPersistsAndOpensFromNearbyWithoutLocation() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Wall\n")
        selectSearchResult("419", query: "Wall", in: app)
        let detail = app.navigationBars["Wall St"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        let anchors = app.buttons["stationAnchorMenu"]
        anchors.tap()
        let toggle = app.buttons["favoriteStationToggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        // Restore a known starting state if a previous simulator run stopped
        // before cleanup. Preserve any other station the rider saved.
        if toggle.label == "Remove from favorites" {
            toggle.tap()
            anchors.tap()
        }
        XCTAssertEqual(toggle.label, "Add to favorites")
        if app.buttons["Remove Home"].exists {
            app.buttons["Remove Home"].tap()
            anchors.tap()
        }
        app.buttons["Set as Home"].tap()
        anchors.tap()
        XCTAssertEqual(toggle.label, "Remove from favorites", "Assigning a station anchor also favorites it")
        detail.staticTexts["Wall St"].tap()

        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["searchButton"].waitForExistence(timeout: 15))
        app.buttons["searchButton"].tap()
        let shortcut = app.buttons["savedPlace-Home"]
        XCTAssertTrue(shortcut.waitForExistence(timeout: 10))
        XCTAssertTrue(shortcut.label.contains("Wall St"))
        let shortcutCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shortcutCapture.name = "Home station shortcut after relaunch without location"
        shortcutCapture.lifetime = .keepAlways
        add(shortcutCapture)
        shortcut.tap()
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["directionsHere"].exists)
        anchors.tap()
        app.buttons["Remove Home"].tap()
        anchors.tap()
        XCTAssertEqual(toggle.label, "Remove from favorites", "Removing an anchor preserves the station favorite")
        detail.staticTexts["Wall St"].tap()
        detail.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(shortcut.waitForNonExistence(timeout: 5))
        app.buttons["Done"].tap()
        let nearby = app.buttons["nearbyButton"]
        XCTAssertTrue(nearby.waitForExistence(timeout: 15))
        nearby.tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        app.buttons["Sheet Grabber"].doubleTap()
        let list = app.collectionViews["stationList"]
        let favorite = list.buttons["favoriteStation-419"]
        XCTAssertTrue(favorite.waitForExistence(timeout: 10))
        XCTAssertTrue(favorite.label.contains("Wall St"))
        let missingFix = list.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", [
            "Location access is off", "Location unavailable", "Waiting for your location…",
        ])).firstMatch
        XCTAssertTrue(missingFix.waitForExistence(timeout: 5), "A saved station must open even without a usable location fix")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Saved Wall St in Nearby after relaunch without location"
        capture.lifetime = .keepAlways
        add(capture)
        favorite.tap()
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        anchors.tap()
        XCTAssertEqual(toggle.label, "Remove from favorites")
        toggle.tap()
        anchors.tap()
        XCTAssertEqual(toggle.label, "Add to favorites")
        detail.staticTexts["Wall St"].tap()
        detail.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        XCTAssertTrue(favorite.waitForNonExistence(timeout: 5))
        XCTAssertTrue(missingFix.exists)
    }

    @MainActor
    func testLineBrowserOpensStationArrivalsAndDirections() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--ui-test-fixture"]
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["moreButton"].tap()
        app.buttons["linesButton"].tap()
        let line = app.buttons["line-4"]
        XCTAssertTrue(line.waitForExistence(timeout: 10))
        line.tap()
        let stops = app.collectionViews["lineStationList"]
        let alerts = stops.buttons["lineAlertsSummary"]
        XCTAssertTrue(alerts.waitForExistence(timeout: 10))
        XCTAssertTrue(alerts.label.contains("1 advisory"))
        XCTAssertTrue(alerts.label.contains("1 severe"))
        XCTAssertGreaterThanOrEqual(alerts.frame.height, 44)
        alerts.tap()
        let warning = stops.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Downtown 4 trains are delayed at Wall St")).firstMatch
        XCTAssertTrue(warning.waitForExistence(timeout: 5))
        let alertCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        alertCapture.name = "4 line advisory before choosing a station"
        alertCapture.lifetime = .keepAlways
        add(alertCapture)
        alerts.tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "lineAlertsSummary")
        XCTAssertTrue(app.navigationBars["4 line"].exists)
        XCTAssertTrue(app.buttons["lineAlertsSummary"].label.contains("1 severe"))
        let wideAlerts = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        wideAlerts.name = "Expanded line advisory summary"
        wideAlerts.lifetime = .keepAlways
        add(wideAlerts)
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "lineAlertsSummary")
        let wall = stops.buttons["lineStation-419"]
        revealPlaceElement(wall, in: stops)
        XCTAssertTrue(wall.label.contains("Wall St"))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "4 line station browser"
        capture.lifetime = .keepAlways
        add(capture)
        wall.tap()
        let details = app.navigationBars["Wall St"]
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "directionsHere")
        XCTAssertTrue(details.waitForExistence(timeout: 5), "Keep the selected station across layout changes")
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "directionsHere")
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["directionsHere"].waitForExistence(timeout: 5))
        app.buttons["directionsHere"].tap()
        XCTAssertTrue(app.buttons["destinationPicker"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["destinationPicker"].label.contains("Wall St"))
        app.navigationBars["Directions"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        details.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(wall.waitForExistence(timeout: 5))
    }

    @MainActor
    func testStationShowsExpressOnlyServiceAdvisory() {
        let app = XCUIApplication()
        defer { XCUIDevice.shared.orientation = .portrait }
        for expanded in [false, true] {
            app.terminate()
            XCUIDevice.shared.orientation = expanded ? .landscapeLeft : .portrait
            app.launchArguments = ["--ui-test-fixture", "--ui-test-express-arrivals"]
            app.launch()
            if !expanded {
                activatePermissionPrompt(in: app)
            }
            waitForLayout(in: app, expanded: expanded)
            app.buttons["searchButton"].tap()
            let search = app.searchFields[unifiedSearchPrompt]
            XCTAssertTrue(search.waitForExistence(timeout: 5))
            guard focusSearchField(search, in: app) else { return }
            search.typeText("Pelham Bay Park\n")
            selectSearchResult("601", query: "Pelham Bay Park", in: app)
            let alerts = app.buttons["stationAlertsSummary"]
            XCTAssertTrue(alerts.waitForExistence(timeout: 10), "A 6X-only advisory must appear at a station indexed under the base 6 route")
            XCTAssertTrue(alerts.label.contains("1 advisory"))
            XCTAssertGreaterThanOrEqual(alerts.frame.height, 44)
            alerts.tap()
            let warning = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "6 express trains are delayed at Pelham Bay Park")).firstMatch
            XCTAssertTrue(warning.waitForExistence(timeout: 5))
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = expanded ? "Expanded station express advisory" : "Compact station express advisory"
            capture.lifetime = .keepAlways
            add(capture)
        }
    }

    @MainActor
    func testRecentStationPersistsAcrossRelaunchAndCanBeCleared() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        let searchButton = app.buttons["searchButton"]
        searchButton.tap()
        let field = app.searchFields[unifiedSearchPrompt]
        let recent = app.buttons["recentStation-127"]
        let clearHistory = app.buttons["clearRecentStations"]
        let stations = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "station-")).firstMatch
        XCTAssertTrue(stations.waitForExistence(timeout: 10))
        if clearHistory.exists {
            clearHistory.tap()
            XCTAssertTrue(clearHistory.waitForNonExistence(timeout: 5))
        }
        XCTAssertFalse(recent.exists)
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Times Square\n")
        let match = app.buttons["station-127"]
        XCTAssertTrue(match.waitForExistence(timeout: 10))
        XCTAssertTrue(match.label.contains("Times Sq-42 St"))
        let matches = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        matches.name = "Times Square search finds the Times Sq-42 St station"
        matches.lifetime = .keepAlways
        add(matches)
        selectSearchResult("127", query: "Times Square", in: app)
        let detail = app.navigationBars["Times Sq-42 St"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "Times Square")
        XCTAssertFalse(recent.exists, "Recent stations appear only for an empty query")
        field.tap()
        let clearQuery = field.buttons["Clear text"]
        XCTAssertTrue(clearQuery.waitForExistence(timeout: 5))
        clearQuery.tap()
        XCTAssertTrue(recent.waitForExistence(timeout: 10))

        app.terminate()
        app.launch()
        XCTAssertTrue(searchButton.waitForExistence(timeout: 15))
        searchButton.tap()
        XCTAssertTrue(recent.waitForExistence(timeout: 10))
        XCTAssertTrue(recent.label.contains("Times Sq-42 St"))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Recent station in empty Search after relaunch"
        capture.lifetime = .keepAlways
        add(capture)
        recent.tap()
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        detail.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(clearHistory.waitForExistence(timeout: 5))
        clearHistory.tap()
        XCTAssertTrue(recent.waitForNonExistence(timeout: 5))
        XCTAssertFalse(clearHistory.exists)
        XCTAssertTrue(stations.exists, "Clearing recent stations must preserve station browsing")
    }

    @MainActor
    private func focusSearchField(_ field: XCUIElement, in app: XCUIApplication,
                                  file: StaticString = #filePath, line: UInt = #line) -> Bool
    {
        // Hittability requires the field to exist. Avoid a separate remote existence
        // query consuming the readiness budget before XCTest measures hittability.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: field)
        guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
            XCTFail("Search field did not become interactive", file: file, line: line)
            return false
        }
        // Activate the visible text area only once the native search field
        // is interactive, then require its keyboard before injecting text.
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        guard app.keyboards.firstMatch.waitForExistence(timeout: 10) else {
            XCTFail("Search did not present its keyboard: \(field.debugDescription)", file: file, line: line)
            return false
        }
        return true
    }

    @MainActor
    func testPlaceSearchPreviewsSubwayAndWalkingFromManualStation() {
        checkPlaceSearchPreview(expanded: false)
    }

    @MainActor
    func testExpandedPlaceSearchPreview() {
        checkPlaceSearchPreview(expanded: true)
    }

    @MainActor
    private func checkPlaceSearchPreview(expanded: Bool) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = expanded ? .landscapeLeft : .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        // Nearby can request permission on demand. Compact exercises an actual
        // denial. Expanded also supports the system waiting for its first fix.
        let nearby = app.buttons["nearbyButton"]
        XCTAssertTrue(nearby.waitForExistence(timeout: 20))
        nearby.tap()
        if expanded {
            XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 10))
            XCTAssertFalse(app.descendants(matching: .any)["userLocationDot"].exists)
        } else {
            XCTAssertTrue(app.staticTexts["Location access is off"].firstMatch.waitForExistence(timeout: 10))
            app.buttons["Done"].tap()
        }
        waitForLayout(in: app, expanded: expanded)
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 10))
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertEqual(app.searchFields.count, 1)
        guard focusSearchField(field, in: app) else { return }
        field.typeText("550 Madison\n")
        let result = app.buttons["placeResult-fixture-550-madison"]
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        app.buttons["Save 550 Madison Avenue"].tap()
        app.buttons["Set as Home"].tap()
        let saved = app.buttons["savedPlace-Home"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertTrue(saved.label.contains("550 Madison"))
        let shortcutCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shortcutCapture.name = expanded ? "Expanded saved Home shortcut" : "Compact saved Home shortcut"
        shortcutCapture.lifetime = .keepAlways
        add(shortcutCapture)
        saved.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Current Location"))
        origin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        guard focusSearchField(picker, in: app) else { return }
        picker.typeText("Wall\n")
        let chosen = app.buttons["stationChoice-419"]
        revealPlaceElement(chosen, in: app.collectionViews.firstMatch)
        chosen.tap()
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Wall St"))
        let list = app.collectionViews["placePreviewList"]
        if !expanded, (app.buttons["Sheet Grabber"].value as? String) == "Half screen" {
            app.buttons["Sheet Grabber"].doubleTap()
        }
        let leg = list.descendants(matching: .any)["placeTripLeg-4:N:419>629"].firstMatch
        revealPlaceElement(leg, in: list)
        XCTAssertTrue(leg.exists)
        let total = list.descendants(matching: .any)["placeWalkingTotal"].firstMatch
        revealPlaceElement(total, in: list)
        XCTAssertTrue(total.waitForExistence(timeout: 5))
        XCTAssertTrue(list.descendants(matching: .any)["placeDestinationWalk"].firstMatch.label.contains("550 Madison"))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = expanded ? "Expanded place preview" : "Compact place preview"
        capture.lifetime = .keepAlways
        add(capture)
        app.buttons["placeBackToSearch"].tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        app.buttons["Manage Home"].tap()
        app.buttons["Remove Home"].tap()
        XCTAssertTrue(saved.waitForNonExistence(timeout: 5))
        let recent = app.buttons["recentPlace-fixture-550-madison"]
        XCTAssertTrue(recent.waitForExistence(timeout: 5))
        let recentCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        recentCapture.name = expanded ? "Expanded recent destination" : "Compact recent destination"
        recentCapture.lifetime = .keepAlways
        add(recentCapture)
        recent.tap()
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Current Location"), "Reopening a recent destination starts a new editable trip")
        app.buttons["placeBackToSearch"].tap()
        XCTAssertTrue(recent.waitForExistence(timeout: 5))
        app.buttons["clearRecentPlaces"].tap()
        XCTAssertTrue(recent.waitForNonExistence(timeout: 5))
        XCTAssertTrue(field.exists)
    }

    @MainActor
    func testMuseumTransferShowsBothServicesAndInterchangeOnMainMap() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        waitForLayout(in: app, expanded: true)
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Noguchi\n")
        let museum = app.buttons["placeResult-fixture-noguchi"]
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        museum.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 5))
        origin.tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        guard focusSearchField(picker, in: app) else { return }
        picker.typeText("55 Wall Street\n")
        let address = app.buttons["placeOriginResult-fixture-55-wall-street"]
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        XCTAssertTrue(origin.waitForExistence(timeout: 5))
        XCTAssertTrue(origin.label.contains("55 Wall Street"))
        let list = app.collectionViews["placePreviewList"]
        let inbound = "4:N:419>629"
        let outbound = "N:N:R11>R05"
        let choice = list.buttons["placeRouteOption-419>R05:\(inbound)|\(outbound)"]
        revealPlaceElement(choice, in: list)
        choice.tap()
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let interchange = "Change to N/W at Lexington Av/59 St"
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@ AND value CONTAINS %@", interchange, "Wall St", "Broadway"), evaluatedWith: map)
        waitForExpectations(timeout: 10)
        let ride4 = list.descendants(matching: .any)["placeTripLeg-\(inbound)"].firstMatch
        revealPlaceElement(ride4, in: list)
        XCTAssertTrue(ride4.label.contains("Wall St") && ride4.label.contains("Lexington Av/59 St"))
        let firstPrediction = list.descendants(matching: .any)["placeDeparture-\(inbound)"].firstMatch
        revealPlaceElement(firstPrediction, in: list)
        XCTAssertTrue(firstPrediction.label.contains("Next 4 boarding prediction: 3 min."))
        XCTAssertTrue(firstPrediction.label.contains("After the estimated walk and entry: 4 in 9 min from now."))
        let predictionCapture = XCTAttachment(screenshot: app.screenshot())
        predictionCapture.name = "Wall St platform prediction and later train after the walk"
        predictionCapture.lifetime = .keepAlways
        add(predictionCapture)
        let change = list.descendants(matching: .any)["placeTransferStep"].firstMatch
        revealPlaceElement(change, in: list)
        XCTAssertTrue(change.label.contains(interchange))
        XCTAssertTrue(change.label.localizedCaseInsensitiveContains("in-station signs"))
        XCTAssertFalse(list.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Walk to Lexington Av/59 St")).firstMatch.exists)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Wall St to Noguchi Museum with Lexington Av transfer on the main map"
        capture.lifetime = .keepAlways
        add(capture)
        let rideNW = list.descendants(matching: .any)["placeTripLeg-\(outbound)"].firstMatch
        revealPlaceElement(rideNW, in: list)
        XCTAssertTrue(rideNW.label.contains("Lexington Av/59 St") && rideNW.label.contains("Broadway"))
        let transferPrediction = list.descendants(matching: .any)["placeDeparture-\(outbound)"].firstMatch
        revealPlaceElement(transferPrediction, in: list)
        XCTAssertEqual(transferPrediction.label, "Next N departure at the transfer platform: 17 min from now.")
        app.buttons["placeBackToSearch"].tap()
        XCTAssertTrue(museum.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "Noguchi")
    }

    @MainActor
    func testStationRouteChoicesNameInterchanges() {
        checkStationRouteInterchanges(expanded: false, largeType: false)
    }

    @MainActor
    func testStationRouteChoicesNameInterchangesAtLargestType() {
        checkStationRouteInterchanges(expanded: false, largeType: true)
    }

    @MainActor
    func testStationRouteChoicesNameInterchangesExpanded() {
        checkStationRouteInterchanges(expanded: true, largeType: false)
    }

    @MainActor
    private func checkStationRouteInterchanges(expanded: Bool, largeType: Bool) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-route-interchanges"]
        if largeType {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["moreButton"].tap()
        let directions = app.buttons["directionsButton"]
        XCTAssertTrue(directions.waitForExistence(timeout: 5))
        directions.tap()
        if expanded {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true, readyControl: "originPicker")
        }
        let origin = app.buttons["originPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Wall\n")
        selectStationResult("419", query: "Wall", in: app)
        app.buttons["destinationPicker"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Astoria\n")
        selectStationResult("R03", query: "Astoria", in: app)
        let list = app.collectionViews["directionsList"]
        let union = app.buttons["tripPlan-4:N:419>635|N:N:R20>R03"]
        let lexington = app.buttons["tripPlan-4:N:419>629|N:N:R11>R03"]
        revealPlaceElement(union, in: list)
        XCTAssertTrue(union.label.contains("Change to N/W at 14 St-Union Sq"))
        let unionCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        unionCapture.name = "Union Square route choice — expanded \(expanded), largest type \(largeType)"
        unionCapture.lifetime = .keepAlways
        add(unionCapture)
        revealPlaceElement(lexington, in: list)
        let instruction = "Change to N/W at Lexington Av/59 St"
        XCTAssertTrue(lexington.label.contains(instruction))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Lexington route choice — expanded \(expanded), largest type \(largeType)"
        capture.lifetime = .keepAlways
        add(capture)
        lexington.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 10))
        let transfer = app.descendants(matching: .any)["stationTripTransfer"].firstMatch
        revealPlaceElement(transfer, in: app.collectionViews.firstMatch)
        XCTAssertTrue(transfer.label.contains(instruction))
        let showMap = app.buttons["showStationRouteOnMap"]
        XCTAssertTrue(showMap.waitForExistence(timeout: 5))
        XCTAssertTrue(showMap.isHittable, "The native map toolbar action must remain reachable while the itinerary is scrolled")
        XCTAssertEqual(showMap.label, "Show route on map")
        let mapAction = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        mapAction.name = "Native map action while scrolled — expanded \(expanded), largest type \(largeType)"
        mapAction.lifetime = .keepAlways
        add(mapAction)
        showMap.tap()
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        expectation(for: NSPredicate(format: "value CONTAINS %@", instruction), evaluatedWith: map)
        waitForExpectations(timeout: 10)
    }

    @MainActor
    func testManualStationItineraryFitsExposedCompactMap() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Noguchi\n")
        let museum = app.buttons["placeResult-fixture-noguchi"]
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        museum.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        guard focusSearchField(picker, in: app) else { return }
        picker.typeText("Wall\n")
        let station = app.buttons["stationChoice-419"]
        revealPlaceElement(station, in: app.collectionViews.firstMatch)
        station.tap()
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Wall St"))
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@", "Noguchi", "Wall St"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        let header = app.navigationBars["StandClear"]
        let sheetHeader = app.navigationBars["Route preview"]
        XCTAssertTrue(header.exists)
        XCTAssertTrue(sheetHeader.exists)
        XCTAssertGreaterThan(header.frame.height, 0)
        XCTAssertGreaterThan(sheetHeader.frame.height, 0)
        let labels = ["The Noguchi Museum", "Wall St", "Change to N/W at Lexington Av/59 St"]
        let fitted = NSPredicate { _, _ in MainActor.assumeIsolated {
            labels.allSatisfy { label in
                let pin = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
                guard pin.exists else { return false }
                let frame = pin.frame
                return frame.width > 0 && frame.height > 0 &&
                    frame.minY > header.frame.maxY && frame.maxY < sheetHeader.frame.minY &&
                    frame.minX >= map.frame.minX && frame.maxX <= map.frame.maxX
            }
        } }
        // Allow native sheet dismissal and camera framing to settle. The old
        // top-safe-area override leaves these pins behind the header indefinitely.
        let fit = XCTNSPredicateExpectation(predicate: fitted, object: map)
        let result = XCTWaiter.wait(for: [fit], timeout: 8)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Manual Wall St origin initial compact itinerary framing"
        capture.lifetime = .keepAlways
        add(capture)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = "Compact itinerary accessibility geometry"
        tree.lifetime = .keepAlways
        add(tree)
        XCTAssertEqual(result, .completed, "Boarding, transfer, and destination pins must fit between the header and route sheet")
    }

    @MainActor
    func testNoguchiMuseumOptionsOnCompactMap() {
        checkMuseumRouteOptions(expanded: false)
    }

    @MainActor
    func testNoguchiMuseumOptionsOnExpandedMap() {
        checkMuseumRouteOptions(expanded: true)
    }

    @MainActor
    private func checkMuseumRouteOptions(expanded: Bool) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        func provideFix() {
            XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
        }
        provideFix()
        defer {
            XCUIDevice.shared.location = nil
            XCUIDevice.shared.orientation = .portrait
        }
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let allow = alert.buttons["Allow While Using App"]
            guard allow.exists else { return false }
            allow.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        let dot = app.descendants(matching: .any)["userLocationDot"].firstMatch
        XCTAssertTrue(dot.waitForExistence(timeout: 30))
        if expanded {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true)
        }
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Noguchi\n")
        let museum = app.buttons["placeResult-fixture-noguchi"]
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        provideFix()
        museum.tap()
        let list = app.collectionViews["placePreviewList"]
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Current Location"))
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let mapped = NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@", "Noguchi", "N/W")
        expectation(for: mapped, evaluatedWith: map)
        waitForExpectations(timeout: 15)
        let firstSummary = map.value as? String
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = expanded ? "Expanded Noguchi Museum route on main map" : "Compact Noguchi Museum route on interactive main map"
        capture.lifetime = .keepAlways
        add(capture)
        if expanded {
            XCTAssertGreaterThan(list.frame.midX, app.windows.firstMatch.frame.midX)
        } else {
            let window = app.windows.firstMatch
            XCTAssertGreaterThan(list.frame.minY, window.frame.height * 0.3, "The compact route card must expose the main map")
            // The destination pin belongs to the selected itinerary and stays
            // present independently of Core Location updates.
            let pin = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "The Noguchi Museum")).firstMatch
            XCTAssertTrue(pin.waitForExistence(timeout: 5))
            let priorX = pin.frame.midX
            let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: 0.34))
            start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: window.frame.width * 0.23, dy: 0)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
            let moved = NSPredicate { _, _ in MainActor.assumeIsolated { pin.exists && pin.frame.midX - priorX > 8 } }
            expectation(for: moved, evaluatedWith: pin)
            waitForExpectations(timeout: 8)
            XCTAssertTrue(list.exists)
            XCTAssertEqual(map.value as? String, firstSummary)
            XCTAssertTrue(list.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND value == %@", "placeRouteOption-", "Selected")).firstMatch.exists)
        }
        // Use an independently identified alighting platform. Other rows can
        // be reordered as their walking durations finish loading.
        provideFix()
        let target = firstSummary?.hasSuffix(", 36 Av") == true ? "R05" : "R06"
        let legID = "N:N:R16>\(target)"
        let alternative = list.buttons["placeRouteOption-127>\(target):\(legID)"]
        revealPlaceElement(alternative, in: list)
        alternative.tap()
        expectation(for: NSPredicate(format: "value == %@", "Selected"), evaluatedWith: alternative)
        waitForExpectations(timeout: 8)
        let changed = NSPredicate { _, _ in MainActor.assumeIsolated {
            guard let summary = map.value as? String else { return false }
            return summary.contains("Noguchi") && summary.contains("N/W") && summary != firstSummary
        } }
        expectation(for: changed, evaluatedWith: map)
        waitForExpectations(timeout: 10)
        let alighting = (map.value as? String)?.components(separatedBy: ", ").last ?? ""
        XCTAssertTrue(["Broadway", "36 Av", "30 Av", "39 Av-Dutch Kills", "Queensboro Plaza"].contains(alighting))
        if !expanded, (app.buttons["Sheet Grabber"].value as? String) == "Half screen" {
            app.buttons["Sheet Grabber"].doubleTap()
        }
        let leg = list.descendants(matching: .any)["placeTripLeg-\(legID)"].firstMatch
        revealPlaceElement(leg, in: list)
        XCTAssertTrue(leg.label.contains(alighting), "The card and main map must identify the same alighting station")
        let boarding = list.descendants(matching: .any)["placeDeparture-\(legID)"].firstMatch
        revealPlaceElement(boarding, in: list)
        XCTAssertTrue(boarding.label.contains("Next N boarding prediction"), "Use a matching northbound platform and route")
        let walk = list.descendants(matching: .any)["placeDestinationWalk"].firstMatch
        revealPlaceElement(walk, in: list)
        XCTAssertTrue(walk.label.contains("Noguchi"))
        let total = list.descendants(matching: .any)["placeTripTimeEstimate"].firstMatch
        revealPlaceElement(total, in: list)
        let selection = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        selection.name = expanded ? "Expanded museum alternate itinerary" : "Compact museum alternate itinerary"
        selection.lifetime = .keepAlways
        add(selection)
        if !expanded {
            provideFix()
            revealPlaceElement(origin, in: list, downward: false)
            origin.tap()
            let picker = app.searchFields[unifiedSearchPrompt]
            XCTAssertTrue(picker.waitForExistence(timeout: 5))
            guard focusSearchField(picker, in: app) else { return }
            picker.typeText("49 St\n")
            let manual = app.buttons["stationChoice-R15"]
            revealPlaceElement(manual, in: app.collectionViews.firstMatch)
            manual.tap()
            XCTAssertTrue(origin.waitForExistence(timeout: 5))
            XCTAssertTrue(origin.label.contains("49 St"))
            expectation(for: NSPredicate(format: "value CONTAINS %@", "49 St"), evaluatedWith: map)
            waitForExpectations(timeout: 10)
            origin.tap()
            let useLocation = app.buttons["placeOriginCurrentLocation"]
            XCTAssertTrue(useLocation.waitForExistence(timeout: 5))
            provideFix()
            useLocation.tap()
            XCTAssertTrue(origin.waitForExistence(timeout: 5))
            XCTAssertTrue(origin.label.contains("Current Location"))
        }
        app.buttons["placeBackToSearch"].tap()
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "Noguchi")
    }

    @MainActor
    func testTottenvillePlaceSearchAndWalkingPreview() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-staten-island"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let search = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        guard focusSearchField(search, in: app) else { return }
        search.typeText("Tottenville destination\n")
        let place = app.buttons["placeResult-fixture-tottenville"]
        XCTAssertTrue(place.waitForExistence(timeout: 10), "A destination near the existing SI terminus must not be filtered out")
        place.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        origin.tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        guard focusSearchField(picker, in: app) else { return }
        picker.typeText("Tottenville\n")
        let station = app.buttons["stationChoice-S09"]
        revealPlaceElement(station, in: app.collectionViews.firstMatch)
        station.tap()
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Tottenville"))
        let list = app.collectionViews["placePreviewList"]
        if app.buttons["Sheet Grabber"].value as? String == "Half screen" {
            app.buttons["Sheet Grabber"].doubleTap()
        }
        let walk = list.descendants(matching: .any)["placeDestinationWalk"].firstMatch
        revealPlaceElement(walk, in: list)
        XCTAssertTrue(walk.label.contains("Tottenville destination"))
        let total = list.descendants(matching: .any)["placeWalkingTotal"].firstMatch
        revealPlaceElement(total, in: list)
        XCTAssertTrue(total.label.contains("3 min"), "The confirmed fixture walk should supply its duration")
        XCTAssertFalse(app.staticTexts["No usable walking connection"].exists)
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "Tottenville walking preview in compact presentation"
        compact.lifetime = .keepAlways
        add(compact)
        revealPlaceElement(origin, in: list, downward: false)
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "placeOriginPicker")
        revealPlaceElement(total, in: list)
        XCTAssertTrue(total.label.contains("3 min"))
        let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expanded.name = "Tottenville walking preview in expanded presentation"
        expanded.lifetime = .keepAlways
        add(expanded)
    }

    @MainActor
    private func revealPlaceElement(_ element: XCUIElement, in list: XCUIElement, downward: Bool = true,
                                    file: StaticString = #filePath, line: UInt = #line)
    {
        let app = XCUIApplication()
        // Trip details has a pinned navigation bar too. A row underneath it
        // needs a drag toward the top, even if it is inside the list frame.
        let tripDetails = app.navigationBars["Trip details"]
        let nav = tripDetails.exists ? tripDetails
            : app.navigationBars["From"].exists ? app.navigationBars["From"] : app.navigationBars["Route preview"]
        var towardBottom = downward
        for _ in 0 ..< 18 {
            let bounds = list.frame
            let top = nav.exists ? max(bounds.minY, nav.frame.maxY) : bounds.minY
            if element.exists {
                let frame = element.frame
                if !frame.isNull, !frame.isInfinite, frame.width > 0, frame.height > 0 {
                    if frame.midY > top, frame.midY < bounds.maxY, bounds.contains(CGPoint(x: frame.midX, y: frame.midY)),
                       // Read-only rows do not need activation points. XCTest
                       // can expose their text even when there is no tap target.
                       element.elementType != .button || element.isHittable
                    {
                        return
                    }
                    towardBottom = frame.midY >= top
                }
            }
            // End the drag at rest. A default flick can leap over the entire
            // route list in the short landscape control region.
            let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: towardBottom ? 0.78 : 0.48))
            let distance = min(bounds.height * 0.3, 150)
            start.press(forDuration: 0.08, thenDragTo: start.withOffset(CGVector(dx: 0, dy: towardBottom ? -distance : distance)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTFail("Could not reveal \(element) in the current route panel", file: file, line: line)
    }

    @MainActor
    func testMapKitLaunchIgnoresLegacyProviderAndKeepsNativeControls() {
        let app = XCUIApplication()
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        // Launch arguments override the same defaults key used by earlier builds.
        // Neither a fresh launch nor an old Mapbox preference may gate the map.
        for legacyPreference in [false, true] {
            app.terminate()
            app.launchArguments = ["--ui-test-fixture"] + (legacyPreference ? ["-mapProvider", "Mapbox"] : [])
            app.launch()
            XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 15))
            activatePermissionPrompt(in: app)
            XCTAssertTrue(app.descendants(matching: .any)["appleTransitMap"].waitForExistence(timeout: 10))
            XCTAssertFalse(app.descendants(matching: .any)["mapboxConfigurationUnavailable"].exists)
            XCTAssertTrue(app.buttons["searchButton"].exists)
            XCTAssertTrue(app.buttons["nearbyButton"].exists)
            app.buttons["moreButton"].tap()
            XCTAssertFalse(app.descendants(matching: .any)["mapProviderPicker"].exists)
            XCTAssertFalse(app.buttons["Mapbox"].exists)
            XCTAssertTrue(app.buttons["linesButton"].exists)
            XCTAssertTrue(app.buttons["directionsButton"].exists)
            app.buttons["arrivalStatusButton"].tap()
            XCTAssertTrue(app.alerts["Arrival status"].waitForExistence(timeout: 5))
            XCTAssertTrue(app.alerts.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Status when opened:")).firstMatch.exists)
            app.alerts.buttons["OK"].tap()
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = legacyPreference ? "MapKit ignores legacy Mapbox preference" : "MapKit native map and controls"
            capture.lifetime = .keepAlways
            add(capture)
        }
    }

    @MainActor
    func testSearchAndNearbyPresentOneNativeSheet() {
        let app = XCUIApplication()
        app.resetAuthorizationStatus(for: .location)
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            if deny.exists {
                deny.tap(); return true
            }
            return false
        }
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.launchArguments = ["--ui-test-fixture"]
        app.launch()
        let search = app.buttons["searchButton"]
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        activatePermissionPrompt(in: app)
        search.tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.searchFields.firstMatch.exists)
        let searchScreenshot = XCTAttachment(screenshot: app.screenshot())
        searchScreenshot.name = "Native search presentation"
        searchScreenshot.lifetime = .keepAlways
        add(searchScreenshot)
        app.buttons["Done"].tap()
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Search"].exists)
        XCTAssertTrue(app.staticTexts["Location access is off"].waitForExistence(timeout: 5))
        let nearby = XCTAttachment(screenshot: app.screenshot())
        nearby.name = "Native nearby denied-permission state"
        nearby.lifetime = .keepAlways
        add(nearby)
        app.buttons["Done"].tap()
        XCTAssertTrue(search.exists)
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.staticTexts["Location access is off"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        waitForLayout(in: app, expanded: true)
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].exists)
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Done"].exists, "Wide controls should occupy the right region, not a sheet")
        XCTAssertGreaterThan(app.buttons["searchButton"].frame.midX, app.frame.midX)
        XCTAssertGreaterThan(app.buttons["nearbyButton"].frame.midX, app.frame.midX)
        let expanded = XCTAttachment(screenshot: app.screenshot())
        expanded.name = "Expanded native control region"
        expanded.lifetime = .keepAlways
        add(expanded)
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "Done")
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        let field = app.searchFields.firstMatch
        field.tap()
        field.typeText("Times")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        let sheetDismissed = NSPredicate(format: "exists == false")
        expectation(for: sheetDismissed, evaluatedWith: app.buttons["Done"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("Times") == true)
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertGreaterThan(app.buttons["searchButton"].frame.midX, app.frame.midX)
        // Exercise departure from expanded Search with its keyboard active too.
        app.searchFields.firstMatch.tap()
        app.searchFields.firstMatch.typeText(" Sq")
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "Done")
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Search keyboard must leave with its presentation")
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("Times Sq") == true)
        app.buttons["Done"].tap()
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        expectation(for: sheetDismissed, evaluatedWith: app.buttons["Done"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertFalse(app.navigationBars["Search"].exists)
    }

    @MainActor
    func testStationBrowsersPreserveIndependentPathsAcrossLayouts() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
        defer {
            XCUIDevice.shared.location = nil
            XCUIDevice.shared.orientation = .portrait
        }
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let allow = alert.buttons["Allow While Using App"]
            guard allow.exists else { return false }
            allow.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Wall\n")
        selectSearchResult("419", query: "Wall", in: app)
        XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["stationAlertsSummary"].waitForExistence(timeout: 10))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "directionsHere")
        XCTAssertTrue(app.navigationBars["Wall St"].exists)
        // SwiftUI owns the native toolbar button's metrics. Verify activation
        // instead of applying the former custom list-row height requirement.
        XCTAssertTrue(app.buttons["directionsHere"].isHittable)
        let wide = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        wide.name = "Search station survives expansion"
        wide.lifetime = .keepAlways
        add(wide)
        app.buttons["directionsHere"].tap()
        let destination = app.buttons["destinationPicker"]
        XCTAssertTrue(destination.waitForExistence(timeout: 5))
        XCTAssertTrue(destination.label.contains("Wall St"))
        app.navigationBars["Directions"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
        // Nearby owns a separate stack: it must not inherit Search's Wall St.
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        let times = app.buttons["station-127"]
        XCTAssertTrue(times.waitForExistence(timeout: 15))
        times.tap()
        XCTAssertTrue(app.navigationBars["Times Sq-42 St"].waitForExistence(timeout: 5))
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.navigationBars["Times Sq-42 St"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "directionsHere")
        XCTAssertTrue(app.navigationBars["Times Sq-42 St"].exists)
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "directionsHere")
        XCTAssertTrue(app.navigationBars["Times Sq-42 St"].exists)
        app.navigationBars["Times Sq-42 St"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "directionsHere")
        XCTAssertTrue(app.navigationBars["Wall St"].exists)
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "Search station survives return to compact"
        compact.lifetime = .keepAlways
        add(compact)
        app.navigationBars["Wall St"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "Wall")
        selectSearchResult("419", query: "Wall", in: app)
        app.buttons["Done"].tap()
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5), "Explicit dismissal resets the station path")
        XCTAssertEqual(field.value as? String, "Wall")
        selectSearchResult("419", query: "Wall", in: app)
        // Drag dismissal has the same reset semantics as Done.
        app.buttons["Sheet Grabber"].swipeDown()
        XCTAssertTrue(app.buttons["searchButton"].waitForExistence(timeout: 5))
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "Wall")
    }

    @MainActor
    func testStationSearchDirectionsHerePreservesBackAndQuery() {
        checkStationSearchDirectionsHere(expanded: false)
    }

    @MainActor
    func testExpandedStationSearchDirectionsHere() {
        checkStationSearchDirectionsHere(expanded: true)
    }

    @MainActor
    func testDirectionsHereSuggestsEditableNearbyOrigin() {
        checkStationSearchDirectionsHere(expanded: false, locationGranted: true)
    }

    @MainActor
    private func checkStationSearchDirectionsHere(expanded: Bool, locationGranted: Bool = false) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        if locationGranted {
            XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
        }
        defer { XCUIDevice.shared.location = nil }
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons[locationGranted ? "Allow While Using App" : "Don’t Allow"]
            if deny.exists {
                deny.tap(); return true
            }
            return false
        }
        app.launch()
        XCTAssertTrue(app.buttons["searchButton"].waitForExistence(timeout: 15))
        let title = app.navigationBars["StandClear"].staticTexts["StandClear"]
        XCTAssertTrue(title.waitForExistence(timeout: 20))
        title.tap()
        if locationGranted {
            XCTAssertTrue(app.descendants(matching: .any)["userLocationDot"].waitForExistence(timeout: 30),
                          "Location must be available before testing the one-time origin suggestion")
        }
        if expanded {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true)
        }
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["searchButton"].tap()
        let search = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        guard focusSearchField(search, in: app) else { return }
        search.typeText("Wall\n")
        if !expanded, !locationGranted {
            // The same submitted query offers both a place and a station.
            let list = app.collectionViews["stationList"]
            XCTAssertTrue(list.buttons["placeResult-fixture-55-wall-street"].waitForExistence(timeout: 10))
            XCTAssertTrue(list.buttons["station-419"].exists)
            XCTAssertEqual(search.value as? String, "Wall")
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = "Unified search for Wall"
            capture.lifetime = .keepAlways
            add(capture)
        }
        selectSearchResult("419", query: "Wall", in: app)
        XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
        if !expanded, !locationGranted {
            let summary = app.buttons["stationAlertsSummary"]
            XCTAssertTrue(summary.waitForExistence(timeout: 10))
            XCTAssertTrue(summary.label.contains("1 severe"))
            let alert = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Allow extra travel time at Wall St.")).firstMatch
            XCTAssertFalse(alert.exists, "Severe advisories should identify urgency without displacing arrivals")
            summary.tap()
            XCTAssertTrue(alert.waitForExistence(timeout: 5))
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = "Station-scoped service advisory"
            capture.lifetime = .keepAlways
            add(capture)
            summary.tap()
        }
        if locationGranted {
            // Search may outlast the real 30-second fix lifetime on a hosted
            // simulator. Deliver a fresh measurement on foreground entry.
            XCUIDevice.shared.press(.home)
            let backgrounded = NSPredicate { _, _ in MainActor.assumeIsolated {
                let state = app.state
                return state == .runningBackground || state == .runningBackgroundSuspended
            } }
            expectation(for: backgrounded, evaluatedWith: app)
            waitForExpectations(timeout: 5)
            XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
            XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
        }
        XCTAssertTrue(app.buttons["directionsHere"].waitForExistence(timeout: 5))
        app.buttons["directionsHere"].tap()
        XCTAssertTrue(app.buttons["destinationPicker"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["destinationPicker"].label.contains("Wall St"))
        if locationGranted {
            XCTAssertTrue(app.buttons["originPicker"].label.contains("Times Sq"))
            XCTAssertTrue(app.staticTexts["originSuggestion"].exists)
        } else {
            XCTAssertTrue(app.buttons["originPicker"].label.contains("Choose station"))
        }
        app.buttons["originPicker"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let origins = app.searchFields.firstMatch
        XCTAssertTrue(origins.waitForExistence(timeout: 5))
        origins.tap()
        if locationGranted {
            origins.typeText("Times Square\n")
            selectStationResult("127", query: "Times Square", in: app)
            let origin = app.buttons["originPicker"]
            XCTAssertTrue(origin.waitForExistence(timeout: 5))
            XCTAssertTrue(origin.label.contains("Times Sq-42 St"))
            XCTAssertFalse(app.staticTexts["originSuggestion"].exists, "Selecting the matching station makes From a manual choice")
            origin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            XCTAssertTrue(origins.waitForExistence(timeout: 5))
            origins.tap()
        }
        origins.typeText("59\n")
        selectStationResult("629", query: "59", in: app)
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["originSuggestion"].exists, "A manual origin replaces the location suggestion")
        app.navigationBars["Directions"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["directionsHere"].waitForExistence(timeout: 5))
        app.navigationBars["Wall St"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("Wall") == true)
        selectSearchResult("419", query: "Wall", in: app)
        app.buttons["directionsHere"].tap()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["originPicker"].label.contains("59 St"))
        let plan = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tripPlan-4:S:629>419")).firstMatch
        // A short expanded region keeps endpoint controls above route results.
        for _ in 0 ..< 3 where !plan.exists {
            app.collectionViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(plan.waitForExistence(timeout: 10))
        plan.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 5))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Station search to directions with preserved origin"
        capture.lifetime = .keepAlways
        add(capture)
        app.buttons["showStationRouteOnMap"].tap()
        XCTAssertTrue(app.buttons["searchButton"].waitForExistence(timeout: 5))
        if expanded {
            XCTAssertTrue(app.navigationBars["Trip details"].exists)
        } else {
            XCTAssertTrue(app.navigationBars["Trip details"].waitForNonExistence(timeout: 5))
        }
        let mapCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        mapCapture.name = expanded ? "Station-entry route in expanded region" : "Station-entry route after sheet dismissal"
        mapCapture.lifetime = .keepAlways
        add(mapCapture)
        let clearRoute = app.buttons["clearMapRoute"]
        XCTAssertTrue(clearRoute.waitForExistence(timeout: 5))
        XCTAssertTrue(clearRoute.isHittable)
        clearRoute.tap()
        XCTAssertFalse(clearRoute.exists, "One map action clears the selected route")
        if expanded {
            app.navigationBars["Trip details"].buttons.element(boundBy: 0).tap()
        } else {
            app.buttons["moreButton"].tap()
            app.buttons["directionsButton"].tap()
        }
        XCTAssertTrue(app.navigationBars["Directions"].waitForExistence(timeout: 5))
        // Returning from details preserves scroll position. Start below the
        // native navigation bar: a default swipe can start on that bar in a
        // short expanded window and never reach the scrollable content.
        let directionsList = app.collectionViews["directionsList"]
        for _ in 0 ..< 3 where !app.buttons["originPicker"].exists {
            directionsList.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.05, thenDragTo: directionsList.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)))
        }
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["originPicker"].label.contains("59 St"))
        XCTAssertTrue(app.buttons["destinationPicker"].label.contains("Wall St"))
    }

    @MainActor
    func testStationTripShowsTransferPredictionAndClearsMap() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["moreButton"].tap()
        app.buttons["directionsButton"].tap()
        for (picker, query, stationID) in [("originPicker", "Wall", "419"), ("destinationPicker", "Broadway", "R05")] {
            let button = app.buttons[picker]
            expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: button)
            waitForExpectations(timeout: 10)
            button.tap()
            let field = app.searchFields["Search subway stations"]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            field.tap()
            field.typeText(query)
            selectStationResult(stationID, query: query, in: app)
        }

        let plan = app.buttons["tripPlan-4:N:419>629|N:N:R11>R05"]
        XCTAssertTrue(plan.waitForExistence(timeout: 10))
        plan.tap()
        let grabber = app.buttons["Sheet Grabber"]
        if grabber.exists, grabber.value as? String == "Half screen" {
            grabber.doubleTap()
        }
        let transfer = app.descendants(matching: .any)["stationTripTransfer"].firstMatch
        let list = app.collectionViews.firstMatch
        let interchange = "Change to N/W at Lexington Av/59 St"
        revealPlaceElement(transfer, in: list)
        XCTAssertTrue(transfer.label.contains(interchange))
        let prediction = app.descendants(matching: .any)["legPrediction-N:N:R11>R05"].firstMatch
        let nextN = prediction.staticTexts["N · 17 min"]
        revealPlaceElement(nextN, in: list)
        XCTAssertTrue(prediction.staticTexts["Train destination: 30 Av"].exists)
        let showMap = app.buttons["showStationRouteOnMap"]
        XCTAssertTrue(showMap.waitForExistence(timeout: 5))
        XCTAssertTrue(showMap.isHittable, "The native map toolbar action must remain reachable beside the transfer prediction")
        showMap.tap()
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        expectation(for: NSPredicate(format: "value CONTAINS %@", interchange), evaluatedWith: map)
        waitForExpectations(timeout: 10)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Station trip from Wall St to Broadway with Lexington Av transfer"
        capture.lifetime = .keepAlways
        add(capture)
        app.buttons["clearMapRoute"].tap()
        expectation(for: NSPredicate(format: "exists == true AND NOT (value CONTAINS %@)", interchange), evaluatedWith: map)
        waitForExpectations(timeout: 5)
        XCTAssertFalse(app.buttons["clearMapRoute"].exists)
    }

    @MainActor
    func testExpandedMoreMenuActionsSurviveLayoutChanges() {
        let app = launchForMoreMenu()
        defer { XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        for cycle in 0 ..< 2 {
            let more = app.buttons["moreButton"]
            XCTAssertTrue(more.waitForExistence(timeout: 5))
            let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            capture.name = "Expanded native controls, visit \(cycle + 1)"
            capture.lifetime = .keepAlways
            add(capture)
            guard more.isEnabled else {
                XCTFail("Expanded More is disabled after layout settles; its native menu must remain enabled")
                return
            }
            XCTAssertTrue(more.isHittable)
            more.tap()
            XCTAssertTrue(app.buttons["directionsButton"].waitForExistence(timeout: 5))
            app.buttons["directionsButton"].tap()
            XCTAssertTrue(app.navigationBars["Directions"].waitForExistence(timeout: 5))
            more.tap()
            XCTAssertTrue(app.buttons["linesButton"].waitForExistence(timeout: 5))
            app.buttons["linesButton"].tap()
            XCTAssertTrue(app.navigationBars["Lines"].waitForExistence(timeout: 5))
            more.tap()
            XCTAssertTrue(app.buttons["arrivalStatusButton"].waitForExistence(timeout: 5))
            app.buttons["arrivalStatusButton"].tap()
            let status = app.alerts["Arrival status"]
            XCTAssertTrue(status.waitForExistence(timeout: 5))
            XCTAssertTrue(status.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Status when opened:")).firstMatch.exists)
            status.buttons["OK"].tap()
            app.buttons["searchButton"].tap()
            XCTAssertTrue(app.searchFields[unifiedSearchPrompt].waitForExistence(timeout: 5))
            app.buttons["nearbyButton"].tap()
            XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
            if cycle == 0 {
                XCUIDevice.shared.orientation = .portrait
                waitForLayout(in: app, expanded: false, readyControl: "Done")
                app.buttons["Done"].tap()
                XCTAssertTrue(more.waitForExistence(timeout: 5))
                XCTAssertTrue(more.isEnabled)
                more.tap()
                app.buttons["arrivalStatusButton"].tap()
                XCTAssertTrue(status.waitForExistence(timeout: 5))
                status.buttons["OK"].tap()
                XCUIDevice.shared.orientation = .landscapeLeft
                waitForLayout(in: app, expanded: true)
            }
        }
    }

    @MainActor
    func testMoreMenuAtLargestAccessibilityTextUsesCompactPresentation() {
        let app = launchForMoreMenu(accessibilityText: true)
        let more = app.buttons["moreButton"]
        for (action, title) in [("directionsButton", "Directions"), ("linesButton", "Lines")] {
            XCTAssertTrue(more.waitForExistence(timeout: 5))
            XCTAssertTrue(more.isEnabled)
            more.tap()
            XCTAssertTrue(app.buttons[action].waitForExistence(timeout: 5))
            app.buttons[action].tap()
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
            XCTAssertTrue(app.buttons["Done"].exists, "Accessibility text should retain the native compact sheet")
            app.buttons["Done"].tap()
        }
        more.tap()
        app.buttons["arrivalStatusButton"].tap()
        let status = app.alerts["Arrival status"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Native More status at largest accessibility text"
        capture.lifetime = .keepAlways
        add(capture)
        status.buttons["OK"].tap()
    }

    @MainActor
    private func launchForMoreMenu(accessibilityText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"]
        if accessibilityText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        return app
    }

    @MainActor
    func testJamaicaBoundEUsesNorthboundPlatformPrediction() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-operational-direction"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            guard deny.exists else { return false }
            deny.tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["moreButton"].tap()
        app.buttons["directionsButton"].tap()
        for (picker, query, stationID) in [("originPicker", "Lexington", "F11"), ("destinationPicker", "Jamaica Center", "G05")] {
            XCTAssertTrue(app.buttons[picker].waitForExistence(timeout: 10))
            app.buttons[picker].tap()
            let field = app.searchFields["Search subway stations"]
            guard focusSearchField(field, in: app) else { return }
            field.typeText(query)
            selectStationResult(stationID, query: query, in: app)
        }
        let plan = app.buttons["tripPlan-E:N:F11>G05"]
        XCTAssertTrue(plan.waitForExistence(timeout: 10))
        plan.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 5))
        let grabber = app.buttons["Sheet Grabber"]
        if grabber.exists, grabber.value as? String == "Half screen" {
            grabber.doubleTap()
        }
        let prediction = app.descendants(matching: .any)["legPrediction-E:N:F11>G05"].firstMatch
        let next = prediction.staticTexts["E · 8 min"]
        revealPlaceElement(next, in: app.collectionViews.firstMatch)
        XCTAssertTrue(app.staticTexts["Northbound"].exists)
        XCTAssertTrue(prediction.staticTexts["Train destination: Jamaica Center-Parsons/Archer"].exists)
        XCTAssertFalse(prediction.staticTexts["E · 2 min"].exists)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Jamaica-bound E uses the northbound platform prediction"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testStationDirectionsAndSwap() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            if deny.exists {
                deny.tap(); return true
            }
            return false
        }
        app.launch()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 15))
        // Trigger permission handling on the inert title, not the map center,
        // which can contain the large-text Open Settings link.
        activatePermissionPrompt(in: app)
        app.buttons["moreButton"].tap()
        XCTAssertTrue(app.buttons["directionsButton"].waitForExistence(timeout: 5))
        app.buttons["directionsButton"].tap()
        XCTAssertTrue(app.navigationBars["Directions"].waitForExistence(timeout: 5))
        let origin = app.buttons["originPicker"]
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: origin)
        waitForExpectations(timeout: 30)
        origin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let originSearch = app.searchFields.firstMatch
        XCTAssertTrue(originSearch.waitForExistence(timeout: 5))
        originSearch.tap()
        originSearch.typeText("Wall")
        selectStationResult("419", query: "Wall", in: app)
        app.buttons["destinationPicker"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let destinationSearch = app.searchFields.firstMatch
        XCTAssertTrue(destinationSearch.waitForExistence(timeout: 5))
        destinationSearch.tap()
        destinationSearch.typeText("59")
        selectStationResult("629", query: "59", in: app)
        let northbound = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tripPlan-4:N:419>629")).firstMatch
        XCTAssertTrue(northbound.waitForExistence(timeout: 10))
        northbound.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["5 stops · Direct"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native station itinerary and highlighted route"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["showStationRouteOnMap"].tap()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Trip details"].exists)
        let routeMap = XCTAttachment(screenshot: app.screenshot())
        routeMap.name = "Selected itinerary on Apple Maps"
        routeMap.lifetime = .keepAlways
        add(routeMap)
        app.buttons["moreButton"].tap()
        XCTAssertTrue(app.buttons["directionsButton"].waitForExistence(timeout: 5))
        app.buttons["directionsButton"].tap()
        XCTAssertTrue(app.buttons["swapStations"].waitForExistence(timeout: 5))
        app.buttons["swapStations"].tap()
        let southbound = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tripPlan-4:S:629>419")).firstMatch
        XCTAssertTrue(southbound.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["originPicker"].label.contains("59 St"))
        XCTAssertTrue(app.buttons["destinationPicker"].label.contains("Wall St"))
    }

    @MainActor
    private func selectStationResult(_ stationID: String, query: String, in app: XCUIApplication) {
        // Text injection can return before SwiftUI exposes the filtered list.
        // Wait for the exact result; do not retry input or substitute a station.
        let result = app.buttons["stationChoice-\(stationID)"]
        let ready = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                let search = app.searchFields.firstMatch
                return search.exists && (search.value as? String) == query && result.exists
            }
        }
        expectation(for: ready, evaluatedWith: result)
        waitForExpectations(timeout: 10)
        if query == "Wall" {
            XCTAssertFalse(app.buttons["placeResult-fixture-55-wall-street"].exists,
                           "The transit endpoint picker should offer stations only")
        }
        result.tap()
    }

    @MainActor
    private func selectSearchResult(_ stationID: String, query: String, in app: XCUIApplication) {
        let result = app.buttons["station-\(stationID)"]
        let ready = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                let search = app.searchFields.firstMatch
                return search.exists && (search.value as? String) == query && result.exists && result.isHittable
            }
        }
        expectation(for: ready, evaluatedWith: result)
        waitForExpectations(timeout: 10)
        // Regression: the blank center between station text and route badges
        // must navigate just like either visible part of the native row label.
        result.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    @MainActor
    private func activatePermissionPrompt(in app: XCUIApplication) {
        let title = app.navigationBars["StandClear"].staticTexts["StandClear"]
        XCTAssertTrue(title.waitForExistence(timeout: 20))
        title.tap()
    }

    @MainActor
    private func waitForLayout(in app: XCUIApplication, expanded: Bool, readyControl: String = "searchButton") {
        // Rotation can return before the simulator window and accessibility frames
        // settle. Check geometry before asking XCTest to calculate a hit point.
        let ready = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                let window = app.windows.firstMatch
                // SwiftUI can expose both presentations during adaptation.
                // Wait for a single control before requesting its frame.
                let controls = app.buttons.matching(identifier: readyControl)
                guard window.exists, controls.count == 1 else { return false }
                let control = controls.element(boundBy: 0)
                guard control.exists else { return false }
                let bounds = window.frame
                let frame = control.frame
                guard !bounds.isNull, !bounds.isInfinite, !frame.isNull, !frame.isInfinite,
                      bounds.width > 0, bounds.height > 0,
                      (bounds.width > bounds.height) == expanded,
                      frame.width > 0, frame.height > 0,
                      bounds.contains(frame),
                      !expanded || frame.midX > bounds.midX
                else { return false }
                return control.isHittable
            }
        }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 20)
    }
}
