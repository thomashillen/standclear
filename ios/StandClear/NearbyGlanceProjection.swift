import CoreLocation
import Foundation

struct NearbyGlanceRow: Identifiable {
    let station: Station
    let color: String
    let routes: [String]
    let meters: Double
    let north: Arrival?
    let south: Arrival?

    var id: String {
        "\(station.id):\(color)"
    }
}

enum NearbyGlanceProjection {
    /// Like the web glance, each row is one station's same-color services.
    /// Empty groups remain visible: missing predictions do not mean no service.
    /// Stable geometry/identity ordering prevents rows jumping as ETAs refresh.
    static func rows(stations: [Station], lines: [SubwayLine], snapshot: Snapshot?,
                     coordinate: CLLocationCoordinate2D?, now: Date,
                     feedUnavailable: Bool = false) -> [NearbyGlanceRow]
    {
        guard let coordinate, valid(coordinate) else { return [] }
        let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let nearest = stations.compactMap { station -> (station: Station, meters: Double)? in
            guard valid(station.stop.coordinate) else { return nil }
            let meters = origin.distance(from: CLLocation(latitude: station.stop.lat, longitude: station.stop.lng))
            guard meters <= 900 else { return nil }
            return (station, meters)
        }.sorted {
            $0.meters == $1.meters ? $0.station.id < $1.station.id : $0.meters < $1.meters
        }.prefix(8)
        var colors: [String: String] = [:]
        for line in lines {
            colors[line.routeId] = line.color.trimmingCharacters(in: CharacterSet(charactersIn: "#")).uppercased()
        }
        var result: [NearbyGlanceRow] = []
        for (station, meters) in nearest {
            let byColor = Dictionary(grouping: Set(station.routes)) { colors[$0] ?? "808080" }
            let arrivals = feedUnavailable ? [] : Transit.arrivals(for: station, snapshot: snapshot, now: now).filter {
                $0.eta <= now.timeIntervalSince1970 + 45 * 60
            }
            for color in byColor.keys.sorted() {
                let routes = (byColor[color] ?? []).sorted()
                let matching = arrivals.filter { routes.contains(TransitRouteIdentity($0.routeId).baseID) }
                result.append(NearbyGlanceRow(station: station, color: color, routes: routes, meters: meters,
                                              north: matching.first { $0.direction == "N" },
                                              south: matching.first { $0.direction == "S" }))
                if result.count == 3 {
                    return result
                }
            }
        }
        return result
    }

    private static func valid(_ coordinate: CLLocationCoordinate2D) -> Bool {
        coordinate.latitude.isFinite && coordinate.longitude.isFinite && CLLocationCoordinate2DIsValid(coordinate)
    }
}
