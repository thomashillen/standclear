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
    /// Verified platform suffix for travel in the static stop array order.
    var directionTowardEnd: String? = nil
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

/// Route suffixes describe the reported service, not its track or stopping pattern.
struct TransitRouteIdentity {
    let baseID: String
    let isExpress: Bool

    init(_ id: String) {
        isExpress = ["6X", "7X", "FX"].contains(id)
        baseID = isExpress ? String(id.dropLast()) : id
    }

    var bullet: String {
        ["GS", "FS", "H"].contains(baseID) ? "S" : baseID
    }

    var spokenName: String {
        switch baseID {
        case "GS": "42 Street Shuttle"
        case "FS": "Franklin Avenue Shuttle"
        case "H": "Rockaway Park Shuttle"
        case "SI": "Staten Island Railway"
        case "S": "Shuttle"
        default: isExpress ? "\(baseID) Express" : baseID
        }
    }
}

enum ArrivalDirection: String, CaseIterable {
    case north = "N", south = "S", unknown

    init(_ reported: String) {
        self = Self(rawValue: reported) ?? .unknown
    }

    var title: String {
        switch self {
        case .north: "Northbound"
        case .south: "Southbound"
        case .unknown: "Direction unavailable"
        }
    }
}

struct StationArrivalGroup: Identifiable {
    let direction: ArrivalDirection
    let arrivals: [Arrival]
    var id: ArrivalDirection {
        direction
    }

    private static let previewCount = 4
    var overflowCount: Int {
        max(0, arrivals.count - Self.previewCount)
    }

    func visible(expanded: Bool) -> ArraySlice<Arrival> {
        arrivals.prefix(expanded ? arrivals.count : Self.previewCount)
    }

    /// Group after station/freshness filtering so each direction keeps the
    /// existing ETA order and has access to every qualifying prediction.
    static func groups(_ arrivals: [Arrival]) -> [Self] {
        guard !arrivals.isEmpty else { return [] }
        let byDirection = Dictionary(grouping: arrivals) { ArrivalDirection($0.direction) }
        return ArrivalDirection.allCases.compactMap { direction in
            let members = byDirection[direction] ?? []
            guard direction != .unknown || !members.isEmpty else { return nil }
            return Self(direction: direction, arrivals: members)
        }
    }
}

/// A compact preview of the same first three eligible station predictions.
/// Only explicitly identical reported services share a row; missing destinations
/// or directions never establish that two trains are going to the same place.
struct NearbyArrivalGroup: Identifiable {
    let first: Arrival
    var later: [Arrival] = []
    var id: String {
        first.id
    }

    var arrivals: [Arrival] {
        [first] + later
    }

    static func groups(_ arrivals: [Arrival]) -> [Self] {
        var groups: [Self] = []
        for arrival in arrivals.prefix(3) {
            let destinationKnown = arrival.destStopId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            if destinationKnown, ArrivalDirection(arrival.direction) != .unknown,
               let index = groups.firstIndex(where: {
                   $0.first.routeId == arrival.routeId && $0.first.stopId == arrival.stopId &&
                       $0.first.direction == arrival.direction && $0.first.destStopId == arrival.destStopId
               })
            {
                groups[index].later.append(arrival)
            } else {
                groups.append(Self(first: arrival))
            }
        }
        return groups
    }
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

    var directionLabel: String {
        ArrivalDirection(direction).title
    }

    func destinationName(in lines: [SubwayLine]) -> String? {
        guard let destStopId else { return nil }
        // Resolve the reported destination itself, not the complex's canonical
        // name or a static terminus that could mislabel short-turn service.
        let routeStop = lines.first { $0.routeId == routeId }?.stops.first { $0.id == destStopId }
        let stop = routeStop ?? lines.lazy.flatMap(\.stops).first { $0.id == destStopId }
        guard let name = stop?.name.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
        return name
    }

    func countdown(at now: Date) -> String? {
        let remaining = eta - now.timeIntervalSince1970
        guard remaining.isFinite, remaining >= 0 else { return nil }
        if remaining < 60 {
            return "<1 min"
        }
        let minutes = ceil(remaining / 60)
        guard minutes < Double(Int.max) else { return nil }
        return "\(Int(minutes)) min"
    }
}

struct Snapshot: Decodable {
    let generatedAt: Double // API epoch milliseconds.
    let trains: [Train]
    let arrivals: [Arrival]
    func hasValidTimestamp(at date: Date) -> Bool {
        generatedAt.isFinite && generatedAt > 0 &&
            generatedAt / 1000 <= date.timeIntervalSince1970 + 5
    }

    func isFresh(at date: Date) -> Bool {
        hasValidTimestamp(at: date) && date.timeIntervalSince1970 - generatedAt / 1000 < 60
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
    static let complexes: [[String]] = [["635", "L03", "R20"], ["132", "D19", "L02"], ["A31", "L01"], ["127", "725", "R16", "902"], ["631", "723", "901"], ["D17", "R17"], ["125", "A24"], ["629", "R11"], ["630", "F11"], ["A32", "D20"], ["637", "D21"], ["235", "D24", "R31"], ["A51", "J27", "L22"], ["719", "G22", "F09"], ["232", "423"], ["A41", "R29"], ["229", "418", "A38", "M22"], ["F15", "M18"]]

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

    /// Match the rider's terms anywhere in the name, as in the web station index.
    static func searchStations(_ stations: [Station], query: String) -> [Station] {
        func normalize(_ text: String) -> String {
            text.folding(options: [.diacriticInsensitive, .widthInsensitive], locale: .current)
                .lowercased()
                .replacing(/\bsq\b/, with: "square")
        }

        let terms = normalize(query).split(whereSeparator: \.isWhitespace)
        guard let first = terms.first else { return stations }
        let phrase = terms.joined(separator: " ")
        let matches = stations.compactMap { station -> (station: Station, score: Int)? in
            let name = normalize(station.stop.name)
            guard let firstMatch = name.range(of: first),
                  terms.dropFirst().allSatisfy({ name.contains($0) })
            else { return nil }
            let score = name.hasPrefix(phrase) ? -1 : name.distance(from: name.startIndex, to: firstMatch.lowerBound)
            return (station, score)
        }
        return matches.sorted { $0.score < $1.score }.map(\.station)
    }

    struct NearbyStation: Identifiable {
        let station: Station
        let meters: Double
        var id: String {
            station.id
        }
    }

    static func nearby(_ stations: [Station], coordinate: CLLocationCoordinate2D) -> [NearbyStation] {
        guard CLLocationCoordinate2DIsValid(coordinate) else { return [] }
        let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let ranked = stations.compactMap { station -> NearbyStation? in
            guard CLLocationCoordinate2DIsValid(station.stop.coordinate) else { return nil }
            let meters = origin.distance(from: CLLocation(latitude: station.stop.lat, longitude: station.stop.lng))
            return NearbyStation(station: station, meters: meters)
        }.sorted { $0.meters == $1.meters ? $0.id < $1.id : $0.meters < $1.meters }
        guard let first = ranked.first, first.meters <= 80000 else { return [] }
        return Array(ranked.prefix(5))
    }

    static func arrivals(for station: Station, snapshot: Snapshot?, now: Date) -> [Arrival] {
        guard let snapshot, snapshot.isFresh(at: now) else { return [] }
        let trains = Dictionary(uniqueKeysWithValues: snapshot.uniqueTrains.map { ($0.id, $0) })
        var unique: [String: Arrival] = [:]
        for arrival in snapshot.arrivals {
            unique[arrival.id] = arrival
        }
        return unique.values.filter { arrival in
            guard station.stopIDs.contains(arrival.stopId), arrival.eta.isFinite,
                  arrival.eta >= now.timeIntervalSince1970 else { return false }
            // Trip updates need not have a paired vehicle position. When one
            // exists, invalid/future reports cannot qualify as fresh evidence.
            guard let train = trains[arrival.tripId] else { return true }
            let timestamp = train.lastReportedAt ?? snapshot.generatedAt / 1000
            return timestamp.isFinite && timestamp > 0 && timestamp <= now.timeIntervalSince1970 + 5 &&
                now.timeIntervalSince1970 - timestamp <= 90
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
