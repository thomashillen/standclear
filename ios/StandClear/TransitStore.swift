import CoreLocation
import Foundation
import Observation

@MainActor @Observable
final class TransitStore {
    var lines: [SubwayLine] = []
    var stations: [Station] = []
    var snapshot: Snapshot?
    var loading = true
    var error: String?
    var feedError = false
    private var refreshTask: Task<Snapshot, Error>?
    private var refreshID = UUID()
    private var linesTask: Task<StaticData, Error>?
    private var active = false
    private var generation = 0
    private let baseURL: URL
    private let session: URLSession

    init(session: URLSession = .shared,
         baseURL: URL = URL(string: "https://standclear.vercel.app")!)
    {
        self.session = session
        self.baseURL = baseURL
    }

    private func fetch<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func loadLines() async {
        guard active else { return }
        let current = generation
        loading = true
        error = nil
        defer {
            if current == generation {
                loading = false; linesTask = nil
            }
        }
        if linesTask == nil {
            linesTask = Task { try await self.fetch("gtfsData.json") }
        }
        guard let task = linesTask else { return }
        do {
            let data = try await task.value
            guard active, current == generation else { return }
            try Task.checkCancellation()
            lines = data.lines.values.sorted { $0.routeId < $1.routeId }
            stations = Transit.stations(lines)
        } catch is CancellationError {} catch {
            if active, current == generation, !Task.isCancelled {
                self.error = "Subway data couldn’t load. Check your connection and try again."
            }
        }
    }

    func stop() {
        active = false
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
            if data.generatedAt >= (snapshot?.generatedAt ?? 0) {
                snapshot = data
            }
            feedError = false
        } catch {
            if active, current == generation, !Task.isCancelled {
                feedError = true
            }
        }
        if current == generation, requestID == refreshID {
            refreshTask = nil
        }
    }

    func run() async {
        active = true
        if lines.isEmpty {
            await loadLines()
        }
        while !Task.isCancelled {
            await refresh()
            do { try await Task.sleep(for: .seconds(feedError ? 30 : 8)) } catch { return }
        }
    }

    func feedLabel(at now: Date) -> String {
        if feedError {
            return "Live arrivals unavailable"
        }
        guard let snapshot else { return "Connecting to live arrivals…" }
        return snapshot.isFresh(at: now) ? "Latest arrival predictions" : "Arrival predictions are stale"
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
        coordinate = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        status = manager.authorizationStatus
        coordinate = nil
        if active {
            start()
        }
    }

    func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active else { return }
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              abs(location.timestamp.timeIntervalSinceNow) < 30
        else {
            coordinate = nil
            message = "Your location is out of date. Try again or search for a station."
            return
        }
        coordinate = location.coordinate
        message = nil
        expiryTask?.cancel()
        let remaining = max(0, 30 - Date().timeIntervalSince(location.timestamp))
        expiryTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
            self?.coordinate = nil
            guard let self, active else { return }
            // Coarse one-shot fixes avoid a continuous high-accuracy watch while
            // still expiring stationary/cached coordinates before reusing them.
            manager.requestLocation()
        }
    }

    func locationManager(_: CLLocationManager, didFailWithError _: Error) {
        coordinate = nil
        message = "Your location is unavailable. Try again or search for a station."
    }

    var availableCoordinate: CLLocationCoordinate2D? {
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return nil }
        return coordinate
    }
}
