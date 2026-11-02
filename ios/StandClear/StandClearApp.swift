import MapboxMaps
import SwiftUI

@main
struct StandClearApp: App {
    init() {
        if let token = Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String,
           token.hasPrefix("pk.")
        {
            MapboxOptions.accessToken = token
        }
    }

    var body: some Scene {
        WindowGroup { MapShell() }
    }
}
