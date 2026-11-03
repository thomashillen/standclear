import SwiftUI

/// A single results list. Station filtering is local and independent of MapKit.
struct PlaceSearchView<StationRow: View>: View {
    let store: TransitStore
    let location: LocationStore
    let openWindowPreview: ((PlaceResult) -> Void)?
    @Binding var query: String
    let clearFocus: () -> Void
    let stationRow: (Station) -> StationRow

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
        let stations = text.isEmpty ? store.stations : store.stations.filter { $0.stop.name.localizedStandardContains(text) }
        List {
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
                ForEach(stations) { station in stationRow(station) }
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
