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

/// A single results list. Station filtering is local and independent of MapKit.
struct PlaceSearchView<StationRow: View>: View {
    let store: TransitStore
    let location: LocationStore
    let recentStations: RecentStations
    let openWindowPreview: ((PlaceResult) -> Void)?
    @Binding var query: String
    let clearFocus: () -> Void
    let stationRow: (Station, Bool) -> StationRow

    @Environment(\.scenePhase) private var scenePhase
    private let service = PlaceService()
    @State private var revision = 0
    @State private var visible = false
    @State private var state: SearchState = .loading
    @State private var completedQuery: String?

    private enum SearchState { case loading, failed, results([PlaceResult]) }
    private struct Request: Equatable { let text: String; let active: Bool; let revision: Int }
    private var request: Request {
        Request(text: query.trimmingCharacters(in: .whitespacesAndNewlines), active: visible && scenePhase == .active, revision: revision)
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
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: request) { [request] in
            guard request.active else { return }
            if completedQuery == request.text, case .results = state {
                return
            }
            completedQuery = nil
            state = .loading
            guard request.text.count >= 2 else { return }
            do {
                try await Task.sleep(for: .milliseconds(350))
                let items = try await service.search(request.text)
                try Task.checkCancellation()
                guard self.request == request else { return }
                state = .results(items)
            } catch {
                guard !Task.isCancelled, self.request == request else { return }
                state = .failed
            }
            completedQuery = request.text
        }
    }

    @ViewBuilder private func places(for text: String) -> some View {
        if completedQuery != text {
            ProgressView("Searching places…")
        } else {
            switch state {
            case .loading:
                ProgressView("Searching places…")
            case .failed:
                Button("Place search unavailable. Retry", systemImage: "arrow.clockwise") { revision += 1 }
            case let .results(items):
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
            }
        }
    }

    private func placeRow(_ item: PlaceResult) -> some View {
        Group {
            if let openWindowPreview {
                Button {
                    clearFocus()
                    openWindowPreview(item)
                } label: { resultLabel(item) }
            } else {
                NavigationLink {
                    PlacePreview(place: item, store: store, location: location)
                        .onAppear(perform: clearFocus)
                } label: { resultLabel(item) }
            }
        }
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
