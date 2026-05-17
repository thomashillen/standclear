import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_HOST } from "@/lib/site";

// ─── /terms OG card ───────────────────────────────────────────────────
// Per-page card so a tweeted /terms link gets a card framed for that
// surface instead of the generic site OG. Mirrors the chrome of the
// other marketing OG cards (brand row, large headline, footer pill)
// and adds a "Terms" pill so the surface is identifiable at a glance.
// Amber + slate tint reads "legal document" without leaning on the
// stock document-icon cliché.
// Edge runtime — pure string + gradient render, no GTFS fs reads.

export const runtime = "edge";

export const alt = `${SITE_NAME} terms of service — plain English`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          background:
            "radial-gradient(circle at 80% 20%, rgba(251,191,36,0.18), transparent 55%), radial-gradient(circle at 15% 85%, rgba(148,163,184,0.18), transparent 50%), linear-gradient(135deg, #050507 0%, #0a0a0f 50%, #11131a 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              fontSize: 56,
              lineHeight: 1,
              filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.4))",
            }}
          >
            🚇
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 900,
              letterSpacing: "-0.03em",
            }}
          >
            {SITE_NAME}
          </div>
          <div
            style={{
              marginLeft: 14,
              padding: "6px 14px",
              borderRadius: 999,
              background: "rgba(251,191,36,0.10)",
              border: "1px solid rgba(251,191,36,0.28)",
              fontSize: 22,
              color: "#fde68a",
            }}
          >
            Terms
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              maxWidth: 1000,
            }}
          >
            Plain English. No surprises.
          </div>
          <div
            style={{
              fontSize: 30,
              color: "#9ca3af",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              maxWidth: 1000,
            }}
          >
            Free to use. Informational, not authoritative. MIT-licensed
            source on GitHub.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#6b7280",
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#34d399",
                boxShadow: "0 0 16px #34d399",
              }}
            />
            <span>Streaming MTA GTFS-Realtime</span>
          </div>
          <div>{`${SITE_HOST}/terms`}</div>
        </div>
      </div>
    ),
    size,
  );
}
