"use client";

// ─── Native runtime helpers ──────────────────────────────────────────
// `isNative()` answers "are we running inside the Capacitor iOS /
// Android shell?" at runtime. Used by:
//   • RegisterSW — skip service-worker registration in native, the
//     WebView's own cache layer is sufficient and a SW would shadow
//     it confusingly during offline transitions.
//   • Future native plugin call sites (Share, Haptics, etc.) — gate
//     plugin imports on isNative() so the same component file works
//     as both web and native code.
//
// Capacitor exposes a global `Capacitor` object on `window` from the
// runtime injection that happens inside the WebView. On web (Vercel,
// localhost) the global doesn't exist, so we feature-detect.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => "ios" | "android" | "web";
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  return typeof cap?.isNativePlatform === "function"
    ? cap.isNativePlatform()
    : false;
}

export type NativePlatform = "ios" | "android" | "web";

export function nativePlatform(): NativePlatform {
  if (typeof window === "undefined") return "web";
  const cap = window.Capacitor;
  return typeof cap?.getPlatform === "function" ? cap.getPlatform() : "web";
}

// Convenience for places that need the simple "is this iOS,
// regardless of native vs. web Safari" check. Native on iOS returns
// true; mobile Safari does NOT — use the user-agent detection in
// InstallPrompt for that case.
export function isNativeIos(): boolean {
  return isNative() && nativePlatform() === "ios";
}

// Subscribe to changes in app lifecycle (foreground / background)
// when running in native. On web this is a no-op. The callback
// receives `true` when the app comes to foreground.
//
// Capacitor's `App` plugin emits an "appStateChange" event with
// { isActive: boolean }. We dynamically import the plugin so the
// `@capacitor/app` package isn't pulled into the web bundle.
export async function subscribeNativeForeground(
  cb: (isActive: boolean) => void,
): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const { App } = await import("@capacitor/app");
    const handle = await App.addListener("appStateChange", ({ isActive }) => {
      cb(isActive);
    });
    return () => {
      handle.remove();
    };
  } catch {
    return () => {};
  }
}
