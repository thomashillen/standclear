import CoreLocation
import Foundation
import Observation

@MainActor @Observable
final class TransitStore {
    var lines: [SubwayLine] = [] {
        didSet { linesRevision &+= 1 }
    }

    private(set) var linesRevision: UInt64 = 0
    /// Identifies an accepted response in the active session, including a
    /// corrected payload with an unchanged feed timestamp. Shared refreshes
    /// have the same ID. Inactive and failed feeds cannot drive map motion.
    private(set) var motionSnapshotRevision: UUID?
    var stations: [Station] = []
    var snapshot: Snapshot?
    var loading = true
    var error: String?
    var feedError = false
    private var refreshTask: Task<Snapshot, Error>?
    private var refreshID = UUID()
    private var linesTask: Task<StaticData, Error>?
    private var linesRequestID = UUID()
    private var active = false
    private var generation = 0
    private let baseURL: URL
    private let session: URLSession
    private let pollingSleep: @MainActor (Duration) async throws -> Void

    init(session: URLSession = .shared,
         baseURL: URL = URL(string: "https://standclear.vercel.app")!,
         pollingSleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) })
    {
        self.session = session
        self.baseURL = baseURL
        self.pollingSleep = pollingSleep
    }

    private func fetch<T: Decodable>(_ path: String) async throws -> T {
        #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("--ui-test-fixture") {
                let data = try NativeUITestFixture.data(for: path, now: .now)
                return try JSONDecoder().decode(T.self, from: data)
            }
        #endif
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func stationAlerts() async throws -> StationAlertSnapshot {
        try await fetch("api/alerts")
    }

    func loadLines() async {
        guard active else { return }
        let current = generation
        loading = true
        error = nil
        if linesTask == nil {
            linesRequestID = UUID()
            linesTask = Task { try await self.fetch("gtfsData.json") }
        }
        guard let task = linesTask else { return }
        let requestID = linesRequestID
        defer {
            if current == generation, requestID == linesRequestID {
                loading = false; linesTask = nil
            }
        }
        do {
            let data = try await task.value
            guard active, current == generation, requestID == linesRequestID else { return }
            try Task.checkCancellation()
            let loadedLines = data.lines.values.sorted { $0.routeId < $1.routeId }
            let loadedStations = Transit.stations(loadedLines)
            guard !loadedStations.isEmpty else { throw URLError(.cannotParseResponse) }
            lines = loadedLines
            stations = loadedStations
        } catch is CancellationError {} catch {
            if active, current == generation, requestID == linesRequestID, !Task.isCancelled {
                self.error = "Subway data couldn’t load. Check your connection and try again."
            }
        }
    }

    func stop() {
        active = false
        motionSnapshotRevision = nil
        generation += 1
        refreshTask?.cancel()
        refreshTask = nil
        linesTask?.cancel()
        linesTask = nil
        loading = false
    }

    func refresh() async {
        guard active else { return }
        let current = generation
        if refreshTask == nil {
            refreshID = UUID()
            refreshTask = Task { try await self.fetch("api/trains") }
        }
        guard let task = refreshTask else { return }
        let requestID = refreshID
        do {
            let data = try await task.value
            guard active, current == generation else { return }
            let now = Date.now
            guard data.hasValidTimestamp(at: now) else { throw URLError(.badServerResponse) }
            // A clock change or an invalid cached timestamp must not block recovery.
            if data.generatedAt >= (snapshot?.generatedAt ?? 0) || snapshot?.hasValidTimestamp(at: now) == false {
                snapshot = data
                motionSnapshotRevision = requestID
            }
            feedError = false
        } catch {
            if active, current == generation, !Task.isCancelled {
                feedError = true
                motionSnapshotRevision = nil
            }
        }
        if current == generation, requestID == refreshID {
            refreshTask = nil
        }
    }

    func run() async {
        guard !Task.isCancelled else { return }
        active = true
        let current = generation
        var staticAttempts = 0
        // Retry a transient cold-start failure at the existing polling cadence,
        // at most three times after the first attempt. Manual Retry stays usable.
        while active, current == generation, !Task.isCancelled {
            if lines.isEmpty, staticAttempts < 4 {
                staticAttempts += 1
                await loadLines()
            }
            guard active, current == generation, !Task.isCancelled else { return }
            await refresh()
            guard active, current == generation, !Task.isCancelled else { return }
            do { try await pollingSleep(.seconds(feedError ? 30 : 8)) } catch { return }
        }
    }

    func feedLabel(at now: Date) -> String {
        if feedError {
            return "Live arrivals unavailable"
        }
        guard let snapshot else { return "Connecting to live arrivals…" }
        return snapshot.isFresh(at: now) ? "Arrival feed connected" : "Arrival predictions are stale"
    }
}

#if DEBUG && targetEnvironment(simulator)
    /// Fixed journey anchors for opt-in motion QA; excluded from physical builds.
    struct TemporalMotionFixture {
        private var start: Double?

        struct Sample {
            let generatedAt, reportedAt, eta, progress: Double
            let status: String
        }

        mutating func reset() {
            start = nil
        }

        mutating func sample(at now: Double, stale: Bool = false) -> Sample? {
            guard now.isFinite, now >= 0, (now * 1000).isFinite else { return nil }
            if start == nil {
                start = now
            }
            guard let start else { return nil }
            let source = stale ? start : now
            let eta = start + 120
            guard eta.isFinite else { return nil }
            let progress = min(1, 0.2 + max(0, source - start) / 120 * 0.8)
            return Sample(generatedAt: source * 1000, reportedAt: source, eta: eta,
                          progress: progress, status: source >= eta ? "STOPPED_AT" : "IN_TRANSIT_TO")
        }
    }

    /// Explicit simulator-only UI data. Refresh still uses the normal decoding,
    /// polling, cancellation and freshness gates. Default trips remain stable.
    private enum NativeUITestFixture {
        @MainActor private static var temporalMotion = TemporalMotionFixture()
        @MainActor private static var alertRequests = 0
        @MainActor private static var stationMotionRequests = 0

        @MainActor static func data(for path: String, now: Date) throws -> Data {
            let includeExpress = ProcessInfo.processInfo.arguments.contains("--ui-test-express-arrivals")
            let includeOperational = ProcessInfo.processInfo.arguments.contains("--ui-test-operational-direction")
            let includeMuseum = ProcessInfo.processInfo.arguments.contains("--ui-test-noguchi")
            let payload: [String: Any]
            switch path {
            case "gtfsData.json":
                // Stop identities, order, names, and coordinates come from the
                // checked-in public/gtfsData.json. Geometry joins those stops.
                var lines = [
                    "1": line(id: "1", color: "#D82233", stops: [
                        ("126", "50 St", 40.761728, -73.983849),
                        ("127", "Times Sq-42 St", 40.75529, -73.987495),
                        ("128", "34 St-Penn Station", 40.750373, -73.991057),
                    ]),
                    "4": line(id: "4", color: "#009952", stops: [
                        ("629", "59 St", 40.762526, -73.967967),
                        ("631", "Grand Central-42 St", 40.751776, -73.976848),
                        ("635", "14 St-Union Sq", 40.734673, -73.989951),
                        ("640", "Brooklyn Bridge-City Hall", 40.713065, -74.004131),
                        ("418", "Fulton St", 40.710368, -74.009509),
                        ("419", "Wall St", 40.707557, -74.011862),
                    ]),
                ]
                if includeOperational {
                    lines["E"] = line(id: "E", color: "#0039A6", stops: [
                        ("G05", "Jamaica Center-Parsons/Archer", 40.702147, -73.801109),
                        ("G06", "Sutphin Blvd-Archer Av-JFK Airport", 40.700486, -73.807969),
                        ("G07", "Jamaica-Van Wyck", 40.702566, -73.816859),
                        ("F05", "Briarwood", 40.709179, -73.820574),
                        ("F06", "Kew Gardens-Union Tpke", 40.714441, -73.831008),
                        ("F07", "75 Av", 40.718331, -73.837324),
                        ("G08", "Forest Hills-71 Av", 40.721691, -73.844521),
                        ("G09", "67 Av", 40.726523, -73.852719),
                        ("G10", "63 Dr-Rego Park", 40.729846, -73.861604),
                        ("G11", "Woodhaven Blvd", 40.733106, -73.869229),
                        ("G12", "Grand Av-Newtown", 40.737015, -73.877223),
                        ("G13", "Elmhurst Av", 40.742454, -73.882017),
                        ("G14", "Jackson Hts-Roosevelt Av", 40.746644, -73.891338),
                        ("G15", "65 St", 40.749669, -73.898453),
                        ("G16", "Northern Blvd", 40.752885, -73.906006),
                        ("G18", "46 St", 40.756312, -73.913333),
                        ("G19", "Steinway St", 40.756879, -73.92074),
                        ("G20", "36 St", 40.752039, -73.928781),
                        ("G21", "Queens Plaza", 40.748973, -73.937243),
                        ("F09", "Court Sq-23 St", 40.747846, -73.946),
                        ("F11", "Lexington Av/53 St", 40.757552, -73.969055),
                        ("F12", "5 Av/53 St", 40.760167, -73.975224),
                        ("D14", "7 Av", 40.762862, -73.981637),
                        ("A25", "50 St", 40.762456, -73.985984),
                        ("A27", "42 St-Port Authority Bus Terminal", 40.757308, -73.989735),
                        ("A28", "34 St-Penn Station", 40.752287, -73.993391),
                        ("A30", "23 St", 40.745906, -73.998041),
                        ("A31", "14 St", 40.740893, -74.00169),
                        ("A32", "W 4 St-Wash Sq", 40.732338, -74.000495),
                        ("A33", "Spring St", 40.726227, -74.003739),
                        ("A34", "Canal St", 40.720824, -74.005229),
                        ("E01", "World Trade Center", 40.712582, -74.009781),
                    ])
                }
                if includeExpress {
                    // Static GTFS lists the base service. Only the trip update
                    // explicitly identifies the first Parkchester train as 6X.
                    lines["6"] = line(id: "6", color: "#009952", stops: [
                        ("601", "Pelham Bay Park", 40.852462, -73.828121),
                        ("608", "Parkchester", 40.833226, -73.860816),
                        ("613", "Hunts Point Av", 40.820948, -73.890549),
                    ])
                }
                if includeMuseum {
                    lines["4"] = lexingtonFixtureLine()
                    for route in ["N", "W"] {
                        lines[route] = astoriaFixtureLine(route)
                    }
                }
                if ProcessInfo.processInfo.arguments.contains("--ui-test-route-interchanges") {
                    // Two representative transfer choices with the same services.
                    // Coordinates/complex identities are from the checked-in GTFS.
                    for route in ["N", "W"] {
                        lines[route] = line(id: route, color: "#FCCC0A", stops: [
                            ("R03", "Astoria Blvd", 40.770258, -73.917843),
                            ("R11", "Lexington Av/59 St", 40.76266, -73.967258),
                            ("R20", "14 St-Union Sq", 40.735736, -73.990568),
                        ])
                    }
                }
                if ProcessInfo.processInfo.arguments.contains("--ui-test-staten-island") {
                    lines["SI"] = line(id: "SI", color: "#0039A6", stops: [
                        ("S13", "Richmond Valley", 40.519631, -74.229141),
                        ("S11", "Arthur Kill", 40.516578, -74.242096),
                        ("S09", "Tottenville", 40.512764, -74.251961),
                    ])
                }
                payload = ["lines": lines]
            case "api/alerts":
                alertRequests += 1
                let recovery = ProcessInfo.processInfo.arguments.contains("--ui-test-alert-recovery")
                if recovery, alertRequests == 2 {
                    throw URLError(.notConnectedToInternet)
                }
                let stale = ProcessInfo.processInfo.arguments.contains("--ui-test-stale-alerts") || (recovery && alertRequests == 1)
                let windowEnd = now.timeIntervalSince1970 + (ProcessInfo.processInfo.arguments.contains("--ui-test-alert-window-absolute") ? 2 * 86400 : 2700)
                let bullets = ProcessInfo.processInfo.arguments.contains("--ui-test-route-bullets")
                payload = ["available": true, "generatedAt": now.timeIntervalSince1970 * 1000,
                           "feedTimestamp": now.timeIntervalSince1970 - (stale ? 780 : 0), "alerts": ProcessInfo.processInfo.arguments.contains("--ui-test-empty-alerts") ? [] : [
                               ["id": "fixture-wall", "header": bullets ? "Fixture advisory for [2][3], [F], and [FS]" : "Downtown 4 trains are delayed at Wall St",
                                "description": bullets ? "Take [1] or [6X]. [FS], [GS], and [H] retain their names. Keep [AX] and [planned] literal." : "Allow extra travel time at Wall St.", "effect": "SIGNIFICANT_DELAYS", "severity": "severe",
                                "startTime": now.timeIntervalSince1970 - 3600, "endTime": windowEnd,
                                "routeIds": bullets ? ["1", "2", "3", "6X", "7X", "FX", "GS", "FS", "H", "N", "Q", "UNKNOWN-LONG-ROUTE"] : ["4"], "stopIds": ["419"], "selectors": [["routeId": "4", "stopId": "419"]]],
                               ["id": "fixture-express", "header": "6 express trains are delayed at Pelham Bay Park",
                                "description": "Allow extra travel time for express service.", "effect": "SIGNIFICANT_DELAYS", "severity": "warning",
                                "routeIds": ["6X"], "stopIds": ["601"], "selectors": [["routeId": "6X", "stopId": "601"]]],
                           ]]
            case "api/trains":
                let timestamp = now.timeIntervalSince1970
                if ProcessInfo.processInfo.arguments.contains("--ui-test-station-motion") {
                    stationMotionRequests += 1
                    let stop = stationMotionRequests < 3 ? "128" : "127"
                    let vehicle = train(id: "ui-fixture-station-motion", route: "1", direction: "N", previous: stop, next: stop, timestamp: timestamp)
                        .merging(["progress": 1, "status": "STOPPED_AT"]) { _, updated in updated }
                    return try JSONSerialization.data(withJSONObject: ["generatedAt": timestamp * 1000, "trains": [vehicle], "arrivals": []], options: [.sortedKeys])
                }
                if ProcessInfo.processInfo.arguments.contains("--ui-test-temporal-motion") {
                    guard let sample = temporalMotion.sample(at: timestamp, stale: ProcessInfo.processInfo.arguments.contains("--ui-test-temporal-motion-stale")) else {
                        throw URLError(.badServerResponse)
                    }
                    let vehicle = train(id: "ui-fixture-1-n", route: "1", direction: "N", previous: "128", next: "127", timestamp: sample.reportedAt)
                        .merging(["progress": sample.progress, "status": sample.status]) { _, updated in updated }
                    let reference = train(id: "ui-fixture-reference-4", route: "4", direction: "N", previous: "631", next: "629", timestamp: sample.reportedAt)
                        .merging(["status": "STOPPED_AT"]) { _, updated in updated }
                    return try JSONSerialization.data(withJSONObject: [
                        "generatedAt": sample.generatedAt, "trains": [vehicle, reference],
                        "arrivals": sample.status == "STOPPED_AT" ? [] : [
                            arrival(id: "ui-fixture-1-n", route: "1", stop: "127", direction: "N", destination: "126", eta: sample.eta),
                        ],
                    ], options: [.sortedKeys])
                }
                payload = [
                    "generatedAt": timestamp * 1000,
                    "trains": [
                        train(id: "ui-fixture-1-n", route: "1", direction: "N", previous: "128", next: "127", timestamp: timestamp),
                        train(id: "ui-fixture-4-map", route: "4", direction: "N", previous: "631", next: "629", timestamp: timestamp),
                    ] + (includeExpress ? [
                        train(id: "ui-fixture-6x-n", route: "6X", direction: "N", previous: "613", next: "608", timestamp: timestamp)
                            .merging(["progress": 0.85]) { _, updated in updated },
                    ] : []),
                    "arrivals": [
                        arrival(id: "ui-fixture-1-n", route: "1", stop: "127", direction: "N", destination: "126", eta: timestamp + 150),
                        arrival(id: "ui-fixture-1-s", route: "1", stop: "127", direction: "S", destination: "128", eta: timestamp + 300),
                        arrival(id: "ui-fixture-1-n-later", route: "1", stop: "127", direction: "N", destination: "126", eta: timestamp + 630),
                        arrival(id: "ui-fixture-4-n", route: "4", stop: "419", direction: "N", destination: "629", eta: timestamp + 180),
                        arrival(id: "ui-fixture-4-s", route: "4", stop: "629", direction: "S", destination: "419", eta: timestamp + 240),
                    ] + (includeExpress ? [
                        arrival(id: "ui-fixture-6x-n", route: "6X", stop: "608", direction: "N", destination: "601", eta: timestamp + 120),
                        arrival(id: "ui-fixture-6-s", route: "6", stop: "608", direction: "S", destination: "613", eta: timestamp + 240),
                    ] : []) + (includeOperational ? [
                        arrival(id: "fixture-e-opposite", route: "E", stop: "F11", direction: "S", destination: "E01", eta: timestamp + 90),
                        arrival(id: "fixture-e-jamaica", route: "E", stop: "F11", direction: "N", destination: "G05", eta: timestamp + 450),
                    ] : []) + (includeMuseum ? museumArrivals(at: timestamp) : []) + groupedArrivals(at: timestamp),
                ]
            default:
                throw URLError(.unsupportedURL)
            }
            return try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        }

        /// Simulator-only extract of public/gtfsData.json. Station vertices are
        /// retained while intermediate track points are simplified for the fixture.
        private static func astoriaFixtureLine(_ route: String) -> [String: Any] {
            let shape: [[Double]] = [
                [-73.921479, 40.766779], [-73.925508, 40.76182], [-73.929575, 40.756804],
                [-73.932755, 40.752882], [-73.9338, 40.751634], [-73.936856, 40.749205],
                [-73.937515, 40.749245], [-73.940202, 40.750582], [-73.942083, 40.751651],
                [-73.967258, 40.76266], [-73.972399, 40.764819], [-73.973347, 40.764811],
                [-73.97417, 40.764808], [-73.978759, 40.766646], [-73.979375, 40.766396],
                [-73.980658, 40.764664], [-73.984139, 40.759901], [-73.985775, 40.757477],
                [-73.986754, 40.754672], [-73.98795, 40.749567],
            ]
            let stops: [(String, String, Int)] = [
                ("R04", "30 Av", 0),
                ("R05", "Broadway", 1),
                ("R06", "36 Av", 2),
                ("R08", "39 Av-Dutch Kills", 3),
                ("R09", "Queensboro Plaza", 7),
                ("R11", "Lexington Av/59 St", 9),
                ("R13", "5 Av/59 St", 11),
                ("R14", "57 St-7 Av", 15),
                ("R15", "49 St", 16),
                ("R16", "Times Sq-42 St", 18),
                ("R17", "34 St-Herald Sq", 19),
            ]
            return fixtureTrack(route, color: "#F6BC26", shape: shape, stops: stops)
        }

        private static func lexingtonFixtureLine() -> [String: Any] {
            let shape: [[Double]] = [
                [-73.967967, 40.762526], [-73.975427, 40.7523], [-73.976848, 40.751776],
                [-73.978287, 40.751266], [-73.989845, 40.735409], [-73.989951, 40.734673],
                [-73.989863, 40.733476], [-73.990682, 40.730419], [-73.993622, 40.727308],
                [-73.996631, 40.723488], [-73.99722, 40.722188], [-74.002905, 40.715772],
                [-74.003263, 40.714102], [-74.004131, 40.713065], [-74.005023, 40.712297],
                [-74.008536, 40.711379], [-74.009509, 40.710368], [-74.011862, 40.707557],
            ]
            let stops: [(String, String, Int)] = [
                ("629", "59 St", 0),
                ("631", "Grand Central-42 St", 2),
                ("635", "14 St-Union Sq", 5),
                ("640", "Brooklyn Bridge-City Hall", 13),
                ("418", "Fulton St", 16),
                ("419", "Wall St", 17),
            ]
            return fixtureTrack("4", color: "#009952", shape: shape, stops: stops)
        }

        private static func fixtureTrack(_ route: String, color: String, shape: [[Double]], stops: [(String, String, Int)]) -> [String: Any] {
            ["id": route, "routeId": route, "color": color, "shape": shape,
             "stops": stops.map { id, name, index in
                 ["id": id, "name": name, "lat": shape[index][1], "lng": shape[index][0], "shapeIdx": index] as [String: Any]
             }]
        }

        private static func museumArrivals(at timestamp: Double) -> [[String: Any]] {
            // The two Broadway services use the same platforms. A sooner
            // southbound prediction cannot board a Queens-bound itinerary.
            let wallStreet = [
                arrival(id: "museum-4-s", route: "4", stop: "419", direction: "S", destination: "420", eta: timestamp + 360),
                arrival(id: "museum-4-n-later", route: "4", stop: "419", direction: "N", destination: "629", eta: timestamp + 540),
            ]
            return wallStreet + ["R16", "R15", "R17", "R14", "R13", "R11"].enumerated().flatMap { index, platform in
                let offset = Double(index * 90)
                return [arrival(id: "museum-n-n", route: "N", stop: platform, direction: "N", destination: "R04", eta: timestamp + 540 + offset),
                        arrival(id: "museum-w-n", route: "W", stop: platform, direction: "N", destination: "R04", eta: timestamp + 720 + offset),
                        arrival(id: "museum-w-s", route: "W", stop: platform, direction: "S", destination: "R17", eta: timestamp + 60 + offset)]
            }
        }

        private static func groupedArrivals(at timestamp: Double) -> [[String: Any]] {
            guard ProcessInfo.processInfo.arguments.contains("--ui-test-grouped-arrivals") else { return [] }
            // All northbound arrivals come before the first southbound arrival.
            // A global first-20 cap would hide both the south and unknown groups.
            let north = (1 ... 22).map { index in
                arrival(id: "busy-n-\(index)", route: "4", stop: "631", direction: "N", destination: "629", eta: timestamp + Double(index * 30))
            }
            let south = (1 ... 6).map { index in
                arrival(id: "busy-s-\(index)", route: "4", stop: "631", direction: "S", destination: "419", eta: timestamp + Double(720 + index * 30))
            }
            return north + south + [arrival(id: "busy-unknown", route: "4", stop: "631", direction: "?", destination: "419", eta: timestamp + 960)]
        }

        private static func line(id: String, color: String, stops: [(String, String, Double, Double)]) -> [String: Any] {
            [
                "id": id, "routeId": id, "color": color,
                "stops": stops.enumerated().map { index, stop in
                    ["id": stop.0, "name": stop.1, "lat": stop.2, "lng": stop.3, "shapeIdx": index] as [String: Any]
                },
                "shape": stops.map { [$0.3, $0.2] },
            ]
        }

        private static func train(id: String, route: String, direction: String, previous: String, next: String, timestamp: Double) -> [String: Any] {
            ["id": id, "routeId": route, "direction": direction, "progress": 0.5,
             "prevStopId": previous, "nextStopId": next, "status": "IN_TRANSIT_TO", "lastReportedAt": timestamp]
        }

        private static func arrival(id: String, route: String, stop: String, direction: String, destination: String, eta: Double) -> [String: Any] {
            ["tripId": id, "routeId": route, "stopId": stop, "direction": direction, "destStopId": destination, "eta": eta]
        }
    }
#endif

/// Both deadlines belong to the source timestamp. Receiving the same cached
/// fix again neither extends its lifetime nor permits another early request.
struct LocationFixSchedule {
    static let lifetime: TimeInterval = 30
    private(set) var timestamp: Date?
    private var lastRenewed: Date?

    mutating func accept(_ date: Date) {
        timestamp = date
    }

    mutating func invalidate() {
        timestamp = nil
    }

    static func renewalDate(for date: Date) -> Date {
        date.addingTimeInterval(lifetime - 5)
    }

    func usable(at now: Date) -> Bool {
        guard let timestamp else { return false }
        return abs(now.timeIntervalSince(timestamp)) < Self.lifetime
    }

    mutating func claimRenewal(for date: Date, at now: Date) -> Bool {
        guard timestamp == date, lastRenewed != date, now >= Self.renewalDate(for: date), usable(at: now) else { return false }
        lastRenewed = date
        return true
    }

    mutating func expire(_ date: Date) -> Bool {
        guard timestamp == date else { return false }
        timestamp = nil
        return true
    }
}

@MainActor @Observable
final class LocationStore: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    var coordinate: CLLocationCoordinate2D?
    var status: CLAuthorizationStatus = .notDetermined
    var message: String?
    private var active = false
    private var expiryTask: Task<Void, Never>?
    private var schedule = LocationFixSchedule()

    /// Core Location invokes this manager’s delegate on its creating (main) thread.
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
        status = manager.authorizationStatus
    }

    func start() {
        active = true
        status = manager.authorizationStatus
        switch status {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            message = nil
            manager.requestLocation()
        default: coordinate = nil
        }
    }

    func stop() {
        active = false
        manager.stopUpdatingLocation()
        expiryTask?.cancel()
        schedule.invalidate()
        coordinate = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        status = manager.authorizationStatus
        expiryTask?.cancel()
        schedule.invalidate()
        coordinate = nil
        if active {
            start()
        }
    }

    func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active else { return }
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              abs(location.timestamp.timeIntervalSinceNow) < LocationFixSchedule.lifetime
        else {
            coordinate = nil
            message = "Your location is out of date. Try again or search for a station."
            return
        }
        guard schedule.timestamp.map({ location.timestamp >= $0 }) ?? true else { return }
        coordinate = location.coordinate
        message = nil
        let timestamp = location.timestamp
        guard schedule.timestamp != timestamp else { return }
        schedule.accept(timestamp)
        expiryTask?.cancel()
        let remaining = max(0, LocationFixSchedule.lifetime - Date().timeIntervalSince(timestamp))
        expiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
            guard let self, active, schedule.expire(timestamp) else { return }
            coordinate = nil
            // Coarse one-shot fixes avoid a continuous high-accuracy watch while
            // still expiring stationary/cached coordinates before reusing them.
            manager.requestLocation()
        }
    }

    func locationManager(_: CLLocationManager, didFailWithError _: Error) {
        coordinate = nil
        message = "Your location is unavailable. Try again or search for a station."
    }

    var usableFixTimestamp: Date? {
        availableCoordinate == nil ? nil : schedule.timestamp
    }

    /// A visible location consumer owns this cancellable wait. The ordinary
    /// expiry task remains armed until a newer measurement actually arrives.
    func renewForVisibleLocation(_ timestamp: Date, stillNeeded: () -> Bool) async {
        let delay = LocationFixSchedule.renewalDate(for: timestamp).timeIntervalSinceNow
        if delay > 0 {
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
        }
        guard !Task.isCancelled, active, stillNeeded(), availableCoordinate != nil,
              schedule.claimRenewal(for: timestamp, at: .now) else { return }
        manager.requestLocation()
    }

    var availableCoordinate: CLLocationCoordinate2D? {
        guard status == .authorizedAlways || status == .authorizedWhenInUse, schedule.usable(at: .now) else { return nil }
        return coordinate
    }
}
