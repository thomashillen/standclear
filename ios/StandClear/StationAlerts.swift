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
        let generated = generatedAt / 1000
        let time = now.timeIntervalSince1970
        guard available == true, let source = feedTimestamp,
              source.isFinite, source > 0, generated.isFinite, generated > 0,
              max(source, generated) <= time + 30, source <= generated + 30
        else { return .unknown }
        let oldest = min(source, generated)
        return time - oldest <= 300 ? .current : .lastReported(Date(timeIntervalSince1970: oldest))
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

enum StationAlertsLoad {
    case loading, failed, received(StationAlertSnapshot)
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
    @State private var expanded = false

    var body: some View {
        Section {
            switch load {
            case .loading: ProgressView("Checking service alerts…")
            case .failed: unavailable
            case let .received(snapshot):
                let evidence = snapshot.evidence(at: now)
                if evidence == .unavailable {
                    unavailable
                } else {
                    let matches = snapshot.alerts.filter(includes)
                    switch evidence {
                    case .current:
                        if matches.isEmpty, !compact {
                            Text(emptyMessage)
                        }
                    case let .lastReported(date):
                        if compact {
                            compactStatus("Alert status unconfirmed", symbol: "clock", lastReported: date)
                        } else {
                            Label("Last reported \(date.formatted(date: .abbreviated, time: .shortened)). Current alert status is unconfirmed.", systemImage: "clock")
                            Button("Retry alerts", action: retry)
                        }
                    case .unknown:
                        if compact {
                            compactStatus("Alert status unconfirmed", symbol: "questionmark.circle")
                        } else {
                            Label("Current alert status is unconfirmed.", systemImage: "questionmark.circle")
                            Button("Retry alerts", action: retry)
                        }
                    case .unavailable: EmptyView()
                    }
                    if !matches.isEmpty {
                        let severeCount = matches.filter { $0.severity == "severe" }.count
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
            }
        } header: {
            if !compact {
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

    private var retryButton: some View {
        Button(action: retry) {
            Text("Retry")
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Retry service alerts")
        .accessibilityIdentifier("stationAlertsRetry")
    }

    @ViewBuilder private var unavailable: some View {
        if compact {
            compactStatus("Service alerts unavailable", symbol: "wifi.exclamationmark")
        } else {
            Label("Service alerts unavailable", systemImage: "wifi.exclamationmark")
            Button("Retry alerts", action: retry)
        }
    }
}
