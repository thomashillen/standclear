import CoreLocation
import Foundation

/// Cache one engine per static dataset. Ingest each new feed once, sample from
/// the visible map, and reset when the scene becomes inactive or the feed fails.
struct TrainMotion {
    private let lines: [SubwayLine]
    private let tracks: [String: Track]
    private let geometryIDs: [String: String]
    private var snapshot: Snapshot?
    private var rows: [Row] = []
    private var latestMotionEnd = 0.0

    init(lines: [SubwayLine]) {
        self.lines = lines
        geometryIDs = TrainRouteGeometry.routeIDs(in: lines)
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
        let arrivalsByTrip = Dictionary(grouping: next.arrivals, by: \.tripId)
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
            if let geometryID = geometryIDs[train.routeId], let track = tracks[geometryID] {
                row.baseArc = track.reportedArc(train)
                row.travelForward = track.travelForward(train, arrivals: arrivalsByTrip[train.id] ?? [], generated: generated)
            }
            // Repeated reports must not restart a transition or an ETA leg,
            // even when the snapshot generation advances. Rebuild the roster
            // and base metadata, preserving only identical motion inputs.
            if let old = previous[train.id], old.hasSameMotionInput(as: row) {
                row.leg = old.leg
                row.transition = old.transition
                return row
            }
            guard let reported = train.lastReportedAt, time - reported <= 90,
                  ["IN_TRANSIT_TO", "INCOMING_AT"].contains(train.status), ["N", "S"].contains(train.direction),
                  train.progress.isFinite, (0 ... 1).contains(train.progress),
                  let geometryID = geometryIDs[train.routeId], let track = tracks[geometryID],
                  let from = track.stops[train.prevStopId], let to = track.stops[train.nextStopId],
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
        for index in rows.indices {
            if let old = previous[rows[index].base.id], !old.hasSameMotionInput(as: rows[index]) {
                rows[index].transition = transition(from: old, to: rows[index], at: time)
            }
        }
        latestMotionEnd = rows.reduce(0) { latest, row in
            let predictionEnd = row.leg.flatMap { leg in
                leg.start != leg.end || leg.correctionStart != nil ? leg.eta : nil
            } ?? 0
            let end = max(row.transition?.endTime ?? 0, predictionEnd)
            return max(latest, min(end, row.reported + 90, generated + 60))
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
            let sampledTime = min(time, row.reported + 90)
            let reconciling = !reduceMotion && row.transition.map { sampledTime < $0.endTime } == true
            if !reduceMotion, row.leg != nil || reconciling, let arc = row.arc(at: sampledTime),
               let geometryID = geometryIDs[base.routeID], let track = tracks[geometryID]
            {
                // A correction can move backward without reversing service.
                // Unknown direction must remain neutral, even while moving.
                let forward = reconciling ? row.transition?.forward : row.leg?.forward
                let position = track.position(at: arc, forward: forward ?? true)
                coordinate = position.0
                bearing = forward == nil ? nil : position.1
            }
            return TrainMapMarker(id: base.id, coordinate: coordinate, bearingDegrees: bearing, routeID: base.routeID,
                                  displayLetter: base.displayLetter, color: base.color, textColor: base.textColor,
                                  opacity: age <= 90 ? 1 : 1 - 0.6 * (age - 90) / 270,
                                  reconciling: reconciling)
        }
    }

    /// Reconcile two observed positions, never invent a next destination. The
    /// short bounded transition is presentation uncertainty, not live tracking.
    private func transition(from old: Row, to row: Row, at time: Double) -> Transition? {
        guard old.train.lastReportedAt != nil, row.train.lastReportedAt != nil,
              old.base.routeID == row.base.routeID, old.train.direction == row.train.direction,
              ["N", "S"].contains(row.train.direction), row.reported >= old.reported,
              ["STOPPED_AT", "IN_TRANSIT_TO", "INCOMING_AT"].contains(old.train.status),
              ["STOPPED_AT", "IN_TRANSIT_TO", "INCOMING_AT"].contains(row.train.status),
              time - old.reported <= 90, time - row.reported <= 90,
              let geometryID = geometryIDs[row.base.routeID], let track = tracks[geometryID],
              let start = old.arc(at: time), let target = row.arc(at: time),
              let oldEnd = track.stops[old.train.nextStopId], let newEnd = track.stops[row.train.nextStopId],
              oldEnd == newEnd || old.train.nextStopId == row.train.prevStopId || track.adjacent(oldEnd, newEnd),
              abs(target - start) > 0.01, abs(target - start) <= 2000 else { return nil }
        // Static platform poses may be offset from representative geometry.
        // Do not add an off-track connector or snap onto/off the shape mid-blend.
        if old.leg == nil, old.transition == nil,
           Track.meters(old.base.coordinate, track.position(at: start, forward: true).0) > 0.5
        {
            return nil
        }
        if row.leg == nil,
           Track.meters(row.base.coordinate, track.position(at: target, forward: true).0) > 0.5
        {
            return nil
        }
        let duration = 4.0
        let end = row.leg?.arc(at: time + duration) ?? target
        guard abs(end - start) <= 2000 else { return nil }
        // Borrow only the preceding report's own direction evidence. Do not
        // renew an inherited heading through a chain of stopped corrections.
        return Transition(start: start, end: end, received: time, endTime: time + duration,
                          forward: row.travelForward ?? old.travelForward)
    }

    private struct Transition {
        let start, end, received, endTime: Double
        let forward: Bool?

        func arc(at time: Double) -> Double {
            start + min(1, max(0, (time - received) / (endTime - received))) * (end - start)
        }
    }

    private struct Row {
        let base: TrainMapMarker
        let reported: Double
        let train: Train
        let eta: Double?
        var leg: Leg?
        var transition: Transition?
        var baseArc: Double?
        var travelForward: Bool?

        func arc(at time: Double) -> Double? {
            if let transition, time < transition.endTime {
                return transition.arc(at: time)
            }
            return leg?.arc(at: time) ?? baseArc
        }

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
        let originalArcs: [Double]
        let stopIndices: [String: Int]

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
            self.originalArcs = originalArcs
            stopIndices = Dictionary(line.stops.filter { stops[$0.id] != nil }.map { ($0.id, $0.shapeIdx) }, uniquingKeysWith: { first, _ in first })
        }

        func adjacent(_ a: Double, _ b: Double) -> Bool {
            a != b && !stops.values.contains { $0 > min(a, b) && $0 < max(a, b) }
        }

        func travelForward(_ train: Train, arrivals: [Arrival], generated: Double) -> Bool? {
            guard let to = stops[train.nextStopId] else { return nil }
            if ["IN_TRANSIT_TO", "INCOMING_AT"].contains(train.status),
               let from = stops[train.prevStopId], from != to
            {
                return to > from
            }
            guard train.status == "STOPPED_AT" else { return nil }
            // As in discrete projection, N/S alone is not shape order. A
            // parked train needs its own future arrival at another platform.
            let future = arrivals.filter {
                $0.routeId == train.routeId && $0.direction == train.direction && $0.eta.isFinite && $0.eta > generated
            }.sorted { $0.eta < $1.eta }
            guard let destination = future.compactMap({ stops[$0.stopId] }).first(where: { $0 != to }) else { return nil }
            return destination > to
        }

        func reportedArc(_ train: Train) -> Double? {
            guard let to = stops[train.nextStopId] else { return nil }
            if train.status == "STOPPED_AT" {
                return to
            }
            guard stops[train.prevStopId] != nil, train.progress.isFinite,
                  (0 ... 1).contains(train.progress) else { return nil }
            // Match the discrete projection's vertex-index interpolation.
            guard let a = stopIndices[train.prevStopId], let b = stopIndices[train.nextStopId] else { return nil }
            let index = Double(a) + Double(b - a) * train.progress
            let lower = Int(index.rounded(.down)), upper = Int(index.rounded(.up))
            return originalArcs[lower] + (originalArcs[upper] - originalArcs[lower]) * (index - Double(lower))
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
