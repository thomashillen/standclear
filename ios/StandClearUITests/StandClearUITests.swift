import CoreLocation
import XCTest

final class StandClearUITests: XCTestCase {
    private let unifiedSearchPrompt = "Address, place or station"

    @MainActor
    func testPlaceRouteCanCollapseRestoreAndClear() {
        checkPlaceRouteCollapse(accessibilityText: false)
    }

    @MainActor
    func testPlaceRouteCollapseAtLargestText() {
        checkPlaceRouteCollapse(accessibilityText: true)
    }

    @MainActor
    private func dragRouteSheet(in app: XCUIApplication, to heightFraction: CGFloat) {
        let grabber = app.buttons["Sheet Grabber"]
        XCTAssertTrue(grabber.waitForExistence(timeout: 5))
        // A swipe confined to the tiny grabber is too short to resize a sheet.
        let start = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: heightFraction))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
    }

    @MainActor
    private func checkPlaceRouteCollapse(accessibilityText: Bool) {
        let app = launchForMoreMenu(accessibilityText: accessibilityText)
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Madison\n")
        let result = app.buttons["placeResult-fixture-550-madison"]
        XCTAssertTrue(result.waitForExistence(timeout: 10)); result.tap()
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10)); origin.tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(picker, in: app) else { return }
        picker.typeText("Wall\n")
        let station = app.buttons["stationChoice-419"]
        revealPlaceElement(station, in: app.collectionViews.firstMatch); station.tap()
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@", "550 Madison Avenue", "Wall St"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        let route = map.value as? String
        let restore = app.buttons["restoreRoutePanel"]
        let clear = app.buttons["clearMapRoute"]
        if accessibilityText {
            app.buttons["collapseRoutePanel"].tap()
        } else {
            let grabber = app.buttons["Sheet Grabber"]
            XCTAssertTrue(grabber.waitForExistence(timeout: 5))
            // Endpoint search can leave the sheet at its large detent.
            // Exercise the actual medium-to-small gesture from a known state.
            if grabber.value as? String == "Full screen" {
                grabber.swipeDown()
            }
            print("Route gesture starting detent: \(grabber.value ?? "unknown")")
            let beforeDrag = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            beforeDrag.name = "Route sheet immediately before collapse gesture"
            beforeDrag.lifetime = .keepAlways; add(beforeDrag)
            dragRouteSheet(in: app, to: 0.94)
        }
        XCTAssertTrue(restore.waitForExistence(timeout: 5), "Dragging down collapses instead of canceling the trip")
        XCTAssertEqual(map.value as? String, route)
        XCTAssertFalse(origin.isHittable, "Collapsed steps must not accept interaction")
        XCTAssertGreaterThanOrEqual(restore.frame.height, 44)
        XCTAssertGreaterThanOrEqual(clear.frame.height, 44)
        XCTAssertTrue(clear.isHittable)
        let collapsed = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        collapsed.name = accessibilityText ? "Collapsed place route at largest text" : "Place route retained after dragging down"
        collapsed.lifetime = .keepAlways; add(collapsed)
        if accessibilityText {
            restore.tap()
        } else {
            dragRouteSheet(in: app, to: 0.4)
        }
        XCTAssertTrue(origin.waitForExistence(timeout: 5))
        XCTAssertTrue(origin.label.contains("Wall St"))
        XCTAssertTrue(app.buttons["placeDestinationPicker"].label.contains("550 Madison Avenue"))
        XCTAssertEqual(map.value as? String, route)
        app.buttons["collapseRoutePanel"].tap()
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        restore.tap()
        XCTAssertTrue(origin.waitForExistence(timeout: 5))
        app.buttons["collapseRoutePanel"].tap()
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        if !accessibilityText {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true, readyControl: "placeOriginPicker")
            XCTAssertTrue(origin.label.contains("Wall St"))
            XCTAssertEqual(map.value as? String, route)
            XCUIDevice.shared.orientation = .portrait
            XCTAssertTrue(restore.waitForExistence(timeout: 10))
            XCTAssertEqual(map.value as? String, route)
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertTrue(restore.waitForExistence(timeout: 10))
            XCTAssertEqual(map.value as? String, route)
        }
        clear.tap()
        XCTAssertTrue(restore.waitForNonExistence(timeout: 5))
        XCTAssertFalse(clear.exists)
        XCTAssertFalse((map.value as? String ?? "").contains("550 Madison Avenue"))
        let canceled = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        canceled.name = accessibilityText ? "Cleared collapsed route at largest text" : "Collapsed route canceled independently"
        canceled.lifetime = .keepAlways; add(canceled)
    }

    @MainActor
    func testStationRouteCanRestoreStepsAfterShowingMap() {
        checkStationRoutePresentation(fromSearch: false)
    }

    @MainActor
    func testStationRouteBackDoesNotReplayAfterLayoutChanges() {
        checkStationRoutePresentation(fromSearch: true)
    }

    @MainActor
    func testLineRouteBackThenNewStationClearsOldTrip() {
        checkStationRoutePresentation(fromSearch: false, fromLines: true)
    }

    @MainActor
    private func checkStationRoutePresentation(fromSearch: Bool, fromLines: Bool = false) {
        let app = launchForMoreMenu(arguments: ["--ui-test-noguchi"])
        defer { XCUIDevice.shared.orientation = .portrait }
        let fromBrowser = fromSearch || fromLines
        if fromLines {
            app.buttons["moreButton"].tap(); app.buttons["linesButton"].tap()
            let line = app.buttons["line-N"]
            XCTAssertTrue(line.waitForExistence(timeout: 10)); line.tap()
            let broadway = app.buttons["lineStation-R05"]
            revealPlaceElement(broadway, in: app.collectionViews["lineStationList"]); broadway.tap()
            XCTAssertTrue(app.buttons["directionsHere"].waitForExistence(timeout: 5))
            app.buttons["directionsHere"].tap()
        } else if fromSearch {
            app.buttons["searchButton"].tap()
            let field = app.searchFields[unifiedSearchPrompt]
            guard focusSearchField(field, in: app) else { return }
            field.typeText("Broadway\n")
            selectSearchResult("R05", query: "Broadway", in: app)
            app.buttons["directionsHere"].tap()
        } else {
            app.buttons["moreButton"].tap(); app.buttons["directionsButton"].tap()
        }
        let endpoints = fromBrowser ? [("originPicker", "Wall", "419")] : [("originPicker", "Wall", "419"), ("destinationPicker", "Broadway", "R05")]
        for (picker, query, id) in endpoints {
            let button = app.buttons[picker]
            XCTAssertTrue(button.waitForExistence(timeout: 10)); button.tap()
            let field = app.searchFields["Search subway stations"]
            guard focusSearchField(field, in: app) else { return }
            field.typeText(query + "\n"); selectStationResult(id, query: query, in: app)
        }
        let plan = app.buttons["tripPlan-4:N:419>629|N:N:R11>R05"]
        XCTAssertTrue(plan.waitForExistence(timeout: 10)); plan.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 5))
        app.buttons["showStationRouteOnMap"].tap()
        let restore = app.buttons["restoreRoutePanel"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let interchange = "Change to N/W at Lexington Av/59 St"
        XCTAssertTrue((map.value as? String ?? "").contains(interchange))
        let collapsed = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        collapsed.name = "Collapsed station itinerary retains named transfer"
        collapsed.lifetime = .keepAlways; add(collapsed)
        restore.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 5))
        XCTAssertTrue((map.value as? String ?? "").contains(interchange))
        app.navigationBars["Trip details"].buttons.firstMatch.tap()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "originPicker")
        XCTAssertFalse(app.navigationBars["Trip details"].isHittable, "Back to route choices must not replay steps on widening")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        if fromBrowser {
            app.navigationBars["Directions"].buttons.firstMatch.tap()
            let returnedToStation = app.buttons["directionsHere"].waitForExistence(timeout: 5)
            let failedCheckReturnedAt = returnedToStation ? nil : Date.now.timeIntervalSince1970
            XCTAssertTrue(returnedToStation)
            if let failedCheckReturnedAt {
                captureStationRouteFailure("Directions Back did not reveal station details", result: String(returnedToStation), returnedAt: failedCheckReturnedAt, in: app)
            }
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true, readyControl: "directionsHere")
            XCTAssertFalse(app.buttons["originPicker"].isHittable, "Back to station details must not reopen Directions")
            XCUIDevice.shared.orientation = .portrait
            XCTAssertTrue(app.buttons["directionsHere"].waitForExistence(timeout: 10))
            app.navigationBars["Broadway"].buttons.firstMatch.tap()
            if fromLines {
                let next = app.buttons["lineStation-R09"]
                revealPlaceElement(next, in: app.collectionViews["lineStationList"]); next.tap()
                XCTAssertTrue(app.navigationBars["Queensboro Plaza"].waitForExistence(timeout: 5))
            } else {
                let field = app.searchFields[unifiedSearchPrompt]
                guard focusSearchField(field, in: app) else { return }
                let clear = field.buttons["Clear text"]
                if clear.exists {
                    clear.tap()
                }
                field.typeText("Wall\n")
                selectSearchResult("419", query: "Wall", in: app)
                XCTAssertTrue(app.navigationBars["Wall St"].waitForExistence(timeout: 5))
            }
            expectation(for: NSPredicate(format: "NOT value CONTAINS %@", interchange), evaluatedWith: map)
            waitForExpectations(timeout: 10)
            assertStationEndpointsCleared(["Board at Wall St", interchange, "Arrive at Broadway"], in: app)
            let stationCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            stationCapture.name = fromLines ? "New Lines station with native Done control" : "New Search station with native Done control"
            stationCapture.lifetime = .keepAlways; add(stationCapture)
            app.buttons["Done"].tap()
            let focused = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            focused.name = fromLines ? "Explicit new Lines station clears trip and focuses Queensboro Plaza" : "Explicit new Search station clears trip and focuses Wall St"
            focused.lifetime = .keepAlways; add(focused)
            return
        }
        revealPlaceElement(plan, in: app.collectionViews["directionsList"])
        plan.tap()
        XCTAssertTrue(app.navigationBars["Trip details"].waitForExistence(timeout: 5))
        app.buttons["showStationRouteOnMap"].tap()
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "showStationRouteOnMap")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(restore.waitForExistence(timeout: 10))
        XCTAssertTrue((map.value as? String ?? "").contains(interchange))
        app.buttons["clearMapRoute"].tap()
        XCTAssertTrue(restore.waitForNonExistence(timeout: 5))
        XCTAssertFalse((map.value as? String ?? "").contains(interchange))
        app.buttons["moreButton"].tap(); app.buttons["directionsButton"].tap()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["originPicker"].label.contains("Wall St"))
        XCTAssertTrue(app.buttons["destinationPicker"].label.contains("Broadway"))
    }

    @MainActor
    func testAdvisoryRouteBulletsPreserveDisclosureAndText() {
        checkAdvisoryRouteBullets(accessibilityText: false)
    }

    @MainActor
    func testAdvisoryRouteBulletsAtLargestText() {
        checkAdvisoryRouteBullets(accessibilityText: true)
    }

    @MainActor
    private func checkAdvisoryRouteBullets(accessibilityText: Bool) {
        let app = launchForMoreMenu(accessibilityText: accessibilityText, arguments: ["--ui-test-route-bullets"])
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["moreButton"].tap()
        app.buttons["serviceAlertsButton"].tap()
        let list = app.collectionViews["systemAlertsList"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let advisory = list.buttons["serviceAlert-fixture-wall"]
        revealPlaceElement(advisory, in: list)
        XCTAssertTrue(advisory.label.contains("Fixture advisory for Route 2 Route 3, Route F, and Route Franklin Avenue Shuttle"))
        XCTAssertTrue(advisory.label.contains("UNKNOWN-LONG-ROUTE"))
        XCTAssertTrue(advisory.label.contains("42 Street Shuttle"))
        let collapsed = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        collapsed.name = accessibilityText ? "Route bullets at largest text" : "Route bullets and literal unknown route"
        collapsed.lifetime = .keepAlways
        add(collapsed)
        advisory.tap()
        let body = list.staticTexts.matching(NSPredicate(format: "label == %@", "Take Route 1 or Route 6 Express. Route Franklin Avenue Shuttle, Route 42 Street Shuttle, and Route Rockaway Park Shuttle retain their names. Keep [AX] and [planned] literal.")).firstMatch
        revealPlaceElement(body, in: list)
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expanded.name = accessibilityText ? "Inline advisory bullets at largest text" : "Inline advisory bullets in native text"
        expanded.lifetime = .keepAlways
        add(expanded)
        if accessibilityText {
            let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            start.press(forDuration: 0.08, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -150)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
            let tail = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            tail.name = "Literal advisory text after inline bullets at largest text"
            tail.lifetime = .keepAlways
            add(tail)
        }
        if !accessibilityText {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true)
            // The native disclosure begins closed in its new sidebar presentation.
            revealPlaceElement(advisory, in: list, downward: false)
            advisory.tap()
            revealPlaceElement(body, in: list)
            XCTAssertTrue(body.waitForExistence(timeout: 5))
            let wide = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            wide.name = "Expanded native advisory bullets"
            wide.lifetime = .keepAlways
            add(wide)
        }
        // Native disclosure headers may exceed the viewport at large text sizes.
        // Activate the visible portion below the pinned navigation bar rather
        // than asking XCTest for an offscreen header's center activation point.
        var activatedHeader = false
        for _ in 0 ..< 18 {
            let bounds = list.frame
            let top = max(bounds.minY, app.navigationBars["Service alerts"].frame.maxY)
            let content = CGRect(x: bounds.minX, y: top, width: bounds.width, height: max(0, bounds.maxY - top))
            let header = advisory.frame
            let visibleHeader = header.intersection(content)
            if !visibleHeader.isNull, visibleHeader.width >= 44, visibleHeader.height >= 44 {
                let window = app.windows.firstMatch
                window.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: visibleHeader.midX - window.frame.minX, dy: visibleHeader.midY - window.frame.minY)).tap()
                activatedHeader = true
                break
            }
            let start = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0.08, thenDragTo: start.withOffset(CGVector(dx: 0, dy: header.maxY <= top ? 150 : -150)),
                        withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTAssertTrue(activatedHeader, "The disclosure header must be visible before it can be closed")
        XCTAssertTrue(body.waitForNonExistence(timeout: 5), "Native disclosure must still collapse the advisory")
        let closed = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        closed.name = accessibilityText ? "Closed advisory at largest text" : "Closed advisory in expanded controls"
        closed.lifetime = .keepAlways
        add(closed)
    }

    @MainActor
    private func arrivalFeedUpdate(in app: XCUIApplication) -> String {
        app.buttons["moreButton"].tap()
        app.buttons["arrivalStatusButton"].tap()
        let alert = app.alerts["Arrival status"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        let text = alert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Feed updated")).firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        let report = text.label
        alert.buttons["OK"].tap()
        return report
    }

    @MainActor
    private func observeThreeMinuteArrival(_ row: XCUIElement, renewLocation: Bool = false) {
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        let start = Date()
        var samples: [String] = []
        var lastLocationUpdate = start
        let observed = NSPredicate { _, _ in MainActor.assumeIsolated {
            if renewLocation, Date().timeIntervalSince(lastLocationUpdate) >= 10 {
                XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7076, longitude: -74.0113))
                lastLocationUpdate = Date()
            }
            samples.append(row.exists ? row.label : "Arrival row missing")
            return Date().timeIntervalSince(start) >= 26
        } }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: observed, object: row)], timeout: 35), .completed)
        let record = XCTAttachment(string: samples.joined(separator: "\n"))
        record.name = "Wall St northbound 4 countdown samples over fixture refreshes"
        record.lifetime = .keepAlways
        add(record)
        XCTAssertGreaterThan(samples.count, 3)
        XCTAssertTrue(samples.allSatisfy { $0.contains("3 min") && !$0.contains("4 min") },
                      "Each fresh fixture prediction is exactly three minutes away: \(samples)")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Wall St prediction after repeated feed refreshes"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testStationCountdownUsesTimeOfRefreshedPrediction() {
        let app = launchForMoreMenu()
        let initial = arrivalFeedUpdate(in: app)
        app.buttons["searchButton"].tap()
        let search = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(search, in: app) else { return }
        search.typeText("Wall\n")
        selectSearchResult("419", query: "Wall", in: app)
        let row = app.collectionViews["stationArrivalsList"].buttons["arrivalRow-ui-fixture-4-n:419:N"]
        observeThreeMinuteArrival(row)
        app.buttons["Done"].tap()
        XCTAssertNotEqual(arrivalFeedUpdate(in: app), initial, "The observation must span actual feed refreshes")
    }

    @MainActor
    func testNearbyAndGlanceCountdownUseTimeOfRefreshedPrediction() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7076, longitude: -74.0113))
        defer {
            XCUIDevice.shared.location = nil
            XCUIDevice.shared.orientation = .portrait
        }
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Allow While Using App"].exists else { return false }
            alert.buttons["Allow While Using App"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        let initial = arrivalFeedUpdate(in: app)
        let glance = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "glance-419:")).firstMatch
        observeThreeMinuteArrival(glance, renewLocation: true)
        XCTAssertNotEqual(arrivalFeedUpdate(in: app), initial)
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(latitude: 40.7076, longitude: -74.0113))
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        app.buttons["nearbyButton"].tap()
        let beforeNearby = arrivalFeedUpdate(in: app)
        let row = app.collectionViews["stationList"].buttons["arrivalRow-ui-fixture-4-n:419:N"]
        observeThreeMinuteArrival(row, renewLocation: true)
        XCTAssertNotEqual(arrivalFeedUpdate(in: app), beforeNearby)
    }

    @MainActor
    func testTemporalTrainMovesRelativeToReferenceAndResumesAfterBackground() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-temporal-motion"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        XCTAssertTrue(map.waitForExistence(timeout: 10))
        map.pinch(withScale: 2, velocity: 1)
        let train = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Route 1 train. Estimated position.")).firstMatch
        let reference = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Route 4 train. Estimated position.")).firstMatch
        XCTAssertTrue(train.waitForExistence(timeout: 10))
        XCTAssertTrue(reference.waitForExistence(timeout: 10))

        func observeMovement(_ visit: String) {
            let start = train.frame
            let fixed = reference.frame
            XCTAssertGreaterThan(start.width, 0)
            XCTAssertGreaterThan(fixed.width, 0)
            let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            before.name = "Temporal train before movement — \(visit)"
            before.lifetime = .keepAlways
            add(before)
            let moves = NSPredicate { _, _ in MainActor.assumeIsolated {
                guard train.exists, reference.exists else { return false }
                let next = train.frame
                let stationary = reference.frame
                return hypot(next.midX - start.midX, next.midY - start.midY) > 1 &&
                    hypot(stationary.midX - fixed.midX, stationary.midY - fixed.midY) < 0.5
            } }
            expectation(for: moves, evaluatedWith: train)
            waitForExpectations(timeout: 16)
            let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            after.name = "Temporal train advanced against fixed reference — \(visit)"
            after.lifetime = .keepAlways
            add(after)
        }

        observeMovement("initial foreground")
        XCUIDevice.shared.press(.home)
        let backgrounded = NSPredicate { _, _ in MainActor.assumeIsolated {
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        } }
        expectation(for: backgrounded, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        app.activate()
        XCTAssertTrue(train.waitForExistence(timeout: 10))
        XCTAssertTrue(reference.waitForExistence(timeout: 10))
        observeMovement("foreground reentry")
    }

    @MainActor
    func testTemporalStaleEvidenceRemovesTrainDespiteRepeatedRequests() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-temporal-motion", "--ui-test-temporal-motion-stale"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        XCTAssertTrue(map.waitForExistence(timeout: 10))
        let train = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Route 1 train. Estimated position.")).firstMatch
        let reference = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Route 4 train. Estimated position.")).firstMatch
        XCTAssertTrue(train.waitForExistence(timeout: 10))
        XCTAssertTrue(reference.waitForExistence(timeout: 10))
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: train)
        waitForExpectations(timeout: 65)
        XCTAssertTrue(map.exists)
        XCTAssertFalse(reference.exists)
        let expired = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expired.name = "Expired temporal source removes train markers despite repeated requests"
        expired.lifetime = .keepAlways
        add(expired)
    }

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
    func testSystemAlertsFromMoreRetainBothServicesThroughFailedRetry() {
        let app = launchForMoreMenu(arguments: ["--ui-test-alert-recovery"])
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["moreButton"].tap()
        app.buttons["serviceAlertsButton"].tap()
        let list = app.collectionViews["systemAlertsList"]
        let wall = list.buttons["serviceAlert-fixture-wall"]
        let express = list.buttons["serviceAlert-fixture-express"]
        let retry = list.buttons["systemAlertsRetry"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        revealPlaceElement(wall, in: list)
        XCTAssertTrue(wall.label.contains("Wall St"))
        revealPlaceElement(express, in: list)
        XCTAssertTrue(express.label.contains("Pelham Bay Park"))
        express.tap()
        let description = list.staticTexts["Allow extra travel time for express service."]
        XCTAssertTrue(description.waitForExistence(timeout: 5))
        express.tap()
        revealPlaceElement(retry, in: list, downward: false)
        retry.tap()
        let unavailable = list.staticTexts["Service alerts unavailable"]
        XCTAssertTrue(unavailable.waitForExistence(timeout: 10))
        revealPlaceElement(wall, in: list)
        XCTAssertTrue(wall.label.contains("Wall St"))
        revealPlaceElement(express, in: list)
        XCTAssertTrue(express.label.contains("Pelham Bay Park"))
        revealPlaceElement(retry, in: list, downward: false)
        retry.tap()
        XCTAssertTrue(unavailable.waitForNonExistence(timeout: 10))
        XCTAssertFalse(retry.exists)
        XCTAssertFalse(list.descendants(matching: .any)["systemAlertsEmpty"].exists)

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        XCTAssertTrue(list.waitForExistence(timeout: 5), "The alert list should follow the active pane")
        app.buttons["moreButton"].tap()
        app.buttons["serviceAlertsButton"].tap()
        XCTAssertTrue(wall.exists, "Reopening the selected pane must preserve its report")
        revealPlaceElement(express, in: list)
        express.tap()
        revealPlaceElement(description, in: list)
        XCTAssertTrue(description.waitForExistence(timeout: 5))
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Expanded system service alert details"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testSystemAlertsDistinguishFreshAndStaleEmptyAtLargestText() {
        let app = launchForMoreMenu(accessibilityText: true, arguments: ["--ui-test-empty-alerts", "--ui-test-stale-alerts"])
        let list = app.collectionViews["systemAlertsList"]
        let empty = list.descendants(matching: .any)["systemAlertsEmpty"].firstMatch
        let retry = list.buttons["systemAlertsRetry"]
        app.buttons["moreButton"].tap()
        app.buttons["serviceAlertsButton"].tap()
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertFalse(empty.exists, "An old empty report cannot establish that there are no advisories")

        app.terminate()
        app.launchArguments.removeAll { $0 == "--ui-test-stale-alerts" }
        app.launch()
        let more = app.buttons["moreButton"]
        XCTAssertTrue(more.waitForExistence(timeout: 15))
        more.tap()
        app.buttons["serviceAlertsButton"].tap()
        XCTAssertTrue(empty.waitForExistence(timeout: 10))
        XCTAssertFalse(retry.exists)
        XCTAssertTrue(app.buttons["systemAlertsRefresh"].exists)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Current empty system advisory report at largest accessibility text"
        capture.lifetime = .keepAlways
        add(capture)
    }

    @MainActor
    func testAdvisoryWindowRequiresCurrentReportAcrossLayouts() {
        let app = launchForMoreMenu(arguments: ["--ui-test-alert-recovery"])
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["moreButton"].tap()
        app.buttons["serviceAlertsButton"].tap()
        let list = app.collectionViews["systemAlertsList"]
        let wall = list.buttons["serviceAlert-fixture-wall"]
        // A native disclosure may combine its caption into the button's accessible label.
        let window = list.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR (identifier == %@ AND label CONTAINS %@)",
            "alertWindow-fixture-wall", "serviceAlert-fixture-wall", "Reported alert display window"
        )).firstMatch
        let retry = list.buttons["systemAlertsRetry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        revealPlaceElement(wall, in: list)
        XCTAssertTrue(wall.label.contains("Wall St"))
        XCTAssertFalse(window.exists, "A retained stale advisory cannot establish a current reported window")
        revealPlaceElement(retry, in: list, downward: false)
        retry.tap()
        let unavailable = list.staticTexts["Service alerts unavailable"]
        XCTAssertTrue(unavailable.waitForExistence(timeout: 10))
        revealPlaceElement(wall, in: list)
        XCTAssertTrue(wall.label.contains("Wall St"), "Failed refresh must retain the reported advisory")
        XCTAssertFalse(window.exists, "Failed refresh must not revive a previously reported window")
        revealPlaceElement(retry, in: list, downward: false)
        retry.tap()
        XCTAssertTrue(unavailable.waitForNonExistence(timeout: 10))
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        revealPlaceElement(window, in: list)
        XCTAssertTrue(window.label.contains("Reported"))
        XCTAssertTrue(window.label.contains("New York"), "VoiceOver must identify the time zone of the reported end")
        XCTAssertTrue(window.label.contains("Not a guaranteed service restoration time"))
        XCTAssertFalse(list.descendants(matching: .any)["alertWindow-fixture-express"].exists,
                       "An advisory without a reported end must not acquire a countdown")
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "Current reported advisory window in compact layout"
        compact.lifetime = .keepAlways
        add(compact)

        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        revealPlaceElement(window, in: list)
        XCTAssertTrue(window.label.contains("New York"))
        XCTAssertFalse(retry.exists)
        revealPlaceElement(wall, in: list)
        wall.tap()
        let description = list.staticTexts["Allow extra travel time at Wall St."]
        XCTAssertTrue(description.waitForExistence(timeout: 5), "Timing must preserve access to actual advisory details")
        revealPlaceElement(description, in: list)
        let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expanded.name = "Expanded reported advisory window and details"
        expanded.lifetime = .keepAlways
        add(expanded)
    }

    @MainActor
    func testAdvisoryWindowAndDetailsAtLargestAccessibilityText() {
        let app = launchForMoreMenu(accessibilityText: true, arguments: ["--ui-test-alert-window-absolute"])
        defer { XCUIDevice.shared.orientation = .portrait }
        app.buttons["moreButton"].tap()
        app.buttons["serviceAlertsButton"].tap()
        let list = app.collectionViews["systemAlertsList"]
        // A native disclosure may combine its caption into the button's accessible label.
        let window = list.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR (identifier == %@ AND label CONTAINS %@)",
            "alertWindow-fixture-wall", "serviceAlert-fixture-wall", "Reported alert display window"
        )).firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10))
        let caption = list.staticTexts["alertWindow-fixture-wall"].firstMatch
        revealPlaceElement(caption.exists ? caption : window, in: list)
        XCTAssertTrue(window.label.contains("Reported"))
        XCTAssertTrue(window.label.contains("New York"))
        XCTAssertTrue(window.label.contains("Not a guaranteed service restoration time"))
        XCTAssertGreaterThan(window.frame.height, 0)
        XCTAssertTrue(list.frame.intersects(window.frame), "Reported timing must remain readable in the native scrolling list")
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Reported advisory window at largest accessibility text"
        capture.lifetime = .keepAlways
        add(capture)
        let wall = list.buttons["serviceAlert-fixture-wall"]
        XCTAssertTrue(wall.isEnabled)
        if caption.exists {
            caption.tap()
        } else {
            wall.tap()
        }
        let description = list.staticTexts["Allow extra travel time at Wall St."]
        XCTAssertTrue(description.waitForExistence(timeout: 5))
        revealPlaceElement(description, in: list)
        XCTAssertTrue(description.exists, "The native disclosure must retain full advisory details at largest text")
        let details = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        details.name = "Largest text advisory details after expanding its timing caption"
        details.lifetime = .keepAlways
        add(details)
    }

    @MainActor
    func testStationAdvisorySurvivesFailedRetryAndRecovers() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-alert-recovery"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let search = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(search, in: app) else { return }
        search.typeText("Wall\n")
        selectSearchResult("419", query: "Wall", in: app)
        let list = app.collectionViews["stationArrivalsList"]
        let retry = list.buttons["stationAlertsRetry"]
        let summary = list.buttons["stationAlertsSummary"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertTrue(summary.label.contains("1 severe"))
        retry.tap()
        let unavailable = list.staticTexts["Service alerts unavailable"]
        XCTAssertTrue(unavailable.waitForExistence(timeout: 10))
        XCTAssertTrue(summary.exists, "A failed advisory request must retain the last reported severe advisory")
        XCTAssertTrue(list.staticTexts["stationAlertLastReport"].exists, "Retained advisories must keep their last-report time")
        if summary.exists {
            summary.tap()
            let body = list.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Allow extra travel time at Wall St.")).firstMatch
            XCTAssertTrue(body.waitForExistence(timeout: 5))
            summary.tap()
        }
        let failure = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        failure.name = "Last reported station advisory after a failed retry"
        failure.lifetime = .keepAlways
        add(failure)
        XCTAssertTrue(list.buttons["arrivalRow-ui-fixture-4-n:419:N"].exists)
        retry.tap()
        XCTAssertTrue(unavailable.waitForNonExistence(timeout: 10), "Recovery requires a successful replacement response")
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertFalse(unavailable.exists)
        XCTAssertFalse(list.staticTexts["Alert status unconfirmed"].exists)
        XCTAssertFalse(retry.exists, "A successful current report should replace the failed-request state")
        XCTAssertFalse(list.staticTexts["stationAlertLastReport"].exists)
        summary.tap()
        let currentAdvisory = list.staticTexts["alertWindow-fixture-wall"].firstMatch
        XCTAssertTrue(currentAdvisory.waitForExistence(timeout: 5))
        XCTAssertTrue(currentAdvisory.label.contains("Reported alert display window"))
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
    func testSearchFavoriteActionsPreserveNavigationAndHomeAcrossLayouts() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        let search = app.buttons["searchButton"]
        search.tap()
        let home = app.buttons["savedPlace-Home"]
        let field = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        // Leave an unrelated preexisting Home untouched.
        let previousHome = home.exists ? home.label : nil
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Wall\n")
        let wall = app.buttons["station-419"]
        let toggle = app.buttons["searchFavoriteToggle-419"]
        let detail = app.navigationBars["Wall St"]
        XCTAssertTrue(wall.waitForExistence(timeout: 10))
        wall.press(forDuration: 1)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        if toggle.label == "Remove from favorites" {
            toggle.tap()
            XCTAssertTrue(toggle.waitForNonExistence(timeout: 5))
            wall.press(forDuration: 1)
            XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        }
        XCTAssertEqual(toggle.label, "Add to favorites")
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "Add a station favorite from compact Search"
        compact.lifetime = .keepAlways
        add(compact)
        toggle.tap()
        XCTAssertTrue(toggle.waitForNonExistence(timeout: 5))
        XCTAssertTrue(wall.label.contains("Favorite"))
        XCTAssertEqual(field.value as? String, "Wall")
        XCTAssertFalse(detail.exists)
        selectSearchResult("419", query: "Wall", in: app)
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        let anchors = app.buttons["stationAnchorMenu"]

        app.terminate()
        app.launch()
        let nearby = app.buttons["nearbyButton"]
        XCTAssertTrue(nearby.waitForExistence(timeout: 15))
        nearby.tap()
        XCTAssertTrue(app.navigationBars["Nearby arrivals"].waitForExistence(timeout: 5))
        app.buttons["Sheet Grabber"].doubleTap()
        let list = app.collectionViews["stationList"]
        XCTAssertTrue(list.buttons["favoriteStation-419"].waitForExistence(timeout: 10))
        XCTAssertTrue(list.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", [
            "Location access is off", "Location unavailable", "Waiting for your location…",
        ])).firstMatch.exists)
        // Prove Search alone persisted the favorite before assigning Home,
        // which would otherwise independently favorite the same station.
        list.buttons["favoriteStation-419"].tap()
        XCTAssertTrue(detail.waitForExistence(timeout: 5))
        anchors.tap()
        let wallWasHome = app.buttons["Remove Home"].exists
        if previousHome == nil, !wallWasHome {
            app.buttons["Set as Home"].tap()
        }
        detail.staticTexts["Wall St"].tap()
        app.buttons["Done"].tap()
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        search.tap()
        let recent = app.buttons["recentStation-419"]
        revealPlaceElement(recent, in: list)
        let emptyQuery = field.value as? String
        XCTAssertTrue(recent.label.contains("Favorite"))
        recent.press(forDuration: 1)
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        XCTAssertEqual(toggle.label, "Remove from favorites")
        toggle.tap()
        XCTAssertTrue(toggle.waitForNonExistence(timeout: 5))
        XCTAssertTrue(recent.exists)
        XCTAssertFalse(recent.label.contains("Favorite"))
        XCTAssertTrue(field.exists)
        XCTAssertEqual(field.value as? String, emptyQuery)
        XCTAssertFalse(detail.exists)
        let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        expanded.name = "Recent station stays in expanded Search after removing favorite"
        expanded.lifetime = .keepAlways
        add(expanded)

        // Reopen at the native list top rather than using the route-preview
        // scrolling helper in Search's short landscape region.
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        if previousHome == nil || wallWasHome {
            XCTAssertTrue(home.label.contains("Wall St"))
            home.tap()
            XCTAssertTrue(detail.waitForExistence(timeout: 5))
            anchors.tap()
            XCTAssertEqual(app.buttons["favoriteStationToggle"].label, "Add to favorites")
            if previousHome == nil {
                app.buttons["Remove Home"].tap()
            }
        } else {
            XCTAssertEqual(home.label, previousHome)
        }
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
        XCTAssertTrue(warning.label.contains("Reported alert display window"), "Line advisories must share the reported timing context")
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
    func testIdenticalPlaceOriginClearsRouteAndRecoversAcrossLayouts() {
        checkIdenticalPlaceOrigin(largeType: false)
    }

    @MainActor
    func testIdenticalPlaceOriginAtLargestType() {
        checkIdenticalPlaceOrigin(largeType: true)
    }

    @MainActor
    private func checkIdenticalPlaceOrigin(largeType: Bool) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        if largeType {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        app.buttons["searchButton"].tap()
        let field = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(field, in: app) else { return }
        field.typeText("Noguchi\n")
        let museum = app.buttons["placeResult-fixture-noguchi"]
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        museum.tap()

        func chooseOrigin(_ query: String, resultID: String) -> Bool {
            let origin = app.buttons["placeOriginPicker"]
            XCTAssertTrue(origin.waitForExistence(timeout: 10))
            revealPlaceElement(origin, in: app.collectionViews["placePreviewList"], downward: false)
            origin.tap()
            let search = app.searchFields[unifiedSearchPrompt]
            guard focusSearchField(search, in: app) else { return false }
            search.typeText(query + "\n")
            let result = app.buttons[resultID]
            // At accessibility sizes the address section can put the station
            // outside the List's realized rows. Scroll to its exact identity.
            revealPlaceElement(result, in: app.collectionViews.firstMatch)
            guard result.waitForExistence(timeout: 10) else { XCTFail("Origin result unavailable: \(resultID)"); return false }
            result.tap()
            return true
        }

        guard chooseOrigin("Wall", resultID: "stationChoice-419") else { return }
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        expectation(for: NSPredicate(format: "value CONTAINS %@", "N/W"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        guard chooseOrigin("Noguchi", resultID: "placeOriginResult-fixture-noguchi") else { return }
        let title = app.staticTexts["Same place"]
        let found = title.waitForExistence(timeout: 10)
        XCTAssertTrue(found, "Identical endpoints must show the native same-endpoint state")
        guard found else { return }
        let recovery = app.staticTexts["Choose a different starting point to plan a trip."]
        revealPlaceElement(recovery, in: app.collectionViews["placePreviewList"])
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        before.name = "Identical place endpoints — largest text \(largeType)"
        before.lifetime = .keepAlways
        add(before)
        XCTAssertTrue(app.descendants(matching: .any)["samePlaceRoute"].firstMatch.exists)
        XCTAssertFalse(app.staticTexts["No starting station nearby"].exists)
        XCTAssertFalse(app.staticTexts["No walk required"].exists)
        expectation(for: NSPredicate(format: "value == %@", "The Noguchi Museum"), evaluatedWith: map)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "placeRouteOption-")).firstMatch.exists)

        if !largeType {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true, readyControl: "placeOriginPicker")
            XCTAssertTrue(title.waitForExistence(timeout: 10))
            XCTAssertEqual(map.value as? String, "The Noguchi Museum")
            revealPlaceElement(recovery, in: app.collectionViews["placePreviewList"])
            let expanded = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            expanded.name = "Same-endpoint state in expanded native controls"
            expanded.lifetime = .keepAlways
            add(expanded)
            XCUIDevice.shared.orientation = .portrait
            waitForLayout(in: app, expanded: false, readyControl: "Done")
        }
        let grabber = app.buttons["Sheet Grabber"]
        if grabber.exists, grabber.value as? String == "Half screen" {
            grabber.doubleTap()
        }
        let origin = app.buttons["placeOriginPicker"]
        revealPlaceElement(origin, in: app.collectionViews["placePreviewList"], downward: false)
        origin.tap()
        let from = app.navigationBars["From"]
        XCTAssertTrue(from.waitForExistence(timeout: 10))
        from.buttons.firstMatch.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 10), "Cancelling origin editing must preserve the same-endpoint state")
        XCTAssertTrue(origin.label.contains("The Noguchi Museum"))
        guard chooseOrigin("Wall", resultID: "stationChoice-419") else { return }
        expectation(for: NSPredicate(format: "value CONTAINS %@", "N/W"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(origin.label.contains("Wall St"))
        XCTAssertFalse(app.descendants(matching: .any)["samePlaceRoute"].firstMatch.exists)
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
        let endpointsCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        endpointsCapture.name = expanded ? "Expanded route preview initial endpoints" : "Compact route preview initial endpoints"
        endpointsCapture.lifetime = .keepAlways
        add(endpointsCapture)
        origin.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let picker = app.searchFields[unifiedSearchPrompt]
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        let originCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        originCapture.name = expanded ? "Expanded From picker before search" : "Compact From picker before search"
        originCapture.lifetime = .keepAlways
        add(originCapture)
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
        let optionsCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        optionsCapture.name = expanded ? "Expanded route options from Wall St" : "Compact route options from Wall St"
        optionsCapture.lifetime = .keepAlways
        add(optionsCapture)
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
    func testPlaceDestinationEditingPreservesManualOrigin() {
        checkPlaceDestinationEditing(expanded: false, largeType: false)
    }

    @MainActor
    func testPlaceDestinationEditingExpanded() {
        checkPlaceDestinationEditing(expanded: true, largeType: false)
    }

    @MainActor
    func testPlaceDestinationEditingAtLargestType() {
        checkPlaceDestinationEditing(expanded: false, largeType: true)
    }

    @MainActor
    private func checkPlaceDestinationEditing(expanded: Bool, largeType: Bool) {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        if largeType {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        if expanded {
            XCUIDevice.shared.orientation = .landscapeLeft
            waitForLayout(in: app, expanded: true)
        }
        app.buttons["searchButton"].tap()
        let search = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(search, in: app) else { return }
        search.typeText("Noguchi\n")
        let museum = app.buttons["placeResult-fixture-noguchi"]
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        museum.tap()
        let list = app.collectionViews["placePreviewList"]
        let origin = app.buttons["placeOriginPicker"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10))
        revealPlaceElement(origin, in: list, downward: false)
        origin.tap()
        let fromSearch = app.searchFields[unifiedSearchPrompt]
        guard focusSearchField(fromSearch, in: app) else { return }
        fromSearch.typeText("55 Wall Street\n")
        let from = app.buttons["placeOriginResult-fixture-55-wall-street"]
        XCTAssertTrue(from.waitForExistence(timeout: 10))
        from.tap()
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@", "Noguchi", "Wall St"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        let previousRoute = map.value as? String
        let destination = app.buttons["placeDestinationPicker"]

        func openDestination() -> Bool {
            revealPlaceElement(destination, in: list, downward: false)
            destination.tap()
            return app.navigationBars["To"].waitForExistence(timeout: 10)
        }
        func chooseDestination(_ query: String, id: String) -> Bool {
            guard openDestination() else { XCTFail("Destination picker did not open"); return false }
            let field = app.searchFields["Address or place"]
            guard focusSearchField(field, in: app) else { return false }
            field.typeText(query + "\n")
            let result = app.buttons["placeDestinationResult-" + id]
            guard result.waitForExistence(timeout: 10) else { XCTFail("Destination result missing"); return false }
            revealPlaceElement(result, in: app.collectionViews.firstMatch)
            result.tap()
            return destination.waitForExistence(timeout: 10)
        }

        // Dismissing an in-progress destination search keeps the current trip.
        XCTAssertTrue(openDestination())
        let toSearch = app.searchFields["Address or place"]
        guard focusSearchField(toSearch, in: app) else { return }
        toSearch.typeText("Madison\n")
        XCTAssertTrue(app.buttons["placeDestinationResult-fixture-550-madison"].waitForExistence(timeout: 10))
        let pickerCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        pickerCapture.name = "Native destination search — expanded \(expanded), largest text \(largeType)"
        pickerCapture.lifetime = .keepAlways
        add(pickerCapture)
        // Active native search exposes its own Close button before navigation
        // Back. End search, then explicitly leave the endpoint picker.
        let closeSearch = app.navigationBars["To"].buttons["Close"]
        if closeSearch.exists {
            closeSearch.tap()
        }
        let back = app.navigationBars["To"].buttons["BackButton"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(destination.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("55 Wall Street"))
        XCTAssertEqual(map.value as? String, previousRoute)

        guard chooseDestination("Madison", id: "fixture-550-madison") else { return }
        XCTAssertTrue(destination.label.contains("550 Madison Avenue"))
        XCTAssertTrue(origin.label.contains("55 Wall Street"))
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@ AND NOT value CONTAINS %@", "550 Madison Avenue", "Wall St", "Noguchi"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        let updatedRoute = map.value as? String
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Edited native destination — expanded \(expanded), largest text \(largeType)"
        capture.lifetime = .keepAlways
        add(capture)
        // Choosing the existing destination is also a no-op for route selection.
        guard chooseDestination("Madison", id: "fixture-550-madison") else { return }
        XCTAssertEqual(map.value as? String, updatedRoute)
        XCUIDevice.shared.press(.home)
        let backgrounded = NSPredicate { _, _ in MainActor.assumeIsolated {
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        } }
        expectation(for: backgrounded, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        app.activate()
        XCTAssertTrue(destination.waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("55 Wall Street"))
        XCTAssertTrue(destination.label.contains("550 Madison Avenue"))
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@", "550 Madison Avenue", "Wall St"), evaluatedWith: map)
        waitForExpectations(timeout: 15)

        // A replacement equal to From removes the old route and can recover.
        guard chooseDestination("55 Wall Street", id: "fixture-55-wall-street") else { return }
        XCTAssertTrue(app.staticTexts["Same place"].waitForExistence(timeout: 10))
        XCTAssertTrue(origin.label.contains("55 Wall Street"))
        expectation(for: NSPredicate(format: "value == %@", "55 Wall Street"), evaluatedWith: map)
        waitForExpectations(timeout: 10)
        guard chooseDestination("Madison", id: "fixture-550-madison") else { return }
        expectation(for: NSPredicate(format: "value CONTAINS %@ AND value CONTAINS %@", "550 Madison Avenue", "Wall St"), evaluatedWith: map)
        waitForExpectations(timeout: 15)
        app.buttons["placeBackToSearch"].tap()
        XCTAssertTrue(museum.waitForExistence(timeout: 10))
        XCTAssertEqual(search.value as? String, "Noguchi", "Endpoint editing keeps the original Search visit")
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
        XCTAssertTrue(choice.label.contains("4 → N/W"), "Route bullets must retain the ordered transfer services")
        let routeOptions = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        routeOptions.name = "Ordered native route bullets for the Lexington Av transfer"
        routeOptions.lifetime = .keepAlways
        add(routeOptions)
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
        let endpoints = ["Board at Wall St", "Arrive at Astoria Blvd"]
        assertStationEndpoints(endpoints, in: app, expanded: expanded)
        app.buttons["clearMapRoute"].tap()
        assertStationEndpointsCleared(endpoints + [instruction], in: app)
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
        XCTAssertFalse(map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Board at Wall St")).firstMatch.exists,
                       "Place journeys must retain their existing platform marker rather than duplicate station-only endpoints")
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
            XCTAssertTrue(app.buttons["restoreRoutePanel"].waitForExistence(timeout: 5))
        }
        let mapCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        mapCapture.name = expanded ? "Station-entry route in expanded region" : "Station-entry route after sheet dismissal"
        mapCapture.lifetime = .keepAlways
        add(mapCapture)
        let clearRoute = app.buttons["clearMapRoute"]
        XCTAssertTrue(clearRoute.waitForExistence(timeout: 5))
        XCTAssertTrue(clearRoute.isHittable)
        clearRoute.tap()
        XCTAssertTrue(clearRoute.waitForNonExistence(timeout: 5), "One map action clears the selected route")
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
    func testClearedStationRouteStaysClearedAcrossLayoutsAndCanBeReselected() {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture", "--ui-test-noguchi"]
        addUIInterruptionMonitor(withDescription: "Location permission") { alert in
            guard alert.buttons["Don’t Allow"].exists else { return false }
            alert.buttons["Don’t Allow"].tap()
            return true
        }
        app.launch()
        activatePermissionPrompt(in: app)
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true)
        app.buttons["moreButton"].tap()
        app.buttons["directionsButton"].tap()
        for (picker, query, id) in [("originPicker", "Wall", "419"), ("destinationPicker", "Broadway", "R05")] {
            let button = app.buttons[picker]
            XCTAssertTrue(button.waitForExistence(timeout: 10))
            button.tap()
            let field = app.searchFields["Search subway stations"]
            guard focusSearchField(field, in: app) else { return }
            field.typeText(query + "\n")
            selectStationResult(id, query: query, in: app)
        }
        let plan = app.buttons["tripPlan-4:N:419>629|N:N:R11>R05"]
        func selectPlan() {
            let list = app.collectionViews["directionsList"]
            for _ in 0 ..< 4 where !plan.isHittable {
                list.swipeUp()
            }
            XCTAssertTrue(plan.waitForExistence(timeout: 10))
            XCTAssertTrue(plan.isHittable)
            plan.tap()
        }
        selectPlan()
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let interchange = "Change to N/W at Lexington Av/59 St"
        let labels = ["Board at Wall St", interchange, "Arrive at Broadway"]
        expectation(for: NSPredicate(format: "value CONTAINS %@", interchange), evaluatedWith: map)
        waitForExpectations(timeout: 10)
        assertStationEndpoints([labels[0], labels[2]], in: app, expanded: true)
        XCTAssertTrue(app.navigationBars["Trip details"].exists)
        app.buttons["clearMapRoute"].tap()
        assertStationEndpointsCleared(labels, in: app)
        func staysCleared(_ reason: String) -> Bool {
            let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", interchange), object: map)
            restored.isInverted = true
            let result = XCTWaiter.wait(for: [restored], timeout: 10)
            XCTAssertEqual(result, .completed, reason)
            return result == .completed
        }
        guard staysCleared("Feed refreshes must not restore a cleared route") else { return }
        XCUIDevice.shared.orientation = .portrait
        waitForLayout(in: app, expanded: false, readyControl: "originPicker")
        let stayedClear = staysCleared("Narrowing must not restore the cleared itinerary")
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "Cleared station route after narrowing"
        compact.lifetime = .keepAlways
        add(compact)
        guard stayedClear else { return }
        assertStationEndpointsCleared(labels, in: app)
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForLayout(in: app, expanded: true, readyControl: "originPicker")
        guard staysCleared("Expanding must not restore the cleared itinerary") else { return }
        assertStationEndpointsCleared(labels, in: app)
        XCTAssertTrue(app.buttons["originPicker"].label.contains("Wall St"))
        XCTAssertTrue(app.buttons["destinationPicker"].label.contains("Broadway"))
        selectPlan()
        expectation(for: NSPredicate(format: "value CONTAINS %@", interchange), evaluatedWith: map)
        waitForExpectations(timeout: 10)
        assertStationEndpoints([labels[0], labels[2]], in: app, expanded: true)
        XCTAssertTrue(app.buttons["clearMapRoute"].exists, "Explicitly selecting the same itinerary must highlight it again")
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
            let menuCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            menuCapture.name = "Expanded open More menu, visit \(cycle + 1)"
            menuCapture.lifetime = .keepAlways
            add(menuCapture)
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
                XCTAssertTrue(app.buttons["arrivalStatusButton"].waitForExistence(timeout: 5))
                let compactMenu = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                compactMenu.name = "Compact open More menu after narrowing"
                compactMenu.lifetime = .keepAlways
                add(compactMenu)
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
            let menuCapture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            menuCapture.name = "Largest text open More menu before \(title)"
            menuCapture.lifetime = .keepAlways
            add(menuCapture)
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
    private func launchForMoreMenu(accessibilityText: Bool = false, arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.orientation = .portrait
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--ui-test-fixture"] + arguments
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
        let restore = app.buttons["restoreRoutePanel"]
        XCTAssertTrue(restore.waitForExistence(timeout: 5))
        XCTAssertTrue(restore.isHittable)
        XCTAssertFalse(app.navigationBars["Trip details"].isHittable)
        XCTAssertFalse(app.buttons["showStationRouteOnMap"].isHittable)
        let routeMap = XCTAttachment(screenshot: app.screenshot())
        routeMap.name = "Selected itinerary on Apple Maps"
        routeMap.lifetime = .keepAlways
        add(routeMap)
        let endpoints = ["Board at Wall St", "Arrive at 59 St"]
        assertStationEndpoints(endpoints, in: app)
        app.buttons["clearMapRoute"].tap()
        assertStationEndpointsCleared(endpoints, in: app)
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
    private func assertStationEndpoints(_ labels: [String], in app: XCUIApplication, expanded: Bool = false,
                                        file: StaticString = #filePath, line: UInt = #line)
    {
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let fitted = NSPredicate { _, _ in MainActor.assumeIsolated {
            guard map.exists else { return false }
            let header = app.navigationBars["StandClear"]
            let panel = app.navigationBars["Trip details"]
            let top = header.exists ? max(map.frame.minY, header.frame.maxY) : map.frame.minY
            let right = expanded && panel.exists ? min(map.frame.maxX, panel.frame.minX) : map.frame.maxX
            return labels.allSatisfy { label in
                let marker = map.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
                guard marker.exists else { return false }
                let frame = marker.frame
                return frame.width > 0 && frame.height > 0 && frame.minY > top && frame.maxY < map.frame.maxY &&
                    frame.minX >= map.frame.minX && frame.maxX <= right
            }
        } }
        let ready = XCTNSPredicateExpectation(predicate: fitted, object: map)
        let result = XCTWaiter.wait(for: [ready], timeout: 10)
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        capture.name = "Station itinerary endpoints — expanded \(expanded)"
        capture.lifetime = .keepAlways
        add(capture)
        XCTAssertEqual(result, .completed, "Named boarding and arrival markers must fit in the exposed map", file: file, line: line)
    }

    @MainActor
    private func assertStationEndpointsCleared(_ labels: [String], in app: XCUIApplication,
                                               file: StaticString = #filePath, line: UInt = #line)
    {
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let cleared = NSPredicate { _, _ in MainActor.assumeIsolated {
            guard map.exists else { return false }
            return !app.buttons["clearMapRoute"].exists &&
                map.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", labels)).count == 0
        } }
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: cleared, object: map)], timeout: 5)
        let failedCheckReturnedAt = result == .completed ? nil : Date.now.timeIntervalSince1970
        XCTAssertEqual(result, .completed,
                       "Clear route must remove the boarding, arrival, and transfer markers", file: file, line: line)
        if let failedCheckReturnedAt {
            captureStationRouteFailure("Station endpoint clearance failed", result: String(describing: result), returnedAt: failedCheckReturnedAt, in: app, removedLabels: labels)
        }
    }

    /// Post-failure evidence cannot reconstruct values at the original deadline.
    /// Keep the verdict, predicate order and timeout independent of these reads.
    @MainActor
    private func captureStationRouteFailure(_ context: String, result: String, returnedAt: Double, in app: XCUIApplication, removedLabels: [String] = []) {
        let started = Date.now.timeIntervalSince1970
        let capture = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        let screenshotCompleted = Date.now.timeIntervalSince1970
        capture.name = context + " — after failed assertion handling"
        capture.lifetime = .keepAlways; add(capture)
        let timing = XCTAttachment(string: "Original result: \(result)\nCheck returned UTC: \(returnedAt)\nCapture started after assertion UTC: \(started)\nScreenshot completed UTC: \(screenshotCompleted)")
        timing.name = context + " — POST failure timing"
        timing.lifetime = .keepAlways; add(timing)
        var observations: [[String: String]] = []
        func read<T>(_ name: String, _ operation: () -> T) -> T {
            observations.append(["query": name, "phase": "begin", "utcSeconds": String(Date.now.timeIntervalSince1970)])
            let value = operation()
            observations.append(["query": name, "phase": "end", "utcSeconds": String(Date.now.timeIntervalSince1970)])
            return value
        }
        let map = app.descendants(matching: .any)["appleTransitMap"].firstMatch
        let mapExists = read("map.exists") { map.exists }
        let clearExists = read("clearMapRoute.exists") { app.buttons["clearMapRoute"].exists }
        let directionsHere = read("directionsHere.exists") { app.buttons["directionsHere"].exists }
        let originPicker = read("originPicker.exists") { app.buttons["originPicker"].exists }
        let mapValue = mapExists ? read("map.value") { String(describing: map.value) } : "unavailable"
        let endpoints = mapExists && !removedLabels.isEmpty ? read("endpointMatches.elements") {
            map.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", removedLabels)).allElementsBoundByIndex
        } : []
        let matches: [[String: String]] = endpoints.enumerated().map { index, element in
            let exists = read("endpoint.\(index).exists") { element.exists }
            return ["exists": String(exists),
                    "label": exists ? read("endpoint.\(index).label") { element.label } : "unavailable",
                    "frame": exists ? read("endpoint.\(index).frame") { String(describing: element.frame) } : "unavailable"]
        }
        let details: [String: Any] = [
            "context": context, "originalFailedResult": result,
            "observationPhase": "after failed assertion; values are not atomic or deadline-time evidence",
            "originalCheckReturnedUTC": returnedAt, "captureStartedAfterAssertionUTC": started,
            "screenshotRequestedUTC": started, "screenshotCompletedUTC": screenshotCompleted,
            "observationsCompletedUTC": Date.now.timeIntervalSince1970,
            "mapExists": mapExists, "clearButtonExists": clearExists,
            "directionsHereExists": directionsHere, "originPickerExists": originPicker,
            "mapValue": mapValue, "expectedRemovedLabels": removedLabels,
            "endpointQueryPerformed": mapExists && !removedLabels.isEmpty,
            "matchedEndpointCount": matches.count, "matchedEndpoints": matches, "queryTimes": observations,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: details, options: [.prettyPrinted, .sortedKeys]) {
            let record = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            record.name = context + " — POST failure observations"
            record.lifetime = .keepAlways; add(record)
        }
        let hierarchyStarted = Date.now.timeIntervalSince1970
        let hierarchy = app.debugDescription
        let tree = XCTAttachment(string: "Post-failure hierarchy started UTC: \(hierarchyStarted)\nCompleted UTC: \(Date.now.timeIntervalSince1970)\n" + hierarchy)
        tree.name = context + " — POST failure accessibility hierarchy"
        tree.lifetime = .keepAlways; add(tree)
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
