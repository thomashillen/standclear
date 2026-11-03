import Foundation
@testable import StandClear
import XCTest

@MainActor
final class TransitStoreTests: XCTestCase {
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
        fixture.respond(generatedAt: 1_800_000_000_000)
        let secondRevision = await secondRefresh.value
        let thirdRevision = await thirdRefresh.value
        let accepted = try XCTUnwrap(store.motionSnapshotRevision)
        XCTAssertEqual(secondRevision, accepted)
        XCTAssertEqual(thirdRevision, accepted)
        XCTAssertEqual(store.snapshot?.generatedAt, 1_800_000_000_000)
        XCTAssertEqual(fixture.requestCount, 1)
    }

    func testOlderSnapshotCannotReplaceNewerPredictions() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        try await waitUntil { fixture.requestCount == 1 }
        fixture.respond(generatedAt: 1_800_000_000_000)
        try await waitUntil { store.snapshot != nil }
        let accepted = try XCTUnwrap(store.motionSnapshotRevision)

        let refresh = Task { await store.refresh() }
        try await waitUntil { fixture.requestCount == 2 }
        fixture.respond(generatedAt: 1_799_999_990_000)
        await refresh.value
        XCTAssertEqual(store.snapshot?.generatedAt, 1_800_000_000_000)
        XCTAssertEqual(store.motionSnapshotRevision, accepted, "Rejected older responses must not advance the motion input")
    }

    func testSameTimestampCorrectionPublishesNewRevisionAndRemovesTrain() async throws {
        let fixture = ResponseFixture()
        let (store, session) = makeStore(fixture)
        defer { session.invalidateAndCancel() }
        let run = Task { await store.run() }
        defer { run.cancel(); store.stop() }
        let timestamp = 1_800_000_000_000.0
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
        let timestamp = 1_800_000_000_000.0
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
        fixture.respond(generatedAt: 1_800_000_000_000)
        store.stop()
        for _ in 0 ..< 10 {
            await Task.yield()
        }
        XCTAssertNil(store.snapshot)
        XCTAssertNil(store.motionSnapshotRevision, "A late response cannot reactivate motion after backgrounding")
        XCTAssertFalse(store.feedError)
    }

    private func makeStore(_ fixture: ResponseFixture) -> (TransitStore, URLSession) {
        let host = "fixture-\(UUID().uuidString.lowercased()).example"
        FixtureRegistry.shared.register(fixture, host: host)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let store = TransitStore(session: session, baseURL: URL(string: "https://\(host)")!)
        // These tests isolate train polling; static-data parsing has separate coverage.
        store.lines = [SubwayLine(id: "1", routeId: "1", color: "EE352E", stops: [], shape: [])]
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
    private var cancellations = 0
    var requestCount: Int {
        lock.lock(); defer { lock.unlock() }; return requests
    }

    var cancellationCount: Int {
        lock.lock(); defer { lock.unlock() }; return cancellations
    }

    func started(_ request: FixtureURLProtocol) {
        lock.lock(); defer { lock.unlock() }
        pending = request
        requests += 1
    }

    func stopped() {
        lock.lock(); defer { lock.unlock() }
        pending = nil
        cancellations += 1
    }

    func respond(generatedAt: Double, includesTrain: Bool = false, statusCode: Int = 200) {
        lock.lock()
        let request = pending
        pending = nil
        lock.unlock()
        guard let request, let url = request.request.url else { return }
        let trains = includesTrain ? #"[{"id":"fixture-train","routeId":"1","direction":"S","progress":0.5,"prevStopId":"126","nextStopId":"127","status":"IN_TRANSIT_TO"}]"# : "[]"
        let data = Data("{\"generatedAt\":\(generatedAt),\"trains\":\(trains),\"arrivals\":[]}".utf8)
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
