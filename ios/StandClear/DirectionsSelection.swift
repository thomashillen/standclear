import CoreLocation
import Foundation

/// Store identities rather than data snapshots so loading stations never replaces
/// a rider's choices. Resolving an unavailable ID does not silently choose another.
struct DirectionsSelection: Equatable {
    var originID: String? {
        didSet { originWasSuggested = false }
    }

    var destinationID: String?
    private(set) var originWasSuggested = false

    func origin(in stations: [Station]) -> Station? {
        stations.first { $0.id == originID }
    }

    func destination(in stations: [Station]) -> Station? {
        stations.first { $0.id == destinationID }
    }

    /// Replaces only the destination. Suggesting an origin requires a separate,
    /// explicit action; resolving delayed data never changes either endpoint.
    mutating func setDestination(_ stationID: String) {
        destinationID = stationID
    }

    /// A one-time station suggestion, not a live location endpoint or walking
    /// route. Call only for an explicit directions action with a usable fix.
    mutating func suggestOrigin(stations: [Station], coordinate: CLLocationCoordinate2D?) {
        guard originID == nil, let coordinate, Self.valid(coordinate) else { return }
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let nearest = stations.compactMap { station -> (station: Station, meters: Double)? in
            guard Self.valid(station.stop.coordinate) else { return nil }
            let meters = location.distance(from: CLLocation(latitude: station.stop.lat, longitude: station.stop.lng))
            guard meters <= 900 else { return nil }
            return (station, meters)
        }.min {
            $0.meters == $1.meters ? $0.station.id < $1.station.id : $0.meters < $1.meters
        }
        guard let nearest else { return }
        originID = nearest.station.id
        originWasSuggested = true
    }

    private static func valid(_ coordinate: CLLocationCoordinate2D) -> Bool {
        coordinate.latitude.isFinite && coordinate.longitude.isFinite && CLLocationCoordinate2DIsValid(coordinate)
    }

    mutating func swap() {
        (originID, destinationID) = (destinationID, originID)
    }

    mutating func clear() {
        originID = nil
        destinationID = nil
    }
}
