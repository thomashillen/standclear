import MapKit
import Observation
import SwiftUI

/// MapKit renders cached subway geometry and samples train motion while visible.
struct AppleTransitMap: View {
    let store: TransitStore
    let focusedCoordinate: CLLocationCoordinate2D?
    var focusRevision: Int = 0
    var coveredWidth: CGFloat = 0
    var coveredBottom: CGFloat = 0
    var currentLocation: CLLocationCoordinate2D?
    var tripOverlays: [TripMapOverlay] = []
    var tripFocusRevision: Int = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var motion = TrainMotion(lines: [])
    @State private var routeGeometry: [AppleRoutePolyline] = []
    @State private var tripGeometry: [AppleRoutePolyline] = []
    @State private var indexedLinesRevision: UInt64?
    @State private var appliedFeedRevision: UUID?
    @State private var markers: [TrainMapMarker] = []
    @State private var entryGeneration: Double?
    @State private var needsEntryAnchor = true
    @State private var position = MapCameraPosition.region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 40.754, longitude: -73.984),
        span: MKCoordinateSpan(latitudeDelta: 0.14, longitudeDelta: 0.11)
    ))
    @State private var cameraState = AppleTransitCameraState()

    var body: some View {
        let inputs = motionInputs
        GeometryReader { geometry in
            MapKit.Map(position: $position, interactionModes: [.pan, .zoom, .rotate]) {
                ForEach(routeGeometry) { line in
                    MapPolyline(line.polyline)
                        .stroke(line.color,
                                style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                }
                ForEach(tripGeometry) { overlay in
                    MapPolyline(overlay.polyline)
                        .stroke(.white, style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
                    MapPolyline(overlay.polyline)
                        .stroke(overlay.color,
                                style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
                }
                ForEach(inputs.feedRevision == nil || !inputs.active ? [] : markers) { marker in
                    Annotation("Route \(marker.displayLetter) train", coordinate: marker.coordinate) {
                        AppleTrainAnnotation(marker: marker, cameraState: cameraState)
                    }
                    .annotationTitles(.hidden)
                }
                if let currentLocation {
                    // Use the same expiring foreground fix as nearby arrivals.
                    // UserAnnotation would introduce an independent location source.
                    Annotation("Your approximate location", coordinate: currentLocation) {
                        Circle()
                            .fill(.white)
                            .frame(width: 18, height: 18)
                            .overlay {
                                Circle().fill(Color(uiColor: .systemBlue)).frame(width: 12, height: 12)
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("Your approximate location")
                            .accessibilityIdentifier("userLocationDot")
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapStyle(.standard(elevation: .flat, emphasis: .muted,
                                pointsOfInterest: .excludingAll, showsTraffic: false))
            .mapControls {
                MapCompass()
                MapScaleView()
            }
            .onMapCameraChange(frequency: .continuous) { context in
                cameraState.update(heading: context.camera.heading,
                                   zoom: TrainMarkerSizing.zoom(longitudeSpan: context.region.span.longitudeDelta,
                                                                viewportWidth: max(1, geometry.size.width - max(0, coveredWidth))))
            }
            .onChange(of: focusRevision, initial: true) { _, _ in
                guard let focusedCoordinate else { return }
                position = .region(MKCoordinateRegion(
                    center: focusedCoordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.018, longitudeDelta: 0.014)
                ))
            }
            .onChange(of: tripFocusRevision, initial: true) { _, _ in
                if let region = TripMapOverlay.region(for: tripOverlays) {
                    position = .region(region)
                }
            }
            // Apple uses the safe region for its controls and camera framing; the map
            // itself can continue under the native trailing control presentation.
            .safeAreaInset(edge: .trailing, spacing: 0) {
                Color.clear.frame(width: max(0, coveredWidth)).allowsHitTesting(false)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: max(0, coveredBottom)).allowsHitTesting(false)
            }
            .ignoresSafeArea(edges: .top)
            .accessibilityIdentifier("appleTransitMap")
            .accessibilityLabel("Apple Maps subway comparison")
            .accessibilityHint("Use Search or Nearby for accessible station arrivals.")
        }
        .onChange(of: TripGeometryInput(linesRevision: inputs.linesRevision, focus: tripFocusRevision, ids: tripOverlays.map(\.id)), initial: true) { _, _ in
            tripGeometry = tripOverlays.compactMap { AppleRoutePolyline(id: $0.id, color: $0.color, coordinates: $0.coordinates) }
        }
        .task(id: inputs) { await render(inputs) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                stopMotion()
            }
        }
        .onDisappear { stopMotion() }
    }

    private struct TripGeometryInput: Equatable {
        let linesRevision: UInt64
        let focus: Int
        let ids: [String]
    }

    private struct MotionInputs: Equatable {
        let linesRevision: UInt64
        let feedRevision: UUID?
        let active: Bool
        let reduceMotion: Bool
    }

    private var motionInputs: MotionInputs {
        MotionInputs(linesRevision: store.linesRevision, feedRevision: store.feedError ? nil : store.motionSnapshotRevision,
                     active: scenePhase == .active, reduceMotion: reduceMotion)
    }

    private func stopMotion() {
        motion.reset()
        markers = []
        appliedFeedRevision = nil
        needsEntryAnchor = true
    }

    private func render(_ inputs: MotionInputs) async {
        guard !Task.isCancelled, inputs == motionInputs else { return }
        if needsEntryAnchor {
            // A newly visible map can show a fresh cached observation. Do not
            // advance it through the time spent away or blend from that path.
            entryGeneration = store.snapshot?.generatedAt
            needsEntryAnchor = false
        }
        guard inputs.active else { stopMotion(); return }
        if indexedLinesRevision != inputs.linesRevision {
            let lines = store.lines
            routeGeometry = lines.compactMap { AppleRoutePolyline(id: $0.routeId, color: $0.color, coordinates: $0.coordinates) }
            motion = TrainMotion(lines: lines)
            indexedLinesRevision = inputs.linesRevision
            appliedFeedRevision = nil
        }
        guard let revision = inputs.feedRevision, let snapshot = store.snapshot else {
            // After a failed refresh or lifecycle interruption, the previous
            // generation can resume only as a discrete, fresh observation.
            entryGeneration = store.snapshot?.generatedAt
            motion.reset()
            markers = []
            appliedFeedRevision = nil
            return
        }
        if let entryGeneration, snapshot.generatedAt > entryGeneration {
            motion.reset()
            self.entryGeneration = nil
        }
        if appliedFeedRevision != revision {
            motion.update(snapshot: snapshot, now: .now, feedUnavailable: false)
            appliedFeedRevision = revision
        }
        let discrete = inputs.reduceMotion || entryGeneration != nil
        while !Task.isCancelled, inputs == motionInputs {
            let now = Date()
            markers = motion.markers(at: now, reduceMotion: discrete)
            guard snapshot.isFresh(at: now) else { return }
            // Wake exactly at feed expiry even when coarse sampling. Other
            // input/lifecycle changes cancel this sleep and resample immediately.
            let interval = !discrete && motion.hasActiveMotion(at: now) ? 0.25 : 5.0
            let remaining = snapshot.generatedAt / 1000 + 60 - now.timeIntervalSince1970
            do { try await Task.sleep(for: .seconds(min(interval, max(0.001, remaining)))) } catch { return }
        }
    }
}

private struct AppleRoutePolyline: Identifiable {
    let id: String
    let color: Color
    let polyline: MKPolyline

    init?(id: String, color: String, coordinates: [CLLocationCoordinate2D]) {
        guard coordinates.count >= 2 else { return nil }
        self.id = id
        self.color = Color(uiColor: transitColor(color))
        polyline = MKPolyline(coordinates: coordinates, count: coordinates.count)
    }
}

/// The map view does not read these properties. Only individual marker views
/// observe them, keeping camera callbacks from rebuilding all GTFS polylines.
@MainActor @Observable
private final class AppleTransitCameraState {
    var heading = 0.0
    var zoom = 11.0

    func update(heading: Double, zoom: Double) {
        if heading.isFinite, self.heading != heading {
            self.heading = heading
        }
        if zoom.isFinite, self.zoom != zoom {
            self.zoom = zoom
        }
    }
}

private struct AppleTrainAnnotation: View {
    let marker: TrainMapMarker
    let cameraState: AppleTransitCameraState
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

    var body: some View {
        let baseScale = TrainMarkerSizing.scale(zoom: cameraState.zoom)
        let scale = differentiateWithoutColor ? max(0.85, baseScale) : baseScale
        let labelOpacity = differentiateWithoutColor ? 1 : TrainMarkerSizing.labelOpacity(zoom: cameraState.zoom)
        ZStack {
            if let bearing = marker.bearingDegrees {
                TrainCarArtwork(color: marker.color)
                    .rotationEffect(.degrees(bearing - 90 - cameraState.heading))
            } else {
                // A round symbol avoids inventing a travel direction when the
                // current feed cannot establish one, including terminal queues.
                Circle()
                    .fill(Color(uiColor: transitColor(marker.color)))
                    .overlay { Circle().strokeBorder(.white, lineWidth: 1.5) }
                    .frame(width: 24, height: 24)
            }
            Text(marker.displayLetter)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(marker.textColor == "black" ? Color.black : Color.white)
                .fixedSize()
                .opacity(labelOpacity)
        }
        .frame(width: 46, height: 24)
        .scaleEffect(scale)
        .frame(width: 46 * scale, height: 24 * scale)
        .opacity(marker.opacity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Route \(marker.displayLetter) train. Estimated position.")
        .accessibilityValue(accessibilityValue(marker))
    }

    private func accessibilityValue(_ marker: TrainMapMarker) -> String {
        var details: [String] = []
        if marker.bearingDegrees == nil {
            details.append("Travel direction is unavailable")
        }
        if marker.stale {
            details.append("Position report is over 90 seconds old")
        }
        return details.joined(separator: ". ")
    }
}
