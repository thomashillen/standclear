import Foundation
@testable import StandClear
import XCTest

@MainActor
final class TransitStoreTests: XCTestCase {
    private let generatedAt = Date.now.timeIntervalSince1970 * 1000

    func testPlaceRenewalRequestsOncePerSourceTimestampAndDoesNotExtendExpiry() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var schedule = LocationFixSchedule()
        schedule.accept(start)
        XCTAssertFalse(schedule.claimRenewal(for: start, at: start.addingTimeInterval(24)))
        XCTAssertTrue(schedule.claimRenewal(for: start, at: start.addingTimeInterval(25)))
        // Core Location can deliver the same cached measurement in response.
        schedule.accept(start)
        XCTAssertFalse(schedule.claimRenewal(for: start, at: start.addingTimeInterval(26)))
        XCTAssertFalse(schedule.usable(at: start.addingTimeInterval(30)))
        XCTAssertTrue(schedule.expire(start))
        XCTAssertNil(schedule.timestamp)
        XCTAssertFalse(schedule.claimRenewal(for: start, at: start.addingTimeInterval(31)))
    }

    func testNewMeasurementSupersedesOldExpiryAndInactiveRequestCannotRenew() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let fresh = start.addingTimeInterval(26)
        var schedule = LocationFixSchedule()
        schedule.accept(start)
        XCTAssertTrue(schedule.claimRenewal(for: start, at: start.addingTimeInterval(25)))
        schedule.accept(fresh)
        XCTAssertFalse(schedule.expire(start), "An obsolete deadline must not blank the refreshed position")
        XCTAssertTrue(schedule.usable(at: start.addingTimeInterval(31)))
        XCTAssertFalse(schedule.claimRenewal(for: start, at: fresh.addingTimeInterval(25)))
        XCTAssertTrue(schedule.claimRenewal(for: fresh, at: fresh.addingTimeInterval(25)))
        schedule.invalidate()
        XCTAssertFalse(schedule.usable(at: fresh.addingTimeInterval(26)))
        XCTAssertFalse(schedule.claimRenewal(for: fresh, at: fresh.addingTimeInterval(26)))
    }

    func testStopCancelsInFlightRequestAndDoesNotPublishItsResult() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }

        store.stop()
        try await waitUntil { fixture.cancellationCount == 1 }
        XCTAssertNil(store.snapshot)
        XCTAssertNil(store.motionSnapshotRevision)
        XCTAssertFalse(store.feedError, "Cancellation must not appear as an outage")
        await store.refresh()
        XCTAssertEqual(fixture.requestCount, 1, "A stopped store must not start network work")
    }

    func testOverlappingRefreshesShareOneRequest() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }

        var entered = 0
        @MainActor func sharedRefresh() async -> UUID? {
            entered += 1
            await store.refresh()
            return store.motionSnapshotRevision
        }
        let secondRefresh = Task { await sharedRefresh() }
        let thirdRefresh = Task { await sharedRefresh() }
        try await waitUntil { entered == 2 }
        XCTAssertEqual(fixture.requestCount, 1)
        fixture.respond(generatedAt: generatedAt)
        let secondRevision = await secondRefresh.value
        let thirdRevision = await thirdRefresh.value
        let accepted = try XCTUnwrap(store.motionSnapshotRevision)
        XCTAssertEqual(secondRevision, accepted)
        XCTAssertEqual(thirdRevision, accepted)
        XCTAssertEqual(store.snapshot?.generatedAt, generatedAt)
        XCTAssertEqual(fixture.requestCount, 1)
    }

    func testFutureSnapshotCannotBlockRecoveryToValidFeed() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        let now = Date.now.timeIntervalSince1970 * 1000
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: now + 86_400_000)
        try await waitUntil { store.feedError || store.snapshot != nil }
        XCTAssertNil(store.snapshot, "A future timestamp must not become the comparison baseline")
        XCTAssertTrue(store.feedError)
        XCTAssertNil(store.motionSnapshotRevision)

        let recovery = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 2 }
        fixture.respond(generatedAt: now)
        await recovery.value
        XCTAssertEqual(store.snapshot?.generatedAt, now)
        XCTAssertFalse(store.feedError)
        XCTAssertNotNil(store.motionSnapshotRevision)
    }

    func testInvalidRefreshPreservesCacheUntilValidRecovery() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { store.motionSnapshotRevision != nil }
        for (index, invalid) in [0.0, -1, generatedAt + 86_400_000].enumerated() {
            let refresh = Task { await store.refresh() }
            try await waitUntil { fixture.requestCount == index + 2 }
            fixture.respond(generatedAt: invalid)
            await refresh.value
            XCTAssertEqual(store.snapshot?.generatedAt, generatedAt)
            XCTAssertTrue(store.feedError)
            XCTAssertNil(store.motionSnapshotRevision)
        }
        let recovery = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 5 }
        fixture.respond(generatedAt: generatedAt)
        await recovery.value
        XCTAssertFalse(store.feedError)
        XCTAssertNotNil(store.motionSnapshotRevision)
    }

    func testValidResponseReplacesFutureCacheAfterClockChange() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        store.snapshot = Snapshot(generatedAt: generatedAt + 86_400_000, trains: [], arrivals: [])
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { store.motionSnapshotRevision != nil }
        XCTAssertEqual(store.snapshot?.generatedAt, generatedAt)
        XCTAssertFalse(store.feedError)
    }

    func testOlderSnapshotCannotReplaceNewerPredictions() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { store.snapshot != nil }
        let accepted = try XCTUnwrap(store.motionSnapshotRevision)

        let refresh = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 2 }
        fixture.respond(generatedAt: generatedAt - 10000)
        await refresh.value
        XCTAssertEqual(store.snapshot?.generatedAt, generatedAt)
        XCTAssertEqual(store.motionSnapshotRevision, accepted, "Rejected older responses must not advance the motion input")
    }

    func testSameTimestampCorrectionPublishesNewRevisionAndRemovesTrain() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        let timestamp = generatedAt
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: timestamp, includesTrain: true)
        try await waitUntil { store.snapshot?.trains.first?.id == "fixture-train" }
        let originalRevision = try XCTUnwrap(store.motionSnapshotRevision)

        let correction = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 2 }
        fixture.respond(generatedAt: timestamp)
        await correction.value
        XCTAssertEqual(store.snapshot?.generatedAt, timestamp)
        XCTAssertEqual(store.snapshot?.trains.count, 0)
        XCTAssertNotEqual(try XCTUnwrap(store.motionSnapshotRevision), originalRevision)
    }

    func testMotionNeedsAnAcceptedResponseAfterFailureAndForegroundResume() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let firstRun = Task { await store.run() }
        defer { firstRun.cancel(); store.stop() }
        let timestamp = generatedAt
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: timestamp)
        try await waitUntil { store.motionSnapshotRevision != nil }
        let originalRevision = try XCTUnwrap(store.motionSnapshotRevision)

        let failure = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 2 }
        fixture.respond(generatedAt: timestamp, statusCode: 503)
        await failure.value
        XCTAssertTrue(store.feedError)
        XCTAssertNil(store.motionSnapshotRevision)

        let older = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 3 }
        fixture.respond(generatedAt: timestamp - 1000)
        await older.value
        XCTAssertNil(store.motionSnapshotRevision, "An older response cannot make the cached feed eligible again")

        let recovery = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 4 }
        fixture.respond(generatedAt: timestamp)
        await recovery.value
        let recoveredRevision = try XCTUnwrap(store.motionSnapshotRevision)
        XCTAssertNotEqual(originalRevision, recoveredRevision)
        XCTAssertFalse(store.feedError)

        firstRun.cancel()
        store.stop()
        await firstRun.value
        XCTAssertNil(store.motionSnapshotRevision)
        let resumedRun = Task { await store.run() }
        defer { resumedRun.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 5 }
        XCTAssertEqual(store.snapshot?.generatedAt, timestamp)
        XCTAssertNil(store.motionSnapshotRevision, "Previously cached data must not drive motion during the foreground fetch")
        fixture.respond(generatedAt: timestamp)
        try await waitUntil { store.motionSnapshotRevision != nil }
        XCTAssertNotEqual(try XCTUnwrap(store.motionSnapshotRevision), recoveredRevision)
    }

    func testCompletedResponseCannotPublishAfterStoreStops() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }
        // The response has been handed to URLSession, but the main actor has not
        // yielded to the refresh continuation. Backgrounding wins this race.
        fixture.respond(generatedAt: generatedAt)
        store.stop()
        for _ in 0 ..< 10 {
            await Task.yield()
        }
        XCTAssertNil(store.snapshot)
        XCTAssertNil(store.motionSnapshotRevision, "A late response cannot reactivate motion after backgrounding")
        XCTAssertFalse(store.feedError)
    }

    func testStaticStartupFailureRecoversAutomaticallyWithoutStoppingTrainPolling() async throws {
        let fixture = ResponseFixture(), gate = PollingGate()
        let (store, session) = makeStore(fixture, preloadLines: false, pollingSleep: gate.sleep)
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop(); gate.cancel(); session.invalidateAndCancel() }
        try await waitUntil { fixture.requestCount(for: "/gtfsData.json") == 1 }
        fixture.respondStatic(statusCode: 503)
        try await waitUntil { fixture.requestCount(for: "/api/trains") == 1 }
        XCTAssertNotNil(store.error)
        XCTAssertFalse(store.loading)
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { gate.durations.count == 1 }
        XCTAssertEqual(gate.durations, [.seconds(8)])
        XCTAssertNotNil(store.error, "The retry delay must retain the visible failure")
        gate.advance()
        try await waitUntil { fixture.requestCount(for: "/gtfsData.json") == 2 }
        fixture.respondStatic()
        try await waitUntil { fixture.requestCount(for: "/api/trains") == 2 }
        XCTAssertEqual(store.stations.map(\.id), ["127"])
        XCTAssertNil(store.error)
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { gate.durations.count == 2 }
        gate.advance()
        try await waitUntil { fixture.requestCount(for: "/api/trains") == 3 }
        XCTAssertEqual(fixture.requestCount(for: "/gtfsData.json"), 2, "Static requests stop after recovery")
    }

    func testStaticRetryLimitRejectsEmptyPayloadAndManualRetryStillSharesRequest() async throws {
        let fixture = ResponseFixture(), gate = PollingGate()
        let (store, session) = makeStore(fixture, preloadLines: false, pollingSleep: gate.sleep)
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop(); gate.cancel(); session.invalidateAndCancel() }
        for attempt in 1 ... 4 {
            try await waitUntil { fixture.requestCount(for: "/gtfsData.json") == attempt }
            fixture.respondStatic(empty: true)
            try await waitUntil { fixture.requestCount(for: "/api/trains") == attempt }
            XCTAssertTrue(store.lines.isEmpty && store.stations.isEmpty)
            XCTAssertNotNil(store.error, "An empty decoded payload is not recovery")
            fixture.respond(generatedAt: generatedAt, statusCode: 503)
            try await waitUntil { gate.durations.count == attempt }
            XCTAssertEqual(gate.durations.last, .seconds(30))
            gate.advance()
        }
        try await waitUntil { fixture.requestCount(for: "/api/trains") == 5 }
        XCTAssertEqual(fixture.requestCount(for: "/gtfsData.json"), 4)
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { gate.durations.count == 5 }
        let manual = Task { await store.loadLines() }
        try await waitUntil { fixture.requestCount(for: "/gtfsData.json") == 5 }
        var joined = false
        let overlapping = Task { joined = true; await store.loadLines() }
        try await waitUntil { joined }
        XCTAssertEqual(fixture.requestCount(for: "/gtfsData.json"), 5, "Manual retries share an in-flight request")
        fixture.respondStatic()
        await manual.value
        await overlapping.value
        XCTAssertEqual(store.stations.map(\.id), ["127"])
        XCTAssertNil(store.error)
    }

    func testStoppedStaticRetryCannotResumeInANewerActiveGeneration() async throws {
        let fixture = ResponseFixture(), oldGate = PollingGate()
        let (store, session) = makeStore(fixture, preloadLines: false, pollingSleep: oldGate.sleep)
        let oldRun = Task { await store.run() }
        defer { oldRun.cancel(); store.stop(); oldGate.cancel(); session.invalidateAndCancel() }
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respondStatic(statusCode: 503)
        try await waitUntil { fixture.requestCount == 2 }
        fixture.respond(generatedAt: generatedAt)
        try await waitUntil { oldGate.durations.count == 1 }
        store.stop()
        let resumed = Task { await store.run() }
        defer { resumed.cancel() }
        try await waitUntil { fixture.requestCount(for: "/gtfsData.json") == 2 }
        oldGate.advance()
        await oldRun.value
        XCTAssertEqual(fixture.requestCount, 3, "The old run must not join the new generation's work")
        store.stop()
        try await waitUntil { fixture.cancellationCount > 0 }
        await resumed.value
        XCTAssertTrue(store.lines.isEmpty && store.stations.isEmpty)
        XCTAssertFalse(store.loading)
    }

    func testLateStaticResponseCannotPublishAfterStop() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture, preloadLines: false)
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop(); session.invalidateAndCancel() }
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respondStatic()
        store.stop()
        await run.value
        XCTAssertTrue(store.lines.isEmpty && store.stations.isEmpty)
        XCTAssertEqual(fixture.requestCount(for: "/api/trains"), 0)
        XCTAssertFalse(store.loading)
    }

    private func makeStore(_ fixture: ResponseFixture, preloadLines: Bool = true,
                           pollingSleep: @escaping @MainActor (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) -> (TransitStore, URLSession)
    {
        let host = "fixture-\(UUID().uuidString.lowercased()).example"
        FixtureRegistry.shared.register(fixture, host: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let store = TransitStore(session: session, baseURL: URL(string: "https://\(host)")!, pollingSleep: pollingSleep)
        // These tests isolate train polling; static-data parsing has separate coverage.
        if preloadLines {
            store.lines = [SubwayLine(id: "1", routeId: "1", color: "EE352E", stops: [], shape: [])]
        }
        return (store, session)
    }

    private func waitUntil(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(3)
        while !condition() {
            guard Date() < deadline else {
                XCTFail("Timed out waiting for controlled request lifecycle")
                throw URLError(.timedOut)
            }
            try await Task.sleep(for: .milliseconds(10))
        }
    }
}

@MainActor
private final class PollingGate {
    private(set) var durations: [Duration] = []
    private var pending: CheckedContinuation<Void, Error>?

    func sleep(_ duration: Duration) async throws {
        try Task.checkCancellation()
        try await withCheckedThrowingContinuation { continuation in
            durations.append(duration)
            pending = continuation
        }
    }

    func advance() {
        let continuation = pending
        pending = nil
        continuation?.resume()
    }

    func cancel() {
        let continuation = pending
        pending = nil
        continuation?.resume(throwing: CancellationError())
    }
}

/// URLProtocol callbacks run on URLSession's threads; all mutable fixture state
/// lives behind a lock, and each test uses a unique host to avoid shared handlers.
private final class FixtureRegistry: @unchecked Sendable {
    static let shared = FixtureRegistry()
    private let lock = NSLock()
    private var fixtures: [String: ResponseFixture] = [:]
    func register(_ fixture: ResponseFixture, host: String) {
        lock.lock(); defer { lock.unlock() }
        fixtures[host] = fixture
    }

    func fixture(for request: URLRequest) -> ResponseFixture? {
        lock.lock(); defer { lock.unlock() }
        return fixtures[request.url?.host ?? ""]
    }
}

private final class ResponseFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: FixtureURLProtocol?
    private var requests = 0
    private var paths: [String] = []
    private var cancellations = 0
    var requestCount: Int {
        lock.lock(); defer { lock.unlock() }; return requests
    }

    var cancellationCount: Int {
        lock.lock(); defer { lock.unlock() }; return cancellations
    }

    func requestCount(for path: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return paths.filter { $0 == path }.count
    }

    func started(_ request: FixtureURLProtocol) {
        lock.lock(); defer { lock.unlock() }
        pending = request
        requests += 1
        paths.append(request.request.url?.path ?? "")
    }

    func stopped() {
        lock.lock(); defer { lock.unlock() }
        pending = nil
        cancellations += 1
    }

    func respond(generatedAt: Double, includesTrain: Bool = false, statusCode: Int = 200) {
        let trains = includesTrain ? #"[{"id":"fixture-train","routeId":"1","direction":"S","progress":0.5,"prevStopId":"126","nextStopId":"127","status":"IN_TRANSIT_TO"}]"# : "[]"
        let data = Data("{\"generatedAt\":\(generatedAt),\"trains\":\(trains),\"arrivals\":[]}".utf8)
        respond(data: data, statusCode: statusCode)
    }

    func respondStatic(statusCode: Int = 200, empty: Bool = false) {
        let data = Data((empty ? #"{"lines":{}}"# : #"{"lines":{"1":{"id":"1","routeId":"1","color":"EE352E","stops":[{"id":"127","name":"Times Sq-42 St","lat":40.75529,"lng":-73.987495,"shapeIdx":0}],"shape":[[-73.987495,40.75529]]}}}"#).utf8)
        respond(data: data, statusCode: statusCode)
    }

    private func respond(data: Data, statusCode: Int) {
        lock.lock()
        let request = pending
        pending = nil
        lock.unlock()
        guard let request, let url = request.request.url else { return }
        request.client?.urlProtocol(request, didReceive: HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        request.client?.urlProtocol(request, didLoad: data)
        request.client?.urlProtocolDidFinishLoading(request)
    }
}

private final class FixtureURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool {
        FixtureRegistry.shared.fixture(for: request) != nil
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        FixtureRegistry.shared.fixture(for: request)?.started(self)
    }

    override func stopLoading() {
        FixtureRegistry.shared.fixture(for: request)?.stopped()
    }
}

/// Live integration coverage stays separate from deterministic interaction tests.
/// Empty/stale realtime feeds are valid payloads; freshness behavior is covered by
/// TransitModelsTests rather than requiring a particular live train to survive a tap.
@MainActor
final class LiveBackendContractTests: XCTestCase {
    func testProductionEndpointsDecodeWithNativeContracts() async throws {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        func payload(_ path: String) async throws -> Data {
            var request = try URLRequest(url: XCTUnwrap(URL(string: "https://standclear.vercel.app/\(path)")))
            request.timeoutInterval = 20
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await session.data(for: request)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            return data
        }
        let staticData = try await JSONDecoder().decode(StaticData.self, from: payload("gtfsData.json"))
        let stations = Transit.stations(Array(staticData.lines.values))
        XCTAssertFalse(stations.isEmpty)
        for id in ["127", "419", "629"] {
            XCTAssertTrue(stations.contains { $0.id == id }, "Expected NYC station \(id) in the live static contract")
        }
        let snapshot = try await JSONDecoder().decode(Snapshot.self, from: payload("api/trains"))
        XCTAssertTrue(snapshot.generatedAt.isFinite && snapshot.generatedAt > 0)
    }
}
