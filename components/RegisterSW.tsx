"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/native";
import { captureException } from "@/lib/observability";

declare const process: { env: { NODE_ENV?: string } };

// Registers the service worker on first mount. We only register in
// production builds — in dev, Next.js's HMR pipeline fights cache-
// first SWs and you end up serving stale modules. The component
// renders nothing.
//
// Skipped entirely inside the Capacitor native shell. iOS WKWebView
// has its own cache layer that already covers the offline scenario
// the SW exists for, and a SW running inside Capacitor would shadow
// it during offline transitions in surprising ways (e.g. caching the
// fallback page from `native-shell/` then refusing to evict when the
// network returns).
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (isNative()) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // Route through observability so a failed registration lands
        // in /api/log alongside other client errors. Riders whose SW
        // registration silently fails (cache quota, locked storage,
        // CSP edge case) were previously invisible.
        captureException(err, { source: "service-worker-registration" });
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);

  return null;
}
