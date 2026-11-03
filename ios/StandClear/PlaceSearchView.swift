import SwiftUI

struct PlaceSearchView: View {
    let store: TransitStore
    let location: LocationStore
    let openWindowPreview: ((PlaceResult) -> Void)?
    @Environment(\.scenePhase) private var scenePhase
    private let service = PlaceService()
    @State private var query: String
    @State private var revision = 0
    @State private var visible = false
    @State private var state: SearchState = .loading
    @State private var completedQuery: String?

    init(initialQuery: String, store: TransitStore, location: LocationStore, openWindowPreview: ((PlaceResult) -> Void)?) {
        _query = State(initialValue: initialQuery)
        self.store = store
        self.location = location
        self.openWindowPreview = openWindowPreview
    }

    private enum SearchState { case loading, failed, results([PlaceResult]) }
    private struct Request: Equatable { let text: String; let active: Bool; let revision: Int }
    private var request: Request {
        Request(text: query.trimmingCharacters(in: .whitespacesAndNewlines), active: visible && scenePhase == .active, revision: revision)
    }

    var body: some View {
        List {
            if request.text.count < 2 {
                ContentUnavailableView("Find a place in NYC", systemImage: "mappin.and.ellipse", description: Text("Enter at least two characters of a street address or place name."))
            } else if completedQuery != request.text {
                ProgressView("Searching places…")
            } else {
                switch state {
                case .loading: ProgressView("Searching places…")
                case .failed:
                    ContentUnavailableView {
                        Label("Place search unavailable", systemImage: "wifi.exclamationmark")
                    } description: { Text("Check your connection and try again.") } actions: { Button("Retry") { revision += 1 } }
                case let .results(items):
                    if items.isEmpty {
                        ContentUnavailableView.search(text: request.text)
                    }
                    ForEach(items) { item in
                        Group {
                            if let openWindowPreview {
                                Button { openWindowPreview(item) } label: { resultLabel(item) }
                            } else {
                                NavigationLink {
                                    PlacePreview(place: item, store: store, location: location)
                                } label: { resultLabel(item) }
                            }
                        }
                        .accessibilityIdentifier("placeResult-\(item.id)")
                    }
                }
            }
        }
        .navigationTitle("Addresses and places")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Address or place in NYC")
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

    private func resultLabel(_ item: PlaceResult) -> some View {
        VStack(alignment: .leading) {
            Text(item.name)
            if !item.subtitle.isEmpty {
                Text(item.subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}
