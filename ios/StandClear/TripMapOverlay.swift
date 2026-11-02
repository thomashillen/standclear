import MapKit

struct TripMapOverlay: Identifiable {
    let id: String
    let color: String
    let coordinates: [CLLocationCoordinate2D]

    static func make(plan: NativeTripPlan?, lines: [SubwayLine]) -> [TripMapOverlay] {
        guard let plan else { return [] }
        return plan.legs.compactMap { leg in
            let coordinates = TripPlanner.geometry(for: leg, lines: lines)
            guard coordinates.count >= 2,
                  let line = lines.first(where: { $0.routeId == leg.routeId }) else { return nil }
            return TripMapOverlay(id: leg.id, color: line.color, coordinates: coordinates)
        }
    }

    static func region(for overlays: [TripMapOverlay]) -> MKCoordinateRegion? {
        let coordinates = overlays.flatMap(\.coordinates)
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
