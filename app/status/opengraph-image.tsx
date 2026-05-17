import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_HOST } from "@/lib/site";

// ─── /status OG card ──────────────────────────────────────────────────
// Per-page card so a /status link previewed in chat/social gets a card
// framed for that surface. Mirrors the chrome of the other marketing
// OG cards (brand row, large headline, footer pill) and adds a "Status"
// surface pill plus a triple-dot row representing the three checks the
// page renders (MTA feed / static data / runtime). The dots are
// rendered as static emerald — the OG is generated at build / edge
// fetch time and can't reflect live state, but the green dots match
// the page's calm "operational" default and match the brand. A real
// outage will surface on the page itself; the OG is intentionally a
// "this exists, here's what it covers" surface, not a live mirror.
//
// /status is `noindex` (transient, see app/status/page.tsx) so search
// engines won't pin a snapshot. Social previews still render the OG
// because crawlers fetch og:image directly.
//
// Edge runtime — pure string + gradient render, no GTFS fs reads.

export const runtime = "edge";

export const alt = `${SITE_NAME} status — live system health`;
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
            "radial-gradient(circle at 80% 20%, rgba(16,185,129,0.28), transparent 55%), radial-gradient(circle at 15% 85%, rgba(56,189,248,0.18), transparent 50%), linear-gradient(135deg, #050507 0%, #0a0a0f 50%, #11131a 100%)",
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
            Status
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              maxWidth: 1000,
            }}
          >
            Live system health.
          </div>
          {/* Three-dot row mirrors the three checks the page renders.
              Static emerald — the OG can't reflect live state, but the
              dots reinforce the "calm operational default" idiom and
              cue the rider that the status surface exists. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontSize: 28,
              color: "#d1d5db",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: "#34d399",
                boxShadow: "0 0 18px rgba(52,211,153,0.7)",
              }}
            />
            <span>MTA feed</span>
            <span style={{ color: "#4b5563" }}>·</span>
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: "#34d399",
                boxShadow: "0 0 18px rgba(52,211,153,0.7)",
              }}
            />
            <span>Static data</span>
            <span style={{ color: "#4b5563" }}>·</span>
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: "#34d399",
                boxShadow: "0 0 18px rgba(52,211,153,0.7)",
              }}
            />
            <span>Runtime</span>
          </div>
          <div
            style={{
              fontSize: 28,
              color: "#9ca3af",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              maxWidth: 1000,
            }}
          >
            Three checks, refreshed every 15 seconds.
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
          <div>{`${SITE_HOST}/status`}</div>
        </div>
      </div>
    ),
    size,
  );
}
