import MapKit
import Observation
import SwiftUI

/// MapKit renders cached subway geometry and samples train motion while visible.
struct AppleTransitMap: View {
    let store: TransitStore
    let mapExposed: Bool
    let focusedCoordinate: CLLocationCoordinate2D?
    var focusRevision: Int = 0
    var coveredWidth: CGFloat = 0
    var coveredBottom: CGFloat = 0
    var currentLocation: CLLocationCoordinate2D?
    var tripOverlays: [TripMapOverlay] = []
    var tripFocusRevision: Int = 0
    var destination: PlaceResult?
    var placeRoute: PlaceMapRoute?
    var stationEndpoints: StationTripEndpoints?
    var placeGeometryRevision = 0
    var transferMarker: (text: String, coordinate: CLLocationCoordinate2D)?

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var motion = TrainMotion(lines: [])
    @State private var routeGeometry: [AppleRoutePolyline] = []
    @State private var tripGeometry: [AppleRoutePolyline] = []
    @State private var indexedLinesRevision: UInt64?
    @State private var appliedFeedRevision: UUID?
    @State private var markers: [TrainMapMarker] = []
    @State private var animatingRevision: UUID?
    @State private var entryGeneration: Double?
    @State private var needsEntryAnchor = true
    @State private var position = initialPosition

    private static var initialPosition: MapCameraPosition {
        #if DEBUG && targetEnvironment(simulator)
            let arguments = ProcessInfo.processInfo.arguments
            if ["--ui-test-fixture", "--ui-test-station-motion", "--ui-test-motion-clock", "--ui-test-motion-close-zoom"].allSatisfy(arguments.contains) {
                return .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: 40.7528, longitude: -73.9893),
                    span: MKCoordinateSpan(latitudeDelta: 0.012, longitudeDelta: 0.009)
                ))
            }
        #endif
        return .region(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 40.754, longitude: -73.984),
            span: MKCoordinateSpan(latitudeDelta: 0.14, longitudeDelta: 0.11)
        ))
    }

    @State private var cameraState = AppleTransitCameraState()

    private struct ProjectedTrain: Identifiable {
        let marker: TrainMapMarker
        let point: CGPoint
        var id: TrainMapMarker.ID {
            marker.id
        }
    }

    private func projectedTrains(in frame: CGRect, proxy: MapProxy) -> [ProjectedTrain] {
        let corners = [CGPoint(x: frame.minX, y: frame.minY), CGPoint(x: frame.maxX, y: frame.minY),
                       CGPoint(x: frame.minX, y: frame.maxY), CGPoint(x: frame.maxX, y: frame.maxY)]
        // During a camera animation the live projection can change between camera callbacks.
        let bounds = trainProjectionBounds(corners.compactMap { proxy.convert($0, from: .global) })
        return motion.markers(at: store.motionDate).compactMap { marker in
            if let bounds, !bounds.contains(MKMapPoint(marker.coordinate)) {
                return nil
            }
            guard let point = proxy.convert(marker.coordinate, to: .global), frame.contains(point) else { return nil }
            return ProjectedTrain(marker: marker, point: point)
        }
    }

    private var showsJourney: Bool {
        destination != nil || !tripOverlays.isEmpty || stationEndpoints?.boarding != nil || stationEndpoints?.alighting != nil
    }

    var body: some View {
        let inputs = motionInputs
        let animate = inputs.active && !inputs.reduceMotion && inputs.feedRevision != nil && inputs.feedRevision == animatingRevision
        MapReader { proxy in
            GeometryReader { geometry in
                MapKit.Map(position: $position, interactionModes: [.pan, .zoom, .rotate]) {
                    ForEach(showsJourney ? [] : routeGeometry) { line in
                        MapPolyline(line.polyline)
                            .stroke(line.color,
                                    style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    }
                    ForEach(tripGeometry) { overlay in
                        if overlay.walking {
                            MapPolyline(overlay.polyline)
                                .stroke(.blue, style: StrokeStyle(lineWidth: 4, lineCap: .round, dash: [6, 5]))
                        } else {
                            MapPolyline(overlay.polyline)
                                .stroke(.white, style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
                            MapPolyline(overlay.polyline)
                                .stroke(overlay.color, style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
                        }
                    }
                    ForEach(animate || inputs.feedRevision == nil || inputs.feedRevision != appliedFeedRevision || !inputs.active ? [] : markers) { marker in
                        Annotation("Route \(marker.spokenRouteName) train", coordinate: marker.coordinate) {
                            AppleTrainAnnotation(marker: marker, cameraState: cameraState)
                        }
                        .annotationTitles(.hidden)
                    }
                    if let destination {
                        Marker(destination.name, systemImage: "mappin", coordinate: destination.coordinate)
                        if let start = placeRoute?.startMarker(currentLocation: currentLocation) {
                            Marker("Start", systemImage: "figure.walk", coordinate: start)
                        }
                        if let boarding = placeRoute?.boarding {
                            Marker(boarding.name, systemImage: "tram", coordinate: boarding.coordinate)
                        }
                        if let alighting = placeRoute?.alighting, alighting.id != placeRoute?.boarding?.id {
                            Marker(alighting.name, systemImage: "tram", coordinate: alighting.coordinate)
                        }
                    } else if let stationEndpoints {
                        if let boarding = stationEndpoints.boarding {
                            Marker("Board at \(boarding.name)", systemImage: "tram", coordinate: boarding.coordinate)
                                .annotationTitles(dynamicTypeSize.isAccessibilitySize ? .hidden : .automatic)
                        }
                        if let alighting = stationEndpoints.alighting {
                            Marker("Arrive at \(alighting.name)", systemImage: "mappin", coordinate: alighting.coordinate)
                                .annotationTitles(dynamicTypeSize.isAccessibilitySize ? .hidden : .automatic)
                        }
                    }
                    if let transfer = transferMarker {
                        Marker(transfer.text, systemImage: "arrow.left.arrow.right", coordinate: transfer.coordinate)
                            .annotationTitles(.visible)
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
                    cameraState.camera = context.camera
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
                    let endpoints = placeRoute?.endpoints ?? [destination?.coordinate, stationEndpoints?.boarding?.coordinate,
                                                              stationEndpoints?.alighting?.coordinate].compactMap(\.self)
                    if let region = TripMapOverlay.region(for: tripOverlays, including: endpoints) {
                        position = .region(region)
                    }
                }
                // Apple uses the safe region for its controls and camera framing; the map
                // itself can continue under the native trailing control presentation.
                // Keep the inherited top safe area: overriding it makes MapKit fit
                // itinerary pins behind the compact navigation bar.
                .safeAreaInset(edge: .trailing, spacing: 0) {
                    Color.clear.frame(width: max(0, coveredWidth)).allowsHitTesting(false)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    Color.clear.frame(height: max(0, coveredBottom)).allowsHitTesting(false)
                }
                .overlay {
                    if animate {
                        GeometryReader { overlay in
                            let frame = overlay.frame(in: .global)
                            TimelineView(.animation(minimumInterval: 1.0 / 60)) { _ in
                                if cameraState.camera != nil {
                                    ZStack(alignment: .topLeading) {
                                        let paddedFrame = frame.insetBy(dx: -32, dy: -32)
                                        let rows = projectedTrains(in: paddedFrame, proxy: proxy)
                                        ForEach(rows) { row in
                                            AppleTrainAnnotation(marker: row.marker, cameraState: cameraState)
                                                .position(x: row.point.x - frame.minX, y: row.point.y - frame.minY)
                                        }
                                    }
                                    .frame(width: frame.width, height: frame.height, alignment: .topLeading)
                                }
                            }
                        }
                        .allowsHitTesting(false)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("appleTransitMap")
                .accessibilityLabel("Subway map, Apple Maps")
                .accessibilityValue([transferMarker?.text, placeRoute?.accessibilitySummary ?? destination?.name].compactMap(\.self).joined(separator: ", "))
                .accessibilityHint("Use Search or Nearby for accessible station arrivals.")
            }
        }
        #if DEBUG && targetEnvironment(simulator)
        .overlay(alignment: .trailing) {
            if let clock = StationMotionFixtureClock.enabled {
                Button("Advance motion fixture", systemImage: "forward.frame") {
                    clock.advance()
                    Task { await store.refresh() }
                }
                .buttonStyle(.borderedProminent)
                .labelStyle(.iconOnly)
                .padding()
                .accessibilityIdentifier("advanceMotionFixture")
                .accessibilityValue(String(clock.sampledStage))
                .disabled(clock.finished || clock.sampledStage != clock.stage)
            }
        }
        #endif
        .onChange(of: TripGeometryInput(linesRevision: inputs.linesRevision, focus: tripFocusRevision, placeRevision: placeGeometryRevision, ids: tripOverlays.map(\.id)), initial: true) { _, _ in
            tripGeometry = tripOverlays.compactMap { AppleRoutePolyline(id: $0.id, color: $0.color, coordinates: $0.coordinates, walking: $0.walking) }
        }
        .task(id: inputs) { await render(inputs) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                stopMotion()
            }
        }
        .onChange(of: inputs.reduceMotion) { _, _ in
            // Showing a discrete pose while hidden or with Reduce Motion must
            // not replay an earlier transition when animation becomes eligible.
            stopMotion()
        }
        .onDisappear { stopMotion() }
    }

    private struct TripGeometryInput: Equatable {
        let linesRevision: UInt64
        let focus: Int
        let placeRevision: Int
        let ids: [String]
    }

    private struct MotionInputs: Equatable {
        let linesRevision: UInt64
        let feedRevision: UUID?
        let active: Bool
        let reduceMotion: Bool
        let fixtureTime: Date?
    }

    private var motionInputs: MotionInputs {
        var fixtureTime: Date?
        #if DEBUG && targetEnvironment(simulator)
            fixtureTime = StationMotionFixtureClock.enabled?.now
        #endif
        return MotionInputs(linesRevision: store.linesRevision, feedRevision: store.feedError ? nil : store.motionSnapshotRevision,
                            active: scenePhase == .active && !showsJourney, reduceMotion: reduceMotion || !mapExposed, fixtureTime: fixtureTime)
    }

    private func stopMotion() {
        animatingRevision = nil
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
            motion.update(snapshot: snapshot, now: store.motionDate, feedUnavailable: false)
            appliedFeedRevision = revision
        }
        let discrete = inputs.reduceMotion || entryGeneration != nil
        while !Task.isCancelled, inputs == motionInputs {
            let now = store.motionDate
            let animated = !discrete && inputs.fixtureTime == nil && motion.hasActiveMotion(at: now)
            animatingRevision = animated ? revision : nil
            markers = animated ? [] : motion.markers(at: now, reduceMotion: discrete)
            #if DEBUG && targetEnvironment(simulator)
                StationMotionFixtureClock.enabled?.didSample(at: now, generatedAt: snapshot.generatedAt)
            #endif
            guard snapshot.isFresh(at: now), inputs.fixtureTime == nil else { return }
            // Wake exactly at feed expiry even when coarse sampling. Other
            // input/lifecycle changes cancel this sleep and resample immediately.
            let interval = animated ? motion.latestMotionEnd - now.timeIntervalSince1970 : 5.0
            let remaining = snapshot.generatedAt / 1000 + 60 - now.timeIntervalSince1970
            do { try await Task.sleep(for: .seconds(min(interval, max(0.001, remaining)))) } catch { return }
        }
    }
}

private struct AppleRoutePolyline: Identifiable {
    let id: String
    let color: Color
    let polyline: MKPolyline
    let walking: Bool

    init?(id: String, color: String, coordinates: [CLLocationCoordinate2D], walking: Bool = false) {
        guard coordinates.count >= 2 else { return nil }
        self.id = id
        self.walking = walking
        self.color = Color(uiColor: transitColor(color))
        polyline = MKPolyline(coordinates: coordinates, count: coordinates.count)
    }
}

/// A missing corner or a world-wrap ambiguity leaves the screen projection authoritative.
func trainProjectionBounds(_ corners: [CLLocationCoordinate2D]) -> MKMapRect? {
    guard corners.count == 4, corners.allSatisfy(CLLocationCoordinate2DIsValid) else { return nil }
    let points = corners.map { MKMapPoint($0) }
    let xs = points.map(\.x), ys = points.map(\.y)
    guard let left = xs.min(), let right = xs.max(), let top = ys.min(), let bottom = ys.max(),
          left < right, top < bottom, right - left < MKMapRect.world.size.width / 2 else { return nil }
    return MKMapRect(x: left, y: top, width: right - left, height: bottom - top).insetBy(dx: -1, dy: -1)
}

/// The map view does not read these properties. Only individual marker views
/// observe them, keeping camera callbacks from rebuilding all GTFS polylines.
@MainActor @Observable
private final class AppleTransitCameraState {
    var camera: MapCamera?
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
        .accessibilityLabel("Route \(marker.spokenRouteName) train. Estimated position.")
        .accessibilityValue(TrainMarkerPresentation.accessibilityValue(marker))
    }
}
