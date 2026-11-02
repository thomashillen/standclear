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

    mutating func swap() {
        (originID, destinationID) = (destinationID, originID)
    }

    mutating func clear() {
        originID = nil
        destinationID = nil
    }
}
