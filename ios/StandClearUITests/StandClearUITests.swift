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
    func testBusyStationArrivalGroupsExpandIndependently() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-grouped-arrivals", "-mapProvider", "Apple Maps"]
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
        field.tap()
        field.typeText("Grand Central\n")
        selectSearchResult("631", query: "Grand Central", in: app)
        XCTAssertTrue(app.navigationBars["Grand Central-42 St"].waitForExistence(timeout: 5))
        let list = app.collectionViews["stationArrivalsList"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        let north = list.buttons["stationArrivalToggle-N"]
        let south = list.buttons["stationArrivalToggle-S"]
        let fifthNorth = list.buttons["arrivalRow-busy-n-5:631:N"]
        let fifthSouth = list.buttons["arrivalRow-busy-s-5:631:S"]
        let unknown = list.buttons["arrivalRow-busy-unknown:631:?"]
        func reveal(_ row: XCUIElement, towardBottom: Bool) {
            for _ in 0 ..< 8 {
                if row.exists, row.frame.height > 0, list.frame.contains(row.frame), row.isHittable {
                    return
                }
                let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: towardBottom ? 0.8 : 0.35))
                let end = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: towardBottom ? 0.35 : 0.8))
                start.press(forDuration: 0.1, thenDragTo: end)
            }
            XCTFail("Could not reveal \(row)")
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
    }

    @MainActor
    func testExpressArrivalIdentifiesServiceAtParkchester() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.833226, longitude: -73.860816))
        defer { XCUIDevice.shared.location = nil }
        app.launchArguments = ["--ui-test-fixture", "--ui-test-express-arrivals", "-mapProvider", "Apple Maps"]
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
        app.launchArguments = ["--ui-test-fixture", "-mapProvider", "Apple Maps"]
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
        field.tap()
        field.typeText("Wall\n")
        selectSearchResult("419", query: "Wall", in: app)
        let detail = app.navigationBars["Wall St"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        let toggle = app.buttons["favoriteStationToggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        // Restore a known starting state if a previous simulator run stopped
        // before cleanup. Preserve any other station the rider saved.
        if toggle.label == "Remove from favorites" {
            toggle.tap()
        }
        XCTAssertEqual(toggle.label, "Add to favorites")
        toggle.tap()
        XCTAssertEqual(toggle.label, "Remove from favorites")

        app.terminate()
        app.launch()
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
        XCTAssertEqual(toggle.label, "Remove from favorites")
        toggle.tap()
        XCTAssertEqual(toggle.label, "Add to favorites")
        detail.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        XCTAssertTrue(favorite.waitForNonExistence(timeout: 5))
        XCTAssertTrue(missingFix.exists)
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
        XCTAssertTrue(origin.label.contains("Current Location"))
        origin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
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
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "550 Madison")
    }

    @MainActor
    func testMuseumTransferShowsBothServicesAndInterchangeOnMainMap() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi", "-mapProvider", "Apple Maps"]
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
        field.tap()
        field.typeText("Noguchi\n")
        let museum = app.buttons["placeResult-fixture-noguchi"]
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        museum.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 5))
        origin.tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 5))
        picker.tap()
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
        XCTAssertEqual(transferPrediction.label, "Next N boarding prediction: 17 min.")
        app.buttons["placeBackToSearch"].tap()
        XCTAssertTrue(museum.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "Noguchi")
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
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi", "-mapProvider", "Apple Maps"]
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
        field.tap()
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
            picker.tap()
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
    private func revealPlaceElement(_ element: XCUIElement, in list: XCUIElement, downward: Bool = true,
                                    file: StaticString = #filePath, line: UInt = #line)
    {
        let app = XCUIApplication()
        let nav = app.navigationBars["From"].exists ? app.navigationBars["From"] : app.navigationBars["Route preview"]
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
    func testStationTripShowsTransferPredictionAndClearsMap() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi", "-mapProvider", "Apple Maps"]
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
        let showMap = app.buttons["Show route on map"]
        revealPlaceElement(showMap, in: list, downward: false)
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
