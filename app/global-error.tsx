"use client";

// Top-level safety net. Next renders this when even the root layout
// throws — it has to declare its own <html> and <body> because the
// normal layout never rendered. Plain inline styles only (no Tailwind
// guarantee at this point in the tree).

import { useEffect } from "react";
import { captureException } from "@/lib/observability";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, {
      what: "global error boundary",
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#0a0a0a",
          color: "white",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 460, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 18 }} aria-hidden>
            🚇
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            StandClear is having a moment.
          </h1>
          <p
            style={{
              marginTop: 14,
              color: "#9ca3af",
              fontSize: 15,
              lineHeight: 1.55,
            }}
          >
            The whole app failed to render. Reloading usually fixes it.
            If not, please open an issue with the error ID below.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 12,
                fontSize: 11,
                color: "#4b5563",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "10px 22px",
              borderRadius: 9999,
              background: "white",
              color: "#0a0a0a",
              fontWeight: 600,
              fontSize: 14,
              border: "none",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
