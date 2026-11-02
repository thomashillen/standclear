import CoreLocation
import XCTest

final class StandClearUITests: XCTestCase {
    @MainActor
    func testNearbyGlanceKeepsMapVisibleForGrantedLocation() {
        let app = XCUIApplication()
        app.terminate()
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7553, longitude: -73.987))
        defer { XCUIDevice.shared.location = nil }
        app.launchArguments = ["-mapProvider", "Apple Maps"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let allow = alert.buttons["Allow While Using App"]
            if allow.exists {
                allow.tap(); return true
            }
            return false
        }
        app.launch()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 15))
        app.tap()
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
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Automatic nearby arrivals with granted location"
        capture.lifetime = .keepAlways
        add(capture)
        app.buttons["Done"].tap()
        let neighborhood = XCTAttachment(screenshot: app.screenshot())
        neighborhood.name = "Near Me recentered neighborhood"
        neighborhood.lifetime = .keepAlways
        add(neighborhood)
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search stations"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists, "Nearby must not interrupt manual search")
    }

    @MainActor
    func testMapProviderComparisonKeepsNativeControls() {
        let app = XCUIApplication()
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            let deny = alert.buttons["Don’t Allow"]
            if deny.exists {
                deny.tap(); return true
            }
            return false
        }
        app.terminate()
        app.resetAuthorizationStatus(for: .location)
        app.launch()
        XCTAssertTrue(app.buttons["moreButton"].waitForExistence(timeout: 15))
        app.tap()
        for (provider, mapID) in [("Apple Maps", "appleTransitMap"), ("Mapbox", "mapboxTransitMap")] {
            app.buttons["moreButton"].tap()
            let option = app.buttons[provider]
            XCTAssertTrue(option.waitForExistence(timeout: 5))
            option.tap()
            let unavailable = app.descendants(matching: .any)["mapboxConfigurationUnavailable"]
            if provider == "Mapbox", unavailable.exists {
                XCTAssertTrue(app.staticTexts["Map configuration needed"].exists, "CI should retain an explicit missing-token state")
            } else {
                XCTAssertTrue(app.descendants(matching: .any)[mapID].waitForExistence(timeout: 10))
            }
            XCTAssertTrue(app.buttons["searchButton"].exists)
            XCTAssertTrue(app.buttons["nearbyButton"].exists)
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = provider + " transit comparison"
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
        app.launch()
        let search = app.buttons["searchButton"]
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        app.tap() // Let XCTest handle the system permission interruption if present.
        search.tap()
        XCTAssertTrue(app.navigationBars["Search stations"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.searchFields.firstMatch.exists)
        let searchScreenshot = XCTAttachment(screenshot: app.screenshot())
        searchScreenshot.name = "Native search presentation"
        searchScreenshot.lifetime = .keepAlways
        add(searchScreenshot)
        app.buttons["Done"].tap()
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Search stations"].exists)
        XCTAssertTrue(app.staticTexts["Location access is off"].waitForExistence(timeout: 5))
        let nearby = XCTAttachment(screenshot: app.screenshot())
        nearby.name = "Native nearby denied-permission state"
        nearby.lifetime = .keepAlways
        add(nearby)
        app.buttons["Done"].tap()
        XCTAssertTrue(search.exists)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        waitForLayout(in: app, expanded: true)
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].exists)
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search stations"].waitForExistence(timeout: 5))
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
        XCTAssertTrue(app.navigationBars["Search stations"].waitForExistence(timeout: 5))
        let sheetDismissed = NSPredicate(format: "exists == false")
        expectation(for: sheetDismissed, evaluatedWith: app.buttons["Done"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("Times") == true)
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertGreaterThan(app.buttons["searchButton"].frame.midX, app.frame.midX)
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false)
        XCTAssertTrue(app.navigationBars["StandClear"].waitForExistence(timeout: 5))
        let nearbyIsReady = NSPredicate(format: "hittable == true")
        expectation(for: nearbyIsReady, evaluatedWith: app.buttons["nearbyButton"])
        waitForExpectations(timeout: 5)
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        expectation(for: sheetDismissed, evaluatedWith: app.buttons["Done"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertFalse(app.navigationBars["Search stations"].exists)
    }

    @MainActor
    private func waitForLayout(in app: XCUIApplication, expanded: Bool) {
        // Rotation can return before the simulator window and accessibility frames
        // settle. Check geometry before asking XCTest to calculate a hit point.
        let ready = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                let window = app.windows.firstMatch
                let search = app.buttons["searchButton"]
                guard window.exists, search.exists else { return false }
                let bounds = window.frame
                let frame = search.frame
                guard bounds.width > 0, bounds.height > 0,
                      (bounds.width > bounds.height) == expanded,
                      frame.width > 0, frame.height > 0,
                      bounds.contains(frame),
                      !expanded || frame.midX > bounds.midX
                else { return false }
                return search.isHittable
            }
        }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 20)
    }
}
