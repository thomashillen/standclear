import SwiftUI
import UIKit

/// StandClear's top-down car silhouette. The cab points east; map engines rotate
/// the body with travel bearing while rendering the route text upright separately.
struct TrainCarArtwork: View {
    let color: String

    var body: some View {
        Canvas { context, size in
            context.scaleBy(x: size.width / 92, y: size.height / 40)
            let palette = TransitPalette(hex: color)
            let bodyRect = CGRect(x: 11, y: 5, width: 70, height: 30)
            let body = Path(roundedRect: bodyRect, cornerRadius: 6)

            // The short twin beams and cab distinguish the nose even when route
            // colors coincide, without suggesting additional realtime information.
            for y in [11.0, 29.0] {
                var beam = Path()
                beam.move(to: CGPoint(x: 80, y: y - 1.5))
                beam.addLine(to: CGPoint(x: 91, y: y - 4))
                beam.addLine(to: CGPoint(x: 91, y: y + 4))
                beam.addLine(to: CGPoint(x: 80, y: y + 1.5))
                beam.closeSubpath()
                context.fill(beam, with: .linearGradient(
                    Gradient(colors: [.white.opacity(0.55), .white.opacity(0)]),
                    startPoint: CGPoint(x: 80, y: y), endPoint: CGPoint(x: 91, y: y)
                ))
            }
            context.fill(body, with: .color(palette.color))
            context.fill(body, with: .linearGradient(
                Gradient(stops: [
                    .init(color: .white.opacity(0.25), location: 0),
                    .init(color: .clear, location: 0.45),
                    .init(color: .black.opacity(0.25), location: 1),
                ]),
                startPoint: CGPoint(x: 46, y: 5), endPoint: CGPoint(x: 46, y: 35)
            ))
            context.stroke(body, with: .color(.white.opacity(0.8)), lineWidth: 1.5)
            let roof = Path(roundedRect: CGRect(x: 22, y: 7, width: 44, height: 2), cornerRadius: 1)
            context.fill(roof, with: .color(.white.opacity(0.45)))

            for y in [11.0, 29.0] {
                let light = Path(ellipseIn: CGRect(x: 74.5, y: y - 1.7, width: 3.4, height: 3.4))
                context.fill(light, with: .color(Color(red: 1, green: 0.96, blue: 0.86)))
            }
            let windshield = Path(roundedRect: CGRect(x: 72, y: 16, width: 6, height: 8), cornerRadius: 1.5)
            context.fill(windshield, with: .color(.black.opacity(0.5)))
            for y in [11.0, 27.0] {
                context.fill(Path(CGRect(x: 15, y: y, width: 2.5, height: 2.5)), with: .color(.black.opacity(0.5)))
            }
        }
        .frame(width: 46, height: 20)
        .accessibilityHidden(true)
    }
}

/// The Mapbox image API needs a UIImage. Rendering the reusable SwiftUI drawing
/// once per route avoids per-train view snapshots and keeps artwork map-independent.
@MainActor
final class TrainSpriteCache {
    static let shared = TrainSpriteCache()
    private var images: [String: UIImage] = [:]

    func image(routeID: String, color: String) -> UIImage {
        let key = "\(routeID):\(color.uppercased())"
        if let image = images[key] {
            return image
        }
        let renderer = ImageRenderer(content: TrainCarArtwork(color: color))
        renderer.scale = 3
        renderer.isOpaque = false
        let image = renderer.uiImage ?? UIImage(systemName: "tram.fill") ?? UIImage()
        images[key] = image
        return image
    }
}

/// Transit bullets are deliberately custom: route color and text carry meaning.
/// Surrounding navigation and controls retain their standard SwiftUI presentation.
struct RouteBadge: View {
    let routeID: String
    let color: String
    @ScaledMetric(relativeTo: .caption) private var diameter: CGFloat = 24

    var body: some View {
        let palette = TransitPalette(hex: color)
        Text(Self.displayID(routeID))
            .font(.caption.weight(.bold))
            .foregroundStyle(palette.labelColor)
            .frame(minWidth: diameter, minHeight: diameter)
            .background(palette.color, in: Circle())
            .accessibilityLabel("Route \(Self.displayID(routeID))")
    }

    static func displayID(_ routeID: String) -> String {
        ["GS", "FS", "H"].contains(routeID) ? "S" : routeID
    }
}

private struct TransitPalette {
    let red: Double
    let green: Double
    let blue: Double

    init(hex: String) {
        let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x808080
        red = Double((value >> 16) & 255) / 255
        green = Double((value >> 8) & 255) / 255
        blue = Double(value & 255) / 255
    }

    var color: Color {
        Color(red: red, green: green, blue: blue)
    }

    var labelColor: Color {
        func linear(_ component: Double) -> Double {
            component <= 0.04045 ? component / 12.92 : pow((component + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
        return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? .black : .white
    }
}
