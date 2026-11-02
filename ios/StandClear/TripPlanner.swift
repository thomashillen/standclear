import CoreLocation
import Foundation

struct NativeTripLeg: Identifiable {
    let routeId: String
    let direction: String
    let boardStopId: String
    let alightStopId: String
    let boardComplexId: String
    let alightComplexId: String
    let stopCount: Int
    var siblingRouteIDs: [String] = []
    var boardingStopIDsByRoute: [String: String] = [:]

    var routeIDs: [String] {
        [routeId] + siblingRouteIDs
    }

    var id: String {
        "\(routeId):\(direction):\(boardStopId)>\(alightStopId)"
    }
}

struct NativeTripPlan: Identifiable {
    var legs: [NativeTripLeg]
    let totalStops: Int
    let transferComplexId: String?
    var id: String {
        legs.map(\.id).joined(separator: "|")
    }
}

/// The web client's direct/one-transfer graph (lib/commuteRouting.ts).
/// Plans describe static service patterns, not guaranteed live connections.
enum TripPlanner {
    private struct Node {
        let complexID: String
        let index: Int
        let stopID: String
    }

    static func plans(lines: [SubwayLine], stations: [Station], from: Station, to: Station) -> [NativeTripPlan] {
        var complexByStop: [String: String] = [:]
        for station in stations {
            for stopID in station.stopIDs {
                complexByStop[stopID] = station.id
            }
        }
        let origins = Set(from.stopIDs.compactMap { complexByStop[$0] })
        let destinations = Set(to.stopIDs.compactMap { complexByStop[$0] })
        guard !origins.isEmpty, !destinations.isEmpty, origins.isDisjoint(with: destinations) else { return [] }
        let orderedLines = lines.sorted { $0.routeId == $1.routeId ? $0.id < $1.id : $0.routeId < $1.routeId }
        var nodes: [String: [Node]] = [:]
        for line in orderedLines where line.stops.count >= 2 {
            nodes[line.routeId] = line.stops.enumerated().compactMap { index, stop in
                complexByStop[stop.id].map { Node(complexID: $0, index: index, stopID: stop.id) }
            }
        }
        var results: [NativeTripPlan] = []
        for line in orderedLines {
            guard let routeNodes = nodes[line.routeId],
                  let board = routeNodes.first(where: { origins.contains($0.complexID) }),
                  let alight = routeNodes.first(where: { destinations.contains($0.complexID) }),
                  let direct = leg(line: line, board: board, alight: alight) else { continue }
            results.append(NativeTripPlan(legs: [direct], totalStops: direct.stopCount, transferComplexId: nil))
        }
        for firstLine in orderedLines {
            guard let firstNodes = nodes[firstLine.routeId],
                  let board = firstNodes.first(where: { origins.contains($0.complexID) }) else { continue }
            for transfer in firstNodes where !origins.contains(transfer.complexID) && !destinations.contains(transfer.complexID) {
                guard let firstLeg = leg(line: firstLine, board: board, alight: transfer) else { continue }
                for secondLine in orderedLines where secondLine.routeId != firstLine.routeId {
                    guard let secondNodes = nodes[secondLine.routeId],
                          let secondBoard = secondNodes.first(where: { $0.complexID == transfer.complexID }),
                          let alight = secondNodes.first(where: { destinations.contains($0.complexID) }),
                          let secondLeg = leg(line: secondLine, board: secondBoard, alight: alight) else { continue }
                    results.append(NativeTripPlan(legs: [firstLeg, secondLeg], totalStops: firstLeg.stopCount + secondLeg.stopCount,
                                                  transferComplexId: transfer.complexID))
                }
            }
        }
        results.sort {
            if $0.legs.count != $1.legs.count {
                return $0.legs.count < $1.legs.count
            }
            if $0.totalStops != $1.totalStops {
                return $0.totalStops < $1.totalStops
            }
            return $0.id < $1.id
        }
        return deduplicate(results)
    }

    static func geometry(for leg: NativeTripLeg, lines: [SubwayLine]) -> [CLLocationCoordinate2D] {
        guard let line = lines.first(where: { $0.routeId == leg.routeId }),
              let board = line.stops.first(where: { $0.id == leg.boardStopId }),
              let alight = line.stops.first(where: { $0.id == leg.alightStopId }),
              board.shapeIdx != alight.shapeIdx,
              line.shape.indices.contains(board.shapeIdx), line.shape.indices.contains(alight.shapeIdx) else { return [] }
        let points = line.shape[min(board.shapeIdx, alight.shapeIdx) ... max(board.shapeIdx, alight.shapeIdx)]
        // Do not compact invalid shape points and silently connect across a gap.
        guard points.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isFinite) &&
                CLLocationCoordinate2DIsValid(.init(latitude: $0[1], longitude: $0[0])) }) else { return [] }
        let coordinates = points.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
        return board.shapeIdx < alight.shapeIdx ? coordinates : Array(coordinates.reversed())
    }

    /// A prediction at the boarding platform, not a claim that a rider can catch
    /// the train or that it will complete the entire static itinerary.
    static func nextDeparture(for leg: NativeTripLeg, stations: [Station], snapshot: Snapshot?, now: Date,
                              feedUnavailable: Bool) -> Arrival?
    {
        guard !feedUnavailable, let station = stations.first(where: { $0.id == leg.boardComplexId }) else { return nil }
        return Transit.arrivals(for: station, snapshot: snapshot, now: now).first {
            $0.stopId == (leg.boardingStopIDsByRoute[$0.routeId] ?? leg.boardStopId) &&
                leg.routeIDs.contains($0.routeId) && $0.direction == leg.direction
        }
    }

    private static func leg(line: SubwayLine, board: Node, alight: Node) -> NativeTripLeg? {
        guard board.index != alight.index, let first = line.stops.first, let last = line.stops.last,
              first.lat.isFinite, last.lat.isFinite else { return nil }
        let towardEnd = alight.index > board.index
        let firstIsNorth = first.lat > last.lat
        let direction = towardEnd ? (firstIsNorth ? "S" : "N") : (firstIsNorth ? "N" : "S")
        return NativeTripLeg(routeId: line.routeId, direction: direction,
                             boardStopId: board.stopID, alightStopId: alight.stopID,
                             boardComplexId: board.complexID, alightComplexId: alight.complexID,
                             stopCount: abs(alight.index - board.index), boardingStopIDsByRoute: [line.routeId: board.stopID])
    }

    private static func deduplicate(_ plans: [NativeTripPlan]) -> [NativeTripPlan] {
        var exactKeys = Set<String>()
        var pathIndices: [String: Int] = [:]
        var result: [NativeTripPlan] = []
        for plan in plans {
            let exact = plan.legs.map { "\($0.routeId)-\($0.direction)" }.joined(separator: "|") + ":" + (plan.transferComplexId ?? "")
            guard exactKeys.insert(exact).inserted else { continue }
            // Stop count keeps express/local alternatives distinct, as on web.
            let path = plan.legs.map { "\($0.boardComplexId)>\($0.alightComplexId)-\($0.direction)-\($0.stopCount)" }.joined(separator: "|")
            if let index = pathIndices[path] {
                for legIndex in plan.legs.indices {
                    let route = plan.legs[legIndex].routeId
                    if !result[index].legs[legIndex].routeIDs.contains(route) {
                        result[index].legs[legIndex].siblingRouteIDs.append(route)
                        result[index].legs[legIndex].boardingStopIDsByRoute[route] = plan.legs[legIndex].boardStopId
                    }
                }
            } else {
                pathIndices[path] = result.count
                result.append(plan)
            }
        }
        let directRoutes = Set(result.filter { $0.legs.count == 1 }.flatMap { $0.legs[0].routeIDs })
        return Array(result.filter { plan in
            plan.legs.count == 1 || !plan.legs.contains { directRoutes.contains($0.routeId) }
        }.prefix(4))
    }
}
