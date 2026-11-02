import MapKit
import Observation
import SwiftUI

/// A bounded, flat-map comparison using the same transit projection and artwork
/// as Mapbox. It intentionally does not claim Mapbox's pitched symbol parity.
struct AppleTransitMap: View {
    private let routeGeometry: [AppleRoutePolyline]
    let markers: [TrainMapMarker]
    let focusedCoordinate: CLLocationCoordinate2D?
    let currentLocation: CLLocationCoordinate2D?
    var focusRevision: Int = 0
    var coveredWidth: CGFloat = 0
    var coveredBottom: CGFloat = 0

    init(lines: [SubwayLine], markers: [TrainMapMarker], focusedCoordinate: CLLocationCoordinate2D?,
         focusRevision: Int = 0, coveredWidth: CGFloat = 0, coveredBottom: CGFloat = 0, currentLocation: CLLocationCoordinate2D? = nil)
    {
        // Rebuilt when the parent supplies transit inputs, never when this view's
        // camera state changes. Exact shape changes update without a hash per frame.
        routeGeometry = lines.map { AppleRoutePolyline(id: $0.routeId, color: $0.color, coordinates: $0.coordinates) }
        self.markers = markers
        self.focusedCoordinate = focusedCoordinate
        self.currentLocation = currentLocation
        self.focusRevision = focusRevision
        self.coveredWidth = coveredWidth
        self.coveredBottom = coveredBottom
    }

    @State private var position = MapCameraPosition.region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 40.754, longitude: -73.984),
        span: MKCoordinateSpan(latitudeDelta: 0.14, longitudeDelta: 0.11)
    ))
    @State private var cameraState = AppleTransitCameraState()

    var body: some View {
        GeometryReader { geometry in
            MapKit.Map(position: $position, interactionModes: [.pan, .zoom, .rotate]) {
                ForEach(routeGeometry) { line in
                    MapPolyline(coordinates: line.coordinates)
                        .stroke(Color(uiColor: transitColor(line.color)),
                                style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                }
                ForEach(markers) { marker in
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
    }
}

private struct AppleRoutePolyline: Identifiable {
    let id: String
    let color: String
    let coordinates: [CLLocationCoordinate2D]
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
