import CoreLocation
@testable import StandClear
import XCTest

final class MapFocusStateTests: XCTestCase {
    private let nearby = CLLocationCoordinate2D(latitude: 40.707, longitude: -74.0118)
    private let station = CLLocationCoordinate2D(latitude: 40.7625, longitude: -73.9679)

    func testPlaceMapFramesOriginAndDestinationWithoutInventingWalkingGeometry() throws {
        let start = CLLocationCoordinate2D(latitude: 40.708, longitude: -74.013)
        let place = PlaceResult(id: "museum", name: "Museum", subtitle: "", latitude: 40.767, longitude: -73.938)
        let route = PlaceMapRoute(place: place, plan: nil, boarding: nil, alighting: nil, start: start,
                                  access: nil, egress: nil, optionID: "candidate")
        XCTAssertTrue(route.walkingOverlays.isEmpty)
        let region = try XCTUnwrap(TripMapOverlay.region(for: [], including: route.endpoints))
        XCTAssertEqual(region.center.latitude, (start.latitude + place.latitude) / 2, accuracy: 0.00001)
        XCTAssertGreaterThan(region.span.longitudeDelta, abs(place.longitude - start.longitude))
    }

    func testRepeatedNearMeAtSameCoordinateCreatesNewCameraIntent() {
        var state = MapFocusState()
        XCTAssertTrue(state.requestNearby(nearby))
        XCTAssertEqual(state.revision, 1)
        XCTAssertTrue(state.requestNearby(nearby))
        XCTAssertEqual(state.revision, 2, "Returning after panning must work even when the rider has not moved")
        XCTAssertFalse(state.waitingForLocation)
        XCTAssertEqual(state.coordinate?.latitude, nearby.latitude)
        XCTAssertEqual(state.coordinate?.longitude, nearby.longitude)
    }

    func testPendingNearMeAppliesFirstValidFixOnly() {
        var state = MapFocusState()
        XCTAssertFalse(state.requestNearby(nil))
        XCTAssertTrue(state.waitingForLocation)
        XCTAssertNil(state.coordinate)
        XCTAssertEqual(state.revision, 0)
        XCTAssertTrue(state.receiveLocation(nearby))
        XCTAssertFalse(state.waitingForLocation)
        XCTAssertEqual(state.revision, 1)
        XCTAssertFalse(state.receiveLocation(station), "Periodic fixes should not move the camera again")
        XCTAssertEqual(state.coordinate?.latitude, nearby.latitude)
        XCTAssertEqual(state.revision, 1)
    }

    func testManualStationFocusCancelsPendingNearMe() {
        var state = MapFocusState()
        state.requestNearby(nil)
        XCTAssertTrue(state.focus(on: station))
        XCTAssertFalse(state.waitingForLocation)
        XCTAssertFalse(state.receiveLocation(nearby))
        XCTAssertEqual(state.coordinate?.latitude, station.latitude)
        XCTAssertEqual(state.coordinate?.longitude, station.longitude)
        XCTAssertEqual(state.revision, 1)
    }

    func testCancellingPendingRequestKeepsLastFocusAndIgnoresLateFix() {
        var state = MapFocusState()
        state.focus(on: station)
        state.requestNearby(nil)
        state.cancelPending()
        XCTAssertFalse(state.waitingForLocation)
        XCTAssertFalse(state.receiveLocation(nearby))
        XCTAssertEqual(state.coordinate?.latitude, station.latitude)
        XCTAssertEqual(state.revision, 1)
    }

    func testInvalidCoordinatesNeverReplaceCameraOrCompletePendingRequest() {
        let invalid = [
            CLLocationCoordinate2D(latitude: .nan, longitude: 0),
            CLLocationCoordinate2D(latitude: 0, longitude: .infinity),
            CLLocationCoordinate2D(latitude: -.infinity, longitude: 0),
            CLLocationCoordinate2D(latitude: 90.001, longitude: 0),
            CLLocationCoordinate2D(latitude: 0, longitude: -180.001),
        ]
        var state = MapFocusState()
        state.focus(on: station)
        for coordinate in invalid {
            XCTAssertFalse(state.requestNearby(coordinate))
            XCTAssertTrue(state.waitingForLocation)
            XCTAssertFalse(state.receiveLocation(coordinate))
            XCTAssertFalse(state.focus(on: coordinate))
            XCTAssertEqual(state.coordinate?.latitude, station.latitude)
            XCTAssertEqual(state.coordinate?.longitude, station.longitude)
            XCTAssertEqual(state.revision, 1)
            XCTAssertTrue(state.waitingForLocation)
        }
        XCTAssertFalse(state.receiveLocation(nil))
        XCTAssertTrue(state.receiveLocation(nearby), "Invalid intermediate fixes must not consume the request")
        XCTAssertEqual(state.revision, 2)
    }
}
