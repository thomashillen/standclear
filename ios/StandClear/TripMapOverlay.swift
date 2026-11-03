import MapKit

/// Only confirmed pedestrian paths are drawn. The separate endpoint coordinates
/// also let the camera frame an itinerary while walking directions are pending.
struct PlaceMapRoute {
    let place: PlaceResult
    let plan: NativeTripPlan?
    let boarding, alighting: Stop?
    let start: CLLocationCoordinate2D?
    let access, egress: WalkingConnection?
    let optionID: String

    var endpoints: [CLLocationCoordinate2D] {
        [start, boarding?.coordinate, alighting?.coordinate, place.coordinate].compactMap(\.self)
    }

    func startMarker(currentLocation: CLLocationCoordinate2D?) -> CLLocationCoordinate2D? {
        guard let start else { return nil }
        let alreadyMarked = [currentLocation, boarding?.coordinate, place.coordinate].compactMap(\.self)
            .contains { $0.latitude == start.latitude && $0.longitude == start.longitude }
        return alreadyMarked ? nil : start
    }

    var walkingOverlays: [TripMapOverlay] {
        [("access", access), ("egress", egress)].compactMap { key, connection in
            guard let connection, connection.coordinates.count >= 2 else { return nil }
            return TripMapOverlay(id: "\(optionID):\(key)", color: "007AFF", coordinates: connection.coordinates, walking: true)
        }
    }

    func transferLabel(in lines: [SubwayLine]) -> (text: String, coordinate: CLLocationCoordinate2D)? {
        guard let plan, let transfer = plan.transfer(in: lines), let departingLeg = plan.legs.last else { return nil }
        let service = departingLeg.routeIDs.map { TransitRouteIdentity($0).bullet }.joined(separator: "/")
        return ("Change to \(service) at \(transfer.outgoing.name)", transfer.outgoing.coordinate)
    }

    var accessibilitySummary: String {
        let rides = plan?.legs.map { $0.routeIDs.joined(separator: "/") }.joined(separator: ", then ")
        return [place.name, rides, boarding?.name, alighting?.name].compactMap(\.self).joined(separator: ", ")
    }
}

struct TripMapOverlay: Identifiable {
    let id: String
    let color: String
    let coordinates: [CLLocationCoordinate2D]
    var walking = false

    static func make(plan: NativeTripPlan?, lines: [SubwayLine]) -> [TripMapOverlay] {
        guard let plan else { return [] }
        return plan.legs.compactMap { leg in
            let coordinates = TripPlanner.geometry(for: leg, lines: lines)
            guard coordinates.count >= 2,
                  let line = lines.first(where: { $0.routeId == leg.routeId }) else { return nil }
            return TripMapOverlay(id: leg.id, color: line.color, coordinates: coordinates)
        }
    }

    static func region(for overlays: [TripMapOverlay], including endpoints: [CLLocationCoordinate2D] = []) -> MKCoordinateRegion? {
        let coordinates = overlays.flatMap(\.coordinates) + endpoints
        guard let minLat = coordinates.map(\.latitude).min(),
              let maxLat = coordinates.map(\.latitude).max(),
              let minLng = coordinates.map(\.longitude).min(),
              let maxLng = coordinates.map(\.longitude).max() else { return nil }
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2,
                                                                 longitude: (minLng + maxLng) / 2),
                                  span: MKCoordinateSpan(latitudeDelta: max(0.008, (maxLat - minLat) * 1.4),
                                                         longitudeDelta: max(0.008, (maxLng - minLng) * 1.4)))
    }
}
