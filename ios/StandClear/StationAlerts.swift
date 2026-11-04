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

    /// A line includes its reported express service and variants beyond the
    /// representative static stopping pattern. An explicit different route
    /// never matches merely because it shares a station with this line.
    func applies(to line: SubwayLine) -> Bool {
        let routeID = TransitRouteIdentity(line.routeId).baseID
        let stopIDs = Set(line.stops.map(\.id))
        func matchesRoute(_ id: String) -> Bool {
            TransitRouteIdentity(id).baseID == routeID
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
        guard let selectors, !selectors.isEmpty else {
            return stopIds.contains(where: station.stopIDs.contains) || routeIds.contains(where: station.routes.contains)
        }
        // A GTFS selector's fields must match together. Any selector may qualify.
        return selectors.contains { selector in
            switch (selector.routeId, selector.stopId) {
            case let (route?, stop?): station.routes.contains(route) && station.stopIDs.contains(stop)
            case let (route?, nil): station.routes.contains(route)
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
                            emptyMessage: "No service alerts reported for this station.", summaryIdentifier: "stationAlertsSummary")
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
    @State private var expanded = false

    var body: some View {
        Section("Service alerts") {
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
                        if matches.isEmpty {
                            Text(emptyMessage)
                        }
                    case let .lastReported(date):
                        Label("Last reported \(date.formatted(date: .abbreviated, time: .shortened)). Current alert status is unconfirmed.", systemImage: "clock")
                        Button("Retry alerts", action: retry)
                    case .unknown:
                        Label("Current alert status is unconfirmed.", systemImage: "questionmark.circle")
                        Button("Retry alerts", action: retry)
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
        }
        .listRowBackground(Color.clear)
    }

    @ViewBuilder private var unavailable: some View {
        Label("Service alerts unavailable", systemImage: "wifi.exclamationmark")
        Button("Retry alerts", action: retry)
    }
}
