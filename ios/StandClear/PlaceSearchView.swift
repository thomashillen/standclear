import SwiftUI

/// Recent station identities are local to this installation. Resolve names and
/// routes from the current dataset, including when it arrives after startup.
@MainActor @Observable
final class RecentStations {
    static let storageKey = "recentStationIDs"
    private let defaults: UserDefaults
    private(set) var ids: [String]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        var seen = Set<String>()
        ids = Array((defaults.stringArray(forKey: Self.storageKey) ?? []).filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && seen.insert($0).inserted
        }.prefix(10))
    }

    func record(_ stationID: String) {
        guard !stationID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, ids.first != stationID else { return }
        ids = [stationID] + ids.filter { $0 != stationID }.prefix(9)
        defaults.set(ids, forKey: Self.storageKey)
    }

    func resolved(in stations: [Station]) -> [Station] {
        ids.compactMap { id in stations.first { $0.id == id } }
    }

    func clear() {
        ids = []
        defaults.removeObject(forKey: Self.storageKey)
    }
}

/// Retain the last completed place lookup in this map window so returning
/// from directions can restore the same list without another MapKit request.
@MainActor @Observable
final class PlaceSearchMemory {
    private var query: String?
    private var places: [PlaceResult] = []

    func results(for text: String) -> [PlaceResult]? {
        query == text ? places : nil
    }

    func remember(_ results: [PlaceResult], for text: String) {
        query = text
        places = results
    }
}

/// A single results list. Station filtering is local and independent of MapKit.
struct PlaceSearchView<StationRow: View>: View {
    let store: TransitStore
    let recentStations: RecentStations
    let placeSearchMemory: PlaceSearchMemory
    let openPlace: (PlaceResult) -> Void
    @Binding var query: String
    let clearFocus: () -> Void
    let stationRow: (Station, Bool) -> StationRow

    @Environment(\.scenePhase) private var scenePhase
    private let service = PlaceService()
    @State private var revision = 0
    @State private var state: SearchState = .loading
    @State private var completedQuery: String?

    private enum SearchState { case loading, failed }
    private struct Request: Equatable { let text: String; let active: Bool; let revision: Int }
    private var request: Request {
        Request(text: query.trimmingCharacters(in: .whitespacesAndNewlines), active: scenePhase == .active, revision: revision)
    }

    var body: some View {
        let text = request.text
        let stations = Transit.searchStations(store.stations, query: text)
        let recent = text.isEmpty ? recentStations.resolved(in: store.stations) : []
        List {
            if !recent.isEmpty {
                Section {
                    ForEach(recent) { station in stationRow(station, true) }
                } header: {
                    HStack {
                        Text("Recent stations")
                        Spacer()
                        Button("Clear", action: recentStations.clear)
                            .accessibilityLabel("Clear recent stations")
                            .accessibilityIdentifier("clearRecentStations")
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }
            if text.count >= 2 {
                Section("Addresses and places") {
                    places(for: text)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            }
            Section("Stations") {
                if store.loading {
                    ProgressView("Loading stations…")
                }
                if store.error != nil {
                    Label("Station search unavailable", systemImage: "wifi.exclamationmark")
                    Button("Retry stations") { Task { await store.loadLines() } }
                } else if stations.isEmpty, !store.loading {
                    Text("No matching stations").foregroundStyle(.secondary)
                }
                ForEach(stations) { station in stationRow(station, false) }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        }
        .accessibilityIdentifier("stationList")
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .listSectionSpacing(.compact)
        .task(id: request) { [request] in
            guard request.active, placeSearchMemory.results(for: request.text) == nil else { return }
            completedQuery = nil
            state = .loading
            guard request.text.count >= 2 else { return }
            do {
                try await Task.sleep(for: .milliseconds(350))
                let items = try await service.search(request.text)
                try Task.checkCancellation()
                guard self.request == request else { return }
                placeSearchMemory.remember(items, for: request.text)
            } catch {
                guard !Task.isCancelled, self.request == request else { return }
                state = .failed
            }
            completedQuery = request.text
        }
    }

    @ViewBuilder private func places(for text: String) -> some View {
        if let items = placeSearchMemory.results(for: text) {
            if items.isEmpty {
                Text("No matching addresses or places").foregroundStyle(.secondary)
            }
            ForEach(items.prefix(3)) { placeRow($0) }
            if items.count > 3 {
                DisclosureGroup("More places") {
                    ForEach(items.dropFirst(3)) { placeRow($0) }
                }
                .id(text)
            }
        } else if completedQuery == text, case .failed = state {
            Button("Place search unavailable. Retry", systemImage: "arrow.clockwise") { revision += 1 }
        } else {
            ProgressView("Searching places…")
        }
    }

    private func placeRow(_ item: PlaceResult) -> some View {
        Button {
            clearFocus()
            openPlace(item)
        } label: { resultLabel(item) }
            .accessibilityIdentifier("placeResult-\(item.id)")
    }

    private func resultLabel(_ item: PlaceResult) -> some View {
        VStack(alignment: .leading) {
            Text(item.name)
            if !item.subtitle.isEmpty {
                Text(item.subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }
}
