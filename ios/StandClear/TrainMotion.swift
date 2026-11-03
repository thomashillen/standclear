import CoreLocation
import Foundation

/// Cache one engine per static dataset. Ingest each new feed once, sample from
/// the visible map, and reset when the scene becomes inactive or the feed fails.
struct TrainMotion {
    private let lines: [SubwayLine]
    private let tracks: [String: Track]
    private var snapshot: Snapshot?
    private var rows: [Row] = []
    private var latestMotionEnd = 0.0

    init(lines: [SubwayLine]) {
        self.lines = lines
        var tracks: [String: Track] = [:]
        for line in lines {
            tracks[line.routeId] = Track(line)
        }
        self.tracks = tracks
    }

    mutating func reset() {
        snapshot = nil
        latestMotionEnd = 0
        rows.removeAll(keepingCapacity: true)
    }

    mutating func update(snapshot next: Snapshot?, now: Date, feedUnavailable: Bool = false) {
        guard !feedUnavailable, let next else { reset(); return }
        if let snapshot, snapshot.isFresh(at: now), next.generatedAt < snapshot.generatedAt {
            return
        }
        guard next.isFresh(at: now) else { reset(); return }
        let previous = snapshot?.isFresh(at: now) == true ? Dictionary(uniqueKeysWithValues: rows.map { ($0.base.id, $0) }) : [:]
        let sameGeneration = next.generatedAt == snapshot?.generatedAt
        snapshot = next
        let generated = next.generatedAt / 1000
        let time = now.timeIntervalSince1970
        let trains = Dictionary(uniqueKeysWithValues: next.uniqueTrains.map { ($0.id, $0) })
        var arrivals: [String: Double] = [:]
        for arrival in next.arrivals {
            guard let train = trains[arrival.tripId], arrival.routeId == train.routeId,
                  arrival.direction == train.direction, arrival.stopId == train.nextStopId,
                  arrival.eta.isFinite, arrival.eta > generated else { continue }
            arrivals[train.id] = min(arrivals[train.id] ?? arrival.eta, arrival.eta)
        }
        rows = TrainMapProjection.markers(snapshot: next, lines: lines, now: now).compactMap { base in
            guard let train = trains[base.id] else { return nil }
            let eta = arrivals[train.id]
            var row = Row(base: base, reported: train.lastReportedAt ?? generated, train: train, eta: eta)
            // A server revision can change individual vehicles or ETAs without
            // changing generatedAt. Keep unchanged trajectories (including a
            // completed arrival), but rebuild the marker roster and base poses.
            if sameGeneration, let old = previous[train.id], old.hasSameMotionInput(as: row) {
                row.leg = old.leg
                return row
            }
            guard let reported = train.lastReportedAt, time - reported <= 90,
                  ["IN_TRANSIT_TO", "INCOMING_AT"].contains(train.status), ["N", "S"].contains(train.direction),
                  train.progress.isFinite, (0 ... 1).contains(train.progress),
                  let track = tracks[train.routeId], let from = track.stops[train.prevStopId], let to = track.stops[train.nextStopId],
                  from != to, let eta, eta > time else { return row }
            let start = from + (to - from) * train.progress
            // An implausibly fast update or a prediction far outside the
            // supported nearby horizon cannot justify continuous movement.
            guard eta - generated <= 45 * 60, abs(to - start) / (eta - generated) <= 35 else { return row }
            var leg = Leg(fromID: train.prevStopId, toID: train.nextStopId, direction: train.direction,
                          forward: to > from, start: start, end: to, generated: generated, eta: eta, received: time)
            if !sameGeneration, let old = previous[train.id], old.base.routeID == train.routeId, time - old.reported <= 90,
               reported >= old.reported, let prior = old.leg, prior.direction == leg.direction, prior.forward == leg.forward,
               (prior.fromID == leg.fromID && prior.toID == leg.toID) || prior.toID == leg.fromID
            {
                let shown = prior.arc(at: time)
                let target = leg.arc(at: time)
                if abs(shown - target) <= 120, leg.forward ? shown <= to : shown >= to {
                    leg.correctionStart = shown
                }
            }
            row.leg = leg
            return row
        }
        latestMotionEnd = rows.reduce(0) { latest, row in
            guard let leg = row.leg, leg.start != leg.end || leg.correctionStart != nil else { return latest }
            return max(latest, min(leg.eta, row.reported + 90, generated + 60))
        }
    }

    func hasActiveMotion(at date: Date) -> Bool {
        snapshot?.isFresh(at: date) == true && date.timeIntervalSince1970 < latestMotionEnd
    }

    func markers(at date: Date, reduceMotion: Bool = false) -> [TrainMapMarker] {
        guard let snapshot, snapshot.isFresh(at: date) else { return [] }
        let time = date.timeIntervalSince1970
        return rows.compactMap { row in
            let age = time - row.reported
            guard (-5 ... 360).contains(age) else { return nil }
            let base = row.base
            var coordinate = base.coordinate, bearing = base.bearingDegrees
            if !reduceMotion, let leg = row.leg, let track = tracks[base.routeID] {
                let position = track.position(at: leg.arc(at: min(time, row.reported + 90)), forward: leg.forward)
                coordinate = position.0
                bearing = position.1
            }
            return TrainMapMarker(id: base.id, coordinate: coordinate, bearingDegrees: bearing, routeID: base.routeID,
                                  displayLetter: base.displayLetter, color: base.color, textColor: base.textColor,
                                  opacity: age <= 90 ? 1 : 1 - 0.6 * (age - 90) / 270)
        }
    }

    private struct Row {
        let base: TrainMapMarker
        let reported: Double
        let train: Train
        let eta: Double?
        var leg: Leg?

        func hasSameMotionInput(as other: Row) -> Bool {
            eta == other.eta && train.routeId == other.train.routeId && train.direction == other.train.direction &&
                train.prevStopId == other.train.prevStopId && train.nextStopId == other.train.nextStopId &&
                train.progress == other.train.progress && train.status == other.train.status && train.lastReportedAt == other.train.lastReportedAt
        }
    }

    private struct Leg {
        let fromID, toID, direction: String
        let forward: Bool
        let start, end, generated, eta, received: Double
        var correctionStart: Double?

        func arc(at time: Double) -> Double {
            let fraction = min(1, max(0, (time - generated) / (eta - generated)))
            let target = start + fraction * (end - start)
            guard let correctionStart else { return target }
            let blend = min(1, max(0, (time - received) / min(4, eta - received)))
            let corrected = correctionStart + blend * (target - correctionStart)
            return forward ? max(correctionStart, corrected) : min(correctionStart, corrected)
        }
    }

    /// Degenerate vertices are removed once. Distances for platform indices
    /// still refer to the original vertices of the representative shape.
    private struct Track {
        let points: [CLLocationCoordinate2D]
        let arcs: [Double]
        let stops: [String: Double]

        init?(_ line: SubwayLine) {
            var points: [CLLocationCoordinate2D] = [], arcs: [Double] = [], originalArcs: [Double] = []
            for pair in line.shape {
                guard pair.count == 2 else { return nil }
                let point = CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
                guard CLLocationCoordinate2DIsValid(point) else { return nil }
                let delta = points.last.map { Self.meters($0, point) } ?? 0
                if points.isEmpty || delta > 0.01 {
                    points.append(point)
                    arcs.append((arcs.last ?? 0) + delta)
                }
                originalArcs.append(arcs.last ?? 0)
            }
            guard points.count >= 2 else { return nil }
            self.points = points
            self.arcs = arcs
            var stops: [String: Double] = [:]
            for stop in line.stops where originalArcs.indices.contains(stop.shapeIdx) && CLLocationCoordinate2DIsValid(stop.coordinate) {
                let pair = line.shape[stop.shapeIdx]
                let vertex = CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
                if Self.meters(stop.coordinate, vertex) <= 250 {
                    stops[stop.id] = originalArcs[stop.shapeIdx]
                }
            }
            self.stops = stops
        }

        func position(at arc: Double, forward: Bool) -> (CLLocationCoordinate2D, Double) {
            var low = 0, high = arcs.count - 1
            while low < high {
                let mid = (low + high) / 2
                if forward ? arcs[mid] <= arc : arcs[mid] < arc {
                    low = mid + 1
                } else {
                    high = mid
                }
            }
            let upper = max(1, low), lower = upper - 1
            let fraction = min(1, max(0, (arc - arcs[lower]) / (arcs[upper] - arcs[lower])))
            let a = points[lower], b = points[upper]
            let dy = b.latitude - a.latitude, dx = b.longitude - a.longitude
            let coordinate = CLLocationCoordinate2D(latitude: a.latitude + fraction * dy, longitude: a.longitude + fraction * dx)
            let bearing = atan2(dx * cos((a.latitude + b.latitude) * .pi / 360), dy) * 180 / .pi
            return (coordinate, (bearing + (forward ? 360 : 540)).truncatingRemainder(dividingBy: 360))
        }

        static func meters(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
            hypot((b.longitude - a.longitude) * cos((a.latitude + b.latitude) * .pi / 360), b.latitude - a.latitude) * 111_200
        }
    }
}
