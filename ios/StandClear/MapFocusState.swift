import CoreLocation

/// Explicit camera intent, separate from continuously refreshed location state.
/// A later location fix may move the map only while a Near Me request is pending.
struct MapFocusState {
    private(set) var coordinate: CLLocationCoordinate2D?
    private(set) var revision = 0
    private(set) var waitingForLocation = false

    /// Returns true when the caller should apply the newly requested camera focus.
    @discardableResult
    mutating func requestNearby(_ available: CLLocationCoordinate2D?) -> Bool {
        guard let available, Self.valid(available) else {
            waitingForLocation = true
            return false
        }
        return focus(on: available)
    }

    /// Ordinary periodic location refreshes never commandeer a manually panned map.
    @discardableResult
    mutating func receiveLocation(_ coordinate: CLLocationCoordinate2D?) -> Bool {
        guard waitingForLocation, let coordinate, Self.valid(coordinate) else { return false }
        return focus(on: coordinate)
    }

    /// Even an identical coordinate represents a new explicit camera instruction.
    @discardableResult
    mutating func focus(on coordinate: CLLocationCoordinate2D) -> Bool {
        guard Self.valid(coordinate) else { return false }
        waitingForLocation = false
        self.coordinate = coordinate
        revision += 1
        return true
    }

    mutating func cancelPending() {
        waitingForLocation = false
    }

    private static func valid(_ coordinate: CLLocationCoordinate2D) -> Bool {
        coordinate.latitude.isFinite && coordinate.longitude.isFinite && CLLocationCoordinate2DIsValid(coordinate)
    }
}
