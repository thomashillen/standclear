import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// ─── /press OG card ───────────────────────────────────────────────────
// Per-page card so a tweeted /press link gets a card framed for that
// surface instead of the generic site OG. Mirrors the chrome of the
// other marketing OG cards (brand row, large headline, footer pill)
// and adds a "Press" pill so the surface is identifiable at a glance.
// Edge runtime — pure string + gradient render, no GTFS fs reads.

export const runtime = "edge";

export const alt = `${SITE_NAME} press kit`;
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
            "radial-gradient(circle at 80% 20%, rgba(244,114,182,0.20), transparent 55%), radial-gradient(circle at 15% 85%, rgba(56,189,248,0.18), transparent 50%), linear-gradient(135deg, #050507 0%, #0a0a0f 50%, #11131a 100%)",
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
              background: "rgba(244,114,182,0.12)",
              border: "1px solid rgba(244,114,182,0.30)",
              fontSize: 22,
              color: "#fbcfe8",
            }}
          >
            Press
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
            Press kit, brand assets, contact.
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
            One paragraph of boilerplate, every fact a writer needs,
            and a single contact link. Cleared for editorial use.
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
          <div>standclear.app/press</div>
        </div>
      </div>
    ),
    size,
  );
}
