import type { CapacitorConfig } from "@capacitor/cli";

// ─── Capacitor configuration ─────────────────────────────────────────
// StandClear ships as a native iOS (and later Android) app via
// Capacitor. The native shell loads the live web app at
// `https://standclear.app` inside a WebView, with native plugins
// layered on top for things the web platform can't do well: native
// splash screen, status bar styling, push notifications, share
// extensions.
//
// Loading the live site (vs. bundling a static export of Next.js)
// trades app-bundle freshness for instant updates: a copy fix or a
// route tweak goes live the moment Vercel deploys, with no App Store
// review queue. The native shell itself only needs an App Store
// update when we add native plugins or change the native config —
// rare, vs. weekly UX iteration on the web.
//
// The pattern Apple Review accepts in 2026 is "WebView wrapper
// PLUS real native value-add" (push, share, splash, status bar,
// haptics, biometrics where relevant). Pure WebView wrappers with
// no native value still risk 4.2 rejection; we sidestep that by
// shipping a meaningful native plugin set from day one.

const config: CapacitorConfig = {
  // Reverse-DNS bundle identifier. Once published to the App Store
  // this string is permanent for the lifetime of the listing —
  // Apple uses it to identify the app across versions, sandbox
  // groupings, push tokens, and paid-app entitlements. Don't change
  // it after first submission unless you want a brand new app
  // listing.
  appId: "app.standclear",
  appName: "StandClear",

  // webDir is the static-asset folder Capacitor copies into the
  // native bundle on `cap sync`. Because we're using `server.url`
  // below, the bundled assets are only used as a fallback splash /
  // offline-shell — actual app content streams from the live site.
  // Keeping the folder small keeps the native bundle slim.
  webDir: "native-shell",

  // Tell Capacitor to load the live site inside the WebView.
  // Setting this means the native bundle doesn't need to ship the
  // full Next.js export — just a thin shell. Web updates are
  // instant; native updates are reserved for shell or plugin
  // changes. cleartext: false forces HTTPS so a hostile network
  // can't downgrade the connection mid-session.
  //
  // The `standclear.app` URL is the brand target. Until the domain
  // is registered + DNS-pointed at the Vercel deploy, swap this
  // for the active Vercel preview URL (e.g. `standclear-xxx.vercel.app`)
  // so the simulator and TestFlight builds load real content. Re-run
  // `npm run cap:sync:ios` after editing so the change reaches the
  // Xcode project's bundled capacitor.config.json.
  server: {
    url: "https://standclear.app",
    cleartext: false,
    // androidScheme defaults to https — explicit for clarity.
    androidScheme: "https",
    // iOS only: when the app is a TWA-style WebView wrapper, this
    // ensures the iOS WebView and our domain share session cookies
    // so localStorage / favorites / commute pins persist between
    // app launches just like in mobile Safari.
    iosScheme: "https",
  },

  ios: {
    // The default WKWebView content-mode lets iOS pick mobile vs.
    // desktop. "mobile" is correct for a phone-first app — the
    // bottom-sheet panel chrome is laid out for compact viewports.
    contentInset: "always",
    // Optional: change to "always" if a deploy ever needs to clear
    // a cached service worker. Leave at default for production.
    limitsNavigationsToAppBoundDomains: false,
  },

  plugins: {
    SplashScreen: {
      // The dark "🚇 StandClear" splash matches the in-app theme so
      // the WebView's first paint isn't preceded by a white flash.
      // 1.2s is long enough to feel intentional, short enough not
      // to feel sluggish. The launch image itself is configured in
      // the iOS asset catalog (ios/App/App/Assets.xcassets) — see
      // NATIVE.md for the design specs.
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#0a0a0a",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // black-translucent matches the manifest's appleWebApp config
      // so the iOS status bar floats over the dark map without a
      // solid bar eating screen real estate.
      style: "DARK",
      backgroundColor: "#0a0a0a",
      overlaysWebView: true,
    },
  },
};

export default config;
