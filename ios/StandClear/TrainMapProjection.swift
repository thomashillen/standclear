import CoreLocation
import Foundation

struct TrainMapMarker: Identifiable {
    let id: String
    let coordinate: CLLocationCoordinate2D
    /// Compass heading; nil means the feed does not establish a travel direction.
    let bearingDegrees: Double?
    let routeID: String
    let displayLetter: String
    let color: String
    let textColor: String
    let opacity: Double
    var stale: Bool {
        opacity < 1
    }
}

enum TrainMapProjection {
    static func markers(snapshot: Snapshot?, lines: [SubwayLine], now: Date,
                        feedUnavailable: Bool = false) -> [TrainMapMarker]
    {
        guard !feedUnavailable, let snapshot, snapshot.isFresh(at: now) else { return [] }
        var routes: [String: Geometry] = [:]
        for line in lines where line.shape.allSatisfy({ $0.count == 2 && valid(.init(latitude: $0[1], longitude: $0[0])) }) {
            var stops: [String: Stop] = [:]
            for stop in line.stops {
                stops[stop.id] = stop
            }
            routes[line.routeId] = Geometry(line: line, coordinates: line.coordinates, stops: stops)
        }
        let arrivalsByTrip = Dictionary(grouping: snapshot.arrivals, by: \.tripId)
        return snapshot.uniqueTrains.compactMap { train in
            guard let geometry = routes[train.routeId],
                  let coordinate = position(train, geometry: geometry), valid(coordinate) else { return nil }
            let line = geometry.line
            let timestamp = train.lastReportedAt ?? snapshot.generatedAt / 1000
            guard timestamp.isFinite, timestamp > 0, timestamp <= now.timeIntervalSince1970 + 5 else { return nil }
            let age = max(0, now.timeIntervalSince1970 - timestamp)
            guard age <= 360 else { return nil }
            return TrainMapMarker(id: train.id, coordinate: coordinate,
                                  bearingDegrees: heading(train, geometry: geometry, arrivals: arrivalsByTrip[train.id] ?? [], generatedAt: snapshot.generatedAt),
                                  routeID: train.routeId, displayLetter: line.id, color: line.color,
                                  textColor: contrastingTextColor(line.color),
                                  opacity: age <= 90 ? 1 : 1 - 0.6 * (age - 90) / 270)
        }
    }

    private struct Geometry {
        let line: SubwayLine
        let coordinates: [CLLocationCoordinate2D]
        let stops: [String: Stop]
    }

    private static func position(_ train: Train, geometry: Geometry) -> CLLocationCoordinate2D? {
        guard let next = geometry.stops[train.nextStopId] else { return nil }
        guard train.status != "STOPPED_AT", let previous = geometry.stops[train.prevStopId],
              previous.id != next.id, !geometry.coordinates.isEmpty else { return next.coordinate }
        let last = geometry.coordinates.count - 1
        let start = max(0, min(previous.shapeIdx, last)), end = max(0, min(next.shapeIdx, last))
        let progress = train.progress.isFinite ? min(1, max(0, train.progress)) : 0
        let index = Double(start) + Double(end - start) * progress
        let lower = Int(index.rounded(.down)), upper = Int(index.rounded(.up))
        let a = geometry.coordinates[lower], b = geometry.coordinates[upper]
        return .init(latitude: a.latitude + (b.latitude - a.latitude) * (index - Double(lower)),
                     longitude: a.longitude + (b.longitude - a.longitude) * (index - Double(lower)))
    }

    private static func heading(_ train: Train, geometry: Geometry, arrivals: [Arrival], generatedAt: Double) -> Double? {
        let coordinates = geometry.coordinates
        guard coordinates.count > 1, let next = geometry.stops[train.nextStopId] else { return nil }
        let last = coordinates.count - 1
        let end = max(0, min(next.shapeIdx, last))
        var index = Double(end)
        let direction: Int
        if train.status != "STOPPED_AT",
           let previous = geometry.stops[train.prevStopId], previous.shapeIdx != next.shapeIdx
        {
            let start = max(0, min(previous.shapeIdx, last))
            guard start != end else { return nil }
            let progress = train.progress.isFinite ? min(1, max(0, train.progress)) : 0
            index = Double(start) + Double(end - start) * progress
            direction = end > start ? 1 : -1
        } else {
            // N/S is not shape order: GTFS representative shapes may run either way.
            // Like the web client, use this trip's next known future arrival as evidence.
            let future = arrivals.filter {
                $0.routeId == train.routeId && $0.eta.isFinite && $0.eta > generatedAt / 1000 && $0.stopId != next.id
            }.sorted { $0.eta < $1.eta }
            guard let destination = future.compactMap({ arrival in
                geometry.stops[arrival.stopId].flatMap { $0.shapeIdx != next.shapeIdx ? $0 : nil }
            }).first else { return nil }
            direction = destination.shapeIdx > next.shapeIdx ? 1 : -1
        }
        return tangent(coordinates, index: index, direction: direction)
    }

    private static func tangent(_ coordinates: [CLLocationCoordinate2D], index: Double, direction: Int) -> Double? {
        let pivot = min(Int(index.rounded(.down)), coordinates.count - 1)
        // At a corner, a reverse train leaves along the preceding segment, not
        // the following segment reversed. Repeated vertices carry no heading.
        if direction < 0, index == Double(pivot), pivot > 0 {
            for lower in stride(from: pivot - 1, through: 0, by: -1) {
                if let result = bearing(coordinates[pivot], coordinates[lower]) {
                    return result
                }
            }
        }
        for upper in (pivot + 1) ..< coordinates.count {
            let a = direction > 0 ? coordinates[pivot] : coordinates[upper]
            let b = direction > 0 ? coordinates[upper] : coordinates[pivot]
            if let result = bearing(a, b) {
                return result
            }
        }
        guard pivot > 0 else { return nil }
        for lower in stride(from: pivot - 1, through: 0, by: -1) {
            let a = direction > 0 ? coordinates[lower] : coordinates[pivot]
            let b = direction > 0 ? coordinates[pivot] : coordinates[lower]
            if let result = bearing(a, b) {
                return result
            }
        }
        return nil
    }

    private static func bearing(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double? {
        guard abs(a.latitude - b.latitude) + abs(a.longitude - b.longitude) > 0.000000001 else { return nil }
        let latitude = (a.latitude + b.latitude) / 2 * .pi / 180
        let east = (b.longitude - a.longitude) * cos(latitude)
        let north = b.latitude - a.latitude
        return (atan2(east, north) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    private static func valid(_ coordinate: CLLocationCoordinate2D) -> Bool {
        coordinate.latitude.isFinite && coordinate.longitude.isFinite && CLLocationCoordinate2DIsValid(coordinate)
    }

    private static func contrastingTextColor(_ hex: String) -> String {
        guard let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) else { return "white" }
        func linear(_ component: UInt32) -> Double {
            let s = Double(component) / 255
            return s <= 0.04045 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * linear((value >> 16) & 255) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255)
        return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "black" : "white"
    }
}
