import CoreLocation
import Foundation

struct Stop: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
    let shapeIdx: Int
    var coordinate: CLLocationCoordinate2D {
        .init(latitude: lat, longitude: lng)
    }
}

struct SubwayLine: Decodable, Identifiable {
    let id: String
    let routeId: String
    let color: String
    let stops: [Stop]
    let shape: [[Double]]
    var coordinates: [CLLocationCoordinate2D] {
        shape.compactMap { $0.count == 2 ? .init(latitude: $0[1], longitude: $0[0]) : nil }
    }
}

struct StaticData: Decodable { let lines: [String: SubwayLine] }
struct Train: Decodable, Identifiable {
    let id: String
    let routeId: String
    let direction: String
    let progress: Double
    let prevStopId: String
    let nextStopId: String
    let status: String
    let lastReportedAt: Double?
}

struct Arrival: Decodable, Identifiable {
    let routeId: String
    let stopId: String
    let direction: String
    let eta: Double // Epoch seconds, unlike generatedAt.
    let tripId: String
    let destStopId: String?
    var id: String {
        "\(tripId):\(stopId):\(direction)"
    }
}

struct Snapshot: Decodable {
    let generatedAt: Double // API epoch milliseconds.
    let trains: [Train]
    let arrivals: [Arrival]
    func isFresh(at date: Date) -> Bool {
        generatedAt.isFinite && generatedAt > 0 &&
            date.timeIntervalSince1970 - generatedAt / 1000 < 60 &&
            generatedAt / 1000 <= date.timeIntervalSince1970 + 5
    }

    var uniqueTrains: [Train] {
        // Match the web's trip-only, last-wins dedup, preserving terminus queues.
        var byID: [String: Train] = [:]
        for train in trains {
            byID[train.id] = train
        }
        return byID.values.sorted { $0.id < $1.id }
    }
}

struct Station: Identifiable {
    let id: String
    let stop: Stop
    let stopIDs: Set<String>
    let routes: [String]
}

enum Transit {
    /// Generated from lib/stopsIndex.ts's explicit allowlist, never name/proximity merging.
    static let complexes: [[String]] = [["635", "L03", "R20"], ["132", "A31", "L01", "L02", "D19"], ["127", "725", "R16", "902"], ["631", "723", "901"], ["D17", "R17"], ["125", "A24"], ["629", "R11"], ["630", "F11"], ["A32", "D20"], ["637", "D21"], ["235", "D24", "R31"], ["A51", "J27", "L22"], ["719", "G22", "F09"], ["232", "423"], ["A41", "R29"], ["229", "418", "A38", "M22"], ["F15", "M18"]]

    static func stations(_ lines: [SubwayLine]) -> [Station] {
        var stops: [String: Stop] = [:]
        var routes: [String: Set<String>] = [:]
        for line in lines.sorted(by: { $0.routeId < $1.routeId }) {
            for stop in line.stops {
                stops[stop.id] = stop
                routes[stop.id, default: []].insert(line.routeId)
            }
        }
        var consumed = Set<String>()
        var result: [Station] = []
        for id in stops.keys.sorted() where !consumed.contains(id) {
            let ids = Set(complexes.first(where: { $0.contains(id) }) ?? [id])
            let present = ids.intersection(stops.keys)
            let ordered = (complexes.first(where: { $0.contains(id) }) ?? [id]).filter { present.contains($0) }
            guard let canonical = ordered.first, let first = stops[canonical] else { continue }
            let members = ordered.compactMap { stops[$0] }
            let stop = Stop(id: canonical, name: first.name,
                            lat: members.map(\.lat).reduce(0, +) / Double(members.count),
                            lng: members.map(\.lng).reduce(0, +) / Double(members.count), shapeIdx: first.shapeIdx)
            consumed.formUnion(present)
            result.append(Station(id: canonical, stop: stop, stopIDs: present,
                                  routes: Set(present.flatMap { routes[$0] ?? [] }).sorted()))
        }
        return result.sorted { $0.stop.name < $1.stop.name }
    }

    static func nearby(_ stations: [Station], coordinate: CLLocationCoordinate2D) -> [Station] {
        let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let ranked = stations.sorted {
            origin.distance(from: CLLocation(latitude: $0.stop.lat, longitude: $0.stop.lng)) <
                origin.distance(from: CLLocation(latitude: $1.stop.lat, longitude: $1.stop.lng))
        }
        guard let first = ranked.first,
              origin.distance(from: CLLocation(latitude: first.stop.lat, longitude: first.stop.lng)) <= 80000 else { return [] }
        return Array(ranked.prefix(5))
    }

    static func arrivals(for station: Station, snapshot: Snapshot?, now: Date) -> [Arrival] {
        guard let snapshot, snapshot.isFresh(at: now) else { return [] }
        let trains = Dictionary(uniqueKeysWithValues: snapshot.uniqueTrains.map { ($0.id, $0) })
        var unique: [String: Arrival] = [:]
        for arrival in snapshot.arrivals {
            unique[arrival.id] = arrival
        }
        return unique.values.filter {
            station.stopIDs.contains($0.stopId) && $0.eta.isFinite && $0.eta >= now.timeIntervalSince1970 &&
                trains[$0.tripId].map { now.timeIntervalSince1970 - ($0.lastReportedAt ?? snapshot.generatedAt / 1000) <= 90 } != false
        }.sorted { $0.eta == $1.eta ? $0.id < $1.id : $0.eta < $1.eta }
    }

    static func coordinate(_ train: Train, line: SubwayLine) -> CLLocationCoordinate2D? {
        guard let next = line.stops.first(where: { $0.id == train.nextStopId }) else { return nil }
        guard train.status != "STOPPED_AT",
              let previous = line.stops.first(where: { $0.id == train.prevStopId }),
              previous.id != next.id, !line.coordinates.isEmpty else { return next.coordinate }
        let start = max(0, min(previous.shapeIdx, line.coordinates.count - 1))
        let end = max(0, min(next.shapeIdx, line.coordinates.count - 1))
        let fraction = train.progress.isFinite ? min(1, max(0, train.progress)) : 0
        let index = Double(start) + Double(end - start) * fraction
        let lower = Int(index.rounded(.down)), upper = Int(index.rounded(.up))
        let a = line.coordinates[lower], b = line.coordinates[upper]
        return .init(latitude: a.latitude + (b.latitude - a.latitude) * (index - Double(lower)),
                     longitude: a.longitude + (b.longitude - a.longitude) * (index - Double(lower)))
    }
}
