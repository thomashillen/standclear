import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// ─── /pricing OG card ─────────────────────────────────────────────────
// "Free" is the headline for the pricing page; the OG should land that
// in one glance. Mirrors the chrome of the default OG (brand row,
// headline, footer pill) with a "Pricing" surface pill and the price
// rendered as a giant "$0" so the card reads correctly even on the
// shrunken thumbnail platforms render in feed.
// Edge runtime — pure string + gradient render, no GTFS fs reads.

export const runtime = "edge";

export const alt = `${SITE_NAME} pricing — free, forever`;
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
            "radial-gradient(circle at 80% 20%, rgba(16,185,129,0.28), transparent 55%), radial-gradient(circle at 15% 85%, rgba(59,130,246,0.20), transparent 50%), linear-gradient(135deg, #050507 0%, #0a0a0f 50%, #11131a 100%)",
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
              background: "rgba(52,211,153,0.12)",
              border: "1px solid rgba(52,211,153,0.30)",
              fontSize: 22,
              color: "#a7f3d0",
            }}
          >
            Pricing
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 28,
            }}
          >
            <div
              style={{
                fontSize: 220,
                fontWeight: 900,
                letterSpacing: "-0.06em",
                lineHeight: 0.9,
                color: "#34d399",
                textShadow: "0 8px 32px rgba(52,211,153,0.30)",
              }}
            >
              $0
            </div>
            <div
              style={{
                fontSize: 36,
                color: "#d1d5db",
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              forever
            </div>
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              maxWidth: 1000,
            }}
          >
            Every train · every line · every feature.
          </div>
          <div
            style={{
              fontSize: 26,
              color: "#9ca3af",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              maxWidth: 1000,
            }}
          >
            No accounts · no ads · no tracking pixels · MIT-licensed.
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
          <div>standclear.app/pricing</div>
        </div>
      </div>
    ),
    size,
  );
}
