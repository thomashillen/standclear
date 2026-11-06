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

/// Bullet palette matches public/gtfsData.json and the MTA brand color chart:
/// https://www.mta.info/document/168976 (verified November 2026).
/// Shares conservative service identity with arrival accessibility labels.
struct TransitBulletStyle {
    let routeID: String

    private var identity: TransitRouteIdentity {
        TransitRouteIdentity(routeID)
    }

    var isExpress: Bool {
        identity.isExpress
    }

    var baseID: String {
        identity.baseID
    }

    var colorHex: String? {
        switch baseID {
        case "1", "2", "3": "D82233"
        case "4", "5", "6": "009952"
        case "7": "9A38A1"
        case "A", "C", "E": "0062CF"
        case "B", "D", "F", "M": "EB6800"
        case "G": "799534"
        case "J", "Z": "8E5C33"
        case "L", "S", "GS", "FS", "H": "7C858C"
        case "N", "Q", "R", "W": "F6BC26"
        case "SI": "08179C"
        default: nil
        }
    }

    var usesBlackLetter: Bool {
        ["N", "Q", "R", "W"].contains(baseID)
    }

    var bullet: String {
        identity.bullet
    }

    var spokenName: String {
        identity.spokenName
    }
}

/// Transit bullets carry route identity; surrounding controls remain native.
struct RouteBadge: View {
    let routeID: String
    var color: String = "808080"
    var renderingContrast: ColorSchemeContrast?
    @Environment(\.colorSchemeContrast) private var contrast
    @ScaledMetric(relativeTo: .caption) private var diameter: CGFloat = 24

    var body: some View {
        let route = TransitBulletStyle(routeID: routeID)
        let palette = TransitPalette(hex: route.colorHex ?? color)
        Group {
            if route.colorHex != nil {
                Text(route.bullet)
                    .font(.caption.weight(.bold))
                    .foregroundStyle((renderingContrast ?? contrast) == .increased ? palette.labelColor : route.usesBlackLetter ? Color.black : Color.white)
                    .frame(minWidth: diameter, minHeight: diameter)
                    .background {
                        if route.isExpress {
                            Image(systemName: "diamond.fill")
                                .resizable()
                                .foregroundStyle(palette.color)
                                .accessibilityHidden(true)
                        } else {
                            Circle().fill(palette.color)
                        }
                    }
            } else {
                // Unknown identifiers remain literal; never invent an express
                // diamond, truncate the name, or borrow another route's identity.
                Text(routeID).font(.caption.weight(.bold)).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityLabel("Route \(route.spokenName)")
    }

    static func displayID(_ routeID: String) -> String {
        ["GS", "FS", "H"].contains(routeID) ? "S" : routeID
    }
}

/// A native adaptive grid preserves every structured service at large text sizes.
struct RouteBadgeGroup: View {
    let routes: [String]
    @ScaledMetric(relativeTo: .caption) private var columnWidth: CGFloat = 32

    var body: some View {
        VStack(alignment: .leading) {
            let known = routes.filter { TransitBulletStyle(routeID: $0).colorHex != nil }
            if !known.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: columnWidth), alignment: .leading)], alignment: .leading) {
                    ForEach(known, id: \.self) { route in RouteBadge(routeID: route) }
                }
            }
            ForEach(routes.filter { TransitBulletStyle(routeID: $0).colorHex == nil }, id: \.self) { route in
                RouteBadge(routeID: route)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Routes: \(routes.map { TransitBulletStyle(routeID: $0).spokenName }.joined(separator: ", "))")
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

/// Tokenize only complete, flat, known route references. Advisory wording is
/// upstream content, not Markdown or a format string.
struct AdvisoryTextContent {
    enum Segment: Equatable {
        case literal(String)
        case route(String)

        var source: String {
            switch self {
            case let .literal(text): text
            case let .route(id): "[\(id)]"
            }
        }

        /// Rendering failures must restore the complete source token.
        func rendered<Value>(literal: (String) -> Value, route: (String) -> Value?) -> Value {
            switch self {
            case let .literal(text): literal(text)
            case let .route(id): route(id) ?? literal(source)
            }
        }
    }

    let segments: [Segment]

    init(_ source: String) {
        var result: [Segment] = []
        var literal = ""
        var cursor = source.startIndex
        while cursor < source.endIndex {
            guard source[cursor] == "[" else {
                literal.append(source[cursor])
                cursor = source.index(after: cursor)
                continue
            }
            let start = cursor
            var depth = 0
            var nested = false
            repeat {
                let character = source[cursor]
                if character == "[" {
                    depth += 1
                    nested = nested || depth > 1
                } else if character == "]" {
                    depth -= 1
                }
                cursor = source.index(after: cursor)
            } while cursor < source.endIndex && depth > 0
            let group = String(source[start ..< cursor])
            let id = String(group.dropFirst().dropLast())
            if depth == 0, !nested, TransitBulletStyle(routeID: id).colorHex != nil {
                if !literal.isEmpty {
                    result.append(.literal(literal)); literal = ""
                }
                result.append(.route(id))
            } else {
                literal += group
            }
        }
        if !literal.isEmpty {
            result.append(.literal(literal))
        }
        segments = result
    }

    var spokenText: String {
        var result = ""
        for (index, segment) in segments.enumerated() {
            switch segment {
            case let .literal(text): result += text
            case let .route(id):
                if let last = result.last, !last.isWhitespace {
                    result += " "
                }
                result += "Route \(TransitRouteIdentity(id).spokenName)"
                if index + 1 < segments.count {
                    switch segments[index + 1] {
                    case .route: result += " "
                    case let .literal(next):
                        if let first = next.first, first.isLetter || first.isNumber {
                            result += " "
                        }
                    }
                }
            }
        }
        return result
    }
}

/// One native Text owns wrapping and accessibility; badge images are only inline
/// attachments. Point size follows the surrounding semantic text style.
struct AdvisoryText: View {
    enum Style: String { case headline, body }
    let source: String
    var style: Style = .body
    @Environment(\.dynamicTypeSize) private var dynamicType
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .headline) private var headlineDiameter: CGFloat = 20
    @ScaledMetric(relativeTo: .body) private var bodyDiameter: CGFloat = 20

    var body: some View {
        let content = AdvisoryTextContent(source)
        let diameter = style == .headline ? headlineDiameter : bodyDiameter
        let pieces: [Text] = content.segments.map { segment in
            segment.rendered(literal: { Text(verbatim: $0) }, route: { route in
                InlineRouteImages.image(route: route, diameter: diameter, scale: displayScale,
                                        dynamicType: dynamicType, contrast: contrast, scheme: scheme, style: style)
                    .map { Text($0).baselineOffset(-diameter * 0.15) }
            })
        }
        pieces.reduce(Text(verbatim: "")) { Text("\($0)\($1)") }
            .font(style == .headline ? .headline : .body)
            .accessibilityLabel(Text(verbatim: content.spokenText))
    }
}

/// Small, process-local cache: images are derived only from recognized route IDs,
/// never arbitrary advisory content. No rasterization on each timeline update.
@MainActor
private enum InlineRouteImages {
    private static let images: NSCache<NSString, CGImage> = {
        let result = NSCache<NSString, CGImage>()
        result.countLimit = 96
        result.totalCostLimit = 4 * 1024 * 1024
        return result
    }()

    static func image(route: String, diameter: CGFloat, scale: CGFloat, dynamicType: DynamicTypeSize,
                      contrast: ColorSchemeContrast, scheme: ColorScheme, style: AdvisoryText.Style) -> Image?
    {
        guard diameter.isFinite, diameter > 0, scale.isFinite, scale > 0,
              TransitBulletStyle(routeID: route).colorHex != nil else { return nil }
        let key = "\(route)|\(diameter)|\(scale)|\(dynamicType)|\(contrast)|\(scheme)|\(style.rawValue)" as NSString
        if let cached = images.object(forKey: key) {
            return Image(decorative: cached, scale: scale, orientation: .up).renderingMode(.original)
        }
        // Render the shared vector at its standard 24-point size, then rasterize
        // directly at the requested Dynamic Type size and physical display scale.
        // This avoids scaling the image twice through the badge's ScaledMetric.
        let renderer = ImageRenderer(content: RouteBadge(routeID: route, renderingContrast: contrast)
            .environment(\.dynamicTypeSize, .large)
            .environment(\.colorScheme, scheme)
            .environment(\.displayScale, scale))
        renderer.scale = scale * diameter / 24
        guard let pixels = renderer.cgImage else { return nil }
        images.setObject(pixels, forKey: key, cost: pixels.bytesPerRow * pixels.height)
        return Image(decorative: pixels, scale: scale, orientation: .up).renderingMode(.original)
    }
}
