import Foundation

/// Store identities rather than data snapshots so loading stations never replaces
/// a rider's choices. Resolving an unavailable ID does not silently choose another.
struct DirectionsSelection: Equatable {
    var originID: String?
    var destinationID: String?

    func origin(in stations: [Station]) -> Station? {
        stations.first { $0.id == originID }
    }

    func destination(in stations: [Station]) -> Station? {
        stations.first { $0.id == destinationID }
    }

    /// An explicit station-details action replaces only the destination. An
    /// unset origin stays unset; location and delayed data must not guess it.
    mutating func setDestination(_ stationID: String) {
        destinationID = stationID
    }

    mutating func swap() {
        (originID, destinationID) = (destinationID, originID)
    }

    mutating func clear() {
        originID = nil
        destinationID = nil
    }
}
