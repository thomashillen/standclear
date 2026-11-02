import CoreLocation
@testable import StandClear
import XCTest

final class DirectionsSelectionTests: XCTestCase {
    func testSwapPreservesBothManualChoices() {
        var selection = DirectionsSelection(originID: "419", destinationID: "629")
        selection.swap()
        XCTAssertEqual(selection.originID, "629")
        XCTAssertEqual(selection.destinationID, "419")
        selection.swap()
        XCTAssertEqual(selection.originID, "419")
    }

    func testSwapHandlesPartiallySelectedTrip() {
        var selection = DirectionsSelection(originID: "419")
        selection.swap()
        XCTAssertNil(selection.originID)
        XCTAssertEqual(selection.destinationID, "419")
    }

    func testClearRemovesBothChoices() {
        var selection = DirectionsSelection(originID: "419", destinationID: "629")
        selection.clear()
        XCTAssertNil(selection.originID)
        XCTAssertNil(selection.destinationID)
    }

    func testDelayedDataResolutionDoesNotOverwriteManualEdits() {
        var selection = DirectionsSelection(originID: "419", destinationID: "629")
        XCTAssertNil(selection.origin(in: []))
        selection.originID = "635"
        let oldOrigin = station("419")
        let newOrigin = station("635")
        let destination = station("629")
        let loaded = [oldOrigin, newOrigin, destination]
        XCTAssertEqual(selection.origin(in: loaded)?.id, "635")
        XCTAssertEqual(selection.destination(in: loaded)?.id, "629")
        XCTAssertNil(selection.origin(in: [oldOrigin, destination]))
        XCTAssertEqual(selection.originID, "635", "Missing data must not silently select a replacement")
    }

    func testDirectionsHerePreservesManualOriginAndReplacesDestination() {
        var selection = DirectionsSelection(originID: "419", destinationID: "629")
        selection.setDestination("635")
        XCTAssertEqual(selection.originID, "419")
        XCTAssertEqual(selection.destinationID, "635")
        selection.swap()
        XCTAssertEqual(selection.originID, "635")
        XCTAssertEqual(selection.destinationID, "419")
    }

    func testDirectionsHereDoesNotInferUnsetOriginWhenDataLoads() {
        var selection = DirectionsSelection()
        selection.setDestination("635")
        XCTAssertNil(selection.originID)
        XCTAssertNil(selection.destination(in: []))
        let loaded = [station("419"), station("635")]
        XCTAssertNil(selection.origin(in: loaded))
        XCTAssertEqual(selection.destination(in: loaded)?.id, "635")
        selection.destinationID = "419"
        XCTAssertEqual(selection.destination(in: loaded)?.id, "419", "Resolution must preserve later rider edits")
        selection.clear()
        XCTAssertNil(selection.originID)
        XCTAssertNil(selection.destinationID)
    }

    func testSuggestOriginChoosesNearestStationAndPreservesDestination() {
        var selection = DirectionsSelection(destinationID: "destination")
        let farther = station("farther", lat: 40.705)
        let nearest = station("nearest", lat: 40.701)
        selection.suggestOrigin(stations: [farther, nearest], coordinate: .init(latitude: 40.7, longitude: -74))
        XCTAssertEqual(selection.originID, "nearest")
        XCTAssertEqual(selection.destinationID, "destination")
        XCTAssertTrue(selection.originWasSuggested)
        XCTAssertEqual(selection.origin(in: [farther, nearest])?.stop.name, "nearest")
    }

    func testSuggestOriginUsesStableIdentityForEqualDistances() {
        let stations = [station("b"), station("a")]
        var first = DirectionsSelection()
        var reversed = DirectionsSelection()
        let coordinate = CLLocationCoordinate2D(latitude: 40.7, longitude: -74)
        first.suggestOrigin(stations: stations, coordinate: coordinate)
        reversed.suggestOrigin(stations: Array(stations.reversed()), coordinate: coordinate)
        XCTAssertEqual(first.originID, "a")
        XCTAssertEqual(reversed.originID, first.originID)
    }

    func testSuggestOriginRequiresValidLocationAndStationWithin900Meters() {
        let nearby = station("nearby")
        for coordinate: CLLocationCoordinate2D? in [nil, .init(latitude: .nan, longitude: -74),
                                                    .init(latitude: 91, longitude: -74), .init(latitude: 40.7, longitude: .infinity)]
        {
            var selection = DirectionsSelection()
            selection.suggestOrigin(stations: [nearby], coordinate: coordinate)
            XCTAssertNil(selection.originID)
            XCTAssertFalse(selection.originWasSuggested)
        }
        var selection = DirectionsSelection()
        let coordinate = CLLocationCoordinate2D(latitude: 40.7, longitude: -74)
        selection.suggestOrigin(stations: [], coordinate: coordinate)
        XCTAssertNil(selection.originID)
        selection.suggestOrigin(stations: [station("distant", lat: 40.709), station("invalid", lat: .nan)], coordinate: coordinate)
        XCTAssertNil(selection.originID, "A roughly 1 km station must not become a nearby default")
        XCTAssertFalse(selection.originWasSuggested)
        selection.suggestOrigin(stations: [station("within", lat: 40.7075), station("invalid", lat: 91)], coordinate: coordinate)
        XCTAssertEqual(selection.originID, "within")
    }

    func testSuggestionDoesNotOverwriteManualOrPreviouslySuggestedOrigin() {
        let coordinate = CLLocationCoordinate2D(latitude: 40.7, longitude: -74)
        var manual = DirectionsSelection(originID: "manual")
        manual.suggestOrigin(stations: [station("nearby")], coordinate: coordinate)
        XCTAssertEqual(manual.originID, "manual")
        XCTAssertFalse(manual.originWasSuggested)
        var suggested = DirectionsSelection()
        suggested.suggestOrigin(stations: [station("original")], coordinate: coordinate)
        suggested.suggestOrigin(stations: [station("new")], coordinate: coordinate)
        XCTAssertEqual(suggested.originID, "original", "A later fix must not move the chosen starting station")
        XCTAssertTrue(suggested.originWasSuggested)
        suggested.setDestination("other")
        XCTAssertEqual(suggested.originID, "original")
    }

    func testManualSelectionOfSameSuggestedStationClearsSuggestionProvenance() {
        var selection = DirectionsSelection()
        selection.suggestOrigin(stations: [station("nearby")], coordinate: .init(latitude: 40.7, longitude: -74))
        selection.originID = "nearby"
        XCTAssertFalse(selection.originWasSuggested)
        selection.suggestOrigin(stations: [station("other")], coordinate: .init(latitude: 40.7, longitude: -74))
        XCTAssertEqual(selection.originID, "nearby")
    }

    func testSwapAndClearRemoveSuggestionProvenance() {
        var selection = DirectionsSelection(destinationID: "destination")
        selection.suggestOrigin(stations: [station("nearby")], coordinate: .init(latitude: 40.7, longitude: -74))
        selection.swap()
        XCTAssertEqual(selection.originID, "destination")
        XCTAssertEqual(selection.destinationID, "nearby")
        XCTAssertFalse(selection.originWasSuggested)
        selection.clear()
        XCTAssertNil(selection.originID)
        XCTAssertNil(selection.destinationID)
        XCTAssertFalse(selection.originWasSuggested)
        selection.suggestOrigin(stations: [station("nearby")], coordinate: .init(latitude: 40.7, longitude: -74))
        XCTAssertTrue(selection.originWasSuggested, "A later explicit action can suggest an origin after clearing")
        selection.clear()
        XCTAssertFalse(selection.originWasSuggested)
    }

    func testNearestDestinationRemainsSameStationInsteadOfInventingAnotherOrigin() {
        var selection = DirectionsSelection(destinationID: "nearby")
        selection.suggestOrigin(stations: [station("nearby"), station("farther", lat: 40.705)],
                                coordinate: .init(latitude: 40.7, longitude: -74))
        XCTAssertEqual(selection.originID, selection.destinationID)
    }

    private func station(_ id: String, lat: Double = 40.7) -> Station {
        Station(id: id, stop: Stop(id: id, name: id, lat: lat, lng: -74, shapeIdx: 0), stopIDs: [id], routes: ["4"])
    }
}
