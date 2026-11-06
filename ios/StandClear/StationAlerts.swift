import Foundation
import SwiftUI

struct StationAlertSnapshot: Decodable {
    let generatedAt: Double // Response creation, epoch milliseconds.
    let available: Bool?
    let feedTimestamp: Double? // Upstream publication, epoch seconds.
    let alerts: [StationAlert]

    enum Evidence: Equatable {
        case current, lastReported(Date), unknown, unavailable
    }

    func evidence(at now: Date) -> Evidence {
        if available == false {
            return .unavailable
        }
        guard let date = reportDate(at: now) else { return .unknown }
        return now.timeIntervalSince(date) <= 300 ? .current : .lastReported(date)
    }

    func reportDate(at now: Date) -> Date? {
        let generated = generatedAt / 1000
        let time = now.timeIntervalSince1970
        guard available == true, let source = feedTimestamp,
              source.isFinite, source > 0, generated.isFinite, generated > 0,
              max(source, generated) <= time + 30, source <= generated + 30
        else { return nil }
        return Date(timeIntervalSince1970: min(source, generated))
    }
}

struct StationAlert: Decodable, Identifiable {
    let id, header, description, effect, severity: String
    let routeIds, stopIds: [String]
    let selectors: [Selector]?

    struct Selector: Decodable {
        let routeId, stopId: String?
    }

    /// Only known feed aliases share advisory scope. Unknown route IDs retain
    /// their identity rather than inheriting a route from their spelling.
    private static func routeFamily(_ id: String) -> String {
        switch id {
        case "6X": "6"
        case "7X": "7"
        case "FX": "F"
        default: id
        }
    }

    /// A line includes its reported express service and variants beyond the
    /// representative static stopping pattern. An explicit different route
    /// never matches merely because it shares a station with this line.
    func applies(to line: SubwayLine) -> Bool {
        let routeID = Self.routeFamily(line.routeId)
        let stopIDs = Set(line.stops.map(\.id))
        func matchesRoute(_ id: String) -> Bool {
            Self.routeFamily(id) == routeID
        }
        guard let selectors, !selectors.isEmpty else {
            return routeIds.contains(where: matchesRoute) || stopIds.contains(where: stopIDs.contains)
        }
        return selectors.contains { selector in
            if let route = selector.routeId {
                return matchesRoute(route)
            }
            return selector.stopId.map(stopIDs.contains) ?? false
        }
    }

    func applies(to station: Station) -> Bool {
        // Static stations list base routes; an express advisory belongs to the
        // same service family, while any explicit stop scope still must match.
        let routes = Set(station.routes.map(Self.routeFamily))
        func matchesRoute(_ id: String) -> Bool {
            routes.contains(Self.routeFamily(id))
        }
        guard let selectors, !selectors.isEmpty else {
            return stopIds.contains(where: station.stopIDs.contains) || routeIds.contains(where: matchesRoute)
        }
        // A GTFS selector's fields must match together. Any selector may qualify.
        return selectors.contains { selector in
            switch (selector.routeId, selector.stopId) {
            case let (route?, stop?): matchesRoute(route) && station.stopIDs.contains(stop)
            case let (route?, nil): matchesRoute(route)
            case let (nil, stop?): station.stopIDs.contains(stop)
            case (nil, nil): false
            }
        }
    }
}

struct StationAlertsLoad {
    private let scope: String?
    private(set) var snapshot: StationAlertSnapshot?
    private var failed = false
    private(set) var isRequestInFlight = false

    init(scope: String? = nil) {
        self.scope = scope
    }

    func scoped(to id: String) -> Self {
        scope == id ? self : Self(scope: id)
    }

    mutating func beginRequest() {
        isRequestInFlight = true
    }

    mutating func receive(_ report: StationAlertSnapshot) {
        isRequestInFlight = false
        snapshot = report
        failed = false
    }

    mutating func fail() {
        isRequestInFlight = false
        failed = true
    }

    func evidence(at now: Date) -> StationAlertSnapshot.Evidence? {
        failed ? .unavailable : snapshot?.evidence(at: now)
    }

    func lastReportAfterFailure(at now: Date) -> Date? {
        guard failed, let date = snapshot?.reportDate(at: now), date <= now else { return nil }
        return date
    }
}

struct StationAlertSection: View {
    let station: Station
    let load: StationAlertsLoad
    let now: Date
    let retry: () -> Void
    var body: some View {
        ServiceAlertSection(load: load, now: now, retry: retry, includes: { $0.applies(to: station) },
                            emptyMessage: "No service alerts reported for this station.", summaryIdentifier: "stationAlertsSummary", compact: true)
    }
}

struct LineAlertSection: View {
    let line: SubwayLine
    let load: StationAlertsLoad
    let now: Date
    let retry: () -> Void

    var body: some View {
        ServiceAlertSection(load: load, now: now, retry: retry, includes: { $0.applies(to: line) },
                            emptyMessage: "No service alerts reported for this line.", summaryIdentifier: "lineAlertsSummary")
    }
}

private struct ServiceAlertSection: View {
    let load: StationAlertsLoad
    let now: Date
    let retry: () -> Void
    let includes: (StationAlert) -> Bool
    let emptyMessage: String
    let summaryIdentifier: String
    var compact = false
    var systemwide = false
    @State private var expanded = false

    var body: some View {
        Section {
            let matches = load.snapshot?.alerts.filter(includes) ?? []
            switch load.evidence(at: now) {
            case nil: ProgressView("Checking service alerts…")
            case .unavailable: unavailable(lastReported: load.lastReportAfterFailure(at: now))
            case .current:
                if matches.isEmpty, !compact {
                    Text(emptyMessage)
                        .accessibilityIdentifier(systemwide ? "systemAlertsEmpty" : "scopedAlertsEmpty")
                }
            case let .lastReported(date):
                if compact {
                    compactStatus("Alert status unconfirmed", symbol: "clock", lastReported: date)
                } else {
                    Label("Last reported \(date.formatted(date: .abbreviated, time: .shortened)). Current alert status is unconfirmed.", systemImage: "clock")
                    lineRetryButton
                }
            case .unknown:
                if compact {
                    compactStatus("Alert status unconfirmed", symbol: "questionmark.circle")
                } else {
                    Label("Current alert status is unconfirmed.", systemImage: "questionmark.circle")
                    lineRetryButton
                }
            }
            if load.snapshot?.available != false, !matches.isEmpty {
                let severeCount = matches.filter { $0.severity == "severe" }.count
                if systemwide {
                    ForEach(matches) { alert in
                        DisclosureGroup {
                            if !alert.description.isEmpty, alert.description != alert.header {
                                Text(alert.description)
                            } else {
                                Text("No additional details reported.").foregroundStyle(.secondary)
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(alert.severity == "severe" ? "Severe" : alert.severity == "warning" ? "Warning" : "Information",
                                      systemImage: alert.severity == "info" ? "info.circle" : "exclamationmark.triangle")
                                    .font(.subheadline)
                                let routes = Array(Set(alert.routeIds + (alert.selectors ?? []).compactMap(\.routeId))).sorted()
                                if !routes.isEmpty {
                                    Text("Routes: \(routes.map { TransitRouteIdentity($0).spokenName }.joined(separator: ", "))")
                                        .font(.subheadline).foregroundStyle(.secondary)
                                }
                                Text(alert.header.isEmpty ? alert.effect.replacingOccurrences(of: "_", with: " ").capitalized : alert.header)
                                    .font(.headline)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityIdentifier("serviceAlert-\(alert.id)")
                    }
                } else {
                    DisclosureGroup(isExpanded: $expanded) {
                        ForEach(matches) { alert in
                            VStack(alignment: .leading, spacing: 4) {
                                Label(alert.severity == "severe" ? "Severe" : alert.severity == "warning" ? "Warning" : "Information",
                                      systemImage: alert.severity == "info" ? "info.circle" : "exclamationmark.triangle")
                                    .font(.subheadline)
                                Text(alert.header.isEmpty ? alert.effect.replacingOccurrences(of: "_", with: " ").capitalized : alert.header)
                                    .font(.headline)
                                if !alert.description.isEmpty, alert.description != alert.header {
                                    Text(alert.description)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    } label: {
                        let count = "\(matches.count) \(matches.count == 1 ? "advisory" : "advisories")"
                        if severeCount > 0 {
                            Label("\(count) · \(severeCount) severe", systemImage: "exclamationmark.triangle.fill")
                        } else {
                            Text(count)
                        }
                    }
                    .accessibilityIdentifier(summaryIdentifier)
                }
            }
        } header: {
            if !compact, !systemwide {
                Text("Service alerts")
            }
        }
        .listRowBackground(Color.clear)
    }

    private func compactStatus(_ title: String, symbol: String, lastReported: Date? = nil) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .center, spacing: 12) {
                statusLabel(title, symbol: symbol, lastReported: lastReported)
                Spacer(minLength: 0)
                retryButton
            }
            VStack(alignment: .leading, spacing: 4) {
                statusLabel(title, symbol: symbol, lastReported: lastReported)
                retryButton
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
    }

    private func statusLabel(_ title: String, symbol: String, lastReported: Date?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: symbol)
                .font(.subheadline)
            if let lastReported {
                let dateStyle: Date.FormatStyle.DateStyle = Calendar.current.isDate(lastReported, inSameDayAs: now) ? .omitted : .abbreviated
                Text("Last report \(lastReported.formatted(date: dateStyle, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Last reported \(lastReported.formatted(date: .complete, time: .shortened))")
                    .accessibilityIdentifier("stationAlertLastReport")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var lineRetryButton: some View {
        Button(load.isRequestInFlight ? "Checking service alerts…" : "Retry alerts", action: retry)
            .disabled(load.isRequestInFlight)
            .accessibilityIdentifier(systemwide ? "systemAlertsRetry" : "lineAlertsRetry")
    }

    private var retryButton: some View {
        Button(action: retry) {
            Group {
                if load.isRequestInFlight {
                    ProgressView()
                } else {
                    Text("Retry")
                }
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(load.isRequestInFlight)
        .accessibilityLabel(load.isRequestInFlight ? "Checking service alerts" : "Retry service alerts")
        .accessibilityIdentifier("stationAlertsRetry")
    }

    @ViewBuilder private func unavailable(lastReported: Date?) -> some View {
        if compact {
            compactStatus("Service alerts unavailable", symbol: "wifi.exclamationmark", lastReported: lastReported)
        } else {
            statusLabel("Service alerts unavailable", symbol: "wifi.exclamationmark", lastReported: lastReported)
            lineRetryButton
        }
    }
}

/// One active visit, using the existing advisory transport and evidence rules.
/// MapShell keeps the report when the same visit moves between sheet and pane.
struct SystemAlertsView: View {
    let store: TransitStore
    @Binding var load: StationAlertsLoad
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var revision = 0

    private struct Request: Equatable {
        let active: Bool
        let revision: Int
    }

    private var request: Request {
        Request(active: visible && scenePhase == .active, revision: revision)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 5)) { context in
            List {
                ServiceAlertSection(load: load, now: context.date, retry: { revision += 1 }, includes: { _ in true },
                                    emptyMessage: "No service alerts reported.", summaryIdentifier: "systemAlertsSummary", systemwide: true)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .navigationTitle("Service alerts")
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("systemAlertsList")
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Refresh service alerts", systemImage: "arrow.clockwise") { revision += 1 }
                    .disabled(load.isRequestInFlight)
                    .accessibilityIdentifier("systemAlertsRefresh")
            }
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: request) { [request] in
            guard request.active else { return }
            while !Task.isCancelled {
                load.beginRequest()
                do {
                    let snapshot = try await store.stationAlerts()
                    guard !Task.isCancelled, self.request == request else { return }
                    load.receive(snapshot)
                } catch {
                    guard !Task.isCancelled, self.request == request else { return }
                    load.fail()
                }
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
            }
        }
    }
}
