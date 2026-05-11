"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/observability";

declare const process: { env: { NODE_ENV?: string } };

// Registers the service worker on first mount. We only register in
// production builds — in dev, Next.js's HMR pipeline fights cache-
// first SWs and you end up serving stale modules. The component
// renders nothing.
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
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
