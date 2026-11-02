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

    private func station(_ id: String) -> Station {
        Station(id: id, stop: Stop(id: id, name: id, lat: 40.7, lng: -74, shapeIdx: 0), stopIDs: [id], routes: ["4"])
    }
}
