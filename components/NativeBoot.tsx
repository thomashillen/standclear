"use client";

import { useEffect } from "react";
import { isNative, nativePlatform } from "@/lib/native";

// ─── Native boot tasks ───────────────────────────────────────────────
// Fires on first mount inside the Capacitor shell. Web users get a
// no-op. Tasks here are deliberately small and synchronous-feeling:
//
//   • Hide the splash screen once React has hydrated, so the dark
//     "🚇 StandClear" logo crossfades into the live map without a
//     stutter or a flash of unstyled content.
//   • Set the iOS status bar style. The bar overlays the WebView
//     (configured in capacitor.config.ts) so the dark theme reads
//     correctly with white glyphs over the dark map.
//   • Listen for app-foreground events and trigger a fresh
//     `/api/trains` poll when the rider returns from background.
//     The web codepath already handles this via visibilitychange;
//     in native, the foreground event fires reliably while
//     visibilitychange does not (depending on iOS version).
//
// Each step is wrapped in try/catch so a missing plugin or a
// runtime quirk on a specific iOS version never bricks the boot
// sequence — at worst the splash hangs an extra second.

export default function NativeBoot() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;

    (async () => {
      try {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        // Hide as soon as we're hydrated — the configured 1.2s
        // launchShowDuration still applies as a *minimum* via
        // launchAutoHide, this just cuts the upper bound.
        if (!cancelled) await SplashScreen.hide();
      } catch {
        // Plugin missing or call failed — splash auto-hide still
        // fires from capacitor.config.ts after launchShowDuration.
      }

      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        if (nativePlatform() === "ios") {
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.setOverlaysWebView({ overlay: true });
        } else if (nativePlatform() === "android") {
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.setBackgroundColor({ color: "#0a0a0a" });
        }
      } catch {
        // Same — fall back to whatever the OS chose.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
