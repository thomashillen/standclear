import { ImageResponse } from "next/og";
import { SITE_NAME, VERSION, APP_RELEASE_NAME, SITE_HOST } from "@/lib/site";

// ─── /changelog OG card ───────────────────────────────────────────────
// Surfaces the current version label so a tweeted changelog link reads
// "what shipped recently" at a glance instead of repeating the generic
// site-wide card. Mirrors chrome of the default OG with a "Changelog"
// surface pill and a sky-tinted version chip — sky matches the
// "changed" badge tint on the changelog page itself.
// Edge runtime — pure string + gradient render, no GTFS fs reads.

export const runtime = "edge";

export const alt = `${SITE_NAME} changelog — what shipped`;
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
            "radial-gradient(circle at 80% 20%, rgba(56,189,248,0.25), transparent 55%), radial-gradient(circle at 15% 85%, rgba(16,185,129,0.20), transparent 50%), linear-gradient(135deg, #050507 0%, #0a0a0f 50%, #11131a 100%)",
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
              background: "rgba(56,189,248,0.12)",
              border: "1px solid rgba(56,189,248,0.30)",
              fontSize: 22,
              color: "#bae6fd",
            }}
          >
            Changelog
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              maxWidth: 1000,
            }}
          >
            What shipped, what changed.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                background: "rgba(56,189,248,0.15)",
                border: "1px solid rgba(56,189,248,0.35)",
                color: "#e0f2fe",
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: "-0.02em",
              }}
            >
              {`v${VERSION}`}
            </div>
            <div
              style={{
                fontSize: 30,
                color: "#9ca3af",
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              {APP_RELEASE_NAME} · newest first
            </div>
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
          <div>{`${SITE_HOST}/changelog`}</div>
        </div>
      </div>
    ),
    size,
  );
}
