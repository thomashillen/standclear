import CoreLocation
import XCTest

final class StandClearUITests: XCTestCase {
    @MainActor
    func testNearbyAutomaticallyOpensForGrantedLocation() {
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
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 30))
        let station = app.buttons["station-127"]
        XCTAssertTrue(station.waitForExistence(timeout: 10), "Times Square should be nearby the simulated location")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "Automatic nearby arrivals with granted location"
        capture.lifetime = .keepAlways
        add(capture)
        app.buttons["Done"].tap()
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.navigationBars["Search stations"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists, "Automatic nearby must not interrupt manual search")
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
            if !option.exists {
                app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Map provider")).firstMatch.tap()
            }
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
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        let wideSearchReady = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                app.buttons["searchButton"].isHittable && app.buttons["searchButton"].frame.midX > app.frame.midX
            }
        }
        expectation(for: wideSearchReady, evaluatedWith: app)
        waitForExpectations(timeout: 5)
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
        XCTAssertTrue(app.navigationBars["StandClear"].waitForExistence(timeout: 5))
        app.buttons["searchButton"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        let field = app.searchFields.firstMatch
        field.tap()
        field.typeText("Times")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.navigationBars["Search stations"].waitForExistence(timeout: 5))
        let sheetDismissed = NSPredicate(format: "exists == false")
        expectation(for: sheetDismissed, evaluatedWith: app.buttons["Done"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue((app.searchFields.firstMatch.value as? String)?.contains("Times") == true)
        XCTAssertFalse(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertGreaterThan(app.buttons["searchButton"].frame.midX, app.frame.midX)
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.navigationBars["StandClear"].waitForExistence(timeout: 5))
        let nearbyIsReady = NSPredicate(format: "hittable == true")
        expectation(for: nearbyIsReady, evaluatedWith: app.buttons["nearbyButton"])
        waitForExpectations(timeout: 5)
        app.buttons["nearbyButton"].tap()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        expectation(for: sheetDismissed, evaluatedWith: app.buttons["Done"])
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].exists)
        XCTAssertFalse(app.navigationBars["Search stations"].exists)
    }
}
