import Foundation

/// Shared with the web's lib/iconScale.ts. Both native engines use the same
/// car-size curve so the comparison does not favor one with larger artwork.
enum TrainMarkerSizing {
    static let scaleStops: [(zoom: Double, scale: Double)] = [
        (10, 0.29), (11.5, 0.5), (13, 0.74), (14, 1.03),
    ]

    static func scale(zoom: Double) -> Double {
        guard zoom.isFinite, let first = scaleStops.first, let last = scaleStops.last else { return 0.29 }
        if zoom <= first.zoom {
            return first.scale
        }
        if zoom >= last.zoom {
            return last.scale
        }
        for index in 1 ..< scaleStops.count {
            let lower = scaleStops[index - 1], upper = scaleStops[index]
            if zoom <= upper.zoom {
                return lower.scale + (zoom - lower.zoom) / (upper.zoom - lower.zoom) * (upper.scale - lower.scale)
            }
        }
        return last.scale
    }

    static func labelOpacity(zoom: Double) -> Double {
        guard zoom.isFinite else { return 0 }
        return min(1, max(0, (zoom - 12) / 0.5))
    }

    /// Approximate a Mapbox-compatible zoom using a 512-point Mercator world.
    /// MapKit's coordinate region is a bounding box, so this is a comparison
    /// sizing estimate, especially while rotating, not an exact engine zoom.
    static func zoom(longitudeSpan: Double, viewportWidth: Double) -> Double {
        guard longitudeSpan.isFinite, viewportWidth.isFinite,
              longitudeSpan > 0, viewportWidth > 0 else { return 10 }
        let result = log2(360 * viewportWidth / (512 * longitudeSpan))
        return result.isFinite ? result : 10
    }
}
