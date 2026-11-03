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
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
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
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "glance-")).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        let station = app.buttons["station-127"]
        XCTAssertTrue(station.waitForExistence(timeout: 10), "Times Square should be nearby the simulated location")
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
        let candidate = arrivalsList.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND NOT label CONTAINS %@", "arrivalRow-", "<1 min")).firstMatch
        XCTAssertTrue(candidate.waitForExistence(timeout: 10), "Fixture arrivals must be available for disclosure coverage")
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
        arrival.tap()
        XCTAssertTrue(arrivalsList.staticTexts.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", arrivalID, "Predicted arrival:")).firstMatch.waitForExistence(timeout: 5))
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
    func testRecentStationPersistsAcrossRelaunchAndCanBeCleared() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
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
        }
        XCTAssertFalse(recent.exists)
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
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
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
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
        field.tap()
        field.typeText("550 Madison\n")
        let result = app.buttons["placeResult-fixture-550-madison"]
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        result.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Choose station"))
        origin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let picker = app.searchFields["Search subway stations"]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        picker.typeText("Wall\n")
        selectStationResult("419", query: "Wall", in: app)
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("Wall St"))
        let list = app.collectionViews["placePreviewList"]
        let leg = list.descendants(matching: .any)["placeTripLeg-4:N:419>629"].firstMatch
        XCTAssertTrue(leg.waitForExistence(timeout: 10))
        let total = list.descendants(matching: .any)["placeWalkingTotal"].firstMatch
        for _ in 0 ..< 3 where !total.exists {
            list.swipeUp()
        }
        XCTAssertTrue(total.waitForExistence(timeout: 5))
        XCTAssertTrue(list.descendants(matching: .any)["placeDestinationWalk"].firstMatch.label.contains("550 Madison"))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = expanded ? "Expanded place preview" : "Compact place preview"
        capture.lifetime = .keepAlways
        add(capture)
        if expanded {
            app.buttons["Done"].tap()
        } else {
            app.navigationBars["Route preview"].buttons.element(boundBy: 0).tap()
        }
        XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "550 Madison")
    }

    @MainActor
    func testMapProviderComparisonKeepsNativeControls() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            if deny.exists {
                deny.tap(); return true
            }
            return false
        }
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launch()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 15))
        activatePermissionPrompt(in: app)
        for (provider, mapID) in [("Apple Maps", "appleTransitMap"), ("Mapbox", "mapboxTransitMap")] {
            app.buttons["moreButton"].tap()
            let option = app.buttons[provider]
            XCTAssertTrue(option.waitForExistence(timeout: 5))
            option.tap()
            let unavailable = app.descendants(matching: .any)["mapboxConfigurationUnavailable"]
            if provider == "Mapbox", unavailable.exists {
                XCTAssertTrue(app.staticTexts["Mapbox unavailable"].exists, "CI should retain an explicit missing-token state")
            } else {
                XCTAssertTrue(app.descendants(matching: .any)[mapID].waitForExistence(timeout: 10))
            }
            XCTAssertTrue(app.buttons["searchButton"].exists)
            XCTAssertTrue(app.buttons["nearbyButton"].exists)
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = provider + " transit comparison"
            capture.lifetime = .keepAlways
            add(capture)
            if provider == "Mapbox", unavailable.exists {
                app.buttons["Use Apple Maps"].tap()
                XCTAssertTrue(app.descendants(matching: .any)["appleTransitMap"].waitForExistence(timeout: 10))
                XCTAssertTrue(unavailable.waitForNonExistence(timeout: 5))
            }
        }
        app.buttons["moreButton"].tap()
        app.buttons["arrivalStatusButton"].tap()
        XCTAssertTrue(app.alerts["Arrival status"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.alerts.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Status when opened:")).firstMatch.exists)
        app.alerts.buttons["OK"].tap()
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
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
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
        waitForLayout(in: app, expanded: false)
        XCTAssertTrue(app.navigationBars["StandClear"].waitForExistence(timeout: 5))
        app.buttons["searchButton"].tap()
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
        waitForLayout(in: app, expanded: false, readyControl: "nearbyButton")
        XCTAssertTrue(app.navigationBars["StandClear"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Search keyboard must leave with its presentation")
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
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
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
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10),
                      "Tapping Search must present a usable keyboard before entering a station")
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
        app.buttons["Show route on map"].tap()
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
    func testStationDirectionsAndSwap() throws {
        try checkStationDirectionsAndSwap(provider: "Apple Maps")
    }

    @MainActor
    func testMapboxStationDirectionsAndSwap() throws {
        try checkStationDirectionsAndSwap(provider: "Mapbox")
    }

    @MainActor
    private func checkStationDirectionsAndSwap(provider: String) throws {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", provider]
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
        if provider == "Mapbox", app.staticTexts["Mapbox unavailable"].exists {
            throw XCTSkip("Mapbox rendering needs an ignored local public token. CI verifies its missing-configuration state separately.")
        }
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
        app.buttons["Show route on map"].tap()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Trip details"].exists)
        let routeMap = XCTAttachment(screenshot: app.screenshot())
        routeMap.name = "Selected itinerary on " + provider
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
                let control = app.buttons[readyControl]
                guard window.exists, control.exists else { return false }
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
